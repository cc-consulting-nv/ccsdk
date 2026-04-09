import { decode as msgpackDecode } from "@msgpack/msgpack";
import { type AuthTokens, type ActingContext } from "./types";

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
export class HttpClient {
  private isRefreshing = false;
  private isLoggingOut = false;
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

    let parsed: unknown = null;

    if (isMsgpack) {
      // Parse MessagePack binary response
      const buffer = await response.arrayBuffer();
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

  private async refreshTokens(): Promise<AuthTokens | null> {
    // Guard: if we're already in the process of logging out, don't trigger
    // another refresh or onUnauthorized cascade.
    if (this.isLoggingOut) {
      return null;
    }

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

    this.isRefreshing = true;

    try {
      const tokens = await this.options.onRefreshTokens();
      this.refreshQueue.forEach((item) => item.resolve(tokens));
      this.refreshQueue = [];
      return tokens;
    } catch (error) {
      this.refreshQueue.forEach((item) => item.reject(error));
      this.refreshQueue = [];
      // Only call onUnauthorized once — prevent multiple concurrent 401s
      // from each triggering a separate logout cascade.
      if (!this.isLoggingOut) {
        this.isLoggingOut = true;
        await this.options.onUnauthorized?.();
      }
      return null;
    } finally {
      this.isRefreshing = false;
    }
  }
}
