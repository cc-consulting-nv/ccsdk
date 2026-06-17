/**
 * Cache layer for the CC Platform SDK using Dexie (IndexedDB).
 *
 * Provides offline-first caching for posts, users, groups, and feeds.
 *
 * @module cache/cacheDB
 * @category Cache
 */
// ponytail: named { Dexie } import, not default — under NodeNext, dexie's ESM
// wrapper has no .d.ts so the default resolves to a namespace type that can't be
// `extends`-ed (TS2507). The named export keeps the constructor type.
import { Dexie, type EntityTable, liveQuery, type Observable } from "dexie";
import { type FeedPage, type Group, type Post, type Ulid, type UserProfile } from "../types.js";

/**
 * Default soft-refresh TTL (30 minutes). Entries older than this are still
 * returned from cache, but trigger a background refresh in the SDK layer.
 * Distinct from the hard TTL (default 24h) which removes the entry entirely.
 */
export const DEFAULT_REFRESH_TTL_MS = 30 * 60 * 1000;

/**
 * Default IndexedDB database name. Shared by the cache itself and the SDK's
 * cross-tab session channel name so both always agree.
 */
export const DEFAULT_DB_NAME = "CcPlatformSdkCache";

// Re-export liveQuery for external use
export { liveQuery, type Observable };

/**
 * Generic cache entry wrapper with TTL and access tracking.
 * @category Cache
 * @internal
 */
interface CacheEntry<T> {
  /** Unique identifier for the cached item */
  id: Ulid;
  /** The cached data */
  data: T;
  /** Timestamp when the entry was cached */
  cachedAt: number;
  /** Timestamp of last access */
  lastAccessed: number;
  /** Number of times this entry has been accessed */
  accessCount: number;
  /**
   * Timestamp of the last successful refresh from the network.
   * Used by callers to decide whether to fire a background refresh while
   * still returning the cached value (stale-while-revalidate). Backfilled
   * from `cachedAt` on v5 migration; updated whenever the entry is
   * (re)written from a fresh network response.
   */
  lastCheckedAt?: number;
}

/**
 * Feed resource cache entry for storing feed pagination state.
 * @category Cache
 * @internal
 */
interface FeedResource {
  /** Route identifier for the feed (e.g., "/v1/feed/trending") */
  route: string;
  /** Array of post ULIDs in this feed */
  ulids: Ulid[];
  /** Cursor for pagination */
  cursor?: string | null;
  /** Timestamp when cached */
  cachedAt: number;
  /** Timestamp of last access */
  lastAccessed: number;
}

/**
 * Notification feed cache entry.
 * @category Cache
 * @internal
 */
interface NotificationFeedResource {
  /** Route identifier */
  route: string;
  /** User ID this feed belongs to */
  userId: string;
  /** Array of notification ULIDs */
  ulids: Ulid[];
  /** Cursor for pagination */
  cursor: string | null;
  /** Timestamp when updated */
  updatedAt: number;
  /** Whether more notifications are available */
  hasMore: boolean;
}

class PlatformCacheDB extends Dexie {
  posts!: EntityTable<CacheEntry<Post>, "id">;
  feedResources!: EntityTable<FeedResource, "route">;
  users!: EntityTable<CacheEntry<UserProfile>, "id">;
  groups!: EntityTable<CacheEntry<Group>, "id">;
  notificationFeeds!: EntityTable<{
    route: string;
    userId: string;
    ulids: Ulid[];
    cursor: string | null;
    updatedAt: number;
    hasMore: boolean;
  }, "route">;
  metadata!: EntityTable<{ key: string; value: any; updatedAt: number }, "key">;

