import type { AuthTokens } from "./types";

/**
 * Interface for token storage and retrieval.
 *
 * Implement this interface to provide custom token storage mechanisms.
 * The SDK provides several built-in implementations:
 * - {@link MemoryTokenProvider} - Stores tokens in memory (cleared on page refresh)
 * - {@link StorageTokenProvider} - Stores tokens in localStorage/sessionStorage
 * - {@link HybridTokenProvider} - Access token in memory, refresh token in storage
 *
 * @category Authentication
 */
export interface TokenProvider {
  /** Retrieve the current authentication tokens */
  getTokens(): AuthTokens | null;
  /** Store new authentication tokens */
  setTokens(tokens: AuthTokens | null): void;
  /** Clear all stored tokens (logout) */
  clearTokens(): void;
}

/**
 * In-memory token storage provider.
 *
 * Stores tokens in memory only - they are lost when the page refreshes.
 * Suitable for short-lived sessions or server-side rendering.
 *
 * @example
 * ```typescript
 * const tokenProvider = new MemoryTokenProvider();
 * const sdk = new CcPlatformSdk({ baseUrl: '...', tokenProvider });
 * ```
 *
 * @category Authentication
 */
export class MemoryTokenProvider implements TokenProvider {
  private tokens: AuthTokens | null;

  /**
   * Create a new memory token provider.
   * @param initialTokens - Optional initial tokens to set
   */
  constructor(initialTokens?: AuthTokens | null) {
    this.tokens = initialTokens ?? null;
    if (this.tokens) {
      console.log('🔑 TokenProvider: Initialized with tokens');
    } else {
      console.log('🔑 TokenProvider: Initialized without tokens');
    }
  }

  getTokens(): AuthTokens | null {
    const hasToken = !!this.tokens?.accessToken;
    if (!hasToken) {
      console.warn('🔑 TokenProvider: getTokens() called but no token available');
    }
    return this.tokens;
  }

  setTokens(tokens: AuthTokens | null): void {
    this.tokens = tokens;
    if (tokens) {
      console.log('🔑 TokenProvider: Tokens set successfully');
    } else {
      console.log('🔑 TokenProvider: Tokens cleared');
    }
  }

  clearTokens(): void {
    this.tokens = null;
    console.log('🔑 TokenProvider: Tokens cleared via clearTokens()');
  }
}

/**
 * Interface matching the Web Storage API (localStorage/sessionStorage).
 * @category Authentication
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Token provider that persists tokens in Web Storage (localStorage or sessionStorage).
 *
 * All tokens are stored together as a JSON object under a configurable key.
 *
 * @example
 * ```typescript
 * // Use localStorage for persistent tokens
 * const tokenProvider = new StorageTokenProvider(localStorage);
 *
 * // Use sessionStorage for session-only tokens
 * const tokenProvider = new StorageTokenProvider(sessionStorage, 'my_tokens');
 * ```
 *
 * @category Authentication
 */
export class StorageTokenProvider implements TokenProvider {
  /**
   * Create a new storage token provider.
   * @param storage - The storage implementation (localStorage, sessionStorage, or custom)
   * @param key - The key under which to store tokens (default: "auth_tokens")
   */
  constructor(
    private readonly storage: StorageLike,
    private readonly key: string = "auth_tokens",
  ) { }

  getTokens(): AuthTokens | null {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      return JSON.parse(raw) as AuthTokens;
    } catch {
      return null;
    }
  }

  setTokens(tokens: AuthTokens | null): void {
    if (!tokens) {
      this.storage.removeItem(this.key);
      return;
    }
    try {
      this.storage.setItem(this.key, JSON.stringify(tokens));
    } catch {
      /* ignore */
    }
  }

  clearTokens(): void {
    this.storage.removeItem(this.key);
  }
}

/**
 * Coordinates token refresh operations to prevent concurrent refresh requests.
 *
 * When multiple requests trigger token refresh simultaneously, this coordinator
 * ensures only one refresh operation runs while others wait for its result.
 *
 * @category Authentication
 */
