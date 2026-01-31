import { CacheDB, createCache } from "./cache/cacheDB";
import { HttpClient, type HttpClientOptions } from "./httpClient";
import { HybridTokenProvider, RefreshCoordinator, type TokenProvider } from "./auth";
import { MultipartUpload, type MultipartUploadOptions, type UploadResult } from "./multipartUpload";
import {
  type ApiEnvelope,
  type AuthTokens,
  type ActingContext,
  type UserProfile,
  type CurrentUser,
  type SuggestedUser,
  type FeedPage,
  type Post,
  type Poll,
  type Playlist,
  type Ulid,
  type SearchResult,
  type AudioSearchResult,
  type Badge,
  type BadgeProgress,
  type UploadJob,
  type SongChannel,
  type ChatGroup,
  type ChatMessage,
  type AppSettings,
  type NotificationType,
  type GenrePreferencesResponse,
  type GenrePreferenceUpdate,
  type TrendingGenre,
  type TrendingMusicUser,
  type TrendingHashtag,
  type TrendingSong,
  type SignupConfig,
  type DemographicResponseInput,
  type AgreementAcceptanceInput,
  type DashboardSummary,
  type DashboardTimeseries,
  type DashboardListeningDistribution,
  type DashboardHourlyActiveUsers,
  type AudioAd,
  type ModerationQueuePost,
  type ModerationQueueResponse,
  type ModerationActionResponse,
  type BlogPost,
  type BlogPostListItem,
  type BlogCategory,
  type BlogListOptions,
  type BlogListResponse,
  type BlogSearchOptions,
  type CreateBlogPostInput,
  type UpdateBlogPostInput,
  type WsomContest,
  type WsomEntry,
  type WsomRatingStats,
  type WsomFeedResponse,
  type WsomContestListResponse,
  type WsomEntryListResponse,
  type WsomContestResultsResponse,
  type WsomRateEntryResponse,
  type WsomCreateContestRequest,
  type WsomUpdateContestRequest,
  // Passkey types
  type Passkey,
  type PasskeyRegisterOptionsResponse,
  type PasskeyAuthenticateOptionsResponse,
  type PasskeyAuthenticateResponse,
  type PasskeyCheckResponse,
  type PasskeyListResponse,
  type PasskeyRegisterResponse,
  type PasskeyUpdateResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  // Poll types
  type PollUserVote,
  type BatchPollsResponse,
  // Push notification types
  type PushNotificationRegisterResponse,
  // Branding types
  type Branding,
  // Creation mode types
  type CreationModeType,
  type CreationModeVoteResponse,
  type CreationModeDeleteResponse,
  // Group types
  type Group,
  type GroupListResponse,
  type CreateGroupRequest,
  type GroupPost,
  type GroupMember,
  type GroupModerationLogEntry,
  type UpdateGroupRequest,
  // Image types
  type ImageVariants,
} from "./types";

/**
 * Convert a snake_case string to camelCase.
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Recursively convert all snake_case keys in an object to camelCase.
 * Handles Date objects, functions, and other non-serializable types safely.
 */
function snakeToCamelObject<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  // Handle primitive types (string, number, boolean, bigint, symbol)
  if (typeof obj !== "object") {
    return obj;
  }
  // Handle Date objects - convert to ISO string for IndexedDB compatibility
  if (obj instanceof Date) {
    return obj.toISOString() as T;
  }
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamelObject) as T;
  }
  // Handle plain objects only (exclude functions, class instances, etc.)
  if (typeof obj === "object" && obj.constructor === Object) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Skip functions and symbols (not serializable to IndexedDB)
      if (typeof value === "function" || typeof value === "symbol") {
        continue;
      }
      result[snakeToCamel(key)] = snakeToCamelObject(value);
    }
    return result as T;
  }
  // For other object types (class instances, etc.), return as-is
  return obj;
}

/**
 * Normalize poll data from snake_case (API) to camelCase (frontend).
 */
function normalizePoll(poll: Record<string, unknown>): Poll {
  return snakeToCamelObject(poll) as unknown as Poll;
}

/**
 * Generate a simple hash of an object for quick comparison.
 * Uses a fast string-based hash (djb2) for efficiency.
 */
function hashObject(obj: unknown): string {
  const str = JSON.stringify(obj, Object.keys(obj as object).sort());
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Extract engagement-related fields from a post for hashing.
 * These are the fields that the engagement polling endpoint returns.
 */
function extractEngagementData(post: Record<string, unknown>): Record<string, unknown> {
  return {
    postEngagement: post.postEngagement,
    userReaction: post.userReaction,
    userRating: post.userRating,
    ratingStats: post.ratingStats,
    // Include fields the engagement API may return
    isDeleted: post.isDeleted,
    isHidden: post.isHidden,
    isSensitive: post.isSensitive,
    otherRepostUsers: post.otherRepostUsers,
  };
}

/**
 * Check if SDK logging is enabled via environment variable.
 * Checks Vite (import.meta.env), browser (window/localStorage), and Node.js (process.env) environments.
 */
function isLoggingEnabled(): boolean {
  // Check Vite environment (browser/build-time) - Vite exposes env vars via import.meta.env
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importMeta = (globalThis as any).import?.meta;
    if (importMeta?.env) {
      const viteValue = (importMeta.env as Record<string, unknown>).VITE_SDK_ENABLE_LOGGING;
      if (viteValue !== undefined) {
        return viteValue === "true" || viteValue === true || viteValue === "1" || viteValue === 1;
      }
    }
  } catch {
    // Ignore errors when checking import.meta (may not be available in all environments)
  }
  
  // Check browser environment (window object or localStorage)
  if (typeof window !== "undefined") {
    // Check for global variable set by consuming app
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const windowAny = window as any;
    if (windowAny.__SDK_ENABLE_LOGGING__ !== undefined) {
      return windowAny.__SDK_ENABLE_LOGGING__ === true || windowAny.__SDK_ENABLE_LOGGING__ === "true";
    }
    
    // Check localStorage (useful for runtime toggling)
    try {
      const stored = localStorage.getItem("SDK_ENABLE_LOGGING");
      if (stored !== null) {
        return stored === "true" || stored === "1";
      }
    } catch {
      // Ignore localStorage errors (e.g., in private browsing)
    }
  }
  
  // Check Node.js environment
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processEnv = (globalThis as any).process?.env;
    if (processEnv) {
      const nodeValue = processEnv.SDK_ENABLE_LOGGING || processEnv.VITE_SDK_ENABLE_LOGGING;
      if (nodeValue !== undefined) {
        return nodeValue === "true" || nodeValue === "1";
      }
    }
  } catch {
    // Ignore errors when checking process.env
  }
  
  // Default to false (logging disabled)
  return false;
}

/**
 * Configuration options for the CC Platform SDK.
 */
export interface CcPlatformSdkOptions {
  /** Base URL of the API server (e.g., 'https://api.example.com') */
  baseUrl: string;
  /** Initial authentication tokens */
  tokens?: AuthTokens;
  /** Token storage provider (default: HybridTokenProvider) */
  tokenProvider?: TokenProvider;
  /**
   * Optional Dexie-backed cache. If omitted, a new cache instance is created.
   */
  cache?: CacheDB;
  /**
   * Optional database name for the IndexedDB cache. Default: "CcPlatformSdkCache"
   * Use a unique name per app to avoid cache collisions (e.g., "MusicCatalogCache")
   */
  dbName?: string;
  /**
   * Optional refresh handler. Called on 401, should return fresh tokens.
   */
  onRefreshTokens?: () => Promise<AuthTokens>;
  /**
   * Called when refresh fails.
   */
  onUnauthorized?: () => Promise<void> | void;
  /**
   * Enable SDK debug logging. If not specified, checks environment variables:
   * - VITE_SDK_ENABLE_LOGGING (Vite/browser environments)
   * - SDK_ENABLE_LOGGING (Node.js environments)
   * Defaults to false if not set.
   */
  enableLogging?: boolean;
  /**
   * Enable MessagePack format for API responses.
   * MessagePack is a binary format that's ~15% smaller than JSON and faster to parse.
   * Requires server support (Accept: application/msgpack header).
   * Defaults to false (JSON responses).
   */
  useMsgpack?: boolean;
}

/**
 * CC Platform SDK - The main entry point for interacting with the CC Platform API.
 *
 * This SDK provides a cache-aware, type-safe interface to the CC Platform API.
 * It uses IndexedDB (via Dexie) for offline caching and TanStack Query patterns
 * for efficient data fetching.
 *
 * ## Features
 *
 * - **Authentication**: Multiple auth methods (email/password, OAuth, magic link)
 * - **Feeds**: Fetch trending, following, discover, and genre-based feeds
 * - **Posts**: Create, update, delete, and interact with posts
 * - **Users**: Profile management, follow/block/mute relationships
 * - **Playlists**: Create and manage user playlists
 * - **Search**: Search posts, users, hashtags, and audio
 * - **Offline Caching**: All data cached in IndexedDB for offline access
 *
 * @example
 * ```typescript
 * import { CcPlatformSdk, HybridTokenProvider } from '@social/cc-platform-sdk';
 *
 * // Create SDK instance
 * const sdk = new CcPlatformSdk({
 *   baseUrl: 'https://api.example.com',
 *   tokenProvider: new HybridTokenProvider(localStorage),
 * });
 *
 * // Login
 * await sdk.login('user@example.com', 'password');
 *
 * // Fetch feed
 * const feed = await sdk.fetchTrendingFeed();
 *
 * // Get user profile
 * const { data: profile } = await sdk.getUserProfile('johndoe');
 * ```
 */
export class CcPlatformSdk {
  /** SDK version for cache busting - v2 adds requestAuthCode */
  static readonly SDK_VERSION = "2.0.0";
  private readonly tokens: TokenProvider;
  private readonly cachePromise: Promise<CacheDB>;
  private readonly client: HttpClient;
  private readonly refreshCoordinator = new RefreshCoordinator();
  private readonly postBatchDelay = 100;
  private postBatchQueue: Set<Ulid> = new Set();
  private postPendingResolvers: Map<
    Ulid,
    Array<{ resolve: (post: Post) => void; reject: (err: unknown) => void }>
  > = new Map();
  private postBatchTimer: number | null = null;

  // User profile batching - debounce and batch up to 20 ULIDs
  private readonly userBatchDelay = 50;
  private readonly userBatchMaxSize = 20;
  private userBatchQueue: Map<Ulid, string | number | undefined> = new Map(); // userId -> hintUpdatedAt
  private userPendingResolvers: Map<
    Ulid,
    Array<{ resolve: (user: UserProfile | null) => void; reject: (err: unknown) => void }>
  > = new Map();
  private userBatchTimer: number | null = null;

  // Engagement fetching - debounced and single-flight
  private readonly engagementBatchDelay = 100;
  private engagementBatchQueue: Set<Ulid> = new Set();
  private engagementPendingResolvers: Array<{
    ulids: Ulid[];
    resolve: (data: Record<string, unknown>) => void;
    reject: (err: unknown) => void;
  }> = [];
  private engagementBatchTimer: number | null = null;
  private engagementInFlight: Promise<Record<string, unknown>> | null = null;

  // Notification counts - single-flight request deduplication
  private notificationCountsInFlight: Promise<{
    total_count: number;
    read_count: number;
    read_count_false: number;
    seen_count: number;
    seen_count_false: number;
  }> | null = null;

  // Acting context for delegated user access
  private actingContext: ActingContext | null = null;

  // Logging state - check option first, then environment variable
  private readonly enableLogging: boolean;

  constructor(private readonly options: CcPlatformSdkOptions) {
    // Determine logging state: explicit option > environment variable > false
    this.enableLogging = options.enableLogging !== undefined 
      ? options.enableLogging 
      : isLoggingEnabled();
    // Use HybridTokenProvider by default (access token in memory, refresh token in localStorage)
    // This is more secure as access tokens are cleared on page refresh
    this.tokens = options.tokenProvider ?? new HybridTokenProvider(
      typeof localStorage !== "undefined" ? localStorage : {
        getItem: () => null,
        setItem: () => { },
        removeItem: () => { },
      },
      options.tokens,
    );
    this.cachePromise = options.cache ? Promise.resolve(options.cache) : createCache(undefined, options.dbName);

    const clientOptions: HttpClientOptions = {
      baseUrl: options.baseUrl.replace(/\/$/, ""),
      getAuthTokens: () => this.tokens.getTokens(),
      getActingContext: () => this.actingContext,
      onRefreshTokens: options.onRefreshTokens
        ? () => this.refreshCoordinator.run(options.onRefreshTokens!)
        : undefined,
      onUnauthorized: options.onUnauthorized,
      useMsgpack: options.useMsgpack,
    };

    this.client = new HttpClient(clientOptions);
  }

  /**
   * Conditional logging helper. Only logs if logging is enabled.
   */
  private log(...args: unknown[]): void {
    if (this.enableLogging) {
      console.log(...args);
    }
  }

  setTokens(tokens: AuthTokens | null): void {
    this.tokens.setTokens(tokens);
  }

  getTokens(): AuthTokens | null {
    return this.tokens.getTokens();
  }

  isAuthenticated(): boolean {
    const tokens = this.tokens.getTokens();
    return Boolean(tokens?.accessToken);
  }

  /**
   * Set the acting context for delegated user access.
   * All subsequent API requests will include acting context headers.
   */
  setActingContext(context: ActingContext | null): void {
    this.actingContext = context;

    // Persist to localStorage so it survives page reloads
    if (typeof localStorage !== "undefined") {
      if (context) {
        localStorage.setItem("actingContext", JSON.stringify(context));
      } else {
        localStorage.removeItem("actingContext");
      }
    }
  }

  /**
   * Get the current acting context.
   */
  getActingContext(): ActingContext | null {
    // Return in-memory value if available
    if (this.actingContext) {
      return this.actingContext;
    }

    // Try to load from localStorage if not in memory
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("actingContext");
      if (stored) {
        try {
          this.actingContext = JSON.parse(stored);
          return this.actingContext;
        } catch {
          // Invalid JSON, clear it
          localStorage.removeItem("actingContext");
        }
      }
    }