  constructor(dbName: string = DEFAULT_DB_NAME) {
    super(dbName);
    this.version(1).stores({
      posts: "id, cachedAt, lastAccessed",
      feedResources: "route, cachedAt, lastAccessed",
      notifications: "id, cachedAt, lastAccessed",
      notificationFeeds: "route, userId, updatedAt",
      metadata: "key, updatedAt",
    });

    // Version 2 adds users store
    this.version(2).stores({
      posts: "id, cachedAt, lastAccessed",
      feedResources: "route, cachedAt, lastAccessed",
      users: "id, cachedAt, lastAccessed, updatedAt",
      notifications: "id, cachedAt, lastAccessed",
      notificationFeeds: "route, userId, updatedAt",
      metadata: "key, updatedAt",
    });

    // Version 3 adds username index to users for efficient username lookups
    // Note: We don't index data.username directly in the schema because it's optional
    // Instead, we'll use Dexie's where() clause for username lookups
    this.version(3).stores({
      posts: "id, cachedAt, lastAccessed",
      feedResources: "route, cachedAt, lastAccessed",
      users: "id, cachedAt, lastAccessed, updatedAt",
      notifications: "id, cachedAt, lastAccessed",
      notificationFeeds: "route, userId, updatedAt",
      metadata: "key, updatedAt",
    });

    // Version 4 fixes users schema - removes updatedAt since CacheEntry doesn't have it
    this.version(4).stores({
      posts: "id, cachedAt, lastAccessed",
      feedResources: "route, cachedAt, lastAccessed",
      users: "id, cachedAt, lastAccessed",
      notifications: "id, cachedAt, lastAccessed",
      notificationFeeds: "route, userId, updatedAt",
      metadata: "key, updatedAt",
    });

    // Version 5 adds:
    //  - `groups` store (per-ULID group cache for stale-while-revalidate)
    //  - `lastCheckedAt` index on users/posts/groups for refresh-TTL queries
    // Existing users/posts rows get `lastCheckedAt` backfilled from `cachedAt`
    // so they don't all become "due for refresh" simultaneously after upgrade.
    this.version(5)
      .stores({
        posts: "id, cachedAt, lastAccessed, lastCheckedAt",
        feedResources: "route, cachedAt, lastAccessed",
        users: "id, cachedAt, lastAccessed, lastCheckedAt",
        groups: "id, cachedAt, lastAccessed, lastCheckedAt",
        notifications: "id, cachedAt, lastAccessed",
        notificationFeeds: "route, userId, updatedAt",
        metadata: "key, updatedAt",
      })
      .upgrade(async (tx) => {
        const stamp = (table: string) =>
          tx
            .table(table)
            .toCollection()
            .modify((entry: CacheEntry<unknown>) => {
              if (typeof entry.lastCheckedAt !== "number") {
                entry.lastCheckedAt = entry.cachedAt;
              }
            });
        await Promise.all([stamp("posts"), stamp("users")]);
      });

    // Version 6 drops the `notifications` per-id store. It was wired in
    // cacheDB but never read or written by the SDK — pure dead code. Setting
    // the schema to `null` instructs Dexie to delete the store on upgrade,
    // reclaiming whatever IndexedDB space was orphaned.
    this.version(6).stores({
      posts: "id, cachedAt, lastAccessed, lastCheckedAt",
      feedResources: "route, cachedAt, lastAccessed",
      users: "id, cachedAt, lastAccessed, lastCheckedAt",
      groups: "id, cachedAt, lastAccessed, lastCheckedAt",
      notifications: null,
      notificationFeeds: "route, userId, updatedAt",
      metadata: "key, updatedAt",
    });

    this.on("versionchange", () => {
      this.close();
    });

    // iOS Safari / WKWebView occasionally drops IndexedDB connections under
    // memory pressure or backgrounding. Auto-reopen so subsequent reads succeed.
    this.on("close", () => {
      // Best-effort reopen; safeOp() will also retry on next access.
      this.open().catch(() => {
        /* swallow - safeOp handles fallback */
      });
    });
  }
}

/**
 * Detect Dexie "connection lost" / closed-database errors that we can recover
 * from by reopening the database (typical on iOS WKWebView).
 * @internal
 */
function isDexieConnectionLost(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  const msg = String(e.message ?? "");
  return (
    e.name === "UnknownError" ||
    e.name === "DatabaseClosedError" ||
    e.name === "InvalidStateError" ||
    msg.includes("Connection to Indexed Database server lost") ||
    msg.includes("database connection is closing") ||
    msg.includes("DatabaseClosedError")
  );
}

/**
 * IndexedDB-based cache for the CC Platform SDK.
 *
 * Provides offline-first caching for posts, users, feeds, and notifications
 * with configurable TTL and LRU-style access tracking.
 *
 * @example
 * ```typescript
 * const cache = await createCache(24 * 60 * 60 * 1000); // 24 hour TTL
 *
 * // Cache a post
 * await cache.setPost(post.ulid, post);
 *
 * // Retrieve from cache
 * const cached = await cache.getPost(post.ulid);
 * ```
 *
 * @category Cache
 */
export class CacheDB {
  private db: PlatformCacheDB;
  private readonly dbName?: string;
  private readonly ttlMs: number;
  private readonly refreshTtlMs: number;
  private readonly trimIntervalMs: number;
  private trimTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * When true, all cache writes (`set*`/`append*` methods) become no-ops.
   * Raised at sign-out so in-flight requests and other tabs can't repopulate
   * the shared IndexedDB with the previous user's data after it was wiped.
   * Lifted when a new session is established.
   */
  private writesFenced = false;

  /**
   * Create a new cache instance.
   *
   * @param ttlMs - Hard TTL in milliseconds; entries older than this are
   *   treated as cache misses (default: 24 hours).
   * @param dbName - Optional custom database name
   * @param maxCapacity - Optional max entries per CacheEntry store (for LRU eviction)
   * @param refreshTtlMs - Soft refresh TTL; entries older than this are still
   *   returned, but `isPastRefreshTTL()` returns true so the SDK can fire a
   *   background refresh (default: 30 minutes).
   * @param trimIntervalMs - How often to auto-run `trimCache()` to evict
   *   past-hard-TTL rows. Defaults to 1 hour. Pass `0` to disable.
   */
  constructor(
    ttlMs: number = 24 * 60 * 60 * 1000,
    dbName?: string,
    private readonly maxCapacity?: number,
    refreshTtlMs: number = DEFAULT_REFRESH_TTL_MS,
    trimIntervalMs: number = 60 * 60 * 1000,
  ) {
    this.ttlMs = ttlMs;
    this.refreshTtlMs = refreshTtlMs;
    this.trimIntervalMs = trimIntervalMs;
    this.dbName = dbName;
    this.db = new PlatformCacheDB(dbName);
  }

