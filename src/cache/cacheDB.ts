/**
 * Cache layer for the CC Platform SDK using Dexie (IndexedDB).
 *
 * Provides offline-first caching for posts, users, feeds, and notifications.
 *
 * @module cache/cacheDB
 * @category Cache
 */
import Dexie, { type EntityTable, liveQuery, type Observable } from "dexie";
import { type FeedPage, type Post, type Ulid, type UserProfile } from "../types";
import { type Notification } from "../types";

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
  notifications!: EntityTable<CacheEntry<any>, "id">;
  notificationFeeds!: EntityTable<{
    route: string;
    userId: string;
    ulids: Ulid[];
    cursor: string | null;
    updatedAt: number;
    hasMore: boolean;
  }, "route">;
  metadata!: EntityTable<{ key: string; value: any; updatedAt: number }, "key">;

  constructor(dbName: string = "CcPlatformSdkCache") {
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

    this.on("versionchange", () => {
      this.close();
    });
  }
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
  private readonly db: PlatformCacheDB;
  private readonly ttlMs: number;

  /**
   * Create a new cache instance.
   *
   * @param ttlMs - Time-to-live in milliseconds (default: 24 hours)
   * @param dbName - Optional custom database name
   * @param maxCapacity - Optional max entries per CacheEntry store (for LRU eviction)
   */
  constructor(ttlMs: number = 24 * 60 * 60 * 1000, dbName?: string, private readonly maxCapacity?: number) {
    this.ttlMs = ttlMs;
    this.db = new PlatformCacheDB(dbName);
  }

  /**
   * Open the IndexedDB database connection.
   * Must be called before using any cache methods.
   */
  async open(): Promise<void> {
    await this.db.open();
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
    };
  }

  private touch<T>(entry: CacheEntry<T>): CacheEntry<T> {
    return {
      ...entry,
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
    const entry = await this.db.posts.get(id);
    if (!entry || this.isExpired(entry.cachedAt)) {
      return null;
    }

    await this.db.posts.put(this.touch(entry));
    return entry.data;
  }

  /**
   * Get multiple posts from cache by their ULIDs.
   *
   * @param ids - Array of post ULIDs
   * @returns Record mapping ULID to Post for found entries
   */
  async getPosts(ids: Ulid[]): Promise<Record<Ulid, Post>> {
    const entries = await this.db.posts.bulkGet(ids);
    const result: Record<Ulid, Post> = {};

    const validEntries = entries
      .filter(Boolean)
      .filter((entry) => !!entry && !this.isExpired(entry!.cachedAt)) as CacheEntry<Post>[];

    for (const entry of validEntries) {
      result[entry.id] = entry.data;
      await this.db.posts.put(this.touch(entry));
    }

    return result;
  }

  /**
   * Store a post in the cache.
   *
   * @param id - The post ULID
   * @param post - The post data to cache
   */
  async setPost(id: Ulid, post: Post): Promise<void> {
    await this.db.posts.put(this.createEntry(id, post));
  }

  /**
   * Store multiple posts in the cache.
   *
   * @param posts - Record mapping ULID to Post
   */
  async setPosts(posts: Record<Ulid, Post>): Promise<void> {
    const entries = Object.entries(posts).map(([id, data]) =>
      this.createEntry(id, data as Post),
    );
    await this.db.posts.bulkPut(entries);
  }

  /**
   * Remove a post object from cache without altering feed membership.
   * Useful when a stale post body needs to be re-fetched but the feed ordering
   * should remain intact.
   *
   * @param id - The post ULID
   */
  async invalidatePost(id: Ulid): Promise<void> {
    await this.db.posts.delete(id);
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
    const entry = await this.db.users?.get(id);
    if (!entry || this.isExpired(entry.cachedAt)) {
      return null;
    }
    await this.db.users?.put(this.touch(entry));
    return entry.data;
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

    await this.db.users.put(this.touch(entry));
    return entry.data;
  }

  /**
   * Get multiple users by ULIDs from IndexedDB cache
   * @param ids - Array of user ULIDs
   * @returns Map of ULID to UserProfile for cached, non-expired entries
   */
  async getUsers(ids: Ulid[]): Promise<Map<Ulid, UserProfile>> {
    if (!this.db.users) return new Map();

    const entries = await this.db.users.bulkGet(ids);
    const result = new Map<Ulid, UserProfile>();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry && !this.isExpired(entry.cachedAt)) {
        result.set(ids[i], entry.data);
        // Touch the entry to update access stats
        await this.db.users.put(this.touch(entry));
      }
    }

    return result;
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
   * Delete a post from cache and remove from all feeds.
   *
   * @param id - The post ULID to delete
   */
  async deletePost(id: Ulid): Promise<void> {
    await this.invalidatePost(id);
    await this.removeUlidFromFeeds(id);
  }

  private async removeUlidFromFeeds(id: Ulid): Promise<void> {
    const feeds = await this.db.feedResources.toArray();
    const updated = feeds
      .map((feed) => {
        const filtered = feed.ulids.filter((u) => u !== id);
        const changed = filtered.length !== feed.ulids.length;
        return changed ? { ...feed, ulids: filtered } : null;
      })
      .filter((feed): feed is FeedResource => Boolean(feed));

    if (updated.length === 0) return;

    await this.db.feedResources.bulkPut(updated);
  }

  /**
   * Get a cached feed resource by route.
   *
   * @param route - The feed route identifier
   * @returns The cached feed resource or null if not found/expired
   */
  async getFeedResource(route: string): Promise<FeedResource | null> {
    const resource = await this.db.feedResources.get(route);
    if (!resource) return null;
    if (this.isExpired(resource.cachedAt)) {
      await this.db.feedResources.delete(route);
      return null;
    }

    await this.db.feedResources.update(route, { lastAccessed: Date.now() });
    return resource;
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
    const existing = await this.db.feedResources.get(route);
    const now = Date.now();

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
    */
   async clearAll(): Promise<void> {
     await Promise.all([
       this.db.posts.clear(),
       this.db.users.clear(),
       this.db.feedResources.clear(),
       this.db.notifications.clear(),
       this.db.notificationFeeds.clear(),
       this.db.metadata.clear(),
     ]);
   }

  /**
   * Trim expired and overflow entries from CacheEntry-type stores.
   *
   * Performs two cleanup operations across posts, users, and notifications
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
       this.db.notifications,
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

  // ========================================================================
  // Notifications
  // ========================================================================

  /**
   * Store a notification in the cache.
   *
   * @param notification - The notification to cache
   */
  async storeNotification(notification: Notification): Promise<void> {
    const id = (notification as any).notificationId || notification.id;
    if (!id) return;
    await this.db.notifications.put(this.createEntry(id as Ulid, notification as any));
  }

  /**
   * Get a notification from cache by ID.
   *
   * @param id - The notification ULID
   * @returns The cached notification or null if not found/expired
   */
  async getNotification(id: Ulid): Promise<Notification | null> {
    const entry = await this.db.notifications.get(id);
    if (!entry || this.isExpired(entry.cachedAt)) return null;
    await this.db.notifications.put(this.touch(entry));
    return entry.data as Notification;
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
    const key = `${userId}:${route}`;
    const feed = await this.db.notificationFeeds.get(key);
    if (!feed) return null;
    if (Date.now() - feed.updatedAt > 30_000) {
      await this.db.notificationFeeds.delete(key);
      return null;
    }
    return feed;
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
   * Retrieve metadata from the cache.
   *
   * @typeParam T - The expected type of the stored value
   * @param key - The metadata key
   * @returns The stored value or null if not found
   */
  async getMetadata<T = any>(key: string): Promise<T | null> {
    const entry = await this.db.metadata.get(key);
    return entry ? (entry.value as T) : null;
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
export async function createCache(ttlMs?: number, dbName?: string, maxCapacity?: number): Promise<CacheDB> {
  const cache = new CacheDB(ttlMs, dbName, maxCapacity);
  await cache.open();
  return cache;
}
