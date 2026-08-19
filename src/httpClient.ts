import { decode as msgpackDecode } from "@msgpack/msgpack";
import { type AuthTokens, type ActingContext } from "./types.js";

/**
 * Configuration options for the HTTP client.
 * @category HTTP
 */
export interface HttpClientOptions {
  baseUrl: string;
  /**
   * Optional fetch implementation override (e.g., for tests).
   */
  fetchImpl?: typeof fetch;
  /**
   * Called to get the latest tokens before each request.
   */
  getAuthTokens?: () => AuthTokens | null | undefined;
  /**
   * Called to get the current acting context before each request.
   */
  getActingContext?: () => ActingContext | null | undefined;
  /**
   * Called when a refresh is needed. Should return fresh tokens.
   */
  onRefreshTokens?: () => Promise<AuthTokens>;
  /**
   * Called after a hard auth failure (refresh failed).
   */
  onUnauthorized?: () => Promise<void> | void;
  defaultHeaders?: Record<string, string>;
  /**
   * Enable MessagePack format for responses (more efficient than JSON).
   * Server must support Accept: application/msgpack header.
   */
  useMsgpack?: boolean;
}

/**
 * Options for individual HTTP requests.
 * @category HTTP
 */
export interface RequestOptions {
  /** Query parameters to append to the URL */
  query?: Record<string, unknown>;
  /** Request body (will be JSON stringified unless FormData) */
  body?: unknown;
  /** Additional headers to include */
  headers?: Record<string, string>;
  /** Skip authentication header injection */
  skipAuth?: boolean;
  /** Request credential mode (for cookie-backed auth flows) */
  credentials?: RequestCredentials;
}

/**
 * HTTP client with automatic token management and refresh.
 *
 * Handles authentication headers, token refresh on 401, and acting context
 * for delegated user operations.
 *
 * @example
 * ```typescript
 * const client = new HttpClient({
 *   baseUrl: 'https://api.example.com',
 *   getAuthTokens: () => tokenProvider.getTokens(),
 *   onRefreshTokens: () => sdk.refreshToken(),
 *   onUnauthorized: () => router.push('/login'),
 * });
 *
 * const data = await client.get<UserProfile>('/v1/users/me');
 * ```
 *
 * @category HTTP
 */
/**
 * Whether a rejected refresh handler means the session is definitively over
 * (latch the logout cascade) rather than transiently unavailable (leave the
 * latch down so a later request can retry).
 *
 * Definitive:
 * - `isAuthSessionExpired === true` — the handler explicitly said so.
 *   `AuthSessionExpiredError` carries this; duck-typed rather than
 *   `instanceof` so handlers from a different copy of the SDK still work.
 * - `status === 401` — the same rejection from a handler that rethrows a raw
 *   HTTP error.
 * - **no status at all** — a plain `throw new Error("refresh failed")`. This
 *   is the pre-existing contract every current consumer relies on, and the
 *   fail-closed default: a handler that cannot describe its failure gets the
 *   old behaviour (one logout cascade) rather than silent infinite 401s.
 *
 * Transient (explicitly NOT definitive): any other numeric status — 429, 408,
 * a captive portal's 400, and every 5xx.
 */
function isDefinitiveRefreshRejection(error: unknown): boolean {
  const e = error as { status?: unknown; isAuthSessionExpired?: unknown } | null | undefined;
  if (e?.isAuthSessionExpired === true) return true;
  const status = e?.status;
  if (typeof status !== "number") return true;
  return status === 401;
}

/**
 * How long a transient refresh failure suppresses further refresh attempts.
 *
 * Without this, N sequential 401s produce N refresh attempts back-to-back —
 * measured at 30 attempts in 9ms against a 429ing server, i.e. the client
 * manufactures the rate limiting that is already hurting it. A flat window is
 * enough: the trigger is a 401 on a real request, so attempts are already
 * paced by application traffic, and there is no thundering herd to spread out.
 */
