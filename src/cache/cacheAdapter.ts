/**
 * Platform-agnostic cache contract.
 *
 * The SDK caches posts, users, groups and feed pagination state offline. On the
 * web that is IndexedDB via Dexie ({@link DexieCacheAdapter}); other platforms
 * (React Native, tests) supply their own implementation of this interface.
 *
 * Derived from the Dexie implementation rather than designed fresh — the shape
 * is what the SDK already calls, so an adapter that satisfies this type is a
 * drop-in replacement.
 *
 * ## Semantics an implementation must preserve
 *
 * These are the parts a naive key-value store loses:
 *
 * - **Two-tier TTL.** A hard TTL (default 24h) evicts entries — past it, reads
 *   are misses. A shorter soft TTL (default 30 min, see
 *   {@link CacheAdapter.isPastRefreshTTL}) does *not* evict: the entry is still
 *   returned so the caller can serve it while refreshing in the background
 *   (stale-while-revalidate). `lastCheckedAt` drives the soft tier and is
 *   distinct from `cachedAt`.
 * - **Access tracking.** `lastAccessed` and `accessCount` must be updated on
 *   read; they drive LRU eviction.
 * - **Feed normalization.** Feeds store an ordered ULID array plus a cursor.
 *   Posts are stored once and referenced by ULID — do not denormalize, and do
 *   not reorder.
 * - **Write fencing.** While fenced ({@link CacheAdapter.fenceWrites}), every
 *   write becomes a no-op; reads and deletes still work. Used at sign-out so
 *   in-flight requests cannot write the previous user's data back after the
 *   wipe. Getting this wrong reintroduces sign-out races.
 *
 * @module cache/cacheAdapter
 * @category Cache
 */
import type { Observable } from "dexie";
import type { Group, Post, Ulid, UserProfile } from "../types.js";
import type { CacheEntry, FeedResource, NotificationFeedResource } from "./cacheDB.js";

/**
 * Storage backend for the SDK's offline cache.
 *
 * @category Cache
 */
export interface CacheAdapter {
  // -- Lifecycle ------------------------------------------------------------

  /** Open the underlying store. Must be called (or awaited via `createCache`) before use. */
  open(): Promise<void>;
  /** Reopen after a close, e.g. when returning from the background. */
  reopen(): Promise<void>;
  /** Begin the periodic hard-TTL eviction sweep. */
  startTrimSchedule(): void;
  /** Stop the periodic eviction sweep. */
  stopTrimSchedule(): void;
  /** Evict entries past the hard TTL. @returns Number of rows removed. */
  trimCache(): Promise<number>;
  /** Remove everything. Used at sign-out. */
  clearAll(): Promise<void>;

  // -- Write fencing --------------------------------------------------------

  /** Make all writes no-ops. Reads and deletes are unaffected. */
  fenceWrites(): void;
  /** Resume accepting writes. */
  unfenceWrites(): void;

  // -- TTL ------------------------------------------------------------------

  /** Soft-refresh TTL in milliseconds. */
  getRefreshTtlMs(): number;
  /**
   * Whether an entry is past the soft TTL and should be refreshed in the
   * background. A missing entry counts as past it.
   */
  isPastRefreshTTL<T>(entry: CacheEntry<T> | null | undefined): boolean;

  // -- Posts ----------------------------------------------------------------

  getPost(id: Ulid): Promise<Post | null>;
  getPosts(ids: Ulid[]): Promise<Record<Ulid, Post>>;
  setPost(id: Ulid, post: Post): Promise<void>;
  setPosts(posts: Record<Ulid, Post>): Promise<void>;
  /** Drop a post's cached copy without removing it from feeds. */
  invalidatePost(id: Ulid): Promise<void>;
  /** Delete a post and remove its ULID from every feed. */
  deletePost(id: Ulid): Promise<void>;

  // -- Users ----------------------------------------------------------------

  getUser(id: Ulid): Promise<UserProfile | null>;
  getUsers(ids: Ulid[]): Promise<Map<Ulid, UserProfile>>;
  getUserByUsername(username: string): Promise<UserProfile | null>;
  /** The raw entry, including TTL and access-tracking fields. */
  getUserEntry(id: Ulid): Promise<CacheEntry<UserProfile> | null>;
  setUser(id: Ulid, user: UserProfile): Promise<void>;
  setUsers(users: UserProfile[]): Promise<void>;
  deleteUser(id: Ulid): Promise<void>;
  /**
   * Emit the user whenever their cached copy changes.
   *
   * Dexie pushes updates natively. A backend without live queries (SQLite)
   * should map this onto the host app's reactivity — e.g. TanStack Query's
   * `invalidateQueries` / `setQueryData` — rather than polling.
   */
  observeUser(id: Ulid): Observable<UserProfile | null>;

  // -- Groups ---------------------------------------------------------------

  getGroup(id: Ulid): Promise<Group | null>;
  getGroupEntry(id: Ulid): Promise<CacheEntry<Group> | null>;
  setGroup(id: Ulid, group: Group): Promise<void>;
  setGroups(groups: Group[]): Promise<void>;
  deleteGroup(id: Ulid): Promise<void>;
  /** @see {@link CacheAdapter.observeUser} for the live-query caveat. */
  observeGroup(id: Ulid): Observable<Group | null>;

  // -- Feeds ----------------------------------------------------------------

  getFeedResource(route: string): Promise<FeedResource | null>;
  /**
   * Store a feed page.
   *
   * @param replace - Replace the stored ULIDs instead of merging into them.
   */
  setFeedResource(
    route: string,
    ulids: Ulid[],
    cursor?: string | null,
    replace?: boolean,
  ): Promise<void>;
  /** Append a page, preserving order and dropping duplicates. */
  appendToFeedResource(route: string, ulids: Ulid[], cursor?: string | null): Promise<void>;

  // -- Notification feeds ---------------------------------------------------

  setNotificationFeed(
    route: string,
    userId: string,
    ulids: Ulid[],
    cursor: string | null,
    hasMore: boolean,
  ): Promise<void>;
  getNotificationFeed(route: string, userId: string): Promise<NotificationFeedResource | null>;
  clearNotificationFeeds(): Promise<void>;

  // -- Metadata -------------------------------------------------------------

  setMetadata(key: string, value: any): Promise<void>;
  getMetadata<T = any>(key: string): Promise<T | null>;
  deleteMetadata(key: string): Promise<void>;
}