export class RefreshCoordinator {
  private refreshing = false;
  private waiters: Array<{
    resolve: (tokens: AuthTokens) => void;
    reject: (error: unknown) => void;
  }> = [];

  async run(refreshFn: () => Promise<AuthTokens>): Promise<AuthTokens> {
    if (this.refreshing) {
      return new Promise<AuthTokens>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
    }

    this.refreshing = true;

    try {
      const tokens = await refreshFn();
      this.waiters.forEach((w) => w.resolve(tokens));
      this.waiters = [];
      return tokens;
    } catch (error) {
      this.waiters.forEach((w) => w.reject(error));
      this.waiters = [];
      throw error;
    } finally {
      this.refreshing = false;
    }
  }
}

/**
 * Interface for handling token refresh operations.
 * @category Authentication
 */
export interface RefreshHandler {
  /** Perform a token refresh and return the new tokens */
  refresh(): Promise<AuthTokens>;
}

/**
 * Hybrid token provider for enhanced security.
 *
 * Stores access tokens in memory (cleared on page refresh) and refresh tokens
 * in persistent storage. This is more secure because:
 * - Access tokens are short-lived and should be cleared when the page closes
 * - Refresh tokens are longer-lived and used to obtain new access tokens
 *
 * @example
 * ```typescript
 * const tokenProvider = new HybridTokenProvider(localStorage);
 * const sdk = new CcPlatformSdk({
 *   baseUrl: 'https://api.example.com',
 *   tokenProvider,
 * });
 * ```
 *
 * @category Authentication
 */
export class HybridTokenProvider implements TokenProvider {
  private accessToken: string | null = null;
  private readonly storage: StorageLike;
  private readonly refreshTokenKey: string;

  constructor(
    storage: StorageLike,
    initialTokens?: AuthTokens | null,
    refreshTokenKey: string = "refresh_token",
  ) {
    this.storage = storage;
    this.refreshTokenKey = refreshTokenKey;

    // Set initial access token in memory if provided
    if (initialTokens?.accessToken) {
      this.accessToken = initialTokens.accessToken;
      console.log('🔑 HybridTokenProvider: Initialized with access token in memory');
    }

    // Store refresh token in localStorage if provided
    if (initialTokens?.refreshToken) {
      this.storage.setItem(this.refreshTokenKey, initialTokens.refreshToken);
      console.log('🔑 HybridTokenProvider: Stored refresh token in localStorage');
    }

    // Log if we have a persisted refresh token
    const hasPersistedRefresh = !!this.storage.getItem(this.refreshTokenKey);
    if (hasPersistedRefresh) {
      console.log('🔑 HybridTokenProvider: Found persisted refresh token');
    }
  }

  getTokens(): AuthTokens | null {
    const refreshToken = this.storage.getItem(this.refreshTokenKey);

    if (!this.accessToken && !refreshToken) {
      return null;
    }

    const result: AuthTokens = {};
    if (this.accessToken) {
      result.accessToken = this.accessToken;
    }
    if (refreshToken) {
      result.refreshToken = refreshToken;
    }
    return result;
  }

  setTokens(tokens: AuthTokens | null): void {
    if (!tokens) {
      this.accessToken = null;
      this.storage.removeItem(this.refreshTokenKey);
      console.log('🔑 HybridTokenProvider: Cleared all tokens');
      return;
    }

    // Store access token in memory
    if (tokens.accessToken) {
      this.accessToken = tokens.accessToken;
      console.log('🔑 HybridTokenProvider: Set access token in memory');
    }

    // Store refresh token in localStorage
    if (tokens.refreshToken) {
      this.storage.setItem(this.refreshTokenKey, tokens.refreshToken);
      console.log('🔑 HybridTokenProvider: Stored refresh token in localStorage');
    }
  }

  clearTokens(): void {
    this.accessToken = null;
    this.storage.removeItem(this.refreshTokenKey);
    console.log('🔑 HybridTokenProvider: Cleared all tokens via clearTokens()');
  }
}