    return null;
  }

  /**
   * Clear the acting context.
   */
  clearActingContext(): void {
    this.actingContext = null;

    // Remove from localStorage
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("actingContext");
    }
  }

  /**
   * Check if currently acting as another user.
   */
  isActing(): boolean {
    if (!this.actingContext) return false;

    // Check if token has expired
    const expiresAt = new Date(this.actingContext.expiresAt).getTime();
    if (Date.now() >= expiresAt) {
      // Token expired, clear it
      this.clearActingContext();
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /**
   * Get the current authenticated user's profile
   * Returns null immediately if no auth token is set (avoids unnecessary API call)
   */
  async getCurrentUser(): Promise<CurrentUser | null> {
    // Check if we have tokens before making the API call
    const tokens = this.tokens.getTokens();
    if (!tokens?.accessToken) {
      return null;
    }

    try {
      const response = await this.client.get<ApiEnvelope<UserProfile>>("/v1/users/me");
      const profile = this.unwrap<UserProfile>(response);
      if (!profile) return null;

      // CRITICAL: Use JSON serialization to ensure we have a plain object without any methods
      // This prevents any methods from being accidentally attached to the profile
      const plainProfile = JSON.parse(JSON.stringify(profile)) as UserProfile;

      // Extract badges array from profile (API may return strings or objects with 'name')
      const rawBadges = (plainProfile as Record<string, unknown>).badges;
      const badges: string[] = [];
      if (Array.isArray(rawBadges)) {
        for (const badge of rawBadges) {
          if (typeof badge === "string") {
            badges.push(badge);
          } else if (badge && typeof badge === "object" && "name" in badge) {
            badges.push((badge as { name: string }).name);
          }
        }
      }

      // Create enhanced user with badges array (no methods - use utility functions instead)
      // This ensures the object can be safely stored in IndexedDB
      const currentUser: CurrentUser = {
        ...plainProfile,
        badges,
      };

      return currentUser;
    } catch {
      return null;
    }
  }

  /**
   * Update the current user's profile
   * Supports both Promise and callback patterns
   * When callback is provided, the PATCH request fires and returns immediately (non-blocking)
   * The read-after-write hook is called when the response arrives
   */
  async updateCurrentUser(
    payload: Partial<{
      displayName: string;
      username: string;
      bio: string;
      avatarUrl: string;
      email: string;
      website: string;
      background: string;
      accountSetup: boolean;
    }>,
    callback?: (error: Error | null, profile: UserProfile | null) => void
  ): Promise<UserProfile> {
    // Read-after-write hook: Fetch updated profile after write completes
    const readAfterWrite = async (response: ApiEnvelope<UserProfile>): Promise<UserProfile> => {
      const cache = await this.cachePromise;
      
      // If the API returns the updated user data, use it
      if (response.data) {
        // CRITICAL: Use JSON serialization to ensure we have a plain object without any methods
        // This strips functions, symbols, and other non-serializable values
        const rawData = JSON.parse(JSON.stringify(response.data)) as Record<string, unknown>;
        const normalized = this.normalizeUserProfile(rawData);
        await cache.setUser(normalized.ulid, normalized);
        return normalized;
      }

      // Fallback: The API returns 202 Accepted without user data, so fetch fresh profile
      let updatedProfile: UserProfile | null = null;

      if (this.actingContext) {
        // When acting, fetch the managed user's profile directly by ULID
        this.log('📡 SDK: Fetching managed user profile after update:', this.actingContext.managedUserUlid);
        const result = await this.getUserProfileById(this.actingContext.managedUserUlid);
        if (result.data) {
          // Use JSON serialization to ensure plain object
          updatedProfile = JSON.parse(JSON.stringify(result.data)) as UserProfile;
        }
      } else {
        // When not acting, fetch current user from API directly
        // NEVER use getCurrentUser() here as it returns CurrentUser with badges (but no methods now)
        const apiResponse = await this.client.get<ApiEnvelope<UserProfile>>("/v1/users/me");
        const unwrapped = this.unwrap<UserProfile>(apiResponse);
        if (unwrapped) {
          // Use JSON serialization to ensure plain object without any attached methods
          updatedProfile = JSON.parse(JSON.stringify(unwrapped)) as UserProfile;
        }
      }

      if (!updatedProfile) {
        throw new Error("Failed to fetch updated profile");
      }

      // Normalize and cache the profile
      const normalized = this.normalizeUserProfile(updatedProfile as unknown as Record<string, unknown>);
      await cache.setUser(normalized.ulid, normalized);

      return normalized;
    };

    // If callback provided, use non-blocking callback pattern
    if (callback) {
      // Use queueMicrotask to defer to the next microtask queue, ensuring truly non-blocking execution
      // This ensures the function returns immediately before any network I/O begins
      queueMicrotask(() => {
        this.client.patch<ApiEnvelope<UserProfile>>("/v1/users/me", {
          body: payload,
        })
          .then((response) => {
            // Read-after-write hook called when response arrives
            return readAfterWrite(response);
          })
          .then((profile) => {
            callback(null, profile);
          })
          .catch((error) => {
            console.error("SDK: Error in updateCurrentUser:", error);
            callback(error instanceof Error ? error : new Error(String(error)), null);
          });
      });
      
      // Return immediately without waiting for the request
      // The callback will be invoked when the response arrives
      return Promise.resolve({} as UserProfile);
    }

    // Otherwise, use blocking Promise pattern (for backwards compatibility)
    try {
      const response = await this.client.patch<ApiEnvelope<UserProfile>>("/v1/users/me", {
        body: payload,
      });
      return await readAfterWrite(response);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if a username is available
   * Returns true if available, false if taken
   */
  async checkUsernameAvailability(username: string): Promise<boolean> {
    try {
      await this.client.post<{ message: string }>("/v1/users/me/checkUsername", {
        body: { username },
      });
      return true; // 200 = available
    } catch (err: unknown) {
      const error = err as { status?: number };
      if (error.status === 403) {
        return false; // 403 = unavailable
      }
      throw err; // Other errors should propagate
    }
  }

  /**
   * Login with email and password.
   *
   * @param email - User's email address
   * @param password - User's password
   * @returns Authentication tokens (access and refresh)
   *
   * @example
   * ```typescript
   * const tokens = await sdk.login('user@example.com', 'password123');
   * console.log('Logged in, access token:', tokens.accessToken);
   * ```
   *
   * @category Authentication
   */
  async login(email: string, password: string): Promise<AuthTokens> {
    const response = await this.client.post<ApiEnvelope<AuthTokens>>("/v1/auth/login", {
      body: { email, password },
    });
    const tokens = this.unwrap<AuthTokens>(response);
    this.setTokens(tokens);
    return tokens;
  }

  /**
   * Login with OAuth authorization code (social login callback).
   *
   * @param provider - OAuth provider name (e.g., 'google', 'apple')
   * @param code - Authorization code from OAuth callback
   * @param redirectUri - The redirect URI used in the OAuth flow
   * @param extraData - Additional data for specific providers (e.g., Apple id_token)
   * @returns Authentication tokens
   *
   * @example
   * ```typescript
   * // Google OAuth callback
   * const tokens = await sdk.loginWithOAuth('google', authCode, redirectUri);
   *
   * // Apple OAuth with id_token
   * const tokens = await sdk.loginWithOAuth('apple', authCode, redirectUri, {
   *   id_token: appleIdToken,
   *   user: userInfo
   * });
   * ```
   *
   * @category Authentication
   */
  async loginWithOAuth(
    provider: string,
    code: string,
    redirectUri?: string,
    extraData?: { id_token?: string | null; user?: string | null },
  ): Promise<AuthTokens> {
    const body: Record<string, string | undefined> = { code };
    if (redirectUri) {
      body.redirect_uri = redirectUri;
    }
    // Add extra data for Apple OAuth (id_token and user info)
    if (extraData?.id_token) {
      body.id_token = extraData.id_token;
    }
    if (extraData?.user) {
      body.user = extraData.user;
    }
    const response = await this.client.post<Record<string, unknown>>(`/v1/auth/${provider}/callback`, {
      body,
    });
    // The OAuth callback endpoint returns a flat response with snake_case keys
    const tokens: AuthTokens = {
      accessToken: (response.access_token as string) || (response.accessToken as string),
      refreshToken: (response.refresh_token as string) || (response.refreshToken as string),
    };
    this.setTokens(tokens);
    return tokens;
  }

  /**
   * Login with a magic link code (6-digit auth code).
   *
   * @param identifier - Email or phone number
   * @param authCode - 6-digit code (string or number, will be converted to integer)
   * @returns Authentication tokens
   *
   * @example
   * ```typescript
   * // Request magic link first
   * await sdk.requestMagicLink('user@example.com');
   *
   * // Then login with the code from email
   * const tokens = await sdk.loginWithMagicLink('user@example.com', '123456');
   * ```
   *
   * @category Authentication
   */
  async loginWithMagicLink(identifier: string, authCode: string | number): Promise<AuthTokens> {
    interface AuthCodeResponse {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
    }
    // API expects authCode as integer
    const response = await this.client.post<AuthCodeResponse>("/authCodeLogin", {
      body: { identifier, authCode: parseInt(String(authCode), 10) },
    });
    // The authCodeLogin endpoint returns a flat response, not wrapped in ApiEnvelope
    const tokens: AuthTokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
    };
    this.setTokens(tokens);
    return tokens;
  }

  /**
   * Request a magic link (auth code) to be sent to an email address.
   *
   * @param email - Email address to send the auth code to
   * @param options - Optional referral and routing data
   *
   * @example
   * ```typescript
   * await sdk.requestMagicLink('user@example.com', { referralCode: 'REF123' });
   * // User receives email with 6-digit code
   * ```
   *
   * @category Authentication
   */
  async requestMagicLink(
    email: string,
    options?: {
      referralCode?: string;
      redirect?: string;
      platform?: string;
    },
  ): Promise<void> {
    const body: Record<string, unknown> = { email };

    if (options?.referralCode) {
      body.ref = options.referralCode;
    }
    if (options?.redirect) {
      body.redirect = options.redirect;
    }
    if (options?.platform) {
      body.platform = options.platform;
    }

    await this.client.post("/sendMagicLink", {
      body,
    });
  }

  /**
   * Request an auth code to be sent to an email address.
   * This is a simpler alternative to magic links that sends a 6-digit code.
   *
   * @param email - Email address to send the auth code to
   * @param options - Optional referral and routing data
   *
   * @example
   * ```typescript
   * await sdk.requestAuthCode('user@example.com');
   * // User receives email with 6-digit code
   * // Then call loginWithMagicLink() with the code
   * const tokens = await sdk.loginWithMagicLink('user@example.com', '123456');
   * ```
   *
   * @category Authentication
   */
  async requestAuthCode(
    email: string,
    options?: {
      referralCode?: string;
      redirect?: string;
      platform?: string;
    },
  ): Promise<void> {
    const body: Record<string, unknown> = { email };

    if (options?.referralCode) {
      body.ref = options.referralCode;
    }
    if (options?.redirect) {
      body.redirect = options.redirect;
    }
    if (options?.platform) {
      body.platform = options.platform;
    }

    await this.client.post("/sendAuthCode", {
      body,
    });
  }

  /**
   * Register a new user account.
   *
   * @param payload - Registration details
   * @param payload.email - User's email address
   * @param payload.password - User's password
   * @param payload.username - Unique username (handle)
   * @param payload.displayName - Optional display name
   * @returns Authentication tokens for the new account
   *
   * @example
   * ```typescript
   * const tokens = await sdk.register({
   *   email: 'user@example.com',
   *   password: 'securePassword123',
   *   username: 'newuser',
   *   displayName: 'New User'
   * });
   * ```
   *
   * @category Authentication
   */
  async register(payload: {
    email: string;
    password: string;
    username: string;
    displayName?: string;
  }): Promise<AuthTokens> {
    const response = await this.client.post<ApiEnvelope<AuthTokens>>("/v1/auth/register", {
      body: payload,
    });
    const tokens = this.unwrap<AuthTokens>(response);
    this.setTokens(tokens);
    return tokens;
  }

  /**
   * Logout the current user and clear all tokens.
   *
   * Also clears the local cache to remove any cached user data.
   *
   * @example
   * ```typescript
   * await sdk.logout();
   * // User is now logged out, redirect to login page
   * ```
   *
   * @category Authentication
   */
  async logout(): Promise<void> {
    try {
      await this.client.post("/v1/auth/logout");
    } finally {
      this.setTokens(null);
      await this.clearCache();
    }
  }

  /**
   * Delete the current user's account (soft delete).
   *
   * This permanently marks the account as deleted. The user will be logged out
   * and all tokens will be invalidated. This action cannot be undone by the user.
   *
   * @example
   * ```typescript
   * // Show confirmation dialog first
   * if (confirm('Are you sure you want to delete your account?')) {
   *   await sdk.deleteAccount();
   *   // Redirect to home page
   *   router.push('/');
   * }
   * ```
   *
   * @category Authentication
   */
  async deleteAccount(): Promise<void> {
    await this.client.delete("/v1/users/me");
    this.setTokens(null);
    await this.clearCache();
  }

  /**
   * Refresh the access token using the stored refresh token.
   *
   * @returns New authentication tokens, or null if refresh failed
   *
   * @example
   * ```typescript
   * const tokens = await sdk.refreshToken();
   * if (!tokens) {
   *   // Refresh failed, redirect to login
   *   router.push('/login');
   * }
   * ```
   *
   * @category Authentication
   */
  async refreshToken(): Promise<AuthTokens | null> {
    const currentTokens = this.getTokens();
    if (!currentTokens?.refreshToken) return null;

    try {
      // Note: /auth/refresh endpoint doesn't have /v1 prefix in the API
      const response = await this.client.post<ApiEnvelope<AuthTokens>>("/auth/refresh", {
        body: { refresh_token: currentTokens.refreshToken },
      });
      const tokens = this.unwrap<AuthTokens>(response);
      this.setTokens(tokens);
      return tokens;
    } catch {
      this.setTokens(null);
      return null;
    }
  }

  /**
   * Request password reset email
   */
  async requestPasswordReset(email: string): Promise<void> {
    await this.client.post("/v1/auth/password/forgot", {
      body: { email },
    });
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, password: string, passwordConfirmation: string): Promise<void> {
    await this.client.post("/v1/auth/password/reset", {
      body: { token, password, password_confirmation: passwordConfirmation },
    });
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(currentPassword: string, newPassword: string, newPasswordConfirmation: string): Promise<void> {
    await this.client.post("/v1/auth/password/change", {
      body: {
        current_password: currentPassword,
        password: newPassword,
        password_confirmation: newPasswordConfirmation,
      },
    });
  }

  /**
   * Fetch a single post by ULID using cache → API resolution.
   */
  async getPostByUlid(postUlid: Ulid, forceRefresh = false): Promise<Post | null> {
    const cache = await this.cachePromise;
    if (!forceRefresh) {
      const cached = await cache.getPost(postUlid);
      if (cached) return cached;
    }

    // When forceRefresh is true, bypass the batch cache and fetch directly from API
    if (forceRefresh) {
      try {
        const payload = await this.client.post<ApiEnvelope<Post[]>>("/v1/posts", {
          body: { ulids: [postUlid] },
        });
        const posts = this.unwrap<Post[]>(payload);
        if (Array.isArray(posts) && posts.length > 0) {
          const post = this.normalizePost(posts[0]);
          const id = (post.ulid || post.id) as Ulid;
          if (id) {
            await cache.setPost(id, post);
          }
          return post;
        }
        return null;
      } catch (err) {
        console.error(`[SDK] Failed to force-refresh post ${postUlid}:`, err);
        return null;
      }
    }

    const results = await this.fetchPostsBatch([postUlid]);
    return results[postUlid] ?? null;
  }

  /**
   * Batch fetch posts with three-tier resolution: cache → API.
   */
  async fetchPostsBatch(postUlids: Ulid[]): Promise<Record<Ulid, Post>> {
    const cache = await this.cachePromise;
    const uniqueIds = Array.from(new Set(postUlids));
    const results: Record<Ulid, Post> = {};

    this.log(`[SDK] 📥 fetchPostsBatch called with ${uniqueIds.length} IDs`, uniqueIds.slice(0, 3));
    console.log(`[SDK] 📥 fetchPostsBatch called with ${uniqueIds.length} IDs`, uniqueIds.slice(0, 5));

    // 1) Cache hits
    const cached = await cache.getPosts(uniqueIds);
    Object.assign(results, cached);
    console.log(`[SDK] 💾 Cache hits: ${Object.keys(cached).length}/${uniqueIds.length}`);
    if (Object.keys(cached).length > 0) {
      const firstCached = Object.values(cached)[0] as any;
      console.log(`[SDK] 💾 First cached post:`, {
        ulid: firstCached?.ulid,
        hasTitle: !!firstCached?.title,
        hasAudio: !!firstCached?.audio,
        audioLength: firstCached?.audio?.length,
        hasStreamUrl: !!firstCached?.streamUrl,
        keys: firstCached ? Object.keys(firstCached).slice(0, 15) : [],
      });
    }

    // 2) Fetch remaining via API
    const missing = uniqueIds.filter((id) => !results[id]);
    console.log(`[SDK] 🔍 Missing from cache: ${missing.length}`, missing.slice(0, 5));
    if (missing.length === 0) {
      console.log(`[SDK] ⏩ All posts found in cache, skipping API call`);
      return results;
    }

    if (missing.length === 0) {
      return results;
    }

    // Debounce batch POST /v1/posts
    this.log(`[SDK] ⏱️  Setting up batch timeout (delay: ${this.postBatchDelay}ms)`);
    const promises = missing.map(
      (id) =>
        new Promise<Post>((resolve, reject) => {
          this.postBatchQueue.add(id);
          if (!this.postPendingResolvers.has(id)) {
            this.postPendingResolvers.set(id, []);
          }
          this.postPendingResolvers.get(id)!.push({ resolve, reject });
        }),
    );

    if (this.postBatchTimer !== null) {
      clearTimeout(this.postBatchTimer);
    }

    this.postBatchTimer = window.setTimeout(() => {
      this.flushPostBatch(cache);
    }, this.postBatchDelay);

    const settled = await Promise.allSettled(promises);
    const fulfilled = settled.filter((result): result is PromiseFulfilledResult<Post> => result.status === 'fulfilled');
    const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    if (rejected.length > 0) {
      console.warn(`[SDK] ⚠️  ${rejected.length}/${settled.length} posts failed to fetch:`, rejected.map(r => r.reason.message));
    }

    this.log(`[SDK] ✅ Successfully fetched ${fulfilled.length}/${settled.length} posts`);
    fulfilled.forEach((result) => {
      const post = result.value;
      const id = (post.ulid || post.id) as Ulid;
      if (id) {
        results[id] = post;
      }
    });

    return results;
  }

  private async flushPostBatch(cache: CacheDB): Promise<void> {
    const idsToFetch = Array.from(this.postBatchQueue);
    this.postBatchQueue.clear();
    this.postBatchTimer = null;

    if (idsToFetch.length === 0) return;

    this.log(`[SDK] 🔄 Flushing post batch: ${idsToFetch.length} posts`, idsToFetch.slice(0, 3));

    try {
      const payload = await this.client.post<ApiEnvelope<Post[]>>("/v1/posts", {
        body: { ulids: idsToFetch },
      });
      this.log(`[SDK] ✅ POST /v1/posts response received`, { payload: typeof payload });
      const posts = this.unwrap<Post[]>(payload);
      this.log(`[SDK] 📦 Unwrapped posts:`, { isArray: Array.isArray(posts), length: Array.isArray(posts) ? posts.length : 0 });
      if (!Array.isArray(posts)) {
        console.warn(`[SDK] ⚠️  Posts is not an array!`, { posts });
        return;
      }
      const mapped = posts.reduce<Record<Ulid, Post>>((acc, post, index) => {
        const id = (post.ulid || post.id) as Ulid;
        if (index < 2) {
          this.log(`[SDK] 🔑 Post ${index}:`, { ulid: post.ulid, id: post.id, hasUlid: !!post.ulid, hasId: !!post.id, keys: Object.keys(post).slice(0, 10) });
        }
        if (!id) {
          console.warn(`[SDK] ⚠️  Post ${index} has no ulid or id!`, { keys: Object.keys(post) });
          return acc;
        }
        // Normalize postType -> type (API returns postType, SDK uses type)
        const normalized = this.normalizePost(post);
        if (index < 2) {
          this.log(`[SDK] ✨ Normalized post ${index}:`, { 
            ulid: normalized.ulid, 
            type: normalized.type,
            hasTitle: !!normalized.title,
            title: normalized.title,
            hasImages: !!normalized.images,
            imagesLength: Array.isArray(normalized.images) ? normalized.images.length : 0,
          });
        }
        acc[id] = normalized;
        return acc;
      }, {});
      this.log(`[SDK] 🗺️  Mapped ${Object.keys(mapped).length} posts from ${posts.length} raw posts`);

      await cache.setPosts(mapped);
      this.log(`[SDK] 🎯 Resolving promises for ${idsToFetch.length} IDs with ${Object.keys(mapped).length} posts`);
      idsToFetch.forEach((id) => {
        const resolvers = this.postPendingResolvers.get(id) || [];
        const post = mapped[id];
        resolvers.forEach(({ resolve, reject }) => {
          if (post) {
            resolve(post);
          } else {
            console.warn(`[SDK] ❌ Post ${id} not returned from API`);
            reject(new Error(`Post ${id} not returned`));
          }
        });
        this.postPendingResolvers.delete(id);
      });
    } catch (err) {
      idsToFetch.forEach((id) => {
        const resolvers = this.postPendingResolvers.get(id) || [];
        resolvers.forEach(({ reject }) => reject(err));
        this.postPendingResolvers.delete(id);
      });
    }
  }

  /**
   * Default limit for feed pages - max supported by API is 100.
   */
  static readonly DEFAULT_FEED_LIMIT = 50;

   /**
   * Fetch a feed page from /v1/songs/feed/all (configurable), hydrate posts via batch fetch,
   * and cache ULID ordering for offline/instant reload.
   * @param endpoint - API endpoint path
   */
  async fetchFeedCount(endpoint: string): Promise<number> {
    // Append /count to the endpoint if not already present
    const countEndpoint = endpoint.endsWith('/count') 
      ? endpoint 
      : `${endpoint}/count`;

    const response = await this.client.get<{ count: number }>(countEndpoint);
    return response.count ?? 0;
  }

  /**
   * Fetch a feed page from /v1/songs/feed/all (configurable), hydrate posts via batch fetch,
   * and cache ULID ordering for offline/instant reload.
   * @param cursor - Pagination cursor for next page
   * @param endpoint - API endpoint path
   * @param cacheKey - Cache key for storing results
   * @param limit - Number of items per page (default: 100, max: 100)
   */
  async fetchFeedPage(
    cursor?: string | null,
    endpoint = "/v1/songs/feed/all",
    cacheKey: string = endpoint,
    limit: number = CcPlatformSdk.DEFAULT_FEED_LIMIT,
  ): Promise<FeedPage> {
    // Handle endpoints that already have query params (e.g., /v1/feeds/timeline?types=post&my_stuff=true)
    let baseEndpoint = endpoint;
    let queryParams: Record<string, string> = {};

    const queryIndex = endpoint.indexOf("?");
    if (queryIndex !== -1) {
      baseEndpoint = endpoint.substring(0, queryIndex);
      const searchParams = new URLSearchParams(endpoint.substring(queryIndex + 1));
      searchParams.forEach((value, key) => {
        queryParams[key] = value;
      });
    }

    // Add cursor if provided
    if (cursor) {
      queryParams.cursor = cursor;
    }

    // Add limit parameter (capped at 100 by API)
    queryParams.limit = String(Math.min(limit, 100));

    const response = await this.client.get<ApiEnvelope<{ ulid: Ulid }[]>>(baseEndpoint, {
      query: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    });

    const envelope = response as ApiEnvelope<any[]>;
    const collection = this.unwrap<any[]>(envelope);

    // Handle case where collection is not an array (e.g., empty response or different format)
    if (!Array.isArray(collection)) {
      console.warn(`fetchFeedPage: Expected array from ${endpoint}, got:`, typeof collection);
      return { ulids: [], posts: [], nextCursor: null };
    }

    // Handle empty collection
    if (collection.length === 0) {
      return { ulids: [], posts: [], nextCursor: null };
    }

    const nextCursor = this.extractNextCursor(envelope);

    // Check if collection contains full post objects (with actual content) or just feed items
    // Feed items have ulid + metadata but lack content fields like body, title, content
    const firstItem = collection[0];
    const hasContentFields = firstItem && (
      firstItem.body !== undefined ||
      firstItem.title !== undefined ||
      firstItem.content !== undefined ||
      firstItem.song_title !== undefined ||
      firstItem.songTitle !== undefined
    );

    if (hasContentFields) {
      // Collection contains full post objects - use them directly
      const posts = collection.map((item) => this.normalizePost(item)).filter(Boolean) as Post[];
      const ulids = posts.map((p) => p.ulid).filter((id): id is string => Boolean(id));
      return { ulids, posts, nextCursor: nextCursor ?? null };
    }

    const ulids = collection.map((item) => item.ulid).filter(Boolean);
    this.log(`[SDK] 📋 Extracted ${ulids.length} ULIDs from collection`, ulids.slice(0, 3));

    // Build a map of ulid -> feed item metadata for enrichment
    const feedItemMap = collection.reduce<Record<Ulid, Record<string, unknown>>>((acc, item) => {
      const ulid = item.ulid;
      if (ulid) {
        acc[ulid] = {
          userId: item.userId || item.user_ulid || item.userULID,
          groupUlid: item.groupUlid,
          groupName: item.groupName,
          commentCount: item.commentCount,
          isLikedByProfileUser: item.isLikedByProfileUser,
        };
      }
      return acc;
    }, {});
    this.log(`[SDK] 👤 Built feedItemMap with ${Object.keys(feedItemMap).length} entries`);

    let posts: Post[] = [];
    if (ulids.length > 0) {
      this.log(`[SDK] 🔄 Calling fetchPostsBatch with ${ulids.length} ULIDs...`);
      const hydrated = await this.fetchPostsBatch(ulids);
      this.log(`[SDK] ✅ fetchPostsBatch returned ${Object.keys(hydrated).length} posts`);

      // Enrich posts with metadata from feed items
      posts = ulids
        .map((id) => {
          const post = hydrated[id];
          if (!post) return null;
          const feedMeta = feedItemMap[id] || {};
          // Merge feed item metadata into post (feed item values override if post doesn't have them)
          return {
            ...post,
            userId: post.userId || feedMeta.userId,
            groupUlid: post.groupUlid || feedMeta.groupUlid,
            groupName: post.groupName || feedMeta.groupName,
            commentCount: feedMeta.commentCount ?? post.commentCount,
            isLikedByProfileUser: feedMeta.isLikedByProfileUser,
          } as Post;
        })
        .filter((post): post is Post => Boolean(post));

      const cache = await this.cachePromise;
      await cache.appendToFeedResource(cacheKey, ulids, nextCursor ?? null);

      // Hydrate users based on hints from feed items
      const hints = collection
        .map((item) => ({
          userId: item.userId || item.user_ulid || item.userULID,
          userUpdatedAt: item.userUpdatedAtEpoch || item.userUpdatedAt,
        }))
        .filter((h) => h.userId);
      await this.hydrateUsersFromHints(hints as any[]);
    }

    return {
      ulids,
      posts,
      nextCursor,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Feed Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch the trending songs feed.
   *
   * @param cursor - Pagination cursor for fetching next page
   * @param cacheKey - Cache key override (default: endpoint path)
   * @returns A page of trending posts/songs
   *
   * @example
   * ```typescript
   * const page = await sdk.fetchTrendingFeed();
   * for (const post of page.posts) {
   *   console.log(post.title, post.artist);
   * }
   * ```
   *
   * @category Feeds
   */
  async fetchTrendingFeed(
    cursor?: string | null,
    cacheKey: string = "/v1/songs/feed/trending",
  ): Promise<FeedPage> {
    return this.fetchFeedPage(cursor, "/v1/songs/feed/trending", cacheKey);
  }

  /**
   * Fetch the following feed (posts from users you follow).
   *
   * @param cursor - Pagination cursor for fetching next page
   * @param cacheKey - Cache key override
   * @returns A page of posts from followed users
   *
   * @category Feeds
   */
  async fetchFollowingFeed(
    cursor?: string | null,
    cacheKey: string = "/v1/songs/feed/following",
  ): Promise<FeedPage> {
    return this.fetchFeedPage(cursor, "/v1/songs/feed/following", cacheKey);
  }

  /**
   * Fetch the discover feed (recommended content).
   *
   * @param cursor - Pagination cursor for fetching next page
   * @param cacheKey - Cache key override
   * @returns A page of recommended posts
   *
   * @category Feeds
   */
  async fetchDiscoverFeed(
    cursor?: string | null,
    cacheKey: string = "/v1/songs/feed/discover",
  ): Promise<FeedPage> {
    return this.fetchFeedPage(cursor, "/v1/songs/feed/discover", cacheKey);
  }

  /**
   * Fetch the latest feed (most recent posts).
   *
   * @param cursor - Pagination cursor for fetching next page
   * @param cacheKey - Cache key override
   * @returns A page of the most recent posts
   *
   * @category Feeds
   */
  async fetchLatestFeed(
    cursor?: string | null,
    cacheKey: string = "/v1/songs/feed/latest",
  ): Promise<FeedPage> {
    return this.fetchFeedPage(cursor, "/v1/songs/feed/latest", cacheKey);
  }

  /**
   * Fetch a genre-specific feed.
   *
   * @param genrePath - Genre path (e.g., 'hip-hop', 'electronic/house')
   * @param cursor - Pagination cursor for fetching next page
   * @param cacheKey - Cache key override
   * @returns A page of posts in the specified genre
   *
   * @example
   * ```typescript
   * const page = await sdk.fetchGenreFeed('hip-hop');
   * ```
   *
   * @category Feeds
   */
  async fetchGenreFeed(
    genrePath: string,
    cursor?: string | null,
    cacheKey?: string,
  ): Promise<FeedPage> {
    const encoded = encodeURIComponent(genrePath);
    const endpoint = `/v1/songs/feed/genre/${encoded}`;
    return this.fetchFeedPage(cursor, endpoint, cacheKey ?? endpoint);
  }

  /**
   * Fetch the popular genres feed.
   *
   * @param cursor - Pagination cursor
   * @param cacheKey - Cache key override
   * @returns A page of posts from popular genres
   *
   * @category Feeds
   */
  async fetchPopularGenresFeed(
    cursor?: string | null,
    cacheKey: string = "/v1/songs/feed/genres/popular",
  ): Promise<FeedPage> {
    return this.fetchFeedPage(cursor, "/v1/songs/feed/genres/popular", cacheKey);
  }

  /**
   * Fetch the trending genres feed.
   *
   * @param cursor - Pagination cursor
   * @param cacheKey - Cache key override
   * @returns A page of posts from trending genres
   *
   * @category Feeds
   */
  async fetchTrendingGenresFeed(
    cursor?: string | null,
    cacheKey: string = "/v1/songs/feed/trending/genres",
  ): Promise<FeedPage> {
    return this.fetchFeedPage(cursor, "/v1/songs/feed/trending/genres", cacheKey);
  }

  /**
   * Fetch the trending users feed.
   *
   * @param cursor - Pagination cursor
   * @param cacheKey - Cache key override
   * @returns A page of posts from trending users
   *
   * @category Feeds
   */
  async fetchTrendingUsersFeed(
    cursor?: string | null,
    cacheKey: string = "/v1/songs/feed/trending/users",
  ): Promise<FeedPage> {
    return this.fetchFeedPage(cursor, "/v1/songs/feed/trending/users", cacheKey);
  }

  /**
   * Fetch unrated songs feed for the rating feature.
   * Returns songs the user hasn't rated yet, optionally filtered by genre.
   *
   * @param options - Optional filters (genreIds, limit)
   * @returns Promise resolving to a FeedPage with unrated songs
   *
   * @example
   * ```typescript
   * // Get unrated songs across all genres
   * const feed = await sdk.getUnratedSongsFeed();
   *
   * // Get unrated songs for specific genres
   * const feed = await sdk.getUnratedSongsFeed({ genreIds: [1, 2, 3] });
   * ```
   *
   * @category Feeds
   */
  async getUnratedSongsFeed(options?: {
    genreIds?: number[];
    limit?: number;
    cursor?: string | null;
  }): Promise<FeedPage> {
    const response = await this.client.post<
      ApiEnvelope<Array<{ ulid: string }>> & { nextCursor?: string | null; meta?: { nextCursor?: string | null } }
    >("/v1/songs/feed/unrated", {
      body: {
        genre_ids: options?.genreIds?.length ? options.genreIds : undefined,
        limit: options?.limit ?? 20,
        cursor: options?.cursor ?? undefined,
      },
    });

    // Get ULIDs from feed response
    const feedItems = response.data || [];
    const ulids = feedItems.map((item) => item.ulid).filter(Boolean);

    // Extract nextCursor from either top-level or meta object
    const nextCursor = response.nextCursor || response.meta?.nextCursor || null;

    if (ulids.length === 0) {
      return { ulids: [], posts: [], nextCursor };
    }

    // Hydrate posts using batch fetch
    const posts = await this.fetchPostsBatch(ulids);
    const orderedPosts = ulids
      .map((id: string) => posts[id])
      .filter((p): p is Post => Boolean(p));

    return {
      ulids,
      posts: orderedPosts,
      nextCursor,
    };
  }

  /**
   * Hydrate an existing feed route from cache (if present).
   */
  async readCachedFeed(cacheKey: string): Promise<FeedPage | null> {
    const cache = await this.cachePromise;
    const resource = await cache.getFeedResource(cacheKey);
    if (!resource) return null;

    const posts = await cache.getPosts(resource.ulids);
    const orderedPosts = resource.ulids
      .map((id) => posts[id])
      .filter(Boolean) as Post[];

    return {
      ulids: resource.ulids,
      posts: orderedPosts,
      nextCursor: resource.cursor,
    };
  }

  /**
   * Clear all cached data (posts + feed ULIDs).
   */
  async clearCache(): Promise<void> {
    const cache = await this.cachePromise;
    await cache.clearAll();
  }

  /**
   * Invalidate a user's profile cache.
   * Call this after operations that change user profile data (e.g., pin/unpin).
   * @param ulid - The user ULID to invalidate
   */
  async invalidateUserCache(ulid: Ulid): Promise<void> {
    const cache = await this.cachePromise;
    await cache.deleteUser(ulid);
  }

  // ---------------------------------------------------------------------------
  // File uploads (S3 multipart)
  // ---------------------------------------------------------------------------

  /**
   * Get a presigned URL for direct file upload.
   * Use this for small files (< 10MB) to avoid multipart overhead.
   */
  async getPresignedUploadUrl(
    contentType: string,
    options?: {
      key?: string;
    }
  ): Promise<{ url: string; key: string; publicUrl: string; headers: Record<string, string> }> {
    const response = await this.client.post<{
      data: {
        url: string;
        key: string;
        publicUrl?: string;
        headers: Record<string, string>;
      };
    }>("/v1/media/signed-storage-url", {
      body: {
        content_type: contentType,
        key: options?.key,
      },
    });

    const data = (response as any).data || response;
    return {
      url: data.url,
      key: data.key,
      publicUrl: data.publicUrl || data.url, // Fallback to presigned URL if publicUrl not provided
      headers: data.headers || {},
    };
  }

  /**
   * Upload a file directly using a presigned URL (for small files).
   * Uses XMLHttpRequest for better iOS Safari compatibility.
   */
  private async uploadDirect(
    file: File,
    presignedUrl: string,
    contentType: string,
    onProgress?: (percentage: number) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open("PUT", presignedUrl, true);

      // Set Content-Type header - must match what was used when generating presigned URL
      xhr.setRequestHeader("Content-Type", contentType);

      // Track upload progress
      if (onProgress) {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const percentage = (e.loaded / e.total) * 100;
            onProgress(percentage);
          }
        });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Extract the final URL from the presigned URL (remove query params)
          const url = new URL(presignedUrl);
          url.search = ""; // Remove query parameters
          resolve(url.toString());
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error("Network error during upload"));
      };

      xhr.onabort = () => {
        reject(new Error("Upload aborted"));
      };

      xhr.send(file);
    });
  }

  /**
   * Upload a media file using direct presigned URL (small files) or multipart upload (large files).
   * Files are uploaded to a tmp/ location in S3 for processing.
   * Returns the final S3 URL after upload completes.
   * 
   * For files < 10MB: Uses direct presigned URL upload (faster, simpler)
   * For files >= 10MB: Uses multipart upload (required for large files)
   */
  async uploadMediaFile(
    file: File,
    options: {
      userUlid: string;
      onProgress?: (percentage: number) => void;
      mediaType?: "audio" | "image" | "video" | "file";
    }
  ): Promise<UploadResult> {
    const validationError = this.validateMediaFile(file, options.mediaType);
    if (validationError) {
      throw new Error(validationError);
    }

    const timestamp = Date.now();
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const key = `tmp/${options.userUlid}/${timestamp}-${sanitizedFilename}`;

    // Use direct upload for files < 10MB (faster and simpler)
    // Use multipart upload for larger files (required for large files)
    const DIRECT_UPLOAD_THRESHOLD = 10 * 1024 * 1024; // 10MB

    if (file.size < DIRECT_UPLOAD_THRESHOLD) {
      // Direct upload using presigned URL
      const contentType = file.type || "application/octet-stream";
      const { url: presignedUrl, key: finalKey, publicUrl } = await this.getPresignedUploadUrl(contentType, {
        key,
      });

      await this.uploadDirect(file, presignedUrl, contentType, options.onProgress);

      // Return the public URL (not the presigned URL)
      return { url: publicUrl, key: finalKey };
    } else {
      // Multipart upload for large files
      return new Promise((resolve, reject) => {
        const upload = new MultipartUpload(this.client, {
          file,
          key,
          onProgress: (percentage) => {
            if (options.onProgress) {
              options.onProgress(percentage);
            }
          },
          onComplete: (location) => {
            resolve({ url: location, key });
          },
          onError: (error) => {
            reject(error);
          },
        });

        upload.start().catch(reject);
      });
    }
  }

  /**
   * Create a multipart upload instance for more control over the upload process.
   */
  createMultipartUpload(options: Omit<MultipartUploadOptions, "client">): MultipartUpload {
    return new MultipartUpload(this.client, options);
  }

  private validateMediaFile(file: File, mediaType?: "audio" | "image" | "video" | "file"): string | null {
    const MAX_SIZE_AUDIO = 100 * 1024 * 1024; // 100MB
    const MAX_SIZE_IMAGE = 20 * 1024 * 1024;  // 20MB
    const MAX_SIZE_VIDEO = 500 * 1024 * 1024; // 500MB
    const MAX_SIZE_DEFAULT = 100 * 1024 * 1024; // 100MB

    switch (mediaType) {
      case "audio":
        if (file.size > MAX_SIZE_AUDIO) {
          return "Audio file exceeds the 100MB upload limit";
        }
        if (!file.type.startsWith("audio/")) {
          return "Please select a valid audio file";
        }
        return null;
      case "image":
        if (file.size > MAX_SIZE_IMAGE) {
          return "Image exceeds the 20MB upload limit";
        }
        if (!file.type.startsWith("image/")) {
          return "Please select a valid image file";
        }
        return null;
      case "video":
        if (file.size > MAX_SIZE_VIDEO) {
          return "Video exceeds the 500MB upload limit";
        }
        if (!file.type.startsWith("video/")) {
          return "Please select a valid video file";
        }
        return null;
      default:
        if (file.size > MAX_SIZE_DEFAULT) {
          return "File exceeds the 100MB upload limit";
        }
        return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Post Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new post.
   *
   * @param payload - Post data (content, type, media, etc.)
   * @returns The created post with full data
   *
   * @example
   * ```typescript
   * const post = await sdk.createPost({
   *   content: 'Hello world!',
   *   type: 'POST'
   * });
   * ```
   *
   * @category Posts
   */
  async createPost(payload: Record<string, unknown>): Promise<Post> {
    const response = await this.client.post<ApiEnvelope<Post>>("/v1/posts/create", {
      body: payload,
    });
    const post = this.unwrap<Post>(response);

    // Read-after-write: fetch full post data to ensure we have complete data with all relationships
    // The create endpoint may return minimal data, so we fetch the full post
    if (post.ulid) {
      const fullPost = await this.getPostByUlid(post.ulid, true);
      if (fullPost) {
        return fullPost;
      }
    }

    // Fallback to caching the create response if read-after-write fails
    await this.cachePost(post);
    return post;
  }

  /**
   * Register an uploaded video URL as a temporary video.
   * This is the first step in creating a video post.
   *
   * @param videoUrl - The S3 URL of the uploaded video
   * @param videoType - Type of video: 'video' or 'burst'
   * @returns The temporary video record with its ULID
   *
   * @example
   * ```typescript
   * const tmpVideo = await sdk.createTmpVideo(
   *   'https://s3.../video.mp4',
   *   'video'
   * );
   * // Use tmpVideo.id as videoId when creating the video post
   * ```
   *
   * @category Videos
   */
  async createTmpVideo(
    videoUrl: string,
    videoType: "video" | "burst" = "video",
  ): Promise<{ id: string; video: { url: string } }> {
    const response = await this.client.post<
      ApiEnvelope<{ id: string; video: { url: string } }>
    >(`/v1/${videoType}/upload`, {
      body: { videoUrl },
    });
    return this.unwrap(response);
  }

  /**
   * Create a video post.
   * Use this instead of createPost() when posting a video.
   *
   * @param payload - Video post data including videoId from createTmpVideo()
   * @returns The created video post
   *
   * @example
   * ```typescript
   * // First, upload video and register it
   * const tmpVideo = await sdk.createTmpVideo(videoUrl, 'video');
   *
   * // Then create the video post
   * const post = await sdk.createVideoPost({
   *   videoId: tmpVideo.id,
   *   title: 'My Video',
   *   body: 'Description',
   *   groupName: 'default'
   * });
   * ```
   *
   * @category Videos
   */
  async createVideoPost(payload: {
    videoId: string;
    title?: string;
    body?: string;
    groupName?: string;
    groupId?: string;
    type?: "VIDEO" | "BURST";
    sensitive?: boolean;
    commentsEnabled?: boolean;
    downloadEnabled?: boolean;
  }): Promise<Post> {
    const response = await this.client.post<ApiEnvelope<Post>>("/v1/video/add", {
      body: {
        ...payload,
        type: payload.type || "VIDEO",
        groupName: payload.groupName || "default",
      },
    });
    const post = this.unwrap<Post>(response);

    // Read-after-write to get complete post data
    if (post.ulid) {
      const fullPost = await this.getPostByUlid(post.ulid, true);
      if (fullPost) {
        return fullPost;
      }
    }

    await this.cachePost(post);
    return post;
  }

  /**
   * Update an existing post.
   *
   * @param postUlid - ULID of the post to update
   * @param payload - Updated post data
   * @returns The updated post
   *
   * @example
   * ```typescript
   * const updated = await sdk.updatePost('01HX...', {
   *   content: 'Updated content'
   * });
   * ```
   *
   * @category Posts
   */
  async updatePost(
    postUlid: Ulid,
    payload: Record<string, unknown>,
  ): Promise<Post> {
    const response = await this.client.patch<ApiEnvelope<Post>>(
      `/v1/posts/${encodeURIComponent(postUlid)}`,
      { body: payload },
    );
    const post = this.unwrap<Post>(response);

    // Read-after-write: fetch full post data to ensure we have complete data with all relationships
    // The update endpoint may return minimal data, so we fetch the full post
    if (post.ulid) {
      const fullPost = await this.getPostByUlid(post.ulid, true);
      if (fullPost) {
        return fullPost;
      }
    }

    // Fallback to caching the update response if read-after-write fails
    await this.cachePost(post);
    return post;
  }

  /**
   * Delete a post.
   *
   * @param postUlid - ULID of the post to delete
   *
   * @example
   * ```typescript
   * await sdk.deletePost('01HX...');
   * ```
   *
   * @category Posts
   */
  async deletePost(postUlid: Ulid): Promise<void> {
    await this.client.delete(`/v1/posts/${encodeURIComponent(postUlid)}`);

    const cache = await this.cachePromise;
    await cache.deletePost(postUlid);
  }

  /**
   * Add a reaction to a post.
   *
   * @param postUlid - ULID of the post
   * @param reaction - Reaction emoji (e.g., '❤️', '🔥')
   *
   * @example
   * ```typescript
   * await sdk.addReaction('01HX...', '❤️');
   * ```
   *
   * @category Posts
   */
  async addReaction(postUlid: Ulid, reaction: string): Promise<void> {
    await this.client.post(`/v1/posts/${encodeURIComponent(postUlid)}/reactions`, {
      body: { reaction },
    });
    // Refresh engagement in IndexedDB cache
    await this.refreshPostEngagement(postUlid);
  }

  /**
   * Remove a reaction from a post.
   *
   * @param postUlid - ULID of the post
   * @param reaction - Reaction emoji to remove
   *
   * @category Posts
   */
  async removeReaction(postUlid: Ulid, reaction: string): Promise<void> {
    await this.client.delete(`/v1/posts/${encodeURIComponent(postUlid)}/reactions`, {
      body: { reaction },
    });
    // Refresh engagement in IndexedDB cache
    await this.refreshPostEngagement(postUlid);
  }

  /**
   * Refresh a single post's engagement data in the cache.
   *
   * @param postUlid - ULID of the post to refresh
   *
   * @category Posts
   */
  async refreshPostEngagement(postUlid: Ulid): Promise<void> {
    try {
      const engagement = await this.fetchEngagement([postUlid]);
      const postEngagement = engagement[postUlid];
      if (postEngagement) {
        await this.updateCachedEngagement(postUlid, postEngagement as Record<string, unknown>);
      }
    } catch {
      // Silently fail - cache update is not critical
    }
  }

  /**
   * Bookmark a post.
   *
   * @param postUlid - ULID of the post to bookmark
   *
   * @category Posts
   */
  async bookmarkPost(postUlid: Ulid): Promise<void> {
    await this.client.post(`/v1/posts/${encodeURIComponent(postUlid)}/bookmarks`);
    // Refresh engagement in IndexedDB cache
    await this.refreshPostEngagement(postUlid);
  }

  /**
   * Remove a bookmark from a post.
   *
   * @param postUlid - ULID of the post to unbookmark
   *
   * @category Posts
   */
  async unbookmarkPost(postUlid: Ulid): Promise<void> {
    await this.client.delete(`/v1/posts/${encodeURIComponent(postUlid)}/bookmarks`);
    // Refresh engagement in IndexedDB cache
    await this.refreshPostEngagement(postUlid);
  }

  /**
   * Share a post (increment share count).
   *
   * @param postUlid - ULID of the post to share
   *
   * @category Posts
   */
  async sharePost(postUlid: Ulid): Promise<void> {
    await this.client.post(`/v1/posts/${encodeURIComponent(postUlid)}/share`);
    // Refresh engagement in IndexedDB cache
    await this.refreshPostEngagement(postUlid);
  }

  /**
   * Upvote a post.
   *
   * @param postUlid - ULID of the post to upvote
   *
   * @category Posts
   */
  async upvotePost(postUlid: Ulid): Promise<void> {
    await this.client.post(`/v1/posts/${encodeURIComponent(postUlid)}/upvote`);
    // Refresh engagement in IndexedDB cache
    await this.refreshPostEngagement(postUlid);
  }

  /**
   * Vote on a poll attached to a post.
   * Updates the post's poll data in the Dexie cache after voting.
   * @param postUlid - The ULID of the post containing the poll
   * @param optionId - The ID of the poll option to vote for
   * @returns The updated poll data
   */
  async votePoll(postUlid: Ulid, optionId: number): Promise<Poll> {
    const response = await this.client.post<ApiEnvelope<Record<string, unknown>>>(
      `/v1/posts/${encodeURIComponent(postUlid)}/polls/vote`,
      { body: { optionId } },
    );
    const rawPoll = this.unwrap<Record<string, unknown>>(response);
    const poll = normalizePoll(rawPoll);

    // Update the post's poll in the cache
    await this.updateCachedPostPoll(postUlid, poll);

    return poll;
  }

  /**
   * Update the poll data for a cached post
   */
  private async updateCachedPostPoll(postUlid: Ulid, poll: Poll): Promise<void> {
    try {
      const cache = await this.cachePromise;
      const cachedPost = await cache.getPost(postUlid);
      if (cachedPost) {
        cachedPost.poll = poll;
        await cache.setPost(postUlid, cachedPost);
      }
    } catch {
      // Silently fail - cache update is not critical
    }
  }

  /**
   * Repost a post (simple repost without additional content)
   */
  async repost(postUlid: Ulid): Promise<Post> {
    const response = await this.client.post<ApiEnvelope<Post>>(
      `/v1/posts/${encodeURIComponent(postUlid)}/reposts`,
    );
    const post = this.unwrap<Post>(response);

    // Read-after-write: fetch full repost data to ensure we have complete data with all relationships
    if (post.ulid) {
      const fullPost = await this.getPostByUlid(post.ulid, true);
      if (fullPost) {
        // Also refresh original post engagement (repost count changed)
        await this.refreshPostEngagement(postUlid);
        return fullPost;
      }
    }

    // Fallback to caching the response if read-after-write fails
    await this.cachePost(post);
    return post;
  }

  /**
   * Remove a repost
   */
  async unrepost(postUlid: Ulid): Promise<void> {
    await this.client.delete(`/v1/posts/${encodeURIComponent(postUlid)}/reposts`);
    // Refresh engagement in IndexedDB cache (repost count changed)
    await this.refreshPostEngagement(postUlid);
  }

  /**
   * Quote a post (repost with additional content)
   */
  async quotePost(postUlid: Ulid, content: string): Promise<Post> {
    const response = await this.client.post<ApiEnvelope<Post>>(
      `/v1/posts/${encodeURIComponent(postUlid)}/quote`,
      { body: { content } },
    );
    const post = this.unwrap<Post>(response);

    // Read-after-write: fetch full quote post data to ensure we have complete data with all relationships
    if (post.ulid) {
      const fullPost = await this.getPostByUlid(post.ulid, true);
      if (fullPost) {
        // Also refresh original post engagement (quote count changed)
        await this.refreshPostEngagement(postUlid);
        return fullPost;
      }
    }

    // Fallback to caching the response if read-after-write fails
    await this.cachePost(post);
    return post;
  }

  /**
   * Get reposts of a post
   */
  async getReposts(postUlid: Ulid, cursor?: string | null): Promise<FeedPage> {
    const endpoint = `/v1/posts/${encodeURIComponent(postUlid)}/reposts`;
    return this.fetchFeedPage(cursor, endpoint, `reposts-${postUlid}`);
  }

  /**
   * Get quotes of a post
   */
  async getQuotes(postUlid: Ulid, cursor?: string | null): Promise<FeedPage> {
    const endpoint = `/v1/posts/${encodeURIComponent(postUlid)}/quotes`;
    return this.fetchFeedPage(cursor, endpoint, `quotes-${postUlid}`);
  }

  /**
   * Pin a post to profile
   */
  async pinPost(postUlid: Ulid): Promise<void> {
    await this.client.post(`/v1/posts/${encodeURIComponent(postUlid)}/pin`);
  }

  /**
   * Unpin a post from profile
   */
  async unpinPost(postUlid: Ulid): Promise<void> {
    await this.client.delete(`/v1/posts/${encodeURIComponent(postUlid)}/pin`);
  }

  // ---------------------------------------------------------------------------
  // Admin/Moderation actions
  // ---------------------------------------------------------------------------

  /**
   * Mark a post as sensitive (NSFW) or remove the sensitive flag.
   * Requires admin/moderator permissions.
   */
  async markPostSensitive(postUlid: Ulid, isSensitive: boolean): Promise<void> {
    const action = isSensitive ? "applyNSFW" : "removeNSFW";
    await this.client.post(`/moderation/post/action/${action}`, {
      body: {
        postULID: postUlid,
        action,
      },
    });
  }

  /**
   * Mark a post as trolling (web-only) or remove the trolling flag.
   * Requires admin/moderator permissions.
   */
  async markPostTrolling(postUlid: Ulid, isTrolling: boolean): Promise<void> {
    const action = isTrolling ? "applyTroll" : "removeTroll";
    await this.client.post(`/moderation/post/action/${action}`, {
      body: {
        postULID: postUlid,
        action,
      },
    });
  }

  /**
   * Delete a post using admin privileges.
   * Requires admin/moderator permissions.
   */
  async adminDeletePost(postUlid: Ulid): Promise<void> {
    await this.client.delete("/v1/moderation/post", {
      body: { ulid: postUlid },
    });

    // Remove from cache
    const cache = await this.cachePromise;
    await cache.deletePost(postUlid);
  }

  /**
   * Get users who liked a post
   */
  async getPostLikers(postUlid: Ulid, cursor?: string | null): Promise<ApiEnvelope<UserProfile[]>> {
    return this.client.get<ApiEnvelope<UserProfile[]>>(
      `/v1/posts/${encodeURIComponent(postUlid)}/likers`,
      { query: cursor ? { cursor } : undefined },
    );
  }

  /**
   * Get bookmarked posts for current user
   */
  async getBookmarks(cursor?: string | null): Promise<FeedPage> {
    return this.fetchFeedPage(cursor, "/v1/posts/bookmarks", "bookmarks");
  }

  /**
   * Get liked posts for current user
   */
  async getLikedPosts(cursor?: string | null): Promise<FeedPage> {
    return this.fetchFeedPage(cursor, "/v1/posts/liked", "liked-posts");
  }

  /**
   * Like a post (adds a 'like' reaction)
   */
  async likePost(postUlid: Ulid): Promise<void> {
    await this.addReaction(postUlid, "like");
  }

  /**
   * Unlike a post (removes the 'like' reaction)
   */
  async unlikePost(postUlid: Ulid): Promise<void> {
    await this.removeReaction(postUlid, "like");
  }

  async ratePost(postUlid: Ulid, rating: number): Promise<void> {
    await this.client.post(`/v1/posts/${encodeURIComponent(postUlid)}/ratings`, {
      body: { rating },
    });
    // Refresh engagement in IndexedDB cache (rating stats changed)
    await this.refreshPostEngagement(postUlid);
  }

  async removeRating(postUlid: Ulid): Promise<void> {
    await this.client.delete(`/v1/posts/${encodeURIComponent(postUlid)}/ratings`);
    // Refresh engagement in IndexedDB cache (rating stats changed)
    await this.refreshPostEngagement(postUlid);
  }

  /**
   * @deprecated Rating stats are now included in the SongResource/PostResource.
   * No need to call this endpoint separately - use the post data directly.
   */
  async getRatings(postUlid: Ulid): Promise<unknown> {
    return this.client.get(`/v1/posts/${encodeURIComponent(postUlid)}/ratings`);
  }

  /**
   * @deprecated User's rating is now included in the SongResource/PostResource as `userRating`.
   * No need to call this endpoint separately - use the post data directly.
   */
  async getMyRating(postUlid: Ulid): Promise<unknown> {
    return this.client.get(`/v1/posts/${encodeURIComponent(postUlid)}/ratings/me`);
  }

  async getRatingsBatch(postUlids: Ulid[]): Promise<unknown> {
    return this.client.post("/v1/posts/ratings/batch", { body: { ulids: postUlids } });
  }

  /**
   * Fetch engagement data for posts and update cache.
   * Debounced and single-flight - only one API call at a time.
   * Uses hash-based comparison to only update and return changed data.
   *
   * @param postUlids - Array of post ULIDs to fetch engagement for
   * @returns Only the engagement data that has changed (empty object if no changes)
   */
  async fetchEngagement(postUlids: Ulid[]): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      // Add ULIDs to the batch queue
      for (const ulid of postUlids) {
        this.engagementBatchQueue.add(ulid);
      }

      // Store the resolver with requested ULIDs
      this.engagementPendingResolvers.push({ ulids: postUlids, resolve, reject });

      // Clear existing timer
      if (this.engagementBatchTimer !== null) {
        clearTimeout(this.engagementBatchTimer);
      }

      // Debounce the actual API call
      this.engagementBatchTimer = window.setTimeout(() => {
        this.flushEngagementBatch();
      }, this.engagementBatchDelay);
    });
  }

  /**
   * Execute the batched engagement fetch.
   * Single-flight: if a request is already in progress, wait for it.
   */
  private async flushEngagementBatch(): Promise<void> {
    // If already in flight, the current resolvers will be handled when it completes
    if (this.engagementInFlight) {
      return;
    }

    // Capture current batch
    const ulidsToFetch = Array.from(this.engagementBatchQueue);
    const resolvers = [...this.engagementPendingResolvers];

    // Clear the queue
    this.engagementBatchQueue.clear();
    this.engagementPendingResolvers = [];
    this.engagementBatchTimer = null;

    if (ulidsToFetch.length === 0) {
      resolvers.forEach(({ resolve }) => resolve({}));
      return;
    }

    // Make the API call (single-flight)
    this.engagementInFlight = this.executeEngagementFetch(ulidsToFetch);

    try {
      const allChangedData = await this.engagementInFlight;

      // Resolve each caller with their relevant subset of changed data
      for (const { ulids, resolve } of resolvers) {
        const relevantData: Record<string, unknown> = {};
        for (const ulid of ulids) {
          if (allChangedData[ulid]) {
            relevantData[ulid] = allChangedData[ulid];
          }
        }
        resolve(relevantData);
      }
    } catch (err) {
      resolvers.forEach(({ reject }) => reject(err));
    } finally {
      this.engagementInFlight = null;

      // If more requests queued while we were fetching, flush again
      if (this.engagementBatchQueue.size > 0) {
        this.flushEngagementBatch();
      }
    }
  }

  /**
   * Execute the actual engagement API call and update cache.
   * Chunks requests into batches of 40 ULIDs max per API call.
   */
  private async executeEngagementFetch(postUlids: Ulid[]): Promise<Record<string, unknown>> {
    // Chunk ULIDs into batches of 40 max
    const BATCH_SIZE = 40;
    const chunks: Ulid[][] = [];
    for (let i = 0; i < postUlids.length; i += BATCH_SIZE) {
      chunks.push(postUlids.slice(i, i + BATCH_SIZE));
    }

    // Fetch chunks sequentially to avoid overwhelming the API
    const data: Record<string, unknown> = {};
    for (const chunk of chunks) {
      const response = await this.client.post<ApiEnvelope<Record<string, unknown>>>(
        "/v1/posts/engagement",
        { body: { ulids: chunk } },
      );
      const chunkData = this.unwrap<Record<string, unknown>>(response);
      Object.assign(data, chunkData);
    }

    // Track which posts actually changed
    const changedData: Record<string, unknown> = {};

    // Track posts that need full reload due to updatedAt change
    const postsToReload: Ulid[] = [];

    // Update cache with engagement data for each post
    const cache = await this.cachePromise;
    for (const [ulid, engagementData] of Object.entries(data)) {
      if (!engagementData || typeof engagementData !== 'object') continue;

      const engagement = engagementData as Record<string, unknown>;

      // Get existing post from cache
      const existingPost = await cache.getPost(ulid);

      // Check if post's updatedAt has changed - if so, reload the full post
      const incomingUpdatedAt = engagement.updatedAt as string | undefined;
      const cachedUpdatedAt = existingPost?.updatedAt;
      if (existingPost && incomingUpdatedAt && cachedUpdatedAt && incomingUpdatedAt !== cachedUpdatedAt) {
        // Post content has changed, mark for full reload
        postsToReload.push(ulid);
        changedData[ulid] = engagementData;
        continue;
      }

      // Generate hash of the new engagement data using the same extraction as normalizePost
      const newHash = hashObject(extractEngagementData(engagement));

      // Check if engagement data has changed by comparing hashes
      if (existingPost?._engagementHash === newHash) {
        // Data hasn't changed, skip update
        continue;
      }

      // Data has changed - mark as changed for return value
      changedData[ulid] = engagementData;

      if (existingPost) {
        // Merge engagement data into post
        const updatedPost: Post = {
          ...existingPost,
          postEngagement: {
            ...existingPost.postEngagement,
            ...(engagement.postEngagement as Record<string, unknown> || {}),
          },
        };

        // Merge userReaction
        if (engagement.userReaction !== undefined) {
          (updatedPost as Record<string, unknown>).userReaction = engagement.userReaction;
        }

        // Normalize and merge rating stats
        const ratingStats = engagement.ratingStats as Record<string, unknown> | undefined;
        if (ratingStats) {
          (updatedPost as Record<string, unknown>).ratingStats = {
            average: ratingStats.average_rating ?? ratingStats.average,
            total: ratingStats.total_ratings ?? ratingStats.total,
            distribution: ratingStats.rating_distribution ?? ratingStats.distribution,
          };
          (updatedPost as Record<string, unknown>).averageRating = ratingStats.average_rating ?? ratingStats.average;
          (updatedPost as Record<string, unknown>).ratingCount = ratingStats.total_ratings ?? ratingStats.total;
        }

        // Merge userRating
        if (engagement.userRating !== undefined) {
          (updatedPost as Record<string, unknown>).userRating = engagement.userRating;
        }

        // Merge other engagement fields
        if (engagement.isDeleted !== undefined) {
          (updatedPost as Record<string, unknown>).isDeleted = engagement.isDeleted;
        }
        if (engagement.isHidden !== undefined) {
          (updatedPost as Record<string, unknown>).isHidden = engagement.isHidden;
        }
        if (engagement.isSensitive !== undefined) {
          (updatedPost as Record<string, unknown>).isSensitive = engagement.isSensitive;
        }
        if (engagement.otherRepostUsers !== undefined) {
          (updatedPost as Record<string, unknown>).otherRepostUsers = engagement.otherRepostUsers;
        }

        // Recalculate hash after merging
        updatedPost._engagementHash = hashObject(extractEngagementData(updatedPost as Record<string, unknown>));

        // Update cache
        await cache.setPost(ulid, updatedPost);
      }
    }

    // Reload posts that have different updatedAt (post content changed)
    if (postsToReload.length > 0) {
      // Fetch full post data for posts with changed updatedAt
      await this.fetchPostsBatch(postsToReload);
    }

    return changedData;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Notifications
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fetch notifications for the current user.
   *
   * Supports cursor-based pagination and filtering by type.
   *
   * @param params - Optional query parameters
   * @param params.cursor - Cursor for pagination (ULID of last notification)
   * @param params.limit - Maximum notifications to return
   * @param params.type - Filter by notification type
   * @param params.unreadOnly - Only return unread notifications
   * @returns Promise resolving to paginated notifications
   *
   * @example
   * ```typescript
   * const response = await sdk.getNotifications({ limit: 20, unreadOnly: true });
   * const notifications = sdk.unwrap(response);
   * ```
   *
   * @category Notifications
   */
  async getNotifications(params?: {
    cursor?: string;
    limit?: number;
    type?: string;
    unreadOnly?: boolean;
  }): Promise<ApiEnvelope<unknown>> {
    const query: Record<string, unknown> = {};
    if (params?.cursor) query.ulid = params.cursor;
    if (params?.limit) query.limit = params.limit;
    if (params?.type) query.type = params.type;
    if (params?.unreadOnly) query.unread_only = params.unreadOnly;

    return this.client.get<ApiEnvelope<unknown>>("/v1/users/me/notifications", { query });
  }

  /**
   * Get notification counts (total, read, unread, seen, unseen).
   *
   * Uses request deduplication to prevent multiple simultaneous API calls.
   *
   * @returns Promise resolving to notification count breakdown
   *
   * @example
   * ```typescript
   * const counts = await sdk.getNotificationCounts();
   * console.log(`${counts.read_count_false} unread notifications`);
   * ```
   *
   * @category Notifications
   */
  async getNotificationCounts(): Promise<{
    total_count: number;
    read_count: number;
    read_count_false: number;
    seen_count: number;
    seen_count_false: number;
  }> {
    // If a request is already in flight, return the same promise
    if (this.notificationCountsInFlight) {
      this.log('🔔 SDK: Reusing in-flight notification counts request');
      return this.notificationCountsInFlight;
    }

    this.log('🔔 SDK: Starting new notification counts request');

    // Create new request and track it
    this.notificationCountsInFlight = (async () => {
      try {
        const response = await this.client.get<ApiEnvelope<{
          total_count: number;
          read_count: number;
          read_count_false: number;
          seen_count: number;
          seen_count_false: number;
        }>>("/v1/users/me/notifications/count");
        return this.unwrap(response);
      } finally {
        // Clear in-flight tracker when request completes (success or error)
        this.notificationCountsInFlight = null;
      }
    })();

    return this.notificationCountsInFlight;
  }

  /**
   * Get unread notification count (convenience method).
   *
   * @returns Promise resolving to the number of unread notifications
   *
   * @category Notifications
   */
  async getUnreadNotificationCount(): Promise<number> {
    const counts = await this.getNotificationCounts();
    return counts.read_count_false;
  }

  /**
   * Mark specific notifications as read.
   *
   * @param notificationIds - Array of notification IDs to mark as read
   *
   * @category Notifications
   */
  async markNotificationsRead(notificationIds: string[]): Promise<void> {
    await this.client.post("/v1/users/me/notifications/markRead", {
      body: { notificationIds },
    });
  }

  /**
   * Mark a single notification as read.
   *
   * @param notificationId - The notification ID to mark as read
   *
   * @category Notifications
   */
  async markNotificationRead(notificationId: string): Promise<void> {
    await this.markNotificationsRead([notificationId]);
  }

  /**
   * Mark all notifications as read.
   *
   * @param lastNotificationId - Optional: only mark notifications up to this ID
   *
   * @category Notifications
   */
  async markAllNotificationsRead(lastNotificationId?: string): Promise<void> {
    await this.client.post("/v1/users/me/notifications/markAllRead", {
      body: lastNotificationId ? { lastNotificationId } : {},
    });
  }

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  async fetchComments(params: {
    ulid: Ulid;
    perPage?: number;
    sortBy?: string;
    cursor?: string | null;
  }): Promise<{
    comments: Post[];
    nextCursor?: string | null;
    hasMore: boolean;
  }> {
    const { ulid, perPage = 20, sortBy = "newest", cursor } = params;

    const payload: Record<string, unknown> = {
      ulid,
      perPage,
      sortBy,
    };
    if (cursor) {
      payload.cursor = cursor;
    }

    const response = await this.client.post<ApiEnvelope<any>>("/v1/comments", {
      body: payload,
    });

    const data = (response as any).data ?? response;
    const commentData = Array.isArray(data) ? data : data?.data || [];

    if (!Array.isArray(commentData) || commentData.length === 0) {
      const cursor = (response as any).nextCursor ?? (response as any).next_cursor ?? data?.nextCursor ?? data?.next_cursor;
      return {
        comments: [],
        nextCursor: cursor,
        hasMore: Boolean(cursor),
      };
    }

  // Use comment data directly from /v1/comments response
  // This avoids cache issues with reaction counts and visibility problems
  const comments: Post[] = commentData
    .filter((comment: any) => comment?.ulid)
    .map((comment: any) => this.normalizePost(comment as Post));


    // Hydrate user profiles into cache (UI will look them up reactively)
    // Extract userId from the hydrated comments (Post objects), not the raw commentData
    const hints = comments
      .map((comment) => ({
        userId: comment.userId,
        userUpdatedAt: comment.userUpdatedAt,
      }))
      .filter((h) => h.userId);

    await this.hydrateUsersFromHints(hints as any[]);

    // Return comments with userId - UI components will reactively look up user data

    const nextCursor = (response as any).nextCursor ?? (response as any).next_cursor ?? data?.nextCursor ?? data?.next_cursor;
    return {
      comments,
      nextCursor,
      hasMore: Boolean(nextCursor),
    };
  }

  async createComment(data: {
    parentId: Ulid;
    title?: string;
    body?: string;
    images?: unknown;
  }): Promise<Post> {
    const response = await this.client.put<ApiEnvelope<Post>>("/v1/comments", {
      body: {
        parentId: data.parentId,
        title: data.title,
        body: data.body,
        images: data.images,
      },
    });

    const comment = this.unwrap<Post>(response);

    // Read-after-write: fetch full comment data to ensure we have complete data with all relationships
    if (comment.ulid) {
      const fullComment = await this.getPostByUlid(comment.ulid, true);
      if (fullComment) {
        // Also refresh parent post engagement (comment count changed)
        await this.refreshPostEngagement(data.parentId);
        return fullComment;
      }
    }

    // Fallback to caching the create response if read-after-write fails
    await this.cachePost(comment);
    return comment;
  }

  async deleteComment(commentUlid: Ulid, parentId?: Ulid): Promise<void> {
    // If parentId not provided, try to get it from cache before deleting
    let parentUlid = parentId;
    if (!parentUlid) {
      const cache = await this.cachePromise;
      const cachedComment = await cache.getPost(commentUlid);
      if (cachedComment?.parentId && typeof cachedComment.parentId === "string") {
        parentUlid = cachedComment.parentId;
      }
    }

    await this.client.delete(`/v1/posts/${encodeURIComponent(commentUlid)}`);
    const cache = await this.cachePromise;
    await cache.deletePost(commentUlid);

    // Refresh parent post engagement (comment count changed)
    if (parentUlid) {
      await this.refreshPostEngagement(parentUlid);
    }
  }

  /**
   * Get comments for a post (convenience wrapper)
   */
  async getPostComments(
    postUlid: Ulid,
    cursor?: string | null
  ): Promise<{ posts: Post[]; nextCursor?: string | null }> {
    const result = await this.fetchComments({
      ulid: postUlid,
      cursor: cursor ?? undefined,
    });
    return {
      posts: result.comments,
      nextCursor: result.nextCursor,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Playlists
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get playlists for a specific user by their username.
   *
   * @param username - The username of the user whose playlists to fetch
   * @param params - Optional query parameters for filtering/pagination
   * @returns Promise resolving to an array of playlists
   *
   * @example
   * ```typescript
   * const response = await sdk.getPlaylists('johndoe');
   * const playlists = sdk.unwrap(response);
   * playlists.forEach(playlist => console.log(playlist.name));
   * ```
   *
   * @category Playlists
   */
  async getPlaylists(username: string, params?: Record<string, unknown>): Promise<ApiEnvelope<Playlist[]>> {
    return this.client.get<ApiEnvelope<Playlist[]>>(
      `/v1/playlist/${encodeURIComponent(username)}/feed`,
      { query: params },
    );
  }

  /**
   * Get public/promoted playlists for the Explore section.
   *
   * Returns playlists that have been promoted by users with Administrator/Creator badges.
   * These are curated playlists shown in the Explore area of the application.
   *
   * @returns Promise resolving to an array of promoted playlists
   *
   * @example
   * ```typescript
   * const response = await sdk.getPublicPlaylists();
   * const playlists = sdk.unwrap(response);
   * ```
   *
   * @category Playlists
   */
  async getPublicPlaylists(): Promise<ApiEnvelope<Playlist[]>> {
    return this.client.get<ApiEnvelope<Playlist[]>>("/v1/explore/playlists");
  }

  /**
   * Get playlists for the timeline feed.
   *
   * When myStuff is true, returns playlists from followed users.
   * Otherwise returns recent public playlists.
   *
   * @param myStuff - If true, returns playlists only from followed users
   * @returns Promise resolving to an array of playlists
   *
   * @example
   * ```typescript
   * // Get public playlists for timeline
   * const publicPlaylists = await sdk.getTimelinePlaylists();
   *
   * // Get playlists from followed users only
   * const myPlaylists = await sdk.getTimelinePlaylists(true);
   * ```
   *
   * @category Playlists
   */
  async getTimelinePlaylists(myStuff = false): Promise<ApiEnvelope<Playlist[]>> {
    const params = new URLSearchParams();
    if (myStuff) {
      params.set("my_stuff", "true");
    }
    const queryString = params.toString();
    const url = queryString ? `/v1/playlists/timeline?${queryString}` : "/v1/playlists/timeline";
    return this.client.get<ApiEnvelope<Playlist[]>>(url);
  }

  /**
   * Get featured artists for the Explore section.
   *
   * Returns artists ordered by sort_order (ascending).
   * Backend returns ULIDs, SDK hydrates full user profiles from IndexedDB cache or API.
   *
   * @returns Promise resolving to an array of featured artist profiles
   *
   * @example
   * ```typescript
   * const artists = await sdk.getFeaturedArtists();
   * artists.forEach(artist => console.log(artist.username));
   * ```
   *
   * @category Playlists
   */
  async getFeaturedArtists(): Promise<UserProfile[]> {
    // Get ULIDs from backend
    const response = await this.client.get<ApiEnvelope<Ulid[]>>("/v1/explore/featured-artists");
    const userUlids = this.unwrap<Ulid[]>(response);

    if (!userUlids || userUlids.length === 0) {
      return [];
    }

    // Hydrate profiles from cache/API
    await Promise.all(
      userUlids.map(ulid => this.fetchUserProfileById(ulid))
    );

    // Retrieve hydrated profiles from cache in original order
    const cache = await this.cachePromise;
    const profiles: UserProfile[] = [];
    for (const ulid of userUlids) {
      const profile = await cache.getUser(ulid);
      if (profile) {
        profiles.push(profile);
      }
    }

    return profiles;
  }

  /**
   * Check if a user is featured.
   *
   * Used to determine menu option visibility for admin actions.
   *
   * @param userUlid - The user ULID to check
   * @returns Promise resolving to is_featured status and ends_at date if applicable
   *
   * @example
   * ```typescript
   * const status = await sdk.checkFeaturedArtist('01HQ...');
   * if (status.is_featured) {
   *   console.log('Featured until:', status.ends_at);
   * }
   * ```
   *
   * @category Playlists
   */
  async checkFeaturedArtist(userUlid: string): Promise<{ is_featured: boolean; ends_at?: string | null }> {
    return this.client.get<{ is_featured: boolean; ends_at?: string | null }>(`/v1/featured-artists/${userUlid}/check`);
  }

  /**
   * Add a user to featured artists (admin only).
   *
   * Requires admin privileges. Featured artists appear in the Explore section.
   *
   * @param userUlid - The user ULID to add
   * @param endsAt - Optional end date for the featured status (ISO 8601 format)
   * @returns Promise resolving to the updated user profile
   *
   * @example
   * ```typescript
   * // Feature indefinitely
   * await sdk.addFeaturedArtist('01HQ...');
   *
   * // Feature until specific date
   * await sdk.addFeaturedArtist('01HQ...', '2025-12-31T23:59:59Z');
   * ```
   *
   * @category Playlists
   */
  async addFeaturedArtist(userUlid: string, endsAt?: string): Promise<ApiEnvelope<UserProfile>> {
    return this.client.post<ApiEnvelope<UserProfile>>("/v1/featured-artists", {
      body: { user_ulid: userUlid, ends_at: endsAt },
    });
  }

  /**
   * Remove a user from featured artists (admin only).
   *
   * Requires admin privileges.
   *
   * @param userUlid - The user ULID to remove from featured
   * @returns Promise resolving to confirmation message
   *
   * @example
   * ```typescript
   * await sdk.removeFeaturedArtist('01HQ...');
   * ```
   *
   * @category Playlists
   */
  async removeFeaturedArtist(userUlid: string): Promise<{ message: string }> {
    return this.client.delete<{ message: string }>(`/v1/featured-artists/${userUlid}`);
  }

  /**
   * Get a single playlist by its ULID.
   *
   * @param playlistId - The playlist ULID
   * @param shuffle - If true, returns songs in shuffled order (promoted playlists auto-shuffle daily)
   * @returns Promise resolving to the playlist with its songs
   *
   * @example
   * ```typescript
   * // Get playlist in original order
   * const response = await sdk.getPlaylist('01HQ...');
   * const playlist = sdk.unwrap(response);
   *
   * // Get playlist with shuffled songs
   * const shuffled = await sdk.getPlaylist('01HQ...', true);
   * ```
   *
   * @category Playlists
   */
  async getPlaylist(playlistId: string, shuffle?: boolean): Promise<ApiEnvelope<Playlist>> {
    const query = shuffle !== undefined ? { shuffle: shuffle ? 'true' : 'false' } : {};
    return this.client.get<ApiEnvelope<Playlist>>(
      `/v1/playlist/${encodeURIComponent(playlistId)}`,
      { query },
    );
  }

  /**
   * Create a new playlist.
   *
   * @param payload - Playlist creation data including name, description, isPublic
   * @returns Promise resolving to the created playlist
   *
   * @example
   * ```typescript
   * const response = await sdk.createPlaylist({
   *   name: 'My Favorites',
   *   description: 'Collection of my favorite songs',
   *   isPublic: true
   * });
   * const playlist = sdk.unwrap(response);
   * ```
   *
   * @category Playlists
   */
  async createPlaylist(payload: Record<string, unknown>): Promise<ApiEnvelope<Playlist>> {
    return this.client.post<ApiEnvelope<Playlist>>("/v1/playlist/add", { body: payload });
  }

  /**
   * Create a new song playlist (audio-only). Automatically sets type to 'SONG'.
   * Use this for sites that have both songs and videos to ensure correct playlist type.
   *
   * @param payload - Playlist configuration (name, description, isPublic)
   * @returns Promise resolving to the created playlist
   *
   * @example
   * ```typescript
   * const response = await sdk.createSongPlaylist({
   *   name: 'My Favorites',
   *   description: 'Collection of my favorite songs',
   *   isPublic: true
   * });
   * const playlist = sdk.unwrap(response);
   * ```
   *
   * @category Playlists
   */
  async createSongPlaylist(payload: {
    name: string;
    description?: string;
    isPublic?: boolean;
    isPrivate?: boolean;
  }): Promise<ApiEnvelope<Playlist>> {
    return this.client.post<ApiEnvelope<Playlist>>("/v1/playlist/add", {
      body: { ...payload, type: "SONG" },
    });
  }

  /**
   * Update an existing playlist (name, description, isPublic, etc).
   *
   * @param playlistId - The playlist ULID to update
   * @param payload - Fields to update (name, description, isPublic, coverUrl)
   * @returns Promise resolving to the updated playlist
   *
   * @example
   * ```typescript
   * await sdk.updatePlaylist('01HQ...', {
   *   name: 'Updated Name',
   *   description: 'New description'
   * });
   * ```
   *
   * @category Playlists
   */
  async updatePlaylist(
    playlistId: string,
    payload: Record<string, unknown>,
  ): Promise<ApiEnvelope<Playlist>> {
    return this.client.patch<ApiEnvelope<Playlist>>(
      `/v1/playlist/${encodeURIComponent(playlistId)}`,
      { body: payload },
    );
  }

  /**
   * Delete a playlist.
   *
   * @param playlistId - The playlist ULID to delete
   * @returns Promise that resolves when the playlist is deleted
   *
   * @example
   * ```typescript
   * await sdk.deletePlaylist('01HQ...');
   * ```
   *
   * @category Playlists
   */
  async deletePlaylist(playlistId: string): Promise<void> {
    await this.client.delete(`/v1/playlist/${encodeURIComponent(playlistId)}`);
  }

  /**
   * Upload a cover image for a playlist.
   *
   * Uses S3 multipart upload to tmp/ location, returns URL for use with updatePlaylist.
   *
   * @param playlistId - The playlist ID (used for S3 path organization)
   * @param file - The image file to upload (File or Blob)
   * @param userUlid - The user's ULID (required for S3 tmp path)
   * @returns Promise resolving to the S3 URL of the uploaded image
   *
   * @example
   * ```typescript
   * const coverUrl = await sdk.uploadPlaylistCoverImage(
   *   '01HQ...',
   *   imageFile,
   *   user.ulid
   * );
   * await sdk.updatePlaylist('01HQ...', { coverUrl });
   * ```
   *
   * @category Playlists
   */
  async uploadPlaylistCoverImage(
    playlistId: string,
    file: File | Blob,
    userUlid: string,
  ): Promise<string> {
    // Convert Blob to File if needed (for uploadMediaFile compatibility)
    const fileToUpload = file instanceof File
      ? file
      : new File([file], `playlist-cover-${playlistId}.jpg`, { type: file.type || 'image/jpeg' });

    const result = await this.uploadMediaFile(fileToUpload, {
      userUlid,
      mediaType: 'image',
    });

    return result.url;
  }

  /**
   * Add songs to a playlist.
   *
   * The media array should contain objects with id (song ULID) and order (position).
   *
   * @param playlistId - The playlist ULID to add songs to
   * @param songs - Array of song objects with id (ULID) and optional order (position)
   * @returns Promise resolving to the updated playlist
   *
   * @example
   * ```typescript
   * await sdk.addPlaylistSongs('01HQ...', [
   *   { id: 'song1ulid', order: 0 },
   *   { id: 'song2ulid', order: 1 }
   * ]);
   * ```
   *
   * @category Playlists
   */
  async addPlaylistSongs(
    playlistId: string,
    songs: Array<{ id: Ulid; order?: number }>,
  ): Promise<ApiEnvelope<Playlist>> {
    return this.client.patch<ApiEnvelope<Playlist>>(
      `/v1/playlist/${encodeURIComponent(playlistId)}/media`,
      { body: { media: songs } },
    );
  }

  /**
   * Remove a song from a playlist.
   *
   * @param playlistId - The playlist ULID to remove from
   * @param songUlid - The song ULID to remove
   * @returns Promise resolving to the updated playlist
   *
   * @example
   * ```typescript
   * await sdk.removePlaylistSong('01HQ...', 'songUlid123');
   * ```
   *
   * @category Playlists
   */
  async removePlaylistSong(
    playlistId: string,
    songUlid: Ulid,
  ): Promise<ApiEnvelope<Playlist>> {
    return this.client.delete<ApiEnvelope<Playlist>>(
      `/v1/playlist/${encodeURIComponent(playlistId)}/media`,
      { body: { ulids: [songUlid] } },
    );
  }

  /**
   * Reorder songs in a playlist by providing an ordered array of song ULIDs.
   * Each item contains the song ID and its new order position.
   */
  async reorderPlaylistSongs(
    playlistId: string,
    songs: Array<{ id: Ulid; order: number }>,
  ): Promise<ApiEnvelope<Playlist>> {
    return this.client.patch<ApiEnvelope<Playlist>>(
      `/v1/playlist/${encodeURIComponent(playlistId)}/media`,
      { body: { media: songs, is_reorder: true } },
    );
  }

  /**
   * Promote a playlist to Explore (make it public/featured).
   * Requires user to have appropriate permissions (Administrator/Creator badges).
   */
  async promotePlaylist(playlistId: string): Promise<ApiEnvelope<{ message: string }>> {
    return this.client.post<ApiEnvelope<{ message: string }>>(
      `/v1/playlists/${encodeURIComponent(playlistId)}/promote`,
    );
  }

  /**
   * Remove a playlist from Explore (unpromote/unfeature it).
   */
  async unpromotePlaylist(playlistId: string): Promise<ApiEnvelope<{ message: string }>> {
    return this.client.post<ApiEnvelope<{ message: string }>>(
      `/v1/playlists/${encodeURIComponent(playlistId)}/unpromote`,
    );
  }

  /**
   * Check if the current user can promote playlists to Explore.
   * Returns whether the user has Administrator or Creator badges.
   */
  async canPromotePlaylist(): Promise<ApiEnvelope<{ can_promote: boolean; promotion_badges: string[] }>> {
    return this.client.get<ApiEnvelope<{ can_promote: boolean; promotion_badges: string[] }>>(
      '/v1/playlists/can-promote',
    );
  }

  /**
   * Check if the current user can manage (edit) public playlists in Explore.
   * Returns true if user has Administrator badge.
   */
  async canManagePublicPlaylists(): Promise<ApiEnvelope<{ can_manage: boolean }>> {
    return this.client.get<ApiEnvelope<{ can_manage: boolean }>>(
      '/v1/playlists/can-manage',
    );
  }

  // ---------------------------------------------------------------------------
  // Radio Stations
  // ---------------------------------------------------------------------------

  /**
   * Get all radio stations (active for listeners, all for admins).
   *
   * @param options - Optional filters
   * @param options.state - Filter by state ('draft', 'active', 'inactive')
   * @param options.featured - Filter by featured status
   * @returns Promise resolving to array of radio stations
   *
   * @category Radio Stations
   */
  async getRadioStations(options?: { state?: string; featured?: boolean }): Promise<ApiEnvelope<Playlist[]>> {
    const queryParams: Record<string, string> = {};
    if (options?.state) {
      queryParams.state = options.state;
    }
    if (options?.featured !== undefined) {
      queryParams.featured = options.featured ? '1' : '0';
    }
    const query = Object.keys(queryParams).length > 0 ? { query: queryParams } : undefined;
    return this.client.get<ApiEnvelope<Playlist[]>>('/v1/radio-stations', query);
  }

  /**
   * Get a single radio station by ULID.
   *
   * @param ulid - Radio station ULID
   * @param includeTracks - Whether to include track list (admin only, or for active stations)
   * @returns Promise resolving to radio station data
   *
   * @category Radio Stations
   */
  async getRadioStation(ulid: string, includeTracks = false): Promise<ApiEnvelope<Playlist> & { start_position?: number; total_tracks?: number }> {
    const query = includeTracks ? { query: { include_tracks: true } } : undefined;
    // The response includes start_position and total_tracks at the top level (from ->additional())
    const response = await this.client.get<ApiEnvelope<Playlist> & { start_position?: number; total_tracks?: number }>(`/v1/radio-stations/${encodeURIComponent(ulid)}`, query);
    
    // If tracks are included, process them like feed routes (handle FeedResourceCollection format)
    if (includeTracks && response.data) {
      const station = response.data as any;
      
      // Handle FeedResourceCollection format: tracks may be { data: [...] } or just [...]
      let tracksData = station.tracks || station.songs || [];
      
      // Extract data array if wrapped in FeedResourceCollection format
      if (tracksData && typeof tracksData === 'object' && 'data' in tracksData && Array.isArray(tracksData.data)) {
        tracksData = tracksData.data;
      }
      
      // Process tracks similar to fetchFeedPage - check if they're full posts or feed items
      if (Array.isArray(tracksData) && tracksData.length > 0) {
        const firstItem = tracksData[0];
        // Check if this is a FeedResource (metadata only) vs full PostResource
        // FeedResource has: ulid, type, updatedAt, userId, commentCount, etc. but NO content fields
        // PostResource has: title, body, streamUrl, audio, images, etc.
        // If it only has FeedResource fields (ulid, type, updatedAt, userId, etc.) and NO content fields, it needs hydration
        const feedResourceFields = ['ulid', 'type', 'updatedAt', 'updatedAtEpoch', 'userId', 'userUpdatedAt', 'userUpdatedAtEpoch', 'lastActiveAt', 'groupUlid', 'groupName', 'commentCount', 'parentUlid'];
        const contentFields = ['title', 'body', 'content', 'song_title', 'songTitle', 'streamUrl', 'audio', 'images', 'attachments', 'audios'];
        
        const hasOnlyFeedFields = firstItem && feedResourceFields.some(field => field in firstItem);
        const hasContentFields = firstItem && contentFields.some(field => 
          field in firstItem && firstItem[field] !== null && firstItem[field] !== undefined
        );
        
        // If it has feed fields but NO content fields, it's a FeedResource and needs hydration
        const needsHydration = hasOnlyFeedFields && !hasContentFields;
        
        this.log(`[SDK] getRadioStation: tracksData.length=${tracksData.length}, needsHydration=${needsHydration}, hasOnlyFeedFields=${hasOnlyFeedFields}, hasContentFields=${hasContentFields}, firstItem keys=${firstItem ? Object.keys(firstItem).join(',') : 'null'}`);
        console.log(`[SDK] getRadioStation: First item analysis:`, {
          ulid: firstItem?.ulid,
          hasOnlyFeedFields,
          hasContentFields,
          needsHydration,
          keys: firstItem ? Object.keys(firstItem) : [],
        });
        
        if (needsHydration) {
          // Tracks are feed items (just ULIDs + metadata) - need to hydrate
          console.log(`[SDK] getRadioStation: 🔥 HYDRATION NEEDED - calling fetchPostsBatch...`);
          const ulids = tracksData.map((item: any) => item.ulid).filter(Boolean);
          this.log(`[SDK] getRadioStation: Detected feed items, extracting ${ulids.length} ULIDs for hydration`);
          
          if (ulids.length > 0) {
            try {
              this.log(`[SDK] getRadioStation: Calling fetchPostsBatch with ${ulids.length} ULIDs...`);
              console.log(`[SDK] getRadioStation: Calling fetchPostsBatch with ${ulids.length} ULIDs...`);
              const hydrated = await this.fetchPostsBatch(ulids);
              this.log(`[SDK] getRadioStation: fetchPostsBatch returned ${Object.keys(hydrated).length} posts`);
              console.log(`[SDK] getRadioStation: fetchPostsBatch returned ${Object.keys(hydrated).length} posts`);

              const hydratedTracks = ulids
                .map((id: string) => hydrated[id])
                .filter(Boolean) as Post[];

              this.log(`[SDK] getRadioStation: Mapped ${hydratedTracks.length} hydrated tracks from ${ulids.length} ULIDs`);
              console.log(`[SDK] getRadioStation: Mapped ${hydratedTracks.length} hydrated tracks`, {
                firstTrack: hydratedTracks[0] ? {
                  ulid: hydratedTracks[0].ulid,
                  title: hydratedTracks[0].title,
                  hasAudio: !!(hydratedTracks[0] as any).audio,
                  audioLength: (hydratedTracks[0] as any).audio?.length,
                  hasStreamUrl: !!(hydratedTracks[0] as any).streamUrl,
                  keys: Object.keys(hydratedTracks[0]).slice(0, 15),
                } : null,
              });

              // Replace tracks with hydrated posts
              station.tracks = hydratedTracks;
              station.songs = hydratedTracks; // Also update songs for compatibility
            } catch (error) {
              this.log(`[SDK] getRadioStation: Error hydrating tracks: ${error}`);
              console.error('[SDK] getRadioStation: Error hydrating tracks:', error);
              // Fallback: set empty tracks
              station.tracks = [];
              station.songs = [];
            }
          } else {
            this.log(`[SDK] getRadioStation: No ULIDs found in tracksData`);
            station.tracks = [];
            station.songs = [];
          }
        } else {
          // Tracks are full post objects - normalize them
          this.log(`[SDK] getRadioStation: Tracks are full posts, normalizing ${tracksData.length} items`);
          const normalizedTracks = tracksData.map((item: any) => this.normalizePost(item)).filter(Boolean) as Post[];
          this.log(`[SDK] getRadioStation: Normalized ${normalizedTracks.length} tracks`);
          station.tracks = normalizedTracks;
          station.songs = normalizedTracks; // Also update songs for compatibility
        }
      } else {
        // No tracks or invalid format
        this.log(`[SDK] getRadioStation: No tracks or invalid format, tracksData=${tracksData}`);
        station.tracks = [];
        station.songs = [];
      }
    }
    
    return response;
  }

  /**
   * Create a new radio station (Admin only).
   *
   * @param payload - Radio station creation data
   * @returns Promise resolving to the created radio station
   *
   * @category Radio Stations
   */
  async createRadioStation(payload: {
    name: string;
    description?: string;
    cover_image?: string;
  }): Promise<ApiEnvelope<Playlist>> {
    return this.client.post<ApiEnvelope<Playlist>>('/v1/radio-stations', { body: payload });
  }

  /**
   * Update a radio station (Admin only).
   *
   * @param ulid - Radio station ULID
   * @param payload - Fields to update
   * @returns Promise resolving to the updated radio station
   *
   * @category Radio Stations
   */
  async updateRadioStation(
    ulid: string,
    payload: {
      name?: string;
      description?: string;
      cover_image?: string;
    },
  ): Promise<ApiEnvelope<Playlist>> {
    return this.client.patch<ApiEnvelope<Playlist>>(`/v1/radio-stations/${encodeURIComponent(ulid)}`, {
      body: payload,
    });
  }

  /**
   * Delete a radio station (Admin only).
   *
   * @param ulid - Radio station ULID
   *
   * @category Radio Stations
   */
  async deleteRadioStation(ulid: string): Promise<void> {
    await this.client.delete(`/v1/radio-stations/${encodeURIComponent(ulid)}`);
  }

  /**
   * Activate a radio station (Admin only).
   *
   * @param ulid - Radio station ULID
   * @returns Promise resolving to the activated radio station
   *
   * @category Radio Stations
   */
  async activateRadioStation(ulid: string): Promise<ApiEnvelope<Playlist>> {
    return this.client.post<ApiEnvelope<Playlist>>(`/v1/radio-stations/${encodeURIComponent(ulid)}/activate`);
  }

  /**
   * Deactivate a radio station (Admin only).
   *
   * @param ulid - Radio station ULID
   * @returns Promise resolving to the deactivated radio station
   *
   * @category Radio Stations
   */
  async deactivateRadioStation(ulid: string): Promise<ApiEnvelope<Playlist>> {
    return this.client.post<ApiEnvelope<Playlist>>(`/v1/radio-stations/${encodeURIComponent(ulid)}/deactivate`);
  }

  /**
   * Toggle featured status of a radio station (Admin only).
   *
   * @param ulid - Radio station ULID
   * @returns Promise resolving to the updated radio station
   *
   * @category Radio Stations
   */
  async toggleFeaturedRadioStation(ulid: string): Promise<ApiEnvelope<Playlist>> {
    return this.client.post<ApiEnvelope<Playlist>>(`/v1/radio-stations/${encodeURIComponent(ulid)}/toggle-featured`);
  }

  /**
   * Search songs using music_analyses filters (Admin only).
   *
   * @param filters - Search filters (BPM, genres, moods, etc.)
   * @returns Promise resolving to search results
   *
   * @category Radio Stations
   */
  async searchRadioStationSongs(filters: {
    query?: string;
    bpm_min?: number;
    bpm_max?: number;
    key?: string;
    genres?: string[];
    moods?: string[];
    instruments?: string[];
    arousal_min?: number;
    arousal_max?: number;
    valence_min?: number;
    valence_max?: number;
    limit?: number;
    offset?: number;
  }): Promise<ApiEnvelope<Array<{
    ulid: string;
    title: string;
    artist: string;
    album?: string;
    duration: number;
  }>>> {
    return this.client.post<ApiEnvelope<Array<{
      ulid: string;
      title: string;
      artist: string;
      album?: string;
      duration: number;
    }>>>('/v1/radio-stations/search/songs', { body: filters });
  }

  /**
   * Get tracks for a radio station (Admin only).
   *
   * @param ulid - Radio station ULID
   * @returns Promise resolving to array of track ULIDs with order
   *
   * @category Radio Stations
   */
  async getRadioStationTracks(ulid: string): Promise<ApiEnvelope<Array<{ ulid: string; order: number }>>> {
    return this.client.get<ApiEnvelope<Array<{ ulid: string; order: number }>>>(
      `/v1/radio-stations/${encodeURIComponent(ulid)}/tracks`,
    );
  }

  /**
   * Add tracks to a radio station (Admin only).
   *
   * @param ulid - Radio station ULID
   * @param trackUlids - Array of track ULIDs to add
   *
   * @category Radio Stations
   */
  async addRadioStationTracks(ulid: string, trackUlids: string[]): Promise<void> {
    await this.client.post(`/v1/radio-stations/${encodeURIComponent(ulid)}/tracks`, {
      body: { tracks: trackUlids },
    });
  }

  /**
   * Remove a track from a radio station (Admin only).
   *
   * @param ulid - Radio station ULID
   * @param trackUlid - Track ULID to remove
   *
   * @category Radio Stations
   */
  async removeRadioStationTrack(ulid: string, trackUlid: string): Promise<void> {
    await this.client.delete(`/v1/radio-stations/${encodeURIComponent(ulid)}/tracks/${encodeURIComponent(trackUlid)}`);
  }

  /**
   * Reorder tracks in a radio station (Admin only).
   *
   * @param ulid - Radio station ULID
   * @param tracks - Array of track ULIDs with new order positions
   *
   * @category Radio Stations
   */
  async reorderRadioStationTracks(
    ulid: string,
    tracks: Array<{ ulid: string; order: number }>,
  ): Promise<void> {
    await this.client.patch(`/v1/radio-stations/${encodeURIComponent(ulid)}/tracks`, {
      body: { tracks },
    });
  }

  /**
   * Convert an existing playlist to a radio station (Admin only).
   *
   * @param playlistUlid - The ULID of the playlist to convert
   * @param options - Optional conversion options (state, config, name, description, cover_image)
   * @returns Promise resolving to the converted radio station
   *
   * @category Radio Stations
   */
  async convertPlaylistToRadioStation(
    playlistUlid: string,
    options?: {
      radio_station_state?: 'draft' | 'active' | 'inactive';
      radio_station_config?: Record<string, unknown>;
      name?: string;
      description?: string;
      cover_image?: string;
    },
  ): Promise<ApiEnvelope<Playlist>> {
    return this.client.post<ApiEnvelope<Playlist>>(
      `/v1/radio-stations/convert/${encodeURIComponent(playlistUlid)}`,
      { body: options || {} },
    );
  }

  // ---------------------------------------------------------------------------
  // Users/Profile
  // ---------------------------------------------------------------------------

  /**
   * Normalize user profile data from API to SDK interface
   * Maps various API field names to standardized SDK field names
   */
  private normalizeUserProfile(data: Record<string, unknown>): UserProfile {
    // Normalize displayName - API may return 'name' instead of 'displayName'
    const displayName = (data.displayName || data.name) as string | undefined;

    // Normalize avatarVariants and backgroundVariants (convert snake_case to camelCase)
    const avatarVariantsRaw = data.avatarVariants || data.avatar_variants;
    const backgroundVariantsRaw = data.backgroundVariants || data.background_variants;
    
    // Safely normalize variants - only convert if it's a plain object
    let avatarVariants: ImageVariants | undefined = undefined;
    let backgroundVariants: ImageVariants | undefined = undefined;
    
    if (avatarVariantsRaw && typeof avatarVariantsRaw === 'object' && !Array.isArray(avatarVariantsRaw) && avatarVariantsRaw.constructor === Object) {
      try {
        avatarVariants = snakeToCamelObject(avatarVariantsRaw) as ImageVariants;
      } catch (err) {
        console.warn('[SDK] Failed to normalize avatarVariants:', err);
        // Fallback: use raw data if normalization fails
        avatarVariants = avatarVariantsRaw as ImageVariants;
      }
    }
    
    if (backgroundVariantsRaw && typeof backgroundVariantsRaw === 'object' && !Array.isArray(backgroundVariantsRaw) && backgroundVariantsRaw.constructor === Object) {
      try {
        backgroundVariants = snakeToCamelObject(backgroundVariantsRaw) as ImageVariants;
      } catch (err) {
        console.warn('[SDK] Failed to normalize backgroundVariants:', err);
        // Fallback: use raw data if normalization fails
        backgroundVariants = backgroundVariantsRaw as ImageVariants;
      }
    }
    
    // Create normalized object, excluding snake_case variant keys and any functions to avoid conflicts
    // Also exclude methods that might have been added (like isAdmin, hasBadge from CurrentUser)
    const {
      avatar_variants: _avatarVariants,
      background_variants: _backgroundVariants,
      isAdmin: _isAdmin,
      hasBadge: _hasBadge,
      ...restData
    } = data;
    
    // Filter out any functions that might be in restData (defensive programming)
    const cleanRestData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(restData)) {
      // Skip functions and symbols - they can't be stored in IndexedDB
      if (typeof value !== 'function' && typeof value !== 'symbol') {
        cleanRestData[key] = value;
      }
    }
    
    const normalized: UserProfile = {
      // Preserve all original data first (excluding snake_case variant keys and functions)
      ...cleanRestData,
      // Then override with normalized values
      ulid: data.ulid as string,
      username: data.username as string | undefined,
      displayName,
      name: data.name as string | undefined,
      avatarUrl: data.avatarUrl as string | undefined,
      avatar: data.avatar as string | undefined,
      bio: data.bio as string | undefined,
      // Normalize count fields - API may return followers/following/postCount
      // but SDK interface expects followersCount/followingCount/postsCount
      followersCount: (data.followersCount || data.followers || 0) as number,
      followingCount: (data.followingCount || data.following || 0) as number,
      postsCount: (data.postsCount || data.postCount || 0) as number,
    };
    
    // Only add variant fields if they exist (avoid storing undefined)
    if (avatarVariants !== undefined) {
      normalized.avatarVariants = avatarVariants;
    }
    if (backgroundVariants !== undefined) {
      normalized.backgroundVariants = backgroundVariants;
    }
    
    return normalized;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // User Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a user profile by username.
   *
   * Checks IndexedDB cache first, then falls back to API.
   *
   * @param username - Username to lookup
   * @param skipCache - Skip cache and fetch directly from API
   * @returns User profile wrapped in API envelope
   *
   * @example
   * ```typescript
   * const { data: profile } = await sdk.getUserProfile('johndoe');
   * console.log(profile.displayName, profile.followersCount);
   * ```
   *
   * @category Users
   */
  async getUserProfile(username: string, skipCache = false): Promise<ApiEnvelope<UserProfile>> {
    this.log('🔍 SDK: getUserProfile called with username:', username, 'skipCache:', skipCache);
    const cache = await this.cachePromise;

    // Try IndexedDB cache first (unless skipCache is true)
    if (!skipCache) {
      const cached = await cache.getUserByUsername(username);
      if (cached) {
        this.log('✅ SDK: Found user in IndexedDB cache:', username);
        return { data: cached };
      }
      this.log('❌ SDK: User not in cache, fetching from API:', username);
    } else {
      this.log('⏭️ SDK: Skipping cache lookup, fetching directly from API:', username);
    }

    // Fetch from API
    this.log('📡 SDK: Making API request to /v1/profile/' + username);
    const response = await this.client.get<ApiEnvelope<Record<string, unknown>>>(
      `/v1/profile/${encodeURIComponent(username)}`,
    );

    // Normalize and cache the result
    if (response.data) {
      const normalized = this.normalizeUserProfile(response.data);
      await cache.setUser(normalized.ulid, normalized);
      this.log('💾 SDK: Cached fresh profile for:', username);
      return { data: normalized };
    }

    return response as ApiEnvelope<UserProfile>;
  }

  /**
   * Get a user profile by ULID.
   *
   * Preferred over username lookup when ULID is available.
   * Checks IndexedDB cache first, then falls back to API.
   *
   * @param ulid - User ULID to lookup
   * @returns User profile wrapped in API envelope
   *
   * @example
   * ```typescript
   * const { data: profile } = await sdk.getUserProfileById('01HX...');
   * ```
   *
   * @category Users
   */
  async getUserProfileById(ulid: Ulid): Promise<ApiEnvelope<UserProfile>> {
    const cache = await this.cachePromise;

    // Try IndexedDB cache first
    const cached = await cache.getUser(ulid);
    if (cached) {
      this.log('✅ SDK: Found user in IndexedDB cache by ID:', ulid);
      return { data: cached };
    }

    // Fallback to API - fetch by ULID using the profile endpoint
    this.log('📡 SDK: Fetching user from API by ID:', ulid);
    const response = await this.client.get<ApiEnvelope<Record<string, unknown>>>(
      `/v1/profile/ulid/${encodeURIComponent(ulid)}`,
    );

    // Normalize and cache the result
    if (response.data) {
      const normalized = this.normalizeUserProfile(response.data);
      await cache.setUser(ulid, normalized);
      return { data: normalized };
    }

    return response as ApiEnvelope<UserProfile>;
  }

  /**
   * Get multiple user profiles by ULIDs in a single batched request
   * Checks IndexedDB cache first, only fetches missing profiles from API
   * @param ulids - Array of user ULIDs to fetch
   * @returns Array of user profiles
   */
  async getBatchedUserProfiles(ulids: string[]): Promise<UserProfile[]> {
    if (ulids.length === 0) return [];

    const cache = await this.cachePromise;

    // Check cache for all ULIDs
    const cachedUsers = await cache.getUsers(ulids);
    const cached = Array.from(cachedUsers.values());

    // Determine which ULIDs are missing from cache
    const cachedUlids = new Set(cachedUsers.keys());
    const missingUlids = ulids.filter(ulid => !cachedUlids.has(ulid));

    this.log(`✅ SDK: Found ${cached.length}/${ulids.length} users in IndexedDB cache`);

    // If all are cached, return immediately
    if (missingUlids.length === 0) {
      return cached;
    }

    // Fetch missing profiles from API
    this.log(`📡 SDK: Fetching ${missingUlids.length} missing users from API`);
    const response = await this.client.post<UserProfile[]>("/v1/profile", {
      body: { ulids: missingUlids },
    });

    // Handle response format - the API wraps it in an array
    let fetchedUsers: UserProfile[] = [];
    if (Array.isArray(response)) {
      // If it's an array with one element that's also an array
      if (response.length === 1 && Array.isArray(response[0])) {
        fetchedUsers = response[0];
      } else {
        fetchedUsers = response;
      }
    }

    // Cache the newly fetched users
    if (fetchedUsers.length > 0) {
      this.log('📦 SDK: Attempting to cache fetched users:', fetchedUsers);
      try {
        await cache.setUsers(fetchedUsers);
        this.log('✅ SDK: Successfully cached fetched users');
      } catch (cacheError) {
        console.error('❌ SDK: Failed to cache users:', cacheError);
        console.error('Data that failed to cache:', JSON.stringify(fetchedUsers, null, 2));
        // Continue anyway - return the users even if caching fails
      }
    }

    // Combine cached and fetched users
    return [...cached, ...fetchedUsers];
  }

  /**
   * Get followers for a user's profile by username.
   * Uses /v1/profile/{username}/followers endpoint.
   */
  async getProfileFollowers(username: string): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>(
      `/v1/profile/${encodeURIComponent(username)}/followers`,
    );
  }

  /**
   * Get following for a user's profile by username.
   * Uses /v1/profile/{username}/following endpoint.
   */
  async getProfileFollowing(username: string): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>(
      `/v1/profile/${encodeURIComponent(username)}/following`,
    );
  }

  /**
   * Get posts for a user's profile by username.
   * Uses /v1/profile/{username}/feed endpoint.
   */
  async getProfileFeed(username: string, cursor?: string | null): Promise<FeedPage> {
    const endpoint = `/v1/profile/${encodeURIComponent(username)}/feed`;
    return this.fetchFeedPage(cursor, endpoint, `profile-feed-${username}`);
  }

  /**
   * Get songs for a user's profile by username.
   * Uses /v1/songs/user/{username} endpoint.
   */
  async getProfileSongs(username: string, cursor?: string | null): Promise<FeedPage> {
    const endpoint = `/v1/songs/user/${encodeURIComponent(username)}`;
    return this.fetchFeedPage(cursor, endpoint, `profile-songs-${username}`);
  }

  /**
   * Get posts only (no songs/media) for a user's profile by username.
   * Uses /v1/profile/{username}/feedPostsOnly endpoint.
   */
  async getProfilePostsOnly(username: string, cursor?: string | null): Promise<FeedPage> {
    const endpoint = `/v1/profile/${encodeURIComponent(username)}/feedPostsOnly`;
    return this.fetchFeedPage(cursor, endpoint, `profile-posts-${username}`);
  }

  /**
   * Get images/media for a user's profile by username.
   * Uses /v1/profile/{username}/feedImagesOnly endpoint.
   */
  async getProfileImages(username: string, cursor?: string | null): Promise<FeedPage> {
    const endpoint = `/v1/profile/${encodeURIComponent(username)}/feedImagesOnly`;
    return this.fetchFeedPage(cursor, endpoint, `profile-images-${username}`);
  }

  /**
   * @deprecated Use getProfileFollowers(username) instead.
   * This method calls a non-existent endpoint.
   */
  async getUserFollowers(userId: Ulid): Promise<ApiEnvelope<unknown>> {
    const profile = await this.fetchUserProfileById(userId);
    if (!profile?.username) {
      throw new Error(`Cannot fetch followers: username not found for ULID ${userId}`);
    }
    return this.getProfileFollowers(profile.username);
  }

  /**
   * @deprecated Use getProfileFollowing(username) instead.
   * This method calls a non-existent endpoint.
   */
  async getUserFollowing(userId: Ulid): Promise<ApiEnvelope<unknown>> {
    const profile = await this.fetchUserProfileById(userId);
    if (!profile?.username) {
      throw new Error(`Cannot fetch following: username not found for ULID ${userId}`);
    }
    return this.getProfileFollowing(profile.username);
  }

  /**
   * @deprecated Use getProfileFeed(username) instead. This method calls a non-existent endpoint.
   * Kept for backwards compatibility - fetches username from profile first.
   */
  async getUserPosts(userId: Ulid, cursor?: string | null): Promise<FeedPage> {
    const profile = await this.fetchUserProfileById(userId);
    if (!profile?.username) {
      throw new Error(`Cannot fetch posts: username not found for ULID ${userId}`);
    }
    return this.getProfileFeed(profile.username, cursor);
  }

  /**
   * @deprecated Use getProfileLikes(username) instead.
   */
  async getUserLikes(userId: Ulid, cursor?: string | null): Promise<FeedPage> {
    // Note: /v1/profile/{username}/likes endpoint needs to be verified
    const profile = await this.fetchUserProfileById(userId);
    if (!profile?.username) {
      throw new Error(`Cannot fetch likes: username not found for ULID ${userId}`);
    }
    const endpoint = `/v1/profile/${encodeURIComponent(profile.username)}/likes`;
    return this.fetchFeedPage(cursor, endpoint, `profile-likes-${profile.username}`);
  }

  /**
   * @deprecated Use getProfileImages(username) instead.
   */
  async getUserMedia(userId: Ulid, cursor?: string | null): Promise<FeedPage> {
    const profile = await this.fetchUserProfileById(userId);
    if (!profile?.username) {
      throw new Error(`Cannot fetch media: username not found for ULID ${userId}`);
    }
    return this.getProfileImages(profile.username, cursor);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Follow/Unfollow
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Follow a user by username.
   *
   * @param username - Username of the user to follow
   *
   * @example
   * ```typescript
   * await sdk.followUser('johndoe');
   * ```
   *
   * @category Users
   */
  async followUser(username: string): Promise<void> {
    await this.client.put(`/v1/profile/${encodeURIComponent(username)}/follow`);
  }

  /**
   * Unfollow a user by username.
   *
   * @param username - Username of the user to unfollow
   *
   * @category Users
   */
  async unfollowUser(username: string): Promise<void> {
    await this.client.delete(`/v1/profile/${encodeURIComponent(username)}/follow`);
  }

  /**
   * Follow a user by ULID.
   *
   * Convenience method that fetches the username first, then follows.
   *
   * @param userId - ULID of the user to follow
   *
   * @category Users
   */
  async followUserByUlid(userId: Ulid): Promise<void> {
    const profile = await this.fetchUserProfileById(userId);
    if (!profile?.username) {
      throw new Error(`Cannot follow user: username not found for ULID ${userId}`);
    }
    await this.followUser(profile.username);
  }

  /**
   * Unfollow a user by ULID.
   *
   * Convenience method that fetches the username first, then unfollows.
   *
   * @param userId - ULID of the user to unfollow
   *
   * @category Users
   */
  async unfollowUserByUlid(userId: Ulid): Promise<void> {
    const profile = await this.fetchUserProfileById(userId);
    if (!profile?.username) {
      throw new Error(`Cannot unfollow user: username not found for ULID ${userId}`);
    }
    await this.unfollowUser(profile.username);
  }

  // Note: Follow status is returned in the profile response as `isFollowing` and `isFollowingYou`
  // No separate endpoint needed - use getUserProfile() to get follow status

  // ─────────────────────────────────────────────────────────────────────────
  // Invite Friends
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Send an email invitation to a friend.
   *
   * @param email - Email address to invite
   * @returns Success status and message
   *
   * @category Users
   */
  async inviteByEmail(email: string): Promise<{ message: string; success: boolean }> {
    return this.client.post<{ message: string; success: boolean }>("/v1/users/me/inviteByEmail", {
      body: { email },
    });
  }

  /**
   * Send email invitations to multiple friends.
   *
   * @param emails - Array of email addresses to invite
   * @returns Success status and message
   *
   * @category Users
   */
  async inviteByEmailMultiple(emails: string[]): Promise<{ message: string; success: boolean }> {
    return this.client.post<{ message: string; success: boolean }>("/v1/users/me/inviteEmailMultiple", {
      body: { emails },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Block/Mute
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Block a user.
   *
   * Blocked users cannot see your content or interact with you.
   *
   * @param userId - ULID of the user to block
   *
   * @category Users
   */
  async blockUser(userId: Ulid): Promise<void> {
    await this.client.post(`/v1/users/${encodeURIComponent(userId)}/block`);
  }

  /**
   * Unblock a user.
   *
   * @param userId - ULID of the user to unblock
   *
   * @category Users
   */
  async unblockUser(userId: Ulid): Promise<void> {
    await this.client.delete(`/v1/users/${encodeURIComponent(userId)}/block`);
  }

  /**
   * Get a list of users you have blocked.
   *
   * @param cursor - Pagination cursor
   * @returns List of blocked user profiles
   *
   * @category Users
   */
  async getBlockedUsers(cursor?: string | null): Promise<ApiEnvelope<UserProfile[]>> {
    return this.client.get<ApiEnvelope<UserProfile[]>>("/v1/users/me/blockedUsers", {
      query: cursor ? { cursor } : undefined,
    });
  }

  /**
   * Mute a user.
   *
   * Muted users' content will not appear in your feeds.
   *
   * @param userId - ULID of the user to mute
   *
   * @category Users
   */
  async muteUser(userId: Ulid): Promise<void> {
    await this.client.post(`/v1/users/${encodeURIComponent(userId)}/mute`);
  }

  /**
   * Unmute a user.
   *
   * @param userId - ULID of the user to unmute
   *
   * @category Users
   */
  async unmuteUser(userId: Ulid): Promise<void> {
    await this.client.delete(`/v1/users/${encodeURIComponent(userId)}/mute`);
  }

  /**
   * Get a list of users you have muted.
   *
   * @param cursor - Pagination cursor
   * @returns List of muted user profiles
   *
   * @category Users
   */
  async getMutedUsers(cursor?: string | null): Promise<ApiEnvelope<UserProfile[]>> {
    return this.client.get<ApiEnvelope<UserProfile[]>>("/v1/users/me/mutedUsers", {
      query: cursor ? { cursor } : undefined,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Admin Moderation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ban a user (admin/moderator only).
   *
   * Banned users cannot access the platform.
   *
   * @param userId - ULID of the user to ban
   *
   * @category Users
   */
  async banUser(userId: Ulid): Promise<void> {
    await this.client.post("/admin/profile/ban", {
      body: { ulid: userId },
    });
  }

  /**
   * Unban a user (admin/moderator only).
   *
   * @param userId - ULID of the user to unban
   *
   * @category Users
   */
  async unbanUser(userId: Ulid): Promise<void> {
    await this.client.delete("/admin/profile/ban", {
      body: { ulid: userId },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Report Content
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Report a post for policy violation.
   *
   * @param postUlid - ULID of the post to report
   * @param reason - Reason category for the report
   * @param details - Additional details about the report
   *
   * @category Posts
   */
  async reportPost(postUlid: Ulid, reason: string, details?: string): Promise<void> {
    await this.client.post(`/v1/posts/${encodeURIComponent(postUlid)}/report`, {
      body: { reason, details },
    });
  }

  /**
   * Report a user for policy violation.
   *
   * @param userId - ULID of the user to report
   * @param reason - Reason category for the report
   * @param details - Additional details about the report
   *
   * @category Users
   */
  async reportUser(userId: Ulid, reason: string, details?: string): Promise<void> {
    await this.client.post(`/v1/users/${encodeURIComponent(userId)}/report`, {
      body: { reason, details },
    });
  }

  async reportComment(commentUlid: Ulid, reason: string, details?: string): Promise<void> {
    await this.client.post(`/v1/comments/${encodeURIComponent(commentUlid)}/report`, {
      body: { reason, details },
    });
  }

  async fetchUserProfileById(
    userId: Ulid,
    hintUpdatedAt?: string | number,
  ): Promise<UserProfile | null> {
    const cache = await this.cachePromise;
    const cached = await cache.getUser(userId);
    if (cached && !this.isUserStale(cached, hintUpdatedAt)) {
      // Handle cached data that may be wrapped in {data: [...]} (legacy cache entries)
      if (cached && typeof cached === 'object' && 'data' in cached && Array.isArray((cached as any).data)) {
        const unwrappedCached = (cached as any).data[0] as UserProfile;
        if (unwrappedCached) {
          // Fix the cache entry
          await cache.setUser(userId, unwrappedCached);
          return unwrappedCached;
        }
      }
      return cached;
    }

    // Use batched fetching with debounce
    return this.queueUserFetch(userId, hintUpdatedAt);
  }

  /**
   * Create a reactive observable for a user profile by ID.
   * Uses Dexie's liveQuery to automatically update when the user data changes in IndexedDB.
   * This is useful for keeping UI components in sync with cached user data.
   *
   * @param userId - User ULID to observe
   * @returns Observable that emits UserProfile | null whenever the cache entry changes
   *
   * @example
   * ```typescript
   * const subscription = sdk.observeUserProfile(userId).subscribe({
   *   next: (profile) => console.log('Profile updated:', profile),
   *   error: (err) => console.error('Error:', err),
   * });
   * // Later: subscription.unsubscribe();
   * ```
   */
  async observeUserProfile(userId: Ulid): Promise<import("dexie").Observable<UserProfile | null>> {
    const cache = await this.cachePromise;
    return cache.observeUser(userId);
  }

  /**
   * Queue a user profile fetch for batching. Debounces requests and batches up to 20 ULIDs.
   */
  private queueUserFetch(userId: Ulid, hintUpdatedAt?: string | number): Promise<UserProfile | null> {
    return new Promise((resolve, reject) => {
      // Add to queue
      this.userBatchQueue.set(userId, hintUpdatedAt);

      // Add resolver
      const resolvers = this.userPendingResolvers.get(userId) || [];
      resolvers.push({ resolve, reject });
      this.userPendingResolvers.set(userId, resolvers);

      // Clear existing timer
      if (this.userBatchTimer !== null) {
        clearTimeout(this.userBatchTimer);
      }

      // If we hit max batch size, flush immediately
      if (this.userBatchQueue.size >= this.userBatchMaxSize) {
        this.flushUserBatch();
      } else {
        // Otherwise, debounce
        this.userBatchTimer = setTimeout(() => this.flushUserBatch(), this.userBatchDelay) as unknown as number;
      }
    });
  }

  /**
   * Flush the user batch queue and fetch all queued users in one request.
   */
  private async flushUserBatch(): Promise<void> {
    if (this.userBatchQueue.size === 0) return;

    // Capture current queue and clear
    const userIds = Array.from(this.userBatchQueue.keys());
    const resolversSnapshot = new Map(this.userPendingResolvers);
    this.userBatchQueue.clear();
    this.userPendingResolvers.clear();
    this.userBatchTimer = null;

    try {
      const response = await this.client.post<ApiEnvelope<UserProfile[]>>("/v1/profile", {
        body: { ulids: userIds },
      });

      let users = this.unwrap<UserProfile[]>(response);

      // Handle double-wrapped response: { data: [ { data: [...] } ] }
      if (Array.isArray(users) && users.length > 0 && users[0] && typeof users[0] === 'object' && 'data' in users[0]) {
        users = (users[0] as any).data as UserProfile[];
      }

      // Build map of userId -> user
      const userMap = new Map<Ulid, UserProfile>();
      if (Array.isArray(users)) {
        const cache = await this.cachePromise;
        for (const user of users) {
          const id = user.ulid || user.id;
          if (id) {
            userMap.set(id as Ulid, user);
            await cache.setUser(id as Ulid, user);
          }
        }
      }

      // Resolve all pending promises
      for (const userId of userIds) {
        const resolvers = resolversSnapshot.get(userId) || [];
        const user = userMap.get(userId) || null;
        for (const { resolve } of resolvers) {
          resolve(user);
        }
      }
    } catch (err) {
      console.error(`[SDK] ❌ Error fetching user batch:`, err);
      // Reject all pending promises
      for (const userId of userIds) {
        const resolvers = resolversSnapshot.get(userId) || [];
        for (const { reject } of resolvers) {
          reject(err);
        }
      }
    }
  }

  private isUserStale(user: UserProfile, hintUpdatedAt?: string | number): boolean {
    if (!hintUpdatedAt) return false;
    const cachedAt = typeof user.updatedAt === "string" ? Date.parse(user.updatedAt) : Number(user.updatedAt || 0);
    const hintAt =
      typeof hintUpdatedAt === "string" ? Date.parse(hintUpdatedAt) : Number(hintUpdatedAt);
    if (!cachedAt || !hintAt) return false;
    return hintAt > cachedAt;
  }

  private async hydrateUsersFromHints(
    hints: Array<{ userId: Ulid; userUpdatedAt?: string | number }>,
  ): Promise<void> {
    const cache = await this.cachePromise;
    const uniqueHints = Object.values(
      hints.reduce<Record<string, { userId: Ulid; userUpdatedAt?: string | number }>>(
        (acc, h) => {
          if (!h.userId) return acc;
          acc[h.userId] = h;
          return acc;
        },
        {},
      ),
    );

    const staleOrMissing = [];
    for (const hint of uniqueHints) {
      const cached = await cache.getUser(hint.userId);
      if (!cached || this.isUserStale(cached, hint.userUpdatedAt)) {
        staleOrMissing.push(hint);
      }
    }

    if (staleOrMissing.length === 0) return;

    // Queue all fetches in parallel - they will be batched automatically (up to 20 per request)
    await Promise.all(
      staleOrMissing.map(hint => this.fetchUserProfileById(hint.userId, hint.userUpdatedAt))
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Search
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Search users by query string (full search).
   *
   * Returns user profiles matching the search query with fields:
   * ulid, name, username, avatar, updatedAt, updatedAtEpoch.
   *
   * @param query - The search query string
   * @param limit - Maximum number of results to return (default: 30)
   * @returns Promise resolving to an array of matching user profiles
   *
   * @example
   * ```typescript
   * const response = await sdk.searchUsers('john');
   * const users = sdk.unwrap(response);
   * users.forEach(user => console.log(user.username));
   * ```
   *
   * @category Search
   */
  async searchUsers(query: string, limit = 30): Promise<ApiEnvelope<UserProfile[]>> {
    return this.client.post<ApiEnvelope<UserProfile[]>>("/v1/search/user", {
      body: { q: query, limit, pagination: false },
    });
  }

  /**
   * Autocomplete users by query string (for typeahead suggestions).
   *
   * Returns lightweight user profiles optimized for typeahead/autocomplete UIs.
   *
   * @param query - The search query string
   * @returns Promise resolving to an array of matching user profiles
   *
   * @example
   * ```typescript
   * const response = await sdk.searchUsersAutocomplete('jo');
   * const suggestions = sdk.unwrap(response);
   * ```
   *
   * @category Search
   */
  async searchUsersAutocomplete(query: string): Promise<ApiEnvelope<UserProfile[]>> {
    return this.client.post<ApiEnvelope<UserProfile[]>>("/v1/search/autocomplete/user", {
      body: { q: query },
    });
  }

  /**
   * Get suggested users to follow.
   *
   * Returns personalized user suggestions based on:
   * - Users followed by people you follow (friends of friends)
   * - Popular users if you don't follow anyone yet
   * - Includes ProfileEngagement data for each user
   *
   * @param limit - Maximum number of suggestions (1-20, default: 5)
   * @returns Promise resolving to an array of suggested users with engagement data
   *
   * @example
   * ```typescript
   * const suggestions = await sdk.getUserSuggestions(10);
   * suggestions.forEach(user => console.log(user.username));
   * ```
   *
   * @category Search
   */
  async getUserSuggestions(limit: number = 5): Promise<SuggestedUser[]> {
    const response = await this.client.get<ApiEnvelope<SuggestedUser[]>>(`/v1/users/me/suggestions?limit=${limit}`);
    return this.unwrap<SuggestedUser[]>(response);
  }

  /**
   * Search audio/songs by query string.
   *
   * Returns audio results with fields:
   * ulid, title, username, userId, avatar, updatedAt, updatedAtEpoch.
   *
   * @param query - The search query string
   * @returns Promise resolving to an array of matching audio results
   *
   * @example
   * ```typescript
   * const response = await sdk.searchAudio('jazz');
   * const songs = sdk.unwrap(response);
   * songs.forEach(song => console.log(song.title));
   * ```
   *
   * @category Search
   */
  async searchAudio(query: string): Promise<ApiEnvelope<AudioSearchResult[]>> {
    return this.client.post<ApiEnvelope<AudioSearchResult[]>>("/v1/search/audio", {
      body: { q: query },
    });
  }

  /**
   * Search/autocomplete hashtags by query string.
   *
   * Sanitizes input to match API requirements (word characters only).
   *
   * @param query - The hashtag query (with or without leading #)
   * @returns Promise resolving to search results with matching hashtag names
   *
   * @example
   * ```typescript
   * const response = await sdk.searchHashtags('music');
   * const result = sdk.unwrap(response);
   * result.items.forEach(tag => console.log('#' + tag.name));
   * ```
   *
   * @category Search
   */
  async searchHashtags(query: string): Promise<ApiEnvelope<SearchResult<{ name: string }>>> {
    // Remove leading # if present and sanitize to only word characters
    // API validates with regex /^[\w]+$/ so we must sanitize before sending
    let hashtag = query.startsWith('#') ? query.slice(1) : query;
    hashtag = hashtag.replace(/[^\w]/g, ''); // Remove non-word characters

    // Return empty results if hashtag is empty or too short after sanitization
    if (!hashtag || hashtag.length < 1) {
      return { data: { items: [] } } as ApiEnvelope<SearchResult<{ name: string }>>;
    }

    return this.client.post<ApiEnvelope<SearchResult<{ name: string }>>>("/v1/search/autocomplete/hashtag", {
      body: { hashtag },
    });
  }

  /**
   * Hydrate search results by fetching full post data for SONG/PODCAST posts.
   * Search API returns metadata only - this fetches audio URLs, cover images, etc.
   */
  private async hydrateSearchResults(posts: Post[]): Promise<Post[]> {
    const audioTypes = ["SONG", "PODCAST"];
    const postsToHydrate = posts.filter((p) => {
      const type = p.type || p.postType || "";
      // Return only audio posts missing audio data
      return audioTypes.includes(type) && 
        (!p.audio || (Array.isArray(p.audio) && p.audio.length === 0));
    });

    // If no posts need hydration, return early
    if (postsToHydrate.length === 0) {
      return posts.map((p) => this.normalizePost(p));
    }
    
    const ulids = postsToHydrate.map((p) => p.ulid || p.id).filter(Boolean) as string[];
    const hydrated = await this.fetchPostsBatch(ulids);

    return posts.map((post) => {
      const id = post.ulid || post.id;
      const fullPost = id ? hydrated[id] : null;
      // Use hydrated post if available, otherwise use original
      return this.normalizePost(fullPost || post);
    });
  }
  /**
   * Search posts by hashtag.
   *
   * @param hashtag - The hashtag to search for (with or without leading #)
   * @returns Promise resolving to search results containing matching posts
   *
   * @example
   * ```typescript
   * const response = await sdk.searchPostsByHashtag('#music');
   * const result = sdk.unwrap(response);
   * result.items.forEach(post => console.log(post.title));
   * ```
   *
   * @category Search
   */
  async searchPostsByHashtag(hashtag: string): Promise<ApiEnvelope<SearchResult<Post>>> {
    // Remove leading # if present
    const tag = hashtag.startsWith("#") ? hashtag.slice(1) : hashtag;
    const response = await this.client.post<ApiEnvelope<SearchResult<Post>>>(
      "/v1/search/posts/hashtag",
      {
        body: { hashtag: tag },
      },
    );
    if (response.data?.items) {
      response.data.items = await this.hydrateSearchResults(response.data.items);
    }
    return response;
  }

  /**
   * Search posts by text query (full-text search).
   *
   * @param query - The search query string
   * @returns Promise resolving to search results containing matching posts
   *
   * @example
   * ```typescript
   * const response = await sdk.searchPosts('music production tips');
   * const result = sdk.unwrap(response);
   * result.items.forEach(post => console.log(post.title));
   * ```
   *
   * @category Search
   */
  async searchPosts(query: string): Promise<ApiEnvelope<SearchResult<Post>>> {
    const rawResponse = await this.client.post<SearchResult<Post>>(
      "/v1/search/posts",
      {
        body: { q: query },
      },
    );
    // Wrap response to match ApiEnvelope<SearchResult<Post>> format
    const response: ApiEnvelope<SearchResult<Post>> = {
      data: rawResponse as SearchResult<Post>,
    };
    
    if (response.data?.items) {
      response.data.items = await this.hydrateSearchResults(response.data.items);
    }
    return response;
  }

  /**
   * Search posts by user ULID.
   *
   * @param userUlid - The user ULID whose posts to search
   * @returns Promise resolving to search results containing the user's posts
   *
   * @example
   * ```typescript
   * const response = await sdk.searchPostsByUser('01HQ...');
   * const result = sdk.unwrap(response);
   * ```
   *
   * @category Search
   */
  async searchPostsByUser(userUlid: Ulid): Promise<ApiEnvelope<SearchResult<Post>>> {
    const response = await this.client.post<ApiEnvelope<SearchResult<Post>>>("/v1/search/posts/username", {
      body: { ulid: userUlid },
    });
    if (response.data?.items) {
      response.data.items = await this.hydrateSearchResults(response.data.items);
    }
    return response;
  }

  /**
   * Search followers of current user.
   *
   * @param query - The search query string
   * @returns Promise resolving to search results containing matching followers
   *
   * @example
   * ```typescript
   * const response = await sdk.searchFollowers('john');
   * const result = sdk.unwrap(response);
   * ```
   *
   * @category Search
   */
  async searchFollowers(query: string): Promise<ApiEnvelope<SearchResult<UserProfile>>> {
    return this.client.post<ApiEnvelope<SearchResult<UserProfile>>>("/v1/search/followers", {
      body: { q: query },
    });
  }

  /**
   * Search users the current user is following.
   *
   * @param query - The search query string
   * @returns Promise resolving to search results containing matching followed users
   *
   * @example
   * ```typescript
   * const response = await sdk.searchFollowing('john');
   * const result = sdk.unwrap(response);
   * ```
   *
   * @category Search
   */
  async searchFollowing(query: string): Promise<ApiEnvelope<SearchResult<UserProfile>>> {
    return this.client.post<ApiEnvelope<SearchResult<UserProfile>>>("/v1/search/following", {
      body: { q: query },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Badges
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get all available badges from app settings (cached for 24 hours).
   *
   * @returns Promise resolving to array of available badges
   *
   * @category Badges
   */
  async getAvailableBadges(): Promise<ApiEnvelope<Badge[]>> {
    const cache = await this.cachePromise;
    const CACHE_KEY = "app_settings";
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    // Check cache first
    const cachedEntry = await cache.getMetadata<{ data: AppSettings; cachedAt: number }>(CACHE_KEY);
    if (cachedEntry && Date.now() - cachedEntry.cachedAt < CACHE_TTL) {
      const appBadges = cachedEntry.data.badges || [];
      const badges = appBadges.map((b) => ({
        id: String(b.id || 0),
        name: b.name || "",
        description: b.description,
        iconUrl: b.iconUrl || undefined,
      }));
      return { data: badges };
    }

    // Cache miss or expired - fetch from API
    const response = await this.client.get<ApiEnvelope<AppSettings>>("/v1/settings");
    const settings = response.data;

    // Cache the settings
    await cache.setMetadata(CACHE_KEY, {
      data: settings,
      cachedAt: Date.now(),
    });

    // Extract and convert badges
    const appBadges = settings.badges || [];
    const badges = appBadges.map((b) => ({
      id: String(b.id || 0),
      name: b.name || "",
      description: b.description,
      iconUrl: b.iconUrl || undefined,
    }));
    return { data: badges };
  }

  /**
   * Get badges earned by a specific user.
   *
   * @param userId - The ULID of the user
   * @returns Promise resolving to array of earned badges
   *
   * @category Badges
   */
  async getUserBadges(userId: Ulid): Promise<ApiEnvelope<Badge[]>> {
    return this.client.get<ApiEnvelope<Badge[]>>(
      `/v1/users/${encodeURIComponent(userId)}/badges`,
    );
  }

  /**
   * Get the current user's earned badges.
   *
   * @returns Promise resolving to array of earned badges
   *
   * @category Badges
   */
  async getMyBadges(): Promise<ApiEnvelope<Badge[]>> {
    return this.client.get<ApiEnvelope<Badge[]>>('/v1/users/me/badges');
  }

  /**
   * Check if user has a specific badge from provided badges array.
   *
   * This is a synchronous helper that checks badges from an existing array.
   * Use this with badges already loaded from auth state (e.g., from login response).
   *
   * @param badges - Array of badges (strings or objects with 'name' property)
   * @param badgeName - The badge name to check for (case-insensitive)
   * @returns true if the badge is found
   *
   * @example
   * ```typescript
   * // In UI, use with auth store badges
   * const user = authStore.user;
   * const isAdmin = sdk.hasBadgeInList(user?.badges, 'administrator');
   * ```
   *
   * @category Badges
   */
  hasBadgeInList(badges: unknown, badgeName: string): boolean {
    if (!badges || !Array.isArray(badges)) return false;

    return (badges as Array<string | { name?: string }>).some((badge) => {
      const name = typeof badge === 'string' ? badge : badge?.name;
      return name?.toLowerCase() === badgeName.toLowerCase();
    });
  }

  /**
   * @deprecated Use hasBadgeInList() with badges from auth state instead.
   * This method no longer makes API calls and always returns false.
   * Check badges synchronously from auth store user data.
   *
   * @category Badges
   */
  async hasBadge(_badgeName: string): Promise<boolean> {
    // Deprecated: Don't make API calls for badge checks
    // Use hasBadgeInList() with badges from auth state instead
    return false;
  }

  /**
   * @deprecated Use hasBadgeInList(badges, 'administrator') with badges from auth state instead.
   * This method no longer makes API calls and always returns false.
   *
   * @category Badges
   */
  async isAdmin(): Promise<boolean> {
    // Deprecated: Don't make API calls for admin checks
    // Use hasBadgeInList(user.badges, 'administrator') instead
    return false;
  }

  /**
   * Get all badges defined in the system.
   *
   * @returns Promise resolving to array of all badges
   *
   * @category Badges
   */
  async getAllBadges(): Promise<ApiEnvelope<Badge[]>> {
    return this.client.get<ApiEnvelope<Badge[]>>('/v1/badges');
  }

  /**
   * Award a badge to a user (admin operation).
   *
   * @param userId - The ULID of the user to award the badge to
   * @param badgeId - The ID of the badge to award
   * @returns Promise resolving to the awarded badge
   *
   * @category Badges
   */
  async awardBadge(userId: Ulid, badgeId: string): Promise<ApiEnvelope<Badge>> {
    return this.client.post<ApiEnvelope<Badge>>(
      `/v1/users/${encodeURIComponent(userId)}/badges`,
      { body: { badge_id: badgeId } },
    );
  }

  /**
   * Set a badge as the current user's featured badge.
   *
   * The featured badge is displayed on posts and comments.
   *
   * @param badgeId - The ID of the badge to feature
   * @returns Promise resolving to the featured badge
   *
   * @category Badges
   */
  async setFeaturedBadge(badgeId: string): Promise<ApiEnvelope<Badge>> {
    return this.client.put<ApiEnvelope<Badge>>(
      `/v1/users/me/badges/${encodeURIComponent(badgeId)}/featured`,
    );
  }

  /**
   * Clear the current user's featured badge.
   *
   * @returns Promise resolving to success status
   *
   * @category Badges
   */
  async clearFeaturedBadge(): Promise<ApiEnvelope<{ success: boolean; message: string }>> {
    return this.client.delete<ApiEnvelope<{ success: boolean; message: string }>>(
      '/v1/users/me/badges/featured',
    );
  }

  /**
   * Get the current user's badge progress for gamification badges.
   *
   * Returns current listen/rating counts and next badges to earn.
   *
   * @returns Promise resolving to badge progress data
   *
   * @example
   * ```typescript
   * const response = await sdk.getBadgeProgress();
   * const progress = sdk.unwrap(response);
   * console.log(`Listen count: ${progress.listenCount}`);
   * if (progress.nextBadges.listenCount) {
   *   console.log(`Next badge: ${progress.nextBadges.listenCount.badge.name}`);
   * }
   * ```
   *
   * @category Badges
   */
  async getBadgeProgress(): Promise<ApiEnvelope<BadgeProgress>> {
    const response = await this.client.get<ApiEnvelope<{
      listen_count: number;
      rating_count: number;
      next_badges: {
        listen_count: {
          badge: Record<string, unknown>;
          current: number;
          needed: number;
          progress_percentage: number;
        } | null;
        rating_count: {
          badge: Record<string, unknown>;
          current: number;
          needed: number;
          progress_percentage: number;
        } | null;
      };
    }>>('/v1/users/me/badges/progress');

    // Transform snake_case to camelCase
    const data = response.data;
    const transformBadge = (b: Record<string, unknown>): Badge => ({
      id: String(b.id || ''),
      name: String(b.name || ''),
      description: b.description as string | undefined,
      iconUrl: b.icon_url as string | undefined,
      slug: b.slug as string | undefined,
      type: b.type as Badge['type'],
      threshold: b.threshold as number | undefined,
    });

    return {
      data: {
        listenCount: data.listen_count,
        ratingCount: data.rating_count,
        nextBadges: {
          listenCount: data.next_badges.listen_count ? {
            badge: transformBadge(data.next_badges.listen_count.badge),
            current: data.next_badges.listen_count.current,
            needed: data.next_badges.listen_count.needed,
            progressPercentage: data.next_badges.listen_count.progress_percentage,
          } : null,
          ratingCount: data.next_badges.rating_count ? {
            badge: transformBadge(data.next_badges.rating_count.badge),
            current: data.next_badges.rating_count.current,
            needed: data.next_badges.rating_count.needed,
            progressPercentage: data.next_badges.rating_count.progress_percentage,
          } : null,
        },
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Settings
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get global application settings.
   *
   * Includes site branding, available reactions, badges, genres, etc.
   *
   * @returns Promise resolving to application settings
   *
   * @category Settings
   */
  async getGlobalSettings(): Promise<ApiEnvelope<AppSettings>> {
    return this.client.get<ApiEnvelope<AppSettings>>("/v1/settings");
  }

  /**
   * Get notification types with display templates.
   *
   * Templates contain %s placeholder for actor name substitution.
   *
   * @returns Promise resolving to array of notification types
   *
   * @example
   * ```typescript
   * const response = await sdk.getNotificationTypes();
   * const types = sdk.unwrap(response);
   * // types = [{ name: "user_followed", description: "%s followed you" }, ...]
   * ```
   *
   * @category Settings
   */
  async getNotificationTypes(): Promise<ApiEnvelope<NotificationType[]>> {
    return this.client.get<ApiEnvelope<NotificationType[]>>("/v1/settings/notification-types");
  }

  /**
   * Get the current user's personal settings.
   *
   * @returns Promise resolving to user settings
   *
   * @category Settings
   */
  async getUserSettings(): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>('/v1/users/me/settings');
  }

  /**
   * Update the current user's personal settings.
   *
   * @param payload - Settings to update
   * @returns Promise resolving to updated settings
   *
   * @category Settings
   */
  async updateUserSettings(
    payload: Record<string, unknown>,
  ): Promise<ApiEnvelope<unknown>> {
    return this.client.patch<ApiEnvelope<unknown>>('/v1/users/me/settings', { body: payload });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Uploads / Imports
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Import a song from an external URL.
   *
   * @param payload - Import parameters (url, title, artist, etc.)
   * @returns Promise resolving to the upload job status
   *
   * @category Uploads
   */
  async importSong(payload: Record<string, unknown>): Promise<ApiEnvelope<UploadJob>> {
    return this.client.post<ApiEnvelope<UploadJob>>("/v1/songs/import", { body: payload });
  }

  /**
   * Upload a file to a specified endpoint.
   *
   * @param path - The API endpoint path
   * @param file - The file to upload
   * @param additionalData - Additional form fields to include
   * @returns Promise resolving to the upload response
   *
   * @category Uploads
   */
  async uploadFile(
    path: string,
    file: Blob,
    additionalData?: Record<string, unknown>,
  ): Promise<ApiEnvelope<unknown>> {
    const form = new FormData();
    form.append("file", file);
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) =>
        form.append(key, String(value)),
      );
    }
    return this.client.post<ApiEnvelope<unknown>>(path, { body: form });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Analytics
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get analytics dashboard data for songs.
   *
   * @param params - Optional filter parameters
   * @param params.startDate - Start date filter (ISO format)
   * @param params.endDate - End date filter (ISO format)
   * @param params.username - Filter by specific user
   * @returns Promise resolving to dashboard analytics data
   *
   * @category Analytics
   */
  async getAnalyticsDashboard(params?: {
    startDate?: string;
    endDate?: string;
    username?: string;
  }): Promise<ApiEnvelope<unknown>> {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append("start_date", params.startDate);
    if (params?.endDate) queryParams.append("end_date", params.endDate);
    if (params?.username) queryParams.append("username", params.username);
    const queryString = queryParams.toString();
    return this.client.get<ApiEnvelope<unknown>>(
      `/v1/analytics/songs/dashboard${queryString ? `?${queryString}` : ""}`,
    );
  }

  async getSongAnalytics(
    postId: number,
    params?: {
      startDate?: string;
      endDate?: string;
    },
  ): Promise<ApiEnvelope<unknown>> {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append("start_date", params.startDate);
    if (params?.endDate) queryParams.append("end_date", params.endDate);
    const queryString = queryParams.toString();
    return this.client.get<ApiEnvelope<unknown>>(
      `/v1/analytics/songs/song/${postId}${queryString ? `?${queryString}` : ""}`,
    );
  }

  async getAnalyticsTimeSeries(params: {
    metric: string;
    startDate?: string;
    endDate?: string;
    postId?: number;
    username?: string;
  }): Promise<ApiEnvelope<unknown>> {
    const queryParams = new URLSearchParams();
    queryParams.append("metric", params.metric);
    if (params.startDate) queryParams.append("start_date", params.startDate);
    if (params.endDate) queryParams.append("end_date", params.endDate);
    if (params.postId) queryParams.append("post_id", params.postId.toString());
    if (params.username) queryParams.append("username", params.username);
    return this.client.get<ApiEnvelope<unknown>>(
      `/v1/analytics/songs/time-series?${queryParams.toString()}`,
    );
  }

  async getTopSongs(params?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    username?: string;
  }): Promise<ApiEnvelope<unknown>> {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append("start_date", params.startDate);
    if (params?.endDate) queryParams.append("end_date", params.endDate);
    if (params?.limit) queryParams.append("limit", params.limit.toString());
    if (params?.username) queryParams.append("username", params.username);
    const queryString = queryParams.toString();
    return this.client.get<ApiEnvelope<unknown>>(
      `/v1/analytics/songs/top-songs${queryString ? `?${queryString}` : ""}`,
    );
  }

  async getAnalyticsDemographics(params?: {
    startDate?: string;
    endDate?: string;
    postId?: number;
  }): Promise<ApiEnvelope<unknown>> {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append("start_date", params.startDate);
    if (params?.endDate) queryParams.append("end_date", params.endDate);
    if (params?.postId) queryParams.append("post_id", params.postId.toString());
    const queryString = queryParams.toString();
    return this.client.get<ApiEnvelope<unknown>>(
      `/v1/analytics/songs/demographics${queryString ? `?${queryString}` : ""}`,
    );
  }

  // ---------------------------------------------------------------------------
  // CEO Dashboard
  // ---------------------------------------------------------------------------

  /**
   * Get CEO Dashboard summary metrics
   * @param params - Optional date range or preset (7d, 30d, 90d, 365d)
   * @returns Dashboard summary with key metrics and category breakdowns
   */
  async getCEODashboardSummary(params?: {
    preset?: "7d" | "30d" | "90d" | "365d";
    startDate?: string;
    endDate?: string;
  }): Promise<ApiEnvelope<DashboardSummary>> {
    const queryParams = new URLSearchParams();
    if (params?.preset) queryParams.append("preset", params.preset);
    if (params?.startDate) queryParams.append("start_date", params.startDate);
    if (params?.endDate) queryParams.append("end_date", params.endDate);
    const queryString = queryParams.toString();
    return this.client.get<ApiEnvelope<DashboardSummary>>(
      `/v1/admin/dashboard/summary${queryString ? `?${queryString}` : ""}`,
    );
  }

  /**
   * Get CEO Dashboard timeseries data for a specific metric
   * @param params - Metric name and optional date range
   * @returns Timeseries data points
   */
  async getCEODashboardTimeseries(params: {
    metric: string;
    preset?: "7d" | "30d" | "90d" | "365d";
    startDate?: string;
    endDate?: string;
  }): Promise<ApiEnvelope<DashboardTimeseries>> {
    const queryParams = new URLSearchParams();
    queryParams.append("metric", params.metric);
    if (params.preset) queryParams.append("preset", params.preset);
    if (params.startDate) queryParams.append("start_date", params.startDate);
    if (params.endDate) queryParams.append("end_date", params.endDate);
    return this.client.get<ApiEnvelope<DashboardTimeseries>>(
      `/v1/admin/dashboard/timeseries?${queryParams.toString()}`,
    );
  }

  /**
   * Get user listening distribution (logarithmic buckets)
   * @param params - Optional date range
   * @returns Distribution of users by listening time
   */
  async getCEODashboardListeningDistribution(params?: {
    preset?: "7d" | "30d" | "90d" | "365d";
    startDate?: string;
    endDate?: string;
  }): Promise<ApiEnvelope<DashboardListeningDistribution>> {
    const queryParams = new URLSearchParams();
    if (params?.preset) queryParams.append("preset", params.preset);
    if (params?.startDate) queryParams.append("start_date", params.startDate);
    if (params?.endDate) queryParams.append("end_date", params.endDate);
    const queryString = queryParams.toString();
    return this.client.get<ApiEnvelope<DashboardListeningDistribution>>(
      `/v1/admin/dashboard/listening-distribution${queryString ? `?${queryString}` : ""}`,
    );
  }

  /**
   * Get hourly active users for the last 24 hours
   * @returns Hourly active user counts
   */
  async getCEODashboardHourlyActiveUsers(): Promise<ApiEnvelope<DashboardHourlyActiveUsers>> {
    return this.client.get<ApiEnvelope<DashboardHourlyActiveUsers>>(
      "/v1/admin/dashboard/hourly-active-users",
    );
  }

  // ---------------------------------------------------------------------------
  // Push Notifications
  // ---------------------------------------------------------------------------

  async createPushSubscription(subscription: PushSubscriptionJSON): Promise<ApiEnvelope<unknown>> {
    return this.client.post<ApiEnvelope<unknown>>("/v1/subscriptions", {
      body: { subscription },
    });
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await this.client.delete("/v1/subscriptions", {
      body: { endpoint },
    });
  }

  // ---------------------------------------------------------------------------
  // Profile / User Likes
  // ---------------------------------------------------------------------------

  async getProfileLikes(params: {
    username: string;
    cursor?: string;
    rating?: number;
    per_page?: number;
  }): Promise<ApiEnvelope<unknown>> {
    // Include username in the path as per API specification
    const payload: Record<string, unknown> = {
      per_page: params.per_page || 20,
    };

    if (params.cursor) {
      payload.cursor = params.cursor;
    }

    if (params.rating !== undefined && params.rating > 0) {
      payload.rating = params.rating;
    }

    return this.client.post<ApiEnvelope<unknown>>(
      `/v1/profile/${params.username}/likes`,
      { body: payload }
    );
  }

  /**
   * Get liked posts for a user's profile with hydration.
   * Returns a FeedPage with full post objects.
   */
  async getProfileLikesFeed(username: string, cursor?: string | null): Promise<FeedPage> {
    const response = await this.getProfileLikes({
      username,
      cursor: cursor || undefined,
      per_page: 20,
      rating: 1, // Include all rated posts (1-5), not just highly rated (>=3)
    });

    const envelope = response as ApiEnvelope<any[]>;
    const collection = this.unwrap<any[]>(envelope);
    const nextCursor = this.extractNextCursor(envelope);

    if (!Array.isArray(collection) || collection.length === 0) {
      return { ulids: [], posts: [], nextCursor: null };
    }

    // Check if collection contains full post objects or just feed items
    const firstItem = collection[0];
    const hasContentFields = firstItem && (
      firstItem.body !== undefined ||
      firstItem.title !== undefined ||
      firstItem.content !== undefined ||
      firstItem.song_title !== undefined ||
      firstItem.songTitle !== undefined
    );

    if (hasContentFields) {
      // Collection contains full post objects - use them directly
      const posts = collection.map((item) => this.normalizePost(item)).filter(Boolean) as Post[];
      const ulids = posts.map((p) => p.ulid).filter((id): id is string => Boolean(id));
      return { ulids, posts, nextCursor: nextCursor ?? null };
    }

    // Extract ULIDs and hydrate
    const ulids = collection.map((item) => item.ulid).filter(Boolean);
    let posts: Post[] = [];

    if (ulids.length > 0) {
      const hydrated = await this.fetchPostsBatch(ulids);
      posts = ulids
        .map((id) => hydrated[id])
        .filter((post): post is Post => Boolean(post));
    }

    return { ulids, posts, nextCursor: nextCursor ?? null };
  }

  // ---------------------------------------------------------------------------
  // Engagement helpers for cache
  // ---------------------------------------------------------------------------

  async updateCachedEngagement(
    postUlid: Ulid,
    engagement: Record<string, unknown>,
  ): Promise<void> {
    const cache = await this.cachePromise;
    const cached = await cache.getPost(postUlid);
    if (!cached) return;

    // The engagement API returns data with:
    // - userReaction at top level
    // - postEngagement as a nested object with counts/reactions
    // We need to properly merge these into the cached post structure
    const { postEngagement: nestedEngagement, userReaction, ...otherFields } = engagement;

    // Build the new postEngagement by merging:
    // 1. Existing postEngagement
    // 2. Nested postEngagement from API (if present)
    // 3. userReaction (should be in postEngagement for our type)
    // 4. Other relevant fields
    const newPostEngagement = {
      ...cached.postEngagement,
      ...(nestedEngagement as Record<string, unknown> || {}),
      userReaction: userReaction as string | null | undefined,
    };

    const updated = {
      ...cached,
      ...otherFields, // Include any other fields like updatedAt
      postEngagement: newPostEngagement,
    };

    await cache.setPost(postUlid, updated);
  }

  // ---------------------------------------------------------------------------
  // Songs: detail + channels
  // ---------------------------------------------------------------------------

  async getSongDetail(songUlid: Ulid): Promise<ApiEnvelope<Post>> {
    return this.client.get<ApiEnvelope<Post>>(
      `/v1/songs/${encodeURIComponent(songUlid)}`,
    );
  }

  /**
   * Create a new song (audio post).
   * Audio and cover image should be uploaded via uploadMediaFile first.
   *
   * @param payload - Song creation payload
   * @param payload.groupName - Artist/group name
   * @param payload.songTitle - Song title
   * @param payload.audioUrl - URL of the uploaded audio file (from S3 multipart upload)
   * @param payload.songArt - Array of cover image URLs (optional)
   * @param payload.lyrics - Song lyrics (optional)
   * @param payload.genreId - Genre ID from app settings (optional)
   * @param payload.enterWsom - Whether to enter WSOM contest (optional)
   */
  async createSong(payload: {
    groupName: string;
    songTitle: string;
    audioUrl: string;
    songArt?: string[];
    lyrics?: string;
    genreId?: number;
    enterWsom?: boolean;
  }): Promise<Post> {
    const response = await this.client.put<ApiEnvelope<Post>>("/v1/songs/add", {
      body: payload,
    });
    const post = this.unwrap<Post>(response);

    // Read-after-write: fetch full post data to ensure we have complete data with all relationships
    // The create endpoint may return minimal data, so we fetch the full post
    if (post.ulid) {
      const fullPost = await this.getPostByUlid(post.ulid, true);
      if (fullPost) {
        return fullPost;
      }
    }

    // Fallback to caching the create response if read-after-write fails
    await this.cachePost(post);
    return post;
  }

  async getSongChannels(): Promise<ApiEnvelope<SongChannel[]>> {
    return this.client.get<ApiEnvelope<SongChannel[]>>("/v1/songs/channels");
  }

  async listSongChannels(): Promise<ApiEnvelope<SongChannel[]>> {
    return this.client.get<ApiEnvelope<SongChannel[]>>("/v1/songs/channels/list");
  }

  /**
   * Generate a personalized mix queue based on a seed song.
   * Returns a queue of 30 songs similar to the seed, based on genre,
   * user listening history, and engagement data.
   *
   * @param seedUlid - The ULID of the seed song to generate the mix from
   * @returns Queue of posts and metadata
   */
  async generateMixQueue(seedUlid: Ulid): Promise<{
    queue: Post[];
    seed_post: Post;
    queue_size: number;
  }> {
    const response = await this.client.post<
      ApiEnvelope<{
        queue: Post[];
        seed_post: Post;
        queue_size: number;
      }>
    >("/v1/songs/generate-queue", {
      body: { seed_ulid: seedUlid },
    });
    return this.unwrap(response);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chat / Conversations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get all chat groups/conversations for the current user.
   *
   * @param params - Optional query parameters for filtering/pagination
   * @returns Promise resolving to array of chat groups
   *
   * @example
   * ```typescript
   * const response = await sdk.getChatGroups();
   * const groups = sdk.unwrap(response);
   * groups.forEach(g => console.log(`${g.name}: ${g.unreadCount} unread`));
   * ```
   *
   * @category Chat
   */
  async getChatGroups(params?: Record<string, unknown>): Promise<ApiEnvelope<ChatGroup[]>> {
    return this.client.get<ApiEnvelope<ChatGroup[]>>("/v1/chat/groups", { query: params });
  }

  /**
   * Create a new chat group/conversation.
   *
   * @param payload - Group creation data (members, name, etc.)
   * @returns Promise resolving to the created chat group
   *
   * @category Chat
   */
  async createChatGroup(payload: Record<string, unknown>): Promise<ApiEnvelope<ChatGroup>> {
    return this.client.post<ApiEnvelope<ChatGroup>>("/v1/chat/groups", { body: payload });
  }

  /**
   * Mark all messages in a chat group as read.
   *
   * @param groupUlid - The ULID of the chat group
   *
   * @category Chat
   */
  async markChatGroupRead(groupUlid: string): Promise<void> {
    await this.client.post(`/v1/chat/groups/${encodeURIComponent(groupUlid)}/read`);
  }

  /**
   * Get messages from a chat group.
   *
   * @param groupUlid - The ULID of the chat group
   * @param params - Optional query parameters for pagination
   * @returns Promise resolving to array of chat messages
   *
   * @example
   * ```typescript
   * const response = await sdk.getChatMessages(groupUlid);
   * const messages = sdk.unwrap(response);
   * messages.forEach(m => console.log(`${m.sender?.username}: ${m.body}`));
   * ```
   *
   * @category Chat
   */
  async getChatMessages(
    groupUlid: string,
    params?: Record<string, unknown>,
  ): Promise<ApiEnvelope<ChatMessage[]>> {
    return this.client.get<ApiEnvelope<ChatMessage[]>>(
      `/v1/chat/groups/${encodeURIComponent(groupUlid)}/messages`,
      { query: params },
    );
  }

  /**
   * Send a message to a chat group.
   *
   * @param groupUlid - The ULID of the chat group
   * @param payload - Message data (body text, attachments, etc.)
   * @returns Promise resolving to the sent message
   *
   * @example
   * ```typescript
   * const response = await sdk.sendChatMessage(groupUlid, { body: 'Hello!' });
   * const message = sdk.unwrap(response);
   * ```
   *
   * @category Chat
   */
  async sendChatMessage(
    groupUlid: string,
    payload: Record<string, unknown>,
  ): Promise<ApiEnvelope<ChatMessage>> {
    return this.client.post<ApiEnvelope<ChatMessage>>(
      `/v1/chat/groups/${encodeURIComponent(groupUlid)}/messages`,
      { body: payload },
    );
  }

  // ---------------------------------------------------------------------------
  // Group Moderation (for MODERATED visibility groups)
  // ---------------------------------------------------------------------------

  /**
   * Get posts pending moderation for a group
   * @param groupUlid - The group's ULID
   * @param params - Optional pagination params (cursor, limit)
   */
  async getModerationQueue(
    groupUlid: string,
    params?: { cursor?: string; limit?: number },
  ): Promise<ModerationQueueResponse> {
    const response = await this.client.get<ApiEnvelope<ModerationQueueResponse>>(
      `/v1/group/${encodeURIComponent(groupUlid)}/moderation-queue`,
      { query: params },
    );
    return this.unwrap<ModerationQueueResponse>(response);
  }

  /**
   * Approve a pending post in a moderated group
   * @param groupUlid - The group's ULID
   * @param postUlid - The post's ULID to approve
   */
  async approvePost(
    groupUlid: string,
    postUlid: string,
  ): Promise<ModerationActionResponse> {
    const response = await this.client.post<ApiEnvelope<ModerationActionResponse>>(
      `/v1/group/${encodeURIComponent(groupUlid)}/posts/${encodeURIComponent(postUlid)}/approve`,
    );
    const result = this.unwrap<ModerationActionResponse>(response);

    // Update the post's moderation status in Dexie cache
    const cache = await this.cachePromise;
    const cachedPost = await cache.getPost(postUlid);
    if (cachedPost) {
      await cache.setPost(postUlid, {
        ...cachedPost,
        group_moderation_status: "approved",
      });
    }

    return result;
  }

  /**
   * Reject a pending post in a moderated group
   * @param groupUlid - The group's ULID
   * @param postUlid - The post's ULID to reject
   * @param reason - Reason for rejection (will be sent to the author)
   */
  async rejectPost(
    groupUlid: string,
    postUlid: string,
    reason: string,
  ): Promise<ModerationActionResponse> {
    const response = await this.client.post<ApiEnvelope<ModerationActionResponse>>(
      `/v1/group/${encodeURIComponent(groupUlid)}/posts/${encodeURIComponent(postUlid)}/reject`,
      { body: { reason } },
    );
    const result = this.unwrap<ModerationActionResponse>(response);

    // Remove the rejected post from Dexie cache
    const cache = await this.cachePromise;
    await cache.deletePost(postUlid);

    return result;
  }

  // ---------------------------------------------------------------------------
  // User Genre Preferences
  // ---------------------------------------------------------------------------

  /**
   * Get current user's genre preferences
   */
  async getGenrePreferences(): Promise<GenrePreferencesResponse> {
    const response = await this.client.get<ApiEnvelope<GenrePreferencesResponse>>(
      "/v1/users/me/genre-preferences",
    );
    return this.unwrap<GenrePreferencesResponse>(response);
  }

  /**
   * Update multiple genre preferences at once
   */
  async updateGenrePreferences(
    preferences: GenrePreferenceUpdate[],
  ): Promise<{ message: string; updatedCount: number }> {
    // Transform camelCase to snake_case for backend API
    const transformedPreferences = preferences.map((pref) => ({
      genre_id: pref.genreId,
      is_enabled: pref.isEnabled,
      ...(pref.sortOrder !== undefined && { sort_order: pref.sortOrder }),
    }));

    const response = await this.client.put<
      ApiEnvelope<{ message: string; updatedCount: number }>
    >("/v1/users/me/genre-preferences", {
      body: { preferences: transformedPreferences },
    });
    return this.unwrap<{ message: string; updatedCount: number }>(response);
  }

  /**
   * Toggle a single genre preference on/off
   */
  async toggleGenrePreference(
    genreId: number,
  ): Promise<{ message: string; genreId: number; isEnabled: boolean }> {
    const response = await this.client.patch<
      ApiEnvelope<{ message: string; genreId: number; isEnabled: boolean }>
    >(`/v1/users/me/genre-preferences/${genreId}/toggle`);
    return this.unwrap<{ message: string; genreId: number; isEnabled: boolean }>(response);
  }

  /**
   * Reset genre preferences to defaults (all tenant-enabled genres)
   */
  async resetGenrePreferences(): Promise<{ message: string; enabledCount: number }> {
    const response = await this.client.post<
      ApiEnvelope<{ message: string; enabledCount: number }>
    >("/v1/users/me/genre-preferences/reset");
    return this.unwrap<{ message: string; enabledCount: number }>(response);
  }

  /**
   * Get trending genres by percentage of audio views
   * Returns genres ordered by popularity (trendingScore)
   */
  async getTrendingGenres(): Promise<TrendingGenre[]> {
    const response = await this.client.get<ApiEnvelope<TrendingGenre[]>>(
      "/v1/songs/feed/trending/genres",
    );
    return this.unwrap<TrendingGenre[]>(response);
  }

  async getTrendingMusicUsers(params?: {
    limit?: number;
  }): Promise<TrendingMusicUser[]> {
    const queryParams = new URLSearchParams();
    if (params?.limit) {
      queryParams.append("limit", params.limit.toString());
    }
    const queryString = queryParams.toString();
    const response = await this.client.get<ApiEnvelope<TrendingMusicUser[]>>(
      `/v1/songs/feed/trending/users${queryString ? `?${queryString}` : ""}`,
    );
    return this.unwrap<TrendingMusicUser[]>(response);
  }

  /**
   * Get trending hashtags
   * Returns hashtags ordered by usage count in the last 24 hours
   */
  async getTrendingHashtags(limit: number = 5): Promise<TrendingHashtag[]> {
    const response = await this.client.get<ApiEnvelope<{ hashtags: TrendingHashtag[] }>>(
      "/v1/trending/hashtags/last24",
    );
    const data = this.unwrap<{ hashtags: TrendingHashtag[] }>(response);
    return (data.hashtags || []).slice(0, limit);
  }

  /**
   * Get trending songs for sidebar display
   * Returns songs with title, artist, cover image, and play count
   */
  async getTrendingSongs(limit: number = 5, bypassCache: boolean = false): Promise<TrendingSong[]> {
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    if (bypassCache) {
      params.append('nocache', '1');
    }
    const response = await this.client.get<ApiEnvelope<TrendingSong[]>>(
      `/v1/songs/feed/trending/sidebar?${params.toString()}`,
    );
    return this.unwrap<TrendingSong[]>(response);
  }

  // ---------------------------------------------------------------------------
  // Signup / Demographics
  // ---------------------------------------------------------------------------

  /**
   * Get signup configuration including demographic questions and legal documents
   * Returns questions with their options and current user responses
   */
  async getSignupConfig(): Promise<SignupConfig> {
    const response = await this.client.get<ApiEnvelope<SignupConfig>>(
      "/v1/signup/config",
    );
    return this.unwrap<SignupConfig>(response);
  }

  /**
   * Save demographic question responses
   * @param responses - Array of question responses to save
   */
  async saveDemographicResponses(
    responses: DemographicResponseInput[],
  ): Promise<{ message: string }> {
    const response = await this.client.post<ApiEnvelope<{ message: string }>>(
      "/v1/signup/responses",
      { body: { responses } },
    );
    return this.unwrap<{ message: string }>(response);
  }

  /**
   * Accept legal agreement documents
   * @param documents - Array of document acceptances with timestamps
   */
  async acceptAgreements(
    documents: AgreementAcceptanceInput[],
  ): Promise<{ message: string }> {
    const response = await this.client.post<ApiEnvelope<{ message: string }>>(
      "/v1/signup/agreements",
      { body: { documents } },
    );
    return this.unwrap<{ message: string }>(response);
  }

  /**
   * Mark account setup as complete
   * Validates all requirements are met before completing
   */
  async completeSignup(): Promise<{ message: string }> {
    const response = await this.client.post<ApiEnvelope<{ message: string }>>(
      "/v1/signup/complete",
    );
    return this.unwrap<{ message: string }>(response);
  }

  // ---------------------------------------------------------------------------
  // WSOM (World Series of Music)
  // ---------------------------------------------------------------------------

  /**
   * Get list of WSOM contests
   */
  async wsomListContests(
    status?: string,
    cursor?: string,
  ): Promise<WsomContestListResponse> {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (cursor) params.append("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/v1/wsom/contests${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.get<{
      contests: WsomContest[];
      nextCursor?: string;
      prevCursor?: string;
      perPage?: number;
    }>(endpoint);

    const data = this.unwrap(response);
    return {
      data: data.contests ?? (data as unknown as WsomContest[]),
      meta: {
        nextCursor: data.nextCursor ?? null,
        prevCursor: data.prevCursor ?? null,
        perPage: data.perPage ?? 10,
      },
    };
  }

  /**
   * Get the currently active WSOM contest
   */
  async wsomGetActiveContest(): Promise<WsomContest | null> {
    try {
      const response = await this.client.get<WsomContest>(
        "/v1/wsom/contests/active",
      );
      return this.unwrap(response) ?? null;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "status" in error) {
        const httpError = error as { status: number };
        if (httpError.status === 404) {
          return null;
        }
      }
      throw error;
    }
  }

  /**
   * Get a specific WSOM contest by ULID
   */
  async wsomGetContest(contestUlid: string): Promise<WsomContest> {
    const response = await this.client.get<WsomContest>(
      `/v1/wsom/contests/${contestUlid}`,
    );
    return this.unwrap(response);
  }

  /**
   * Get entries for a WSOM contest
   */
  async wsomGetContestEntries(
    contestUlid: string,
    sort?: string,
    cursor?: string,
  ): Promise<WsomEntryListResponse> {
    if (!contestUlid || typeof contestUlid !== "string" || contestUlid.trim() === "") {
      throw new Error("Contest ULID is required and must be a valid string");
    }

    const params = new URLSearchParams();
    if (sort) params.append("sort", sort);
    if (cursor) params.append("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/v1/wsom/contests/${contestUlid}/entries${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.get<{
      entries: WsomEntry[];
      nextCursor?: string;
      prevCursor?: string;
      perPage?: number;
    }>(endpoint);

    const data = this.unwrap(response);
    return {
      data: data.entries ?? (data as unknown as WsomEntry[]),
      meta: {
        nextCursor: data.nextCursor ?? null,
        prevCursor: data.prevCursor ?? null,
        perPage: data.perPage ?? 20,
      },
    };
  }

  /**
   * Get results for a completed WSOM contest
   */
  async wsomGetContestResults(
    contestUlid: string,
  ): Promise<WsomContestResultsResponse> {
    const response = await this.client.get<WsomContestResultsResponse>(
      `/v1/wsom/contests/${contestUlid}/results`,
    );
    return this.unwrap(response);
  }

  /**
   * Get the WSOM feed for the active contest
   */
  async wsomGetFeed(
    unratedOnly = false,
    cursor?: string,
  ): Promise<WsomFeedResponse> {
    const params = new URLSearchParams();
    if (unratedOnly) params.append("unrated_only", "true");
    if (cursor) params.append("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/v1/wsom/feed${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.get<{
      entries: WsomEntry[];
      nextCursor?: string;
      prevCursor?: string;
      perPage?: number;
      contest?: WsomContest;
      unratedCount?: number;
    }>(endpoint);

    const data = this.unwrap(response);
    return {
      data: data.entries ?? (data as unknown as WsomEntry[]),
      meta: {
        nextCursor: data.nextCursor ?? null,
        prevCursor: data.prevCursor ?? null,
        perPage: data.perPage ?? 20,
        contest: data.contest ?? ({} as WsomContest),
        unratedCount: data.unratedCount ?? 0,
      },
    };
  }

  /**
   * Enter a song into the active WSOM contest
   */
  async wsomEnterSong(postUlid: string): Promise<WsomEntry> {
    const response = await this.client.post<WsomEntry>("/v1/wsom/entries", {
      body: { postUlid },
    });
    return this.unwrap(response);
  }

  /**
   * Get a specific WSOM entry
   */
  async wsomGetEntry(entryUlid: string): Promise<WsomEntry> {
    const response = await this.client.get<WsomEntry>(
      `/v1/wsom/entries/${entryUlid}`,
    );
    return this.unwrap(response);
  }

  /**
   * Withdraw an entry from WSOM
   */
  async wsomWithdrawEntry(entryUlid: string): Promise<void> {
    await this.client.delete(`/v1/wsom/entries/${entryUlid}`);
  }

  /**
   * Rate a WSOM entry
   */
  async wsomRateEntry(
    entryUlid: string,
    rating: number,
  ): Promise<WsomRateEntryResponse> {
    const response = await this.client.post<{
      rating: number;
      entryStats: WsomRatingStats;
    }>(`/v1/wsom/entries/${entryUlid}/rate`, { body: { rating } });

    return this.unwrap(response);
  }

  /**
   * Get the current user's WSOM entries
   */
  async wsomGetMyEntries(status?: string): Promise<WsomEntry[]> {
    const params = new URLSearchParams();
    if (status) params.append("status", status);

    const queryString = params.toString();
    const endpoint = `/v1/wsom/my-entries${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.get<WsomEntry[]>(endpoint);
    return this.unwrap(response) ?? [];
  }

  /**
   * Create a new WSOM contest (admin only)
   */
  async wsomCreateContest(data: WsomCreateContestRequest): Promise<WsomContest> {
    const response = await this.client.post<WsomContest>(
      "/v1/wsom/admin/contests",
      { body: data },
    );
    return this.unwrap(response);
  }

  /**
   * Update a WSOM contest (admin only)
   */
  async wsomUpdateContest(
    contestUlid: string,
    data: WsomUpdateContestRequest,
  ): Promise<WsomContest> {
    const response = await this.client.patch<WsomContest>(
      `/v1/wsom/admin/contests/${contestUlid}`,
      { body: data },
    );
    return this.unwrap(response);
  }

  /**
   * Check if there's an active WSOM contest
   */
  async wsomHasActiveContest(): Promise<boolean> {
    const contest = await this.wsomGetActiveContest();
    return contest !== null;
  }

  // ---------------------------------------------------------------------------
  // Passkey (WebAuthn) Methods
  // ---------------------------------------------------------------------------

  /**
   * Check if email has registered passkeys
   * Note: This endpoint does not require authentication
   */
  async passkeyCheckHasPasskeys(email: string): Promise<PasskeyCheckResponse> {
    const response = await this.client.post<PasskeyCheckResponse>(
      "/v1/auth/passkey/check",
      { body: { email }, skipAuth: true },
    );
    return snakeToCamelObject(this.unwrap(response));
  }

  /**
   * Get WebAuthn authentication options for passkey login
   * Note: This endpoint does not require authentication
   * @param email Optional email to filter available credentials
   */
  async passkeyGetAuthenticateOptions(
    email?: string,
  ): Promise<PasskeyAuthenticateOptionsResponse> {
    const response = await this.client.post<PasskeyAuthenticateOptionsResponse>(
      "/v1/auth/passkey/authenticate-options",
      { body: email ? { email } : {}, skipAuth: true },
    );
    return snakeToCamelObject(this.unwrap(response));
  }

  /**
   * Authenticate with a passkey credential
   * Note: This endpoint does not require authentication
   * @param sessionId Session ID from authenticate-options call
   * @param credential The WebAuthn credential response
   */
  async passkeyAuthenticate(
    sessionId: string,
    credential: unknown,
  ): Promise<PasskeyAuthenticateResponse> {
    const response = await this.client.post<PasskeyAuthenticateResponse>(
      "/v1/auth/passkey/authenticate",
      { body: { session_id: sessionId, credential }, skipAuth: true },
    );
    return snakeToCamelObject(this.unwrap(response));
  }

  /**
   * Get WebAuthn registration options for adding a new passkey
   * @param name Display name for the passkey
   */
  async passkeyGetRegisterOptions(
    name: string,
  ): Promise<PasskeyRegisterOptionsResponse> {
    const response = await this.client.post<PasskeyRegisterOptionsResponse>(
      "/v1/auth/passkey/register-options",
      { body: { name } },
    );
    return this.unwrap(response);
  }

  /**
   * Register a new passkey credential
   * @param credential The WebAuthn credential response
   */
  async passkeyRegister(credential: unknown): Promise<PasskeyRegisterResponse> {
    const response = await this.client.post<PasskeyRegisterResponse>(
      "/v1/auth/passkey/register",
      { body: { credential } },
    );
    return snakeToCamelObject(this.unwrap(response));
  }

  /**
   * List all passkeys for the current user
   */
  async passkeyList(): Promise<Passkey[]> {
    const response = await this.client.get<PasskeyListResponse>(
      "/v1/auth/passkeys",
    );
    const result = snakeToCamelObject(this.unwrap(response));
    return result.passkeys ?? [];
  }

  /**
   * Rename a passkey
   * @param id Passkey ID
   * @param name New name for the passkey
   */
  async passkeyRename(id: string, name: string): Promise<PasskeyUpdateResponse> {
    const response = await this.client.patch<PasskeyUpdateResponse>(
      `/v1/auth/passkeys/${id}`,
      { body: { name } },
    );
    return snakeToCamelObject(this.unwrap(response));
  }

  /**
   * Delete a passkey
   * @param id Passkey ID
   */
  async passkeyDelete(id: string): Promise<void> {
    await this.client.delete(`/v1/auth/passkeys/${id}`);
  }

  // ---------------------------------------------------------------------------
  // Poll Methods
  // ---------------------------------------------------------------------------

  /**
   * Get poll data for a post
   */
  async pollGet(postUlid: string): Promise<Poll | null> {
    const response = await this.client.get<{ poll: Poll | null }>(
      `/v1/posts/${postUlid}/polls`,
    );
    const result = this.unwrap(response);
    return result.poll ?? null;
  }

  /**
   * Get current user's vote on a poll
   */
  async pollGetMyVote(postUlid: string): Promise<PollUserVote | null> {
    const response = await this.client.get<{ vote: PollUserVote | null }>(
      `/v1/posts/${postUlid}/polls/me`,
    );
    const result = this.unwrap(response);
    return result.vote ?? null;
  }

  /**
   * Vote on a poll
   * @param postUlid Post ULID
   * @param optionId Poll option ID to vote for
   */
  async pollVote(postUlid: string, optionId: number): Promise<Poll> {
    const response = await this.client.post<{ poll: Poll }>(
      `/v1/posts/${postUlid}/polls/vote`,
      { body: { optionId } },
    );
    const result = this.unwrap(response);
    return result.poll;
  }

  /**
   * Remove vote from a poll
   */
  async pollRemoveVote(postUlid: string): Promise<Poll> {
    const response = await this.client.delete<{ poll: Poll }>(
      `/v1/posts/${postUlid}/polls/vote`,
    );
    const result = this.unwrap(response);
    return result.poll;
  }

  /**
   * Batch fetch polls for multiple posts
   * @param postUlids Array of post ULIDs
   */
  async pollBatchGet(postUlids: string[]): Promise<BatchPollsResponse> {
    const response = await this.client.post<BatchPollsResponse>(
      "/v1/posts/polls/batch",
      { body: { postUlids } },
    );
    return this.unwrap(response);
  }

  // ---------------------------------------------------------------------------
  // Trending Methods
  // ---------------------------------------------------------------------------

  /**
   * Get trending songs feed
   * Hydrates posts with full data via batch fetch
   */
  async trendingGetSongs(cursor?: string): Promise<FeedPage> {
    const params = new URLSearchParams();
    if (cursor) params.append("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/v1/songs/feed/trending${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.get<ApiEnvelope<Post[]>>(endpoint);
    const feedItems = this.unwrap(response) ?? [];

    // Extract ULIDs from feed items (they may be minimal post objects)
    const ulids = feedItems
      .map((item) => item.ulid || item.id)
      .filter((u): u is string => !!u);

    this.log(`[SDK] 📊 trendingGetSongs: Got ${ulids.length} ULIDs from feed endpoint`);

    // Hydrate posts with full data via batch fetch
    // This ensures we have title, images, and all other fields
    const hydratedPosts = await this.fetchPostsBatch(ulids);
    this.log(`[SDK] 💧 trendingGetSongs: Hydrated ${Object.keys(hydratedPosts).length} posts`);

    // Map hydrated posts back to original order
    const posts = ulids
      .map((ulid) => hydratedPosts[ulid])
      .filter((p): p is Post => !!p);

    return {
      ulids,
      posts,
      nextCursor: this.extractNextCursor(response as ApiEnvelope<unknown>),
    };
  }

  /**
   * Get trending videos feed
   * Hydrates posts with full data via batch fetch
   */
  async trendingGetVideos(cursor?: string): Promise<FeedPage> {
    const params = new URLSearchParams();
    if (cursor) params.append("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/v1/trending/videos${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.get<ApiEnvelope<Post[]>>(endpoint);
    const feedItems = this.unwrap(response) ?? [];

    // Extract ULIDs from feed items
    const ulids = feedItems
      .map((item) => item.ulid || item.id)
      .filter((u): u is string => !!u);

    // Hydrate posts with full data via batch fetch
    const hydratedPosts = await this.fetchPostsBatch(ulids);

    // Map hydrated posts back to original order
    const posts = ulids
      .map((ulid) => hydratedPosts[ulid])
      .filter((p): p is Post => !!p);

    return {
      ulids,
      posts,
      nextCursor: this.extractNextCursor(response as ApiEnvelope<unknown>),
    };
  }

  /**
   * Get trending bursts feed
   * Hydrates posts with full data via batch fetch
   */
  async trendingGetBursts(cursor?: string): Promise<FeedPage> {
    const params = new URLSearchParams();
    if (cursor) params.append("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/v1/trending/bursts${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.get<ApiEnvelope<Post[]>>(endpoint);
    const feedItems = this.unwrap(response) ?? [];

    // Extract ULIDs from feed items
    const ulids = feedItems
      .map((item) => item.ulid || item.id)
      .filter((u): u is string => !!u);

    // Hydrate posts with full data via batch fetch
    const hydratedPosts = await this.fetchPostsBatch(ulids);

    // Map hydrated posts back to original order
    const posts = ulids
      .map((ulid) => hydratedPosts[ulid])
      .filter((p): p is Post => !!p);

    return {
      ulids,
      posts,
      nextCursor: this.extractNextCursor(response as ApiEnvelope<unknown>),
    };
  }

  /**
   * Get all videos feed
   */
  async videosGetAll(cursor?: string): Promise<FeedPage> {
    const params = new URLSearchParams();
    if (cursor) params.append("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/v1/videos/all${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.get<ApiEnvelope<Post[]>>(endpoint);
    const posts = this.unwrap(response) ?? [];

    // Cache posts
    await Promise.all(posts.map((post) => this.cachePost(post)));

    return {
      ulids: posts.map((p) => p.ulid).filter((u): u is string => !!u),
      posts,
      nextCursor: this.extractNextCursor(response as ApiEnvelope<unknown>),
    };
  }

  /**
   * Get all bursts feed
   */
  async burstsGetAll(cursor?: string): Promise<FeedPage> {
    const params = new URLSearchParams();
    if (cursor) params.append("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/v1/bursts/all${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.get<ApiEnvelope<Post[]>>(endpoint);
    const posts = this.unwrap(response) ?? [];

    // Cache posts
    await Promise.all(posts.map((post) => this.cachePost(post)));

    return {
      ulids: posts.map((p) => p.ulid).filter((u): u is string => !!u),
      posts,
      nextCursor: this.extractNextCursor(response as ApiEnvelope<unknown>),
    };
  }

  // ---------------------------------------------------------------------------
  // Push Notification Methods
  // ---------------------------------------------------------------------------

  /**
   * Register device for push notifications
   * @param token FCM/APNS token
   * @param platform Device platform (ios, android, web)
   */
  async pushNotificationRegister(
    token: string,
    platform: "ios" | "android" | "web",
  ): Promise<PushNotificationRegisterResponse> {
    const response = await this.client.post<PushNotificationRegisterResponse>(
      "/v1/push-notifications/register",
      { body: { token, platform } },
    );
    return this.unwrap(response);
  }

  // ---------------------------------------------------------------------------
  // Branding Methods
  // ---------------------------------------------------------------------------

  /**
   * Get site branding configuration
   * Note: This endpoint is at the root, not under /v1
   */
  async brandingGet(): Promise<Branding> {
    const response = await this.client.get<Branding>("/branding.json");
    return this.unwrap(response);
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------

  private async cachePost(post: Post): Promise<void> {
    const id = (post.ulid || post.id) as Ulid;
    if (!id) return;
    const cache = await this.cachePromise;
    await cache.setPost(id, this.normalizePost(post));
  }

  private unwrap<T>(payload: ApiEnvelope<T> | T): T {
    if (payload && typeof payload === "object" && "data" in (payload as any)) {
      return (payload as ApiEnvelope<T>).data;
    }
    return payload as T;
  }

  private extractNextCursor(payload: ApiEnvelope<unknown>): string | null | undefined {
    return (
      payload?.nextCursor ??
      payload?.meta?.nextCursor ??
      payload?.meta?.pagination?.nextCursor ??
      null
    );
  }

  /**
   * Normalize post data from API to SDK format.
   * Handles field name variations between API responses.
   */
  private normalizePost(post: Post): Post {
    const p = post as Record<string, unknown>;
    const normalized: Post = { ...post };

    // Normalize postType -> type
    if (!normalized.type && normalized.postType) {
      normalized.type = normalized.postType;
    }

    // Normalize title variations (song_title, songTitle -> title)
    // Only normalize if title is completely missing (null/undefined), not if it's empty string
    // Empty string is a valid value that should be preserved
    if (normalized.title === null || normalized.title === undefined) {
      normalized.title = (p.song_title || p.songTitle || p.name) as string | undefined;
    }
    
    // Ensure images array is preserved (even if empty)
    // The spread operator should preserve it, but be explicit
    if (p.images !== undefined) {
      (normalized as Record<string, unknown>).images = p.images;
    }

    // Normalize artist variations
    if (!normalized.artist) {
      normalized.artist = (p.artist_name || p.artistName) as string | undefined;
    }

    // Normalize album variations
    if (!normalized.album) {
      normalized.album = (p.album_name || p.albumName) as string | undefined;
    }

    // Normalize userId variations (user_ulid, userULID -> userId)
    if (!normalized.userId) {
      normalized.userId = (p.user_ulid || p.userULID) as string | undefined;
    }

    // Normalize embedded user object if present
    // API may return user as { ulid, username, name, avatar } or { ulid, username, displayName, avatarUrl }
    // Or sometimes user data is at post level (username, displayName at post root)
    const userObj = p.user as Record<string, unknown> | undefined;

    // Start with existing user object or create new one
    const normalizedUser: Record<string, unknown> = userObj && typeof userObj === 'object'
      ? { ...userObj }
      : {};

    // Pull user fields from post level into user object
    // Some API responses have username/displayName at post root level
    if (!normalizedUser.username && p.username) {
      normalizedUser.username = p.username;
    }
    if (!normalizedUser.displayName && p.displayName) {
      normalizedUser.displayName = p.displayName;
    }
    if (!normalizedUser.name && p.name) {
      normalizedUser.name = p.name;
    }
    if (!normalizedUser.avatar && p.avatar) {
      normalizedUser.avatar = p.avatar;
    }
    if (!normalizedUser.avatarUrl && p.avatarUrl) {
      normalizedUser.avatarUrl = p.avatarUrl;
    }

    // Normalize name/displayName within user object
    if (!normalizedUser.name && normalizedUser.displayName) {
      normalizedUser.name = normalizedUser.displayName;
    }
    if (!normalizedUser.displayName && normalizedUser.name) {
      normalizedUser.displayName = normalizedUser.name;
    }

    // Normalize avatar/avatarUrl within user object
    if (!normalizedUser.avatar && normalizedUser.avatarUrl) {
      normalizedUser.avatar = normalizedUser.avatarUrl;
    }
    if (!normalizedUser.avatarUrl && normalizedUser.avatar) {
      normalizedUser.avatarUrl = normalizedUser.avatar;
    }

    // If we have a user.ulid but no post.userId, use it
    if (!normalized.userId && normalizedUser.ulid) {
      normalized.userId = normalizedUser.ulid as string;
    }
    // Or if user has userId, use that
    if (!normalized.userId && normalizedUser.userId) {
      normalized.userId = normalizedUser.userId as string;
    }

    // Only set user object if we have some user data
    if (Object.keys(normalizedUser).length > 0) {
      (normalized as Record<string, unknown>).user = normalizedUser;
    }

    // Normalize rating stats (API returns snake_case, we use camelCase)
    const ratingStats = p.ratingStats as Record<string, unknown> | undefined;
    if (ratingStats) {
      (normalized as Record<string, unknown>).ratingStats = {
        average: ratingStats.average_rating ?? ratingStats.average,
        total: ratingStats.total_ratings ?? ratingStats.total,
        distribution: ratingStats.rating_distribution ?? ratingStats.distribution,
      };
      // Also set top-level averageRating and ratingCount for convenience
      if (!p.averageRating) {
        (normalized as Record<string, unknown>).averageRating = ratingStats.average_rating ?? ratingStats.average;
      }
      if (!p.ratingCount) {
        (normalized as Record<string, unknown>).ratingCount = ratingStats.total_ratings ?? ratingStats.total;
      }
    }

    // Normalize userRating if present
    if (p.userRating !== undefined) {
      (normalized as Record<string, unknown>).userRating = p.userRating;
    }

    // Normalize poll data (API returns snake_case, frontend expects camelCase)
    const poll = p.poll as Record<string, unknown> | undefined;
    if (poll) {
      (normalized as Record<string, unknown>).poll = normalizePoll(poll);
    }

    // Calculate and store engagement hash for change detection
    // This allows engagement polling to detect if data has actually changed
    const engagementData = extractEngagementData(normalized as Record<string, unknown>);
    normalized._engagementHash = hashObject(engagementData);

    return normalized;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // User Management / Delegation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get managed user limit status for the current user.
   *
   * Returns whether the user can create more managed users based on their badge tier.
   *
   * @returns Promise resolving to limit status (can_create, current_count, limit)
   *
   * @example
   * ```typescript
   * const response = await sdk.getUserManagementLimitStatus();
   * const status = sdk.unwrap(response);
   * if (status.can_create) {
   *   console.log(`Can create ${status.remaining} more managed users`);
   * }
   * ```
   *
   * @category Delegation
   */
  async getUserManagementLimitStatus(): Promise<ApiEnvelope<import("./types").LimitStatus>> {
    return this.client.get<ApiEnvelope<import("./types").LimitStatus>>("/v1/user-management/limit-status");
  }

  /**
   * Create a new managed user account.
   *
   * Creates a user and establishes a management assignment in one operation.
   *
   * @param requestData - User creation data including credentials and scopes
   * @returns Promise resolving to the created user and assignment
   *
   * @category Delegation
   */
  async createManagedUser(
    requestData: import("./types").CreateManagedUserRequest,
  ): Promise<ApiEnvelope<import("./types").CreateManagedUserResponse>> {
    return this.client.post<ApiEnvelope<import("./types").CreateManagedUserResponse>>(
      "/v1/user-management/managed-users",
      { body: requestData },
    );
  }

  /**
   * List managed user assignments for the current manager.
   *
   * @param params - Optional filter parameters
   * @param params.scope - Filter by delegation scope
   * @param params.status - Filter by status (default: "active")
   * @param params.cursor - Cursor for pagination
   * @param params.limit - Maximum results (default: 20)
   * @returns Promise resolving to assignment list with pagination
   *
   * @category Delegation
   */
  async listManagedUserAssignments(params?: {
    scope?: string;
    status?: string;
    cursor?: string;
    limit?: number;
  }): Promise<ApiEnvelope<import("./types").AssignmentListResponse>> {
    return this.client.get<ApiEnvelope<import("./types").AssignmentListResponse>>(
      "/v1/user-management/assignments",
      {
        query: {
          scope: params?.scope,
          status: params?.status || "active",
          cursor: params?.cursor,
          limit: params?.limit || 20,
        },
      },
    );
  }

  /**
   * Revoke a managed user assignment.
   *
   * Ends the delegation relationship between manager and managed user.
   *
   * @param assignmentUlid - The ULID of the assignment to revoke
   * @returns Promise resolving to revocation details
   *
   * @category Delegation
   */
  async revokeManagedUserAssignment(
    assignmentUlid: string,
  ): Promise<ApiEnvelope<import("./types").RevokeAssignmentData>> {
    return this.client.delete<ApiEnvelope<import("./types").RevokeAssignmentData>>(
      `/v1/user-management/assignments/${encodeURIComponent(assignmentUlid)}`,
    );
  }

  /**
   * Issue a short-lived acting context token for a managed user.
   *
   * The token is used in X-Acting-Context-Token header for delegated operations.
   *
   * @param assignmentUlid - The ULID of the assignment
   * @param request - Token request with intended action and TTL
   * @returns Promise resolving to the acting context token and metadata
   *
   * @example
   * ```typescript
   * const response = await sdk.issueManagedUserToken(assignmentUlid, {
   *   intended_action: 'edit_profile',
   *   ttl_seconds: 300,
   * });
   * const token = sdk.unwrap(response);
   * // Use token.acting_context_token in subsequent requests
   * ```
   *
   * @category Delegation
   */
  async issueManagedUserToken(
    assignmentUlid: string,
    request: import("./types").IssueTokenRequest,
  ): Promise<ApiEnvelope<import("./types").IssueTokenResponse>> {
    return this.client.post<ApiEnvelope<import("./types").IssueTokenResponse>>(
      `/v1/user-management/assignments/${encodeURIComponent(assignmentUlid)}/token`,
      { body: request },
    );
  }

  /**
   * Update a managed user's profile on their behalf.
   *
   * Requires acting context headers from issueManagedUserToken.
   * Implements read-after-write to keep IndexedDB cache in sync.
   *
   * @param userUlid - The ULID of the managed user
   * @param data - Profile fields to update
   * @param actingHeaders - Headers containing X-Acting-Context-Token and X-Acting-User-ULID
   * @returns Promise resolving to updated profile and audit entry
   *
   * @category Delegation
   */
  async updateManagedUserProfile(
    userUlid: string,
    data: import("./types").ManagedProfileUpdateRequest,
    actingHeaders: Record<string, string>,
  ): Promise<ApiEnvelope<import("./types").ManagedProfileUpdateData>> {
    // Send the update request
    const response = await this.client.patch<ApiEnvelope<import("./types").ManagedProfileUpdateData>>(
      `/v1/user-management/users/${encodeURIComponent(userUlid)}`,
      {
        body: data,
        headers: actingHeaders,
      },
    );

    // Read-after-write: Fetch the updated profile directly from API to update cache
    try {
      this.log('📡 SDK: Fetching updated managed user profile from API:', userUlid);
      const freshProfile = await this.client.get<ApiEnvelope<Record<string, unknown>>>(
        `/v1/profile/ulid/${encodeURIComponent(userUlid)}`,
      );

      if (freshProfile.data) {
        // Update IndexedDB cache with the fresh profile data
        const cache = await this.cachePromise;
        const normalized = this.normalizeUserProfile(freshProfile.data);
        await cache.setUser(normalized.ulid, normalized);
        this.log('✅ SDK: Updated managed user cache after profile update:', userUlid);
      }
    } catch (error) {
      console.error('⚠️ SDK: Failed to update cache after managed user profile update:', error);
      // Don't throw - the update succeeded, cache update is best-effort
    }

    return response;
  }

  /**
   * Upload avatar for a managed user.
   *
   * Allows a manager to update the avatar image for a managed user.
   * Requires acting context headers obtained from issueManagedUserToken.
   *
   * @param userUlid - The ULID of the managed user
   * @param file - The avatar image file (JPEG/PNG recommended)
   * @param actingHeaders - Headers containing X-Acting-Context-Token and X-Acting-User-ULID
   * @returns Promise resolving to the new avatar URL
   *
   * @example
   * ```typescript
   * const tokenResponse = await sdk.issueManagedUserToken(assignmentUlid, {
   *   intended_action: 'edit_avatar',
   *   ttl_seconds: 300,
   * });
   * const token = sdk.unwrap(tokenResponse);
   *
   * const avatarFile = document.querySelector('input[type="file"]').files[0];
   * const response = await sdk.uploadManagedUserAvatar(
   *   userUlid,
   *   avatarFile,
   *   {
   *     'X-Acting-Context-Token': token.acting_context_token,
   *     'X-Acting-User-ULID': userUlid,
   *   }
   * );
   * console.log('New avatar URL:', sdk.unwrap(response).avatar_url);
   * ```
   *
   * @category Delegation
   */
  async uploadManagedUserAvatar(
    userUlid: string,
    file: File,
    actingHeaders: Record<string, string>,
  ): Promise<ApiEnvelope<{ avatar_url: string }>> {
    const formData = new FormData();
    formData.append("avatar", file);

    return this.client.post<ApiEnvelope<{ avatar_url: string }>>(
      `/v1/user-management/users/${encodeURIComponent(userUlid)}/avatar`,
      {
        body: formData,
        headers: actingHeaders,
      },
    );
  }

  /**
   * List audit entries for a managed user.
   *
   * Returns a paginated log of actions taken on behalf of a managed user,
   * including profile updates, avatar changes, and other delegated operations.
   *
   * @param userUlid - The ULID of the managed user
   * @param params - Optional filtering and pagination parameters
   * @param params.action - Filter by specific action type
   * @param params.cursor - Pagination cursor for next page
   * @param params.per_page - Number of entries per page (default: 20)
   * @returns Promise resolving to paginated audit entries
   *
   * @example
   * ```typescript
   * // Get all audit entries for a managed user
   * const response = await sdk.listManagedUserAudits(userUlid);
   * const audits = sdk.unwrap(response);
   *
   * audits.forEach(entry => {
   *   console.log(`${entry.action} at ${entry.created_at} by ${entry.actor_ulid}`);
   * });
   *
   * // Filter by action type
   * const profileUpdates = await sdk.listManagedUserAudits(userUlid, {
   *   action: 'profile_update',
   *   per_page: 50,
   * });
   * ```
   *
   * @category Delegation
   */
  async listManagedUserAudits(
    userUlid: string,
    params?: {
      action?: string;
      cursor?: string;
      per_page?: number;
    },
  ): Promise<ApiEnvelope<import("./types").ManagedUserAuditEntry[]>> {
    return this.client.get<ApiEnvelope<import("./types").ManagedUserAuditEntry[]>>(
      `/v1/user-management/users/${encodeURIComponent(userUlid)}/audits`,
      {
        query: {
          action: params?.action,
          cursor: params?.cursor,
          per_page: params?.per_page || 20,
        },
      },
    );
  }

  /**
   * Send audio view tracking data for analytics.
   *
   * Reports listening progress for audio posts to the server for analytics
   * and recommendation purposes. Typically called periodically during playback.
   *
   * @param payload - The tracking payload
   * @param payload.views - Array of view segments with position data
   * @param payload.timestamp - Unix timestamp when the data was collected
   * @param payload.client_id - Unique identifier for the client session
   * @returns Promise that resolves when tracking data is sent
   *
   * @example
   * ```typescript
   * await sdk.sendAudioViews({
   *   views: [
   *     {
   *       post_ulid: '01HX...ULID',
   *       start_second: 0,
   *       end_second: 30,
   *       last_position: 30,
   *     },
   *   ],
   *   timestamp: Date.now(),
   *   client_id: 'unique-session-id',
   * });
   * ```
   *
   * @category Analytics
   */
  async sendAudioViews(payload: {
    views: Array<{
      post_ulid: string;
      start_second: number;
      end_second: number;
      last_position: number;
    }>;
    timestamp: number;
    client_id: string;
  }): Promise<void> {
    await this.client.post<void>("/v1/audio-views", {
      body: payload,
    });
  }

  /**
   * Get all 3 Daily Mix playlists.
   *
   * Returns personalized daily mix playlists generated based on the user's
   * listening history and preferences. These playlists are refreshed daily.
   *
   * @returns Promise resolving to array of 3 Daily Mix playlists
   *
   * @example
   * ```typescript
   * const dailyMixes = await sdk.getDailyMixes();
   * dailyMixes.forEach((mix, index) => {
   *   console.log(`Daily Mix ${index + 1}: ${mix.name}`);
   * });
   * ```
   *
   * @category Playlists
   */
  async getDailyMixes(): Promise<Playlist[]> {
    return this.client.get<Playlist[]>("/v1/smart-playlists/daily-mixes");
  }

  /**
   * Get Discover Weekly playlist
   * GET /v1/smart-playlists/discover-weekly
   */
  async getDiscoverWeekly(): Promise<Playlist | null> {
    return this.client.get<Playlist | null>("/v1/smart-playlists/discover-weekly");
  }

  /**
   * Get user's music preferences and listening stats
   * GET /v1/smart-playlists/preferences
   */
  async getUserMusicPreferences(): Promise<{
    genre_affinities?: Record<string, number>;
    top_genres?: number[];
    listening_stats?: {
      total_listens: number;
      complete_listens: number;
      partial_listens: number;
      avg_completion: number;
      total_listening_time_minutes: number;
      last_listened_at: string | null;
    };
  } | null> {
    return this.client.get("/v1/smart-playlists/preferences");
  }

  /**
   * Force refresh a smart playlist
   * POST /v1/smart-playlists/refresh/{playlistId}
   */
  async refreshSmartPlaylist(playlistId: string): Promise<Playlist> {
    return this.client.post<Playlist>(`/v1/smart-playlists/refresh/${playlistId}`);
  }

  // ---------------------------------------------------------------------------
  // Audio Ads
  // ---------------------------------------------------------------------------

  /**
   * Get all active audio ads for playback between songs.
   * Returns all active audio ads for frontend caching. The frontend
   * should cache these locally and handle rotation. Refresh every
   * 5 minutes to pick up any changes (new ads or removed ads).
   *
   * This is a public endpoint - no authentication required.
   *
   * GET /v1/ads/audio
   *
   * @returns Array of audio ads (empty array if none available)
   */
  async getAudioAds(): Promise<AudioAd[]> {
    const response = await this.client.get<ApiEnvelope<AudioAd[]>>("/v1/ads/audio");
    return response?.data ?? [];
  }

  // ---------------------------------------------------------------------------
  // Blog Posts
  // ---------------------------------------------------------------------------

  /**
   * List published blog posts with filtering and pagination.
   * GET /v1/blog
   *
   * @param options - Filtering and pagination options
   * @returns Paginated list of blog posts
   */
  async listBlogPosts(options?: BlogListOptions): Promise<BlogListResponse> {
    const response = await this.client.get<BlogListResponse>("/v1/blog", {
      query: options as Record<string, unknown>,
    });
    return response;
  }

  /**
   * Get featured blog posts.
   * GET /v1/blog/featured
   *
   * @returns Array of featured blog posts
   */
  async getFeaturedBlogPosts(): Promise<BlogPostListItem[]> {
    const response = await this.client.get<ApiEnvelope<BlogPostListItem[]>>("/v1/blog/featured");
    return response?.data ?? [];
  }

  /**
   * Get blog categories.
   * GET /v1/blog/categories
   *
   * @returns Array of blog categories with post counts
   */
  async getBlogCategories(): Promise<BlogCategory[]> {
    const response = await this.client.get<ApiEnvelope<BlogCategory[]>>("/v1/blog/categories");
    return response?.data ?? [];
  }

  /**
   * Get a single blog post by slug.
   * GET /v1/blog/{slug}
   *
   * @param slug - Blog post slug
   * @returns Full blog post details
   */
  async getBlogPost(slug: string): Promise<BlogPost> {
    const response = await this.client.get<ApiEnvelope<BlogPost>>(`/v1/blog/${encodeURIComponent(slug)}`);
    return this.unwrap(response);
  }

  /**
   * Create a new blog post.
   * POST /v1/blog
   *
   * @param input - Blog post creation data
   * @returns Created blog post
   */
  async createBlogPost(input: CreateBlogPostInput): Promise<BlogPost> {
    const response = await this.client.post<ApiEnvelope<BlogPost>>("/v1/blog", {
      body: input,
    });
    return this.unwrap(response);
  }

  /**
   * Update an existing blog post.
   * PUT /v1/blog/{ulid}
   *
   * @param ulid - Blog post ULID
   * @param input - Blog post update data
   * @returns Updated blog post
   */
  async updateBlogPost(ulid: Ulid, input: UpdateBlogPostInput): Promise<BlogPost> {
    const response = await this.client.put<ApiEnvelope<BlogPost>>(`/v1/blog/${encodeURIComponent(ulid)}`, {
      body: input,
    });
    return this.unwrap(response);
  }

  /**
   * Delete a blog post (soft delete).
   * DELETE /v1/blog/{ulid}
   *
   * @param ulid - Blog post ULID
   */
  async deleteBlogPost(ulid: Ulid): Promise<void> {
    await this.client.delete(`/v1/blog/${encodeURIComponent(ulid)}`);
  }

  /**
   * Publish a draft blog post.
   * POST /v1/blog/{ulid}/publish
   *
   * @param ulid - Blog post ULID
   * @returns Published blog post
   */
  async publishBlogPost(ulid: Ulid): Promise<BlogPost> {
    const response = await this.client.post<ApiEnvelope<BlogPost>>(`/v1/blog/${encodeURIComponent(ulid)}/publish`);
    return this.unwrap(response);
  }

  /**
   * Schedule a blog post for future publication.
   * POST /v1/blog/{ulid}/schedule
   *
   * @param ulid - Blog post ULID
   * @param scheduledFor - ISO 8601 datetime string for scheduled publication
   * @returns Scheduled blog post
   */
  async scheduleBlogPost(ulid: Ulid, scheduledFor: string): Promise<BlogPost> {
    const response = await this.client.post<ApiEnvelope<BlogPost>>(`/v1/blog/${encodeURIComponent(ulid)}/schedule`, {
      body: { scheduled_for: scheduledFor },
    });
    return this.unwrap(response);
  }

  /**
   * Search blog posts via Typesense.
   * POST /v1/blog/search
   *
   * @param options - Search options
   * @returns Paginated search results
   */
  async searchBlogPosts(options: BlogSearchOptions): Promise<BlogListResponse> {
    const response = await this.client.post<BlogListResponse>("/v1/blog/search", {
      body: options,
    });
    return response;
  }

  // ---------------------------------------------------------------------------
  // Creation Mode Methods (AI/Human content voting)
  // ---------------------------------------------------------------------------

  /**
   * Vote on a post's creation mode (AI, HUMAN, HYBRID, or CANT_TELL).
   * POST /v1/posts/{postUlid}/creation-mode
   *
   * @param postUlid - The ULID of the post to vote on
   * @param mode - The creation mode to vote for
   * @returns The vote response with stats
   */
  async voteCreationMode(postUlid: Ulid, mode: CreationModeType): Promise<CreationModeVoteResponse> {
    const response = await this.client.post<ApiEnvelope<CreationModeVoteResponse>>(
      `/v1/posts/${encodeURIComponent(postUlid)}/creation-mode`,
      { body: { mode } },
    );
    return this.unwrap(response);
  }

  /**
   * Remove the current user's creation mode vote from a post.
   * DELETE /v1/posts/{postUlid}/creation-mode
   *
   * @param postUlid - The ULID of the post to remove the vote from
   * @returns The delete response with message and stats
   */
  async deleteCreationModeVote(postUlid: Ulid): Promise<CreationModeDeleteResponse> {
    const response = await this.client.delete<ApiEnvelope<CreationModeDeleteResponse>>(
      `/v1/posts/${encodeURIComponent(postUlid)}/creation-mode`,
    );
    return this.unwrap(response);
  }

  // ---------------------------------------------------------------------------
  // Group Methods
  // ---------------------------------------------------------------------------

  /**
   * Get all groups with optional pagination.
   * GET /v1/groups
   *
   * @param cursor - Optional cursor for pagination
   * @returns List of groups
   */
  async getGroups(cursor?: string): Promise<GroupListResponse> {
    const response = await this.client.get<Group[]>("/v1/groups", {
      query: cursor ? { cursor } : undefined,
    });
    // The API returns data array directly, need to extract cursor from headers or response
    const data = Array.isArray(response) ? response : (response as unknown as { data?: Group[] }).data || [];
    const rawResponse = response as unknown as { next_cursor?: string; nextCursor?: string };
    return {
      data,
      nextCursor: rawResponse.next_cursor || rawResponse.nextCursor,
    };
  }

  /**
   * Get a single group by its ULID.
   * GET /v1/groups/{groupUlid}
   *
   * @param groupUlid - The ULID of the group
   * @returns The group details
   */
  async getGroup(groupUlid: Ulid): Promise<Group> {
    const response = await this.client.get<ApiEnvelope<Group>>(
      `/v1/groups/${encodeURIComponent(groupUlid)}`,
    );
    return this.unwrap(response);
  }

  /**
   * Create a new group.
   * POST /v1/group/add
   *
   * @param request - Group creation request
   * @returns The created group (with isJoined: true since creator is auto-joined)
   */
  async createGroup(request: CreateGroupRequest): Promise<Group> {
    const response = await this.client.post<ApiEnvelope<{ group: Group }>>(
      "/v1/group/add",
      { body: request },
    );
    const unwrapped = this.unwrap(response);
    // API returns { group: {...} } due to GroupResource wrapper
    return unwrapped.group || (unwrapped as unknown as Group);
  }

  /**
   * Join a group.
   * POST /v1/group/join
   *
   * @param groupId - The ULID or ID of the group to join
   * @returns Success response
   */
  async joinGroup(groupId: string): Promise<void> {
    await this.client.post("/v1/group/join", {
      body: { groupId },
    });
  }

  /**
   * Leave a group.
   * POST /v1/group/leave
   *
   * @param groupId - The ULID or ID of the group to leave
   * @returns Success response
   */
  async leaveGroup(groupId: string): Promise<void> {
    await this.client.post("/v1/group/leave", {
      body: { groupId },
    });
  }

  /**
   * Get posts in a group feed.
   * POST /v1/feeds/group
   *
   * @param groupUlid - The ULID of the group
   * @param options - Optional parameters (limit, cursor)
   * @returns List of group posts with pagination
   */
  async getGroupPosts(
    groupUlid: Ulid,
    options?: { limit?: number; cursor?: string },
  ): Promise<{ data: GroupPost[]; nextCursor?: string }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.cursor) params.set("cursor", options.cursor);
    const queryString = params.toString();
    const url = `/v1/feeds/group${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.post<ApiEnvelope<GroupPost[]>>(url, {
      body: { groupId: groupUlid },
    });
    const rawResponse = response as unknown as { data?: GroupPost[]; nextCursor?: string; next_cursor?: string };
    const data = rawResponse.data ?? (Array.isArray(response) ? response : []);
    return {
      data: snakeToCamelObject(data),
      nextCursor: rawResponse.nextCursor ?? rawResponse.next_cursor,
    };
  }

  /**
   * Toggle favorite status of a group.
   * POST /v1/group/{groupUlid}/favorite
   *
   * @param groupUlid - The ULID of the group
   * @returns Updated favorite status
   */
  async toggleGroupFavorite(groupUlid: Ulid): Promise<{ isFavorite: boolean }> {
    const response = await this.client.post<ApiEnvelope<{ isFavorite: boolean }>>(
      `/v1/group/${encodeURIComponent(groupUlid)}/favorite`,
    );
    return this.unwrap(response);
  }

  // Group Management Methods

  /**
   * Get members of a group.
   * GET /v1/group/{groupUlid}/members
   *
   * @param groupUlid - The ULID of the group
   * @returns List of group members
   */
  async getGroupMembers(groupUlid: Ulid): Promise<GroupMember[]> {
    const response = await this.client.get<ApiEnvelope<GroupMember[]>>(
      `/v1/group/${encodeURIComponent(groupUlid)}/members`,
    );
    return this.unwrap(response) || [];
  }

  /**
   * Get moderators of a group.
   * GET /v1/group/{groupUlid}/moderators
   *
   * @param groupUlid - The ULID of the group
   * @returns List of group moderators
   */
  async getGroupModerators(groupUlid: Ulid): Promise<GroupMember[]> {
    const response = await this.client.get<ApiEnvelope<GroupMember[]>>(
      `/v1/group/${encodeURIComponent(groupUlid)}/moderators`,
    );
    return this.unwrap(response) || [];
  }

  /**
   * Get banned users from a group.
   * POST /v1/group/banned-users
   *
   * @param groupUlid - The ULID of the group
   * @returns List of banned users
   */
  async getGroupBannedUsers(groupUlid: Ulid): Promise<GroupMember[]> {
    const response = await this.client.post<ApiEnvelope<GroupMember[]>>(
      "/v1/group/banned-users",
      { body: { groupId: groupUlid } },
    );
    return this.unwrap(response) || [];
  }

  /**
   * Get moderation log for a group.
   * GET /v1/group/{groupUlid}/moderation-log
   *
   * @param groupUlid - The ULID of the group
   * @returns List of moderation log entries
   */
  async getGroupModerationLog(groupUlid: Ulid): Promise<GroupModerationLogEntry[]> {
    const response = await this.client.get<ApiEnvelope<GroupModerationLogEntry[]>>(
      `/v1/group/${encodeURIComponent(groupUlid)}/moderation-log`,
    );
    return this.unwrap(response) || [];
  }

  /**
   * Invite a user to a group.
   * POST /v1/group/{groupUlid}/invite
   *
   * @param groupUlid - The ULID of the group
   * @param userUlid - The ULID of the user to invite
   */
  async inviteToGroup(groupUlid: Ulid, userUlid: Ulid): Promise<void> {
    await this.client.post(`/v1/group/${encodeURIComponent(groupUlid)}/invite`, {
      body: { userId: userUlid },
    });
  }

  /**
   * Promote a member to moderator.
   * POST /v1/group/{groupUlid}/moderators
   *
   * @param groupUlid - The ULID of the group
   * @param userUlid - The ULID of the user to promote
   */
  async promoteToModerator(groupUlid: Ulid, userUlid: Ulid): Promise<void> {
    await this.client.post(`/v1/group/${encodeURIComponent(groupUlid)}/moderators`, {
      body: { userId: userUlid },
    });
  }

  /**
   * Demote a moderator to regular member.
   * DELETE /v1/group/{groupUlid}/moderators/{userUlid}
   *
   * @param groupUlid - The ULID of the group
   * @param userUlid - The ULID of the moderator to demote
   */
  async demoteFromModerator(groupUlid: Ulid, userUlid: Ulid): Promise<void> {
    await this.client.delete(
      `/v1/group/${encodeURIComponent(groupUlid)}/moderators/${encodeURIComponent(userUlid)}`,
    );
  }

  /**
   * Mute a member in a group.
   * POST /v1/group/{groupUlid}/mute
   *
   * @param groupUlid - The ULID of the group
   * @param userUlid - The ULID of the user to mute
   */
  async muteGroupMember(groupUlid: Ulid, userUlid: Ulid): Promise<void> {
    await this.client.post(`/v1/group/${encodeURIComponent(groupUlid)}/mute`, {
      body: { userId: userUlid },
    });
  }

  /**
   * Unmute a member in a group.
   * POST /v1/group/{groupUlid}/mute with _method DELETE
   *
   * @param groupUlid - The ULID of the group
   * @param userUlid - The ULID of the user to unmute
   */
  async unmuteGroupMember(groupUlid: Ulid, userUlid: Ulid): Promise<void> {
    await this.client.post(`/v1/group/${encodeURIComponent(groupUlid)}/mute`, {
      body: { _method: "DELETE", userId: userUlid },
    });
  }

  /**
   * Ban a member from a group.
   * POST /v1/group/ban
   *
   * @param groupUlid - The ULID of the group
   * @param userUlid - The ULID of the user to ban
   */
  async banGroupMember(groupUlid: Ulid, userUlid: Ulid): Promise<void> {
    await this.client.post("/v1/group/ban", {
      body: { userId: userUlid, groupId: groupUlid },
    });
  }

  /**
   * Unban a user from a group.
   * POST /v1/group/unban
   *
   * @param groupUlid - The ULID of the group
   * @param userUlid - The ULID of the user to unban
   */
  async unbanGroupMember(groupUlid: Ulid, userUlid: Ulid): Promise<void> {
    await this.client.post("/v1/group/unban", {
      body: { userId: userUlid, groupId: groupUlid },
    });
  }

  /**
   * Update group settings (avatar, background, etc.).
   * PATCH /v1/group/edit
   *
   * @param request - The update request with group ID and fields to update
   */
  async updateGroup(request: UpdateGroupRequest): Promise<void> {
    await this.client.patch("/v1/group/edit", {
      body: request,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Referral Tracking
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Record a referral visit for analytics tracking.
   * POST /v1/referral-visits
   *
   * @param params - Referral visit details
   * @param params.referralCode - The referral code from the URL
   * @param params.destinationType - Type of destination (profile, playlist, song, content)
   * @param params.destinationId - ID of the destination resource
   * @param params.landingPath - The path the user landed on
   *
   * @example
   * ```typescript
   * await sdk.recordReferralVisit({
   *   referralCode: 'ABC123',
   *   destinationType: 'profile',
   *   destinationId: 'username',
   *   landingPath: '/profile/username'
   * });
   * ```
   *
   * @category Analytics
   */
  async recordReferralVisit(params: {
    referralCode: string;
    destinationType?: string;
    destinationId?: string;
    landingPath?: string;
  }): Promise<void> {
    await this.client.post("/v1/referral-visits", {
      body: {
        referral_code: params.referralCode,
        destination_type: params.destinationType,
        destination_id: params.destinationId,
        landing_path: params.landingPath,
      },
    });
  }
}