  /**
   * Soft-refresh TTL in milliseconds.
   * Returned for callers that want to apply the same threshold elsewhere.
   */
  getRefreshTtlMs(): number {
    return this.refreshTtlMs;
  }

  /**
   * Stop accepting cache writes. Call at sign-out, before wiping the cache,
   * so requests that resolve after the wipe (this tab or others) can't write
   * the previous user's data back. Reads and deletes are unaffected.
   */
  fenceWrites(): void {
    this.writesFenced = true;
  }

  /**
   * Resume accepting cache writes. Call when a new session is established.
   */
  unfenceWrites(): void {
    this.writesFenced = false;
  }

  /**
   * Whether a CacheEntry is past the soft refresh TTL and should be
   * refreshed in the background. Treats entries with no `lastCheckedAt`
   * (legacy rows that weren't backfilled) as past TTL.
   */
  isPastRefreshTTL<T>(entry: CacheEntry<T> | null | undefined): boolean {
    if (!entry) return true;
    const stamp = entry.lastCheckedAt ?? entry.cachedAt;
    return Date.now() - stamp > this.refreshTtlMs;
  }

  /**
   * Open the IndexedDB database connection.
   * Must be called before using any cache methods.
   *
   * If the open fails (typically because a Dexie schema upgrade threw on a
   * corrupted row, or browser storage is in a wedged state), the entire
   * IndexedDB database is deleted and recreated at the current schema.
   * The cache loses its contents — but the cache is rebuildable from the
   * network, so this is strictly better than leaving the SDK bricked. Without
   * this fallback, a failed upgrade survives `logout()` (which only calls
   * `clearAll`, not `db.delete`) so the user has no in-app way to recover.
   */
  async open(): Promise<void> {
    try {
      await this.db.open();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[CacheDB] open failed, deleting and recreating database:",
        err,
      );
      await this.deleteAndRecreate("open");
    }
    this.startTrimSchedule();
  }

  /**
   * Last-resort recovery shared by `open()` and `clearAll()`: delete the
   * entire database and recreate it at the current schema. Rethrows if the
   * delete itself fails — at that point the cache may retain stale data and
   * callers must know.
   */
  private async deleteAndRecreate(context: string): Promise<void> {
    try {
      await this.db.delete();
    } catch (deleteErr) {
      // eslint-disable-next-line no-console
      console.error(
        `[CacheDB] ${context} fallback delete failed; cache may retain stale data:`,
        deleteErr,
      );
      throw deleteErr;
    }
    this.db = new PlatformCacheDB(this.dbName);
    await this.db.open();
  }

  /**
   * Start the periodic background trim. Idempotent — safe to call again.
   * Triggered automatically by `open()` when `trimIntervalMs > 0`. Errors
   * inside the trim are logged but never thrown — trim is best-effort.
   */
  startTrimSchedule(): void {
    if (this.trimTimer !== null) return;
    if (!this.trimIntervalMs || this.trimIntervalMs <= 0) return;
    this.trimTimer = setInterval(() => {
      this.trimCache().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[CacheDB] scheduled trim failed:", err);
      });
    }, this.trimIntervalMs);
    // Don't keep a Node process alive just to run trim. No-op in browsers.
    const t = this.trimTimer as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
  }

  /**
   * Stop the periodic trim. Call from `dispose()`/teardown to avoid leaking
   * a dangling interval handle when the SDK is torn down.
   */
  stopTrimSchedule(): void {
    if (this.trimTimer !== null) {
      clearInterval(this.trimTimer);
      this.trimTimer = null;
    }
  }

  /**
   * Force-reopen the underlying IndexedDB connection. Call this when the
   * app returns from background (iOS Safari/WKWebView can silently drop the
   * connection) to recover before the next cache read.
   */
  async reopen(): Promise<void> {
    try {
      if (this.db.isOpen()) {
        this.db.close();
      }
    } catch {
      /* ignore - we'll attempt open regardless */
    }
    await this.db.open();
  }

  /**
   * Wrap a cache read with one-shot reopen-on-connection-lost recovery.
   * If the second attempt also fails, returns the supplied fallback value
   * (cache miss) rather than throwing - cache failures must never break
   * the consuming app, only force a network fetch.
   *
   * @internal
   */
  private async safeRead<T>(op: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (!isDexieConnectionLost(err)) throw err;
      try {
        await this.reopen();
        return await op();
      } catch (retryErr) {
        // eslint-disable-next-line no-console
        console.warn(
          "[CacheDB] IndexedDB unavailable after reopen, falling back to network:",
          retryErr,
        );
        return fallback;
      }
    }
  }

  /**
   * Wrap a cache write with reopen-on-connection-lost recovery. Swallows
   * the error on second failure - writes are best-effort cache updates.
   *
   * @internal
   */
  private async safeWrite(op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (err) {
      if (!isDexieConnectionLost(err)) throw err;
      try {
        await this.reopen();
        await op();
      } catch (retryErr) {
        // eslint-disable-next-line no-console
        console.warn(
          "[CacheDB] IndexedDB write failed after reopen, dropping write:",
          retryErr,
        );
      }
    }
  }

  private isExpired(timestamp: number): boolean {
    return Date.now() - timestamp > this.ttlMs;
  }

  private createEntry<T>(id: Ulid, data: T): CacheEntry<T> {
    const now = Date.now();
    return {
      id,
      data,
      cachedAt: now,
      lastAccessed: now,
      accessCount: 1,
      lastCheckedAt: now,
    };
  }

  /**
   * LRU metadata patch for a read "touch". Applied with `Table.update()`
   * rather than `put()` so a row deleted by `clearAll()` while the read was
   * in flight cannot be re-inserted by the touch write — `update()` is a
   * no-op when the key is gone.
   */
  private touchPatch<T>(entry: CacheEntry<T>): { accessCount: number; lastAccessed: number } {
    return {
      accessCount: entry.accessCount + 1,
      lastAccessed: Date.now(),
    };
  }

  /**
   * Sanitize an object for IndexedDB storage by removing non-serializable properties (functions).
   * IndexedDB uses the structured clone algorithm which cannot serialize functions.
   */
  private sanitizeForStorage<T>(obj: T): T {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeForStorage(item)) as T;
    }
    // Create a new object without functions
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value !== 'function') {
        sanitized[key] = typeof value === 'object' && value !== null
          ? this.sanitizeForStorage(value)
          : value;
      }
    }
    return sanitized as T;
  }

  /**
   * Get a post from cache by its ULID.
   *
   * @param id - The post ULID
   * @returns The cached post or null if not found/expired
   */
  async getPost(id: Ulid): Promise<Post | null> {
    return this.safeRead(async () => {
      const entry = await this.db.posts.get(id);
      if (!entry || this.isExpired(entry.cachedAt)) {
        return null;
      }

      await this.db.posts.update(id, this.touchPatch(entry));
      return entry.data;
    }, null);
  }

  /**
   * Get multiple posts from cache by their ULIDs.
   *
   * @param ids - Array of post ULIDs
   * @returns Record mapping ULID to Post for found entries
   */
  async getPosts(ids: Ulid[]): Promise<Record<Ulid, Post>> {
    return this.safeRead(async () => {
      const entries = await this.db.posts.bulkGet(ids);
      const result: Record<Ulid, Post> = {};

      const validEntries = entries
        .filter(Boolean)
        .filter((entry) => !!entry && !this.isExpired(entry!.cachedAt)) as CacheEntry<Post>[];

      for (const entry of validEntries) {
        result[entry.id] = entry.data;
        await this.db.posts.update(entry.id, this.touchPatch(entry));
      }

      return result;
    }, {});
  }

  /**
   * Store a post in the cache.
   *
   * @param id - The post ULID
   * @param post - The post data to cache
   */
  async setPost(id: Ulid, post: Post): Promise<void> {
    if (this.writesFenced) return;
    await this.safeWrite(() => this.db.posts.put(this.createEntry(id, post)).then(() => undefined));
  }

  /**
   * Store multiple posts in the cache.
   *
   * @param posts - Record mapping ULID to Post
   */
  async setPosts(posts: Record<Ulid, Post>): Promise<void> {
    if (this.writesFenced) return;
    const entries = Object.entries(posts).map(([id, data]) =>
      this.createEntry(id, data as Post),
    );
    await this.safeWrite(() => this.db.posts.bulkPut(entries).then(() => undefined));
  }

  /**
   * Remove a post object from cache without altering feed membership.
   * Useful when a stale post body needs to be re-fetched but the feed ordering
   * should remain intact.
   *
   * @param id - The post ULID
   */
  async invalidatePost(id: Ulid): Promise<void> {
    await this.safeWrite(() => this.db.posts.delete(id).then(() => undefined));
  }

  // ========================================================================
  // Users
  // ========================================================================

  /**
   * Get a user profile from cache by ULID.
   *
   * @param id - The user ULID
   * @returns The cached user profile or null if not found/expired
   */
  async getUser(id: Ulid): Promise<UserProfile | null> {
    return this.safeRead(async () => {
      const entry = await this.db.users?.get(id);
      if (!entry || this.isExpired(entry.cachedAt)) {
        return null;
      }
      await this.db.users?.update(id, this.touchPatch(entry));
      return entry.data;
    }, null);
  }

  /**
   * Create a reactive observable for a user profile by ID.
   * Uses Dexie's liveQuery to automatically update when the user data changes in IndexedDB.
   * @param id - User ULID to observe
   * @returns Observable that emits UserProfile | null whenever the cache entry changes
   */
  observeUser(id: Ulid): Observable<UserProfile | null> {
    return liveQuery(async () => {
      if (!this.db.users) return null;
      const entry = await this.db.users.get(id);
      if (!entry || this.isExpired(entry.cachedAt)) {
        return null;
      }
      return entry.data;
    });
  }

  /**
   * Get user by username from IndexedDB cache
   * @param username - Username to lookup (case-insensitive)
   * @returns User profile if found and not expired, null otherwise
   * Note: This uses a filter since username is optional and can't be indexed
   */
  async getUserByUsername(username: string): Promise<UserProfile | null> {
    return this.safeRead(async () => {
      if (!this.db.users) return null;

      const lowerUsername = username.toLowerCase();

      // Filter by username (case-insensitive) - scans all entries
      const entry = await this.db.users
        .filter(entry => {
          const entryUsername = entry.data.username?.toLowerCase();
          return entryUsername === lowerUsername && !this.isExpired(entry.cachedAt);
        })
        .first();

      if (!entry) {
        return null;
      }

      await this.db.users.update(entry.id, this.touchPatch(entry));
      return entry.data;
    }, null);
  }

  /**
   * Get multiple users by ULIDs from IndexedDB cache
   * @param ids - Array of user ULIDs
   * @returns Map of ULID to UserProfile for cached, non-expired entries
   */
  async getUsers(ids: Ulid[]): Promise<Map<Ulid, UserProfile>> {
    return this.safeRead(async () => {
      if (!this.db.users) return new Map<Ulid, UserProfile>();

      const entries = await this.db.users.bulkGet(ids);
      const result = new Map<Ulid, UserProfile>();

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry && !this.isExpired(entry.cachedAt)) {
          result.set(ids[i], entry.data);
          // Touch the entry to update access stats
          await this.db.users.update(entry.id, this.touchPatch(entry));
        }
      }

      return result;
    }, new Map<Ulid, UserProfile>());
  }

  /**
   * Store a user profile in the cache.
   *
   * @param id - The user ULID
   * @param user - The user profile to cache
   */
  /**
   * Sanitize user profile data to ensure it's IndexedDB-serializable.
   * Removes functions, symbols, and converts Date objects to strings.
   * This is critical because CurrentUser objects have methods like isAdmin() and hasBadge()
   * that cannot be cloned to IndexedDB.
   */
  private sanitizeUserProfile(user: UserProfile): UserProfile {
    try {
      // First, explicitly remove any function properties (methods like isAdmin, hasBadge)
      const userWithoutMethods: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(user)) {
        // Skip functions and symbols - they can't be stored in IndexedDB
        if (typeof value === 'function' || typeof value === 'symbol') {
          continue;
        }
        userWithoutMethods[key] = value;
      }
      
      // Use JSON parse/stringify to deep clone and ensure all nested objects are serializable
      // This will also remove any remaining non-serializable values (like Date objects, undefined in arrays, etc.)
      const sanitized = JSON.parse(JSON.stringify(userWithoutMethods)) as UserProfile;
      return sanitized;
    } catch (error) {
      console.warn('[CacheDB] Failed to sanitize user profile, using original:', error);
      // Fallback: manually remove functions if JSON.stringify fails
      const fallback: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(user)) {
        if (typeof value !== 'function' && typeof value !== 'symbol') {
          fallback[key] = value;
        }
      }
      return fallback as UserProfile;
    }
  }

  async setUser(id: Ulid, user: UserProfile): Promise<void> {
    if (this.writesFenced) return;
    if (!this.db.users) return;
    // Skip users without valid ULID (defensive programming)
    if (!id || typeof id !== 'string') {
      console.warn('[CacheDB] Skipping user cache - invalid ULID:', id, user);
      return;
    }
    try {
      // Sanitize user data before storing to ensure IndexedDB compatibility
      // This removes methods like isAdmin() and hasBadge() that can't be cloned
      const sanitizedUser = this.sanitizeUserProfile(user);
      
      // Double-check: verify no functions remain (defensive programming)
      const hasFunctions = Object.values(sanitizedUser).some(
        (value) => typeof value === 'function' || typeof value === 'symbol'
      );
      if (hasFunctions) {
        console.error('[CacheDB] Sanitized user still contains functions!', {
          id,
          keys: Object.keys(sanitizedUser),
          functions: Object.entries(sanitizedUser)
            .filter(([_, v]) => typeof v === 'function' || typeof v === 'symbol')
            .map(([k]) => k),
        });
        // Force re-sanitize using JSON
        const reSanitized = JSON.parse(JSON.stringify(sanitizedUser)) as UserProfile;
        await this.db.users.put(this.createEntry(id, reSanitized));
        return;
      }
      
      await this.db.users.put(this.createEntry(id, sanitizedUser));
    } catch (error) {
      console.error('[CacheDB] Failed to store user in IndexedDB:', error, {
        id,
        userKeys: Object.keys(user),
        avatarVariants: (user as any).avatarVariants,
        backgroundVariants: (user as any).backgroundVariants,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : typeof error,
        hasIsAdmin: typeof (user as any).isAdmin === 'function',
        hasHasBadge: typeof (user as any).hasBadge === 'function',
      });
      // Don't throw - cache failures shouldn't break the app
    }
  }

  /**
   * Store multiple users in IndexedDB cache
   * @param users - Array of user profiles to cache
   */
  async setUsers(users: UserProfile[]): Promise<void> {
    if (this.writesFenced) return;
    if (!this.db.users) return;

    // Filter out users without valid ULIDs before caching (defensive programming)
    // Sanitize each user to remove non-serializable properties (e.g., functions)
    const entries = users
      .filter(user => user.ulid && typeof user.ulid === 'string')
      .map(user => this.createEntry(user.ulid, this.sanitizeForStorage(user)));

    if (entries.length === 0) {
      console.warn('[CacheDB] No valid users to cache - all missing ULIDs');
      return;
    }

    if (entries.length < users.length) {
      console.warn('[CacheDB] Skipped', users.length - entries.length, 'users with invalid ULIDs');
    }

    await this.db.users.bulkPut(entries);
  }

  /**
   * Delete a user from cache by ULID.
   * @param id - The user ULID to delete
   */
  async deleteUser(id: Ulid): Promise<void> {
    if (!this.db.users) return;
    await this.db.users.delete(id);
  }

  /**
   * Read the raw user CacheEntry (without touching lastAccessed).
   * Returns null if the entry is missing or past the hard TTL.
   * Used by the SDK to inspect `lastCheckedAt` for refresh decisions.
   */
  async getUserEntry(id: Ulid): Promise<CacheEntry<UserProfile> | null> {
    return this.safeRead(async () => {
      const entry = await this.db.users?.get(id);
      if (!entry || this.isExpired(entry.cachedAt)) return null;
      return entry;
    }, null);
  }

  // ========================================================================
  // Groups
  // ========================================================================

  /**
   * Get a group from cache by ULID.
   * @param id - The group ULID
   * @returns The cached group or null if not found / past hard TTL
   */
  async getGroup(id: Ulid): Promise<Group | null> {
    return this.safeRead(async () => {
      const entry = await this.db.groups?.get(id);
      if (!entry || this.isExpired(entry.cachedAt)) return null;
      await this.db.groups?.update(id, this.touchPatch(entry));
      return entry.data;
    }, null);
  }

  /**
   * Read the raw group CacheEntry. Used by the SDK to inspect
   * `lastCheckedAt` when deciding whether to fire a background refresh.
   */
  async getGroupEntry(id: Ulid): Promise<CacheEntry<Group> | null> {
    return this.safeRead(async () => {
      const entry = await this.db.groups?.get(id);
      if (!entry || this.isExpired(entry.cachedAt)) return null;
      return entry;
    }, null);
  }

  /**
   * Store a group in the cache. Stamps `lastCheckedAt = now`.
   */
  async setGroup(id: Ulid, group: Group): Promise<void> {
    if (this.writesFenced) return;
    if (!this.db.groups) return;
    if (!id || typeof id !== "string") return;
    await this.safeWrite(() =>
      this.db.groups.put(this.createEntry(id, this.sanitizeForStorage(group))).then(() => undefined),
    );
  }

  /**
   * Bulk-store groups. Skips entries without a ULID.
   */
  async setGroups(groups: Group[]): Promise<void> {
    if (this.writesFenced) return;
    if (!this.db.groups) return;
    const entries = groups
      .map((g) => {
        const id = (g.ulid || g.id) as Ulid | undefined;
        if (!id) return null;
        return this.createEntry(id, this.sanitizeForStorage(g));
      })
      .filter((e): e is CacheEntry<Group> => e !== null);
    if (entries.length === 0) return;
    await this.safeWrite(() => this.db.groups.bulkPut(entries).then(() => undefined));
  }

  /**
   * Delete a group from cache by ULID.
   */
  async deleteGroup(id: Ulid): Promise<void> {
    if (!this.db.groups) return;
    await this.safeWrite(() => this.db.groups.delete(id).then(() => undefined));
  }

  /**
   * Reactive observable for a group by ID.
   */
  observeGroup(id: Ulid): Observable<Group | null> {
    return liveQuery(async () => {
      if (!this.db.groups) return null;
      const entry = await this.db.groups.get(id);
      if (!entry || this.isExpired(entry.cachedAt)) return null;
      return entry.data;
    });
  }

  /**
   * Delete a post from cache and remove from all feeds.
   *
   * @param id - The post ULID to delete
   */
  async deletePost(id: Ulid): Promise<void> {
    await this.invalidatePost(id);
    await this.removeUlidFromFeeds(id);
  }

  private async removeUlidFromFeeds(id: Ulid): Promise<void> {
    // Fenced like the set* methods: during a sign-out wipe the whole table is
    // going away anyway, and the read-modify-write below must never run
    // against a mid-wipe snapshot.
    if (this.writesFenced) return;
    const feeds = await this.db.feedResources.toArray();
    if (this.writesFenced) return;
    for (const feed of feeds) {
      const filtered = feed.ulids.filter((u) => u !== id);
      if (filtered.length !== feed.ulids.length) {
        // update() (not put): a feed row deleted by clearAll() while this
        // loop runs must not be re-inserted.
        await this.db.feedResources.update(feed.route, { ulids: filtered });
      }
    }
  }

  /**
   * Get a cached feed resource by route.
   *
   * @param route - The feed route identifier
   * @returns The cached feed resource or null if not found/expired
   */
  async getFeedResource(route: string): Promise<FeedResource | null> {
    return this.safeRead(async () => {
      const resource = await this.db.feedResources.get(route);
      if (!resource) return null;
      if (this.isExpired(resource.cachedAt)) {
        await this.db.feedResources.delete(route);
        return null;
      }

      await this.db.feedResources.update(route, { lastAccessed: Date.now() });
      return resource;
    }, null);
  }

  /**
   * Store or update a feed resource.
   *
   * @param route - The feed route identifier
   * @param ulids - Array of post ULIDs in the feed
   * @param cursor - Pagination cursor
   * @param replace - If true, replaces existing; if false, merges with existing
   */
  async setFeedResource(
    route: string,
    ulids: Ulid[],
    cursor?: string | null,
    replace = false,
  ): Promise<void> {
    if (this.writesFenced) return;
    const now = Date.now();
    if (replace) {
      await this.db.feedResources.put({
        route,
        ulids,
        cursor: cursor ?? null,
        cachedAt: now,
        lastAccessed: now,
      });
      return;
    }

    const existing = await this.db.feedResources.get(route);
    const combined = existing ? Array.from(new Set([...ulids, ...existing.ulids])) : ulids;

    // Re-check: a sign-out can fence writes while the read above was in flight.
    if (this.writesFenced) return;
    await this.db.feedResources.put({
      route,
      ulids: combined,
      cursor: cursor ?? existing?.cursor ?? null,
      cachedAt: now,
      lastAccessed: now,
    });
  }

  /**
   * Append new posts to an existing feed resource.
   *
   * @param route - The feed route identifier
   * @param ulids - Array of post ULIDs to append
   * @param cursor - New pagination cursor
   */
  async appendToFeedResource(
    route: string,
    ulids: Ulid[],
    cursor?: string | null,
  ): Promise<void> {
    if (this.writesFenced) return;
    const existing = await this.db.feedResources.get(route);
    const now = Date.now();

    // Re-check: a sign-out can fence writes while the read above was in flight.
    if (this.writesFenced) return;
    if (!existing) {
      await this.db.feedResources.put({
        route,
        ulids,
        cursor: cursor ?? null,
        cachedAt: now,
        lastAccessed: now,
      });
      return;
    }

    const combined = Array.from(new Set([...existing.ulids, ...ulids]));
    await this.db.feedResources.put({
      route,
      ulids: combined,
      cursor: cursor ?? existing.cursor ?? null,
      cachedAt: now,
      lastAccessed: now,
    });
  }

  /**
    * Clear all cached data from all stores.
    * Use with caution - this removes all offline data.
    *
    * A partial failure (e.g. DatabaseClosedError mid-flight) could clear some
    * tables and leave others holding the previous user's data, so on any
    * failure the entire database is deleted and recreated. If the delete also
    * fails the error is rethrown so callers know the wipe did not complete.
    */
   async clearAll(): Promise<void> {
     try {
       await Promise.all([
         this.db.posts.clear(),
         this.db.users.clear(),
         this.db.groups?.clear() ?? Promise.resolve(),
         this.db.feedResources.clear(),
         this.db.notificationFeeds.clear(),
         this.db.metadata.clear(),
       ]);
     } catch (err) {
       // eslint-disable-next-line no-console
       console.warn(
         "[CacheDB] clearAll failed, deleting and recreating database:",
         err,
       );
       await this.deleteAndRecreate("clearAll");
     }
   }

  /**
   * Trim expired and overflow entries from CacheEntry-type stores.
   *
   * Performs two cleanup operations across posts, users, and groups
   * (the stores that hold `CacheEntry<T>` records):
   * 1. Removes entries whose `cachedAt` is past TTL (the same staleness
   *    semantic that read paths apply, so trim and read agree).
   * 2. If maxCapacity is set and a store exceeds it after stale removal,
   *    evicts the N entries with the lowest accessCount (LRU by frequency).
   *
   * `feedResources` is also trimmed by cachedAt TTL, but does not participate
   * in capacity-based eviction because it lacks an accessCount field.
   * `notificationFeeds` has no cachedAt and is not trimmed here.
   *
   * Should be called periodically by the application (e.g., on app activation
   * or periodically via setInterval) to prevent the cache from growing unbounded.
   *
   * @returns Total number of entries removed across all stores
   */
   async trimCache(): Promise<number> {
     const entryStores: EntityTable<CacheEntry<any>, "id">[] = [
       this.db.posts,
       this.db.users,
       this.db.groups,
     ];
     let totalRemoved = 0;

     for (const store of entryStores) {
       if (!store) continue;

       const entries = await store.toArray();
       const nonStaleEntries: CacheEntry<any>[] = [];
       const staleIds: string[] = [];

       for (const entry of entries) {
         if (this.isExpired(entry.cachedAt)) {
           staleIds.push(entry.id);
         } else {
           nonStaleEntries.push(entry);
         }
       }

       const toRemove = [...staleIds];

       if (this.maxCapacity && nonStaleEntries.length > this.maxCapacity) {
         const sorted = [...nonStaleEntries].sort((a, b) => a.accessCount - b.accessCount);
         const excess = sorted.length - this.maxCapacity;
         toRemove.push(...sorted.slice(0, excess).map(e => e.id));
       }

       if (toRemove.length > 0) {
         await store.bulkDelete(toRemove);
         totalRemoved += toRemove.length;
       }
     }

     // feedResources: TTL-only trim (no LRU since no accessCount).
     if (this.db.feedResources) {
       const feeds = await this.db.feedResources.toArray();
       const staleRoutes = feeds
         .filter((f) => this.isExpired(f.cachedAt))
         .map((f) => f.route);
       if (staleRoutes.length > 0) {
         await this.db.feedResources.bulkDelete(staleRoutes);
         totalRemoved += staleRoutes.length;
       }
     }

     return totalRemoved;
   }

  /**
   * Store notification feed pagination state.
   *
   * @param route - The feed route identifier
   * @param userId - The user this feed belongs to
   * @param ulids - Array of notification ULIDs
   * @param cursor - Pagination cursor
   * @param hasMore - Whether more notifications are available
   */
  async setNotificationFeed(
    route: string,
    userId: string,
    ulids: Ulid[],
    cursor: string | null,
    hasMore: boolean,
  ): Promise<void> {
    if (this.writesFenced) return;
    await this.db.notificationFeeds.put({
      route: `${userId}:${route}`,
      userId,
      ulids,
      cursor,
      updatedAt: Date.now(),
      hasMore,
    });
  }

  /**
   * Get cached notification feed state.
   *
   * @param route - The feed route identifier
   * @param userId - The user this feed belongs to
   * @returns The cached feed resource or null if not found/stale (30s TTL)
   */
  async getNotificationFeed(
    route: string,
    userId: string,
  ): Promise<NotificationFeedResource | null> {
    return this.safeRead(async () => {
      const key = `${userId}:${route}`;
      const feed = await this.db.notificationFeeds.get(key);
      if (!feed) return null;
      if (Date.now() - feed.updatedAt > 30_000) {
        await this.db.notificationFeeds.delete(key);
        return null;
      }
      return feed;
    }, null);
  }

  /**
   * Clear all cached notification feeds.
   */
  async clearNotificationFeeds(): Promise<void> {
    await this.db.notificationFeeds.clear();
  }

  // ========================================================================
  // Metadata (used for query cache or misc)
  // ========================================================================

  /**
   * Store arbitrary metadata in the cache.
   *
   * @param key - Unique key for the metadata
   * @param value - The value to store
   */
  async setMetadata(key: string, value: any): Promise<void> {
    if (this.writesFenced) return;
    try {
      const sanitized = this.sanitizeForStorage(value);
      await this.db.metadata.put({
        key,
        value: sanitized,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.warn(`[CacheDB] Failed to store metadata key '${key}' in IndexedDB:`, error);
    }
  }

  /**
   * Delete a metadata row. A true delete (not a null-value write), so it
   * works even while writes are fenced — sign-out flows must always be able
   * to remove persisted state.
   *
   * @param key - The metadata key to delete
   */
  async deleteMetadata(key: string): Promise<void> {
    await this.safeWrite(() => this.db.metadata.delete(key).then(() => undefined));
  }

  /**
   * Retrieve metadata from the cache.
   *
   * @typeParam T - The expected type of the stored value
   * @param key - The metadata key
   * @returns The stored value or null if not found
   */
  async getMetadata<T = any>(key: string): Promise<T | null> {
    return this.safeRead(async () => {
      const entry = await this.db.metadata.get(key);
      return entry ? (entry.value as T) : null;
    }, null);
  }
}

/**
 * Create and open a new cache instance.
 *
 * @param ttlMs - Time-to-live in milliseconds (default: 24 hours)
 * @param dbName - Optional custom database name
 * @returns Promise resolving to an opened cache instance
 *
 * @example
 * ```typescript
 * const cache = await createCache();
 * await cache.setPost(post.ulid, post);
 * ```
 *
 * @category Cache
 */
export async function createCache(
  ttlMs?: number,
  dbName?: string,
  maxCapacity?: number,
  refreshTtlMs?: number,
  trimIntervalMs?: number,
): Promise<CacheDB> {
  const cache = new CacheDB(ttlMs, dbName, maxCapacity, refreshTtlMs, trimIntervalMs);
  await cache.open();
  return cache;
}