const REFRESH_BACKOFF_MS = 5000;

export class HttpClient {
  private isRefreshing = false;
  private isLoggingOut = false;
  /**
   * Timestamp after which a refresh may be attempted again. Written only in
   * the transient-failure branch, and read ONLY synchronously at entry to
   * refreshTokens() — never across an `await`. That ordering is the point:
   * #168 regressed because a mutable flag was written, awaited past, then read
   * back and acted on, letting a concurrent refresh overwrite the verdict. A
   * gate checked before any work starts cannot be raced that way.
   */
  private refreshBlockedUntil = 0;
  private refreshQueue: Array<{
    resolve: (tokens: AuthTokens) => void;
    reject: (error: unknown) => void;
  }> = [];

  constructor(private readonly options: HttpClientOptions) { }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  async post<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  async put<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  async patch<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, options);
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path.startsWith("http") ? path : `${this.options.baseUrl}${path}`);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        url.searchParams.set(key, String(value));
      });
    }
    return url.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const isFormData = options?.body instanceof FormData;
    let body: BodyInit | null | undefined = undefined;

    if (options?.body !== undefined && method !== "GET") {
      body = isFormData ? (options.body as FormData) : JSON.stringify(options.body);
    }
    const acceptHeader = this.options.useMsgpack ? "application/msgpack" : "application/json";
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      "Accept": acceptHeader,
      "X-Requested-With": "XMLHttpRequest",
      ...(this.options.defaultHeaders ?? {}),
      ...(options?.headers ?? {}),
    };

    // Inject token if available
    if (!options?.skipAuth) {
      const tokens = this.options.getAuthTokens?.();
      if (tokens?.accessToken) {
        headers.Authorization = `Bearer ${tokens.accessToken}`;
      } else {
        // console.warn('⚠️  HTTP: No bearer token available for request:', method, path, {
        //   hasGetAuthTokens: !!this.options.getAuthTokens,
        //   tokensResult: tokens,
        // });
      }
    }

    // Inject acting context headers if present
    if (this.options.getActingContext) {
      const actingContext = this.options.getActingContext();
      if (actingContext?.token && actingContext?.managedUserUlid) {
        headers["X-Acting-Context-Token"] = actingContext.token;
        headers["X-Acting-User-ULID"] = actingContext.managedUserUlid;
      }
    }

    const url = this.buildUrl(path, options?.query);
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      credentials: options?.credentials,
    });

    if (response.status === 401 && !options?.skipAuth) {
      const refreshed = await this.refreshTokens();
      if (refreshed?.accessToken) {
        headers.Authorization = `Bearer ${refreshed.accessToken}`;
        const retry = await fetchImpl(url, {
          method,
          headers,
          body,
          credentials: options?.credentials,
        });

        return this.parseResponse<T>(retry);
      }
    }

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("Content-Type") || "";
    const isMsgpack = contentType.includes("msgpack");

    // Reject oversized responses before allocating the body to prevent OOM
    // from malicious or runaway payloads. Header check is best-effort
    // (Content-Length may be missing under chunked encoding); post-allocation
    // check below is the authoritative gate.
    const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
    const declaredLength = response.headers.get("Content-Length");
    if (declaredLength) {
      const n = parseInt(declaredLength, 10);
      if (Number.isFinite(n) && n > MAX_RESPONSE_BYTES) {
        throw new TypeError(
          `Response body too large: declared ${n} bytes (max ${MAX_RESPONSE_BYTES})`
        );
      }
    }

    let parsed: unknown = null;

    if (isMsgpack) {
      // Parse MessagePack binary response
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES) {
        throw new TypeError(
          `MessagePack response too large: ${buffer.byteLength} bytes (max ${MAX_RESPONSE_BYTES})`
        );
      }
      if (buffer.byteLength > 0) {
        try {
          parsed = msgpackDecode(new Uint8Array(buffer));
        } catch (err) {
          console.error("Failed to decode MessagePack response:", err);
          parsed = null;
        }
      }
    } else {
      // Parse JSON response
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new TypeError(
          `JSON response too large: ${text.length} bytes (max ${MAX_RESPONSE_BYTES})`
        );
      }
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          parsed = text;
        }
      }
    }

    if (!response.ok) {
      // Extract user-friendly message from API response if available
      let message = "Request failed";

      if (parsed && typeof parsed === "object" && "message" in parsed) {
        message = String(parsed.message);
      } else if (response.statusText) {
        message = response.statusText;
      }

      const error = new Error(message);
      (error as any).payload = parsed;
      (error as any).status = response.status;
      throw error;
    }

    return parsed as T;
  }

  /**
   * Clear the one-shot logout latch. Without this, the first failed-refresh /
   * onUnauthorized cascade disables 401-triggered refreshes for the lifetime
   * of the client — including after the user logs back in. The SDK calls
   * this whenever a new session is installed.
   */
  resetAuthLatch(): void {
    this.isLoggingOut = false;
    this.refreshBlockedUntil = 0;
  }

  private async refreshTokens(): Promise<AuthTokens | null> {
    // Guard: if we're already in the process of logging out, don't trigger
    // another refresh or onUnauthorized cascade.
    if (this.isLoggingOut) {
      return null;
    }

    // No refresh handler at all: a 401 is unrecoverable by construction, so
    // this latches unconditionally. Not an inconsistency with the transient
    // handling below — there is no retry that could ever succeed here.
    if (!this.options.onRefreshTokens) {
      this.isLoggingOut = true;
      await this.options.onUnauthorized?.();
      return null;
    }

    if (this.isRefreshing) {
      return new Promise<AuthTokens>((resolve, reject) => {
        this.refreshQueue.push({ resolve, reject });
      });
    }

    // Backoff gate. Checked synchronously, before any await, so it cannot be
    // raced by a concurrent refresh settling in between. Returning null here
    // is the same "refresh did not produce tokens" outcome the caller already
    // handles: request() falls through to parseResponse() and the caller sees
    // the original 401 instead of a doomed retry.
    if (Date.now() < this.refreshBlockedUntil) {
      return null;
    }

    this.isRefreshing = true;

    try {
      const tokens = await this.options.onRefreshTokens();
      this.refreshBlockedUntil = 0;
      this.refreshQueue.forEach((item) => item.resolve(tokens));
      this.refreshQueue = [];
      return tokens;
    } catch (error) {
      this.refreshQueue.forEach((item) => item.reject(error));
      this.refreshQueue = [];
      // Only latch on a *definitive* auth rejection. A transient failure
      // (offline, 5xx, timeout) must leave the latch down: it is cleared only
      // by setTokens() installing a session, which itself needs a successful
      // refresh — so latching here would wedge the client into permanent 401s
      // for every later request even once the network recovers.
      //
      // "Definitive" is what the handler *declares*, not a status range. A
      // handler signals it by rejecting with an error carrying
      // `isAuthSessionExpired` (AuthSessionExpiredError does) or a bare 401.
      // 429/408 are 4xx but transient, and a handler that rejects with a
      // plain Error is treated as definitive precisely because it cannot say
      // otherwise — see below.
      if (isDefinitiveRefreshRejection(error) && !this.isLoggingOut) {
        this.isLoggingOut = true;
        await this.options.onUnauthorized?.();
      } else if (!isDefinitiveRefreshRejection(error)) {
        // Transient: the session may still be good, so no latch — but stop
        // hammering. Written before any await in this branch, and never read
        // back here, so nothing depends on it surviving a suspension point.
        // Guarded on transient specifically rather than reusing the `else`:
        // an already-latched definitive rejection also lands there, and
        // arming a backoff on a dead session is meaningless noise.
        this.refreshBlockedUntil = Date.now() + REFRESH_BACKOFF_MS;
      }
      return null;
    } finally {
      this.isRefreshing = false;
    }
  }
}
