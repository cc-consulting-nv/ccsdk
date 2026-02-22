# AGENTS.md — AI Guide for @cc-consulting-nv/ccsdk

> This file helps AI coding assistants (Claude, Gemini, Cursor, Codex, Copilot) understand and work with this SDK.

## What This Project Is

`@cc-consulting-nv/ccsdk` is a **TypeScript SDK** for the CC Platform API — a social media / music streaming platform. It provides:

- Type-safe HTTP client with automatic token refresh
- IndexedDB caching via Dexie (offline-first)
- TanStack Query integration helpers
- Multipart file upload with progress/resume
- Authentication with multiple token storage strategies

**Package name:** `@cc-consulting-nv/ccsdk`
**Registry:** GitHub Packages (`npm.pkg.github.com`)
**License:** UNLICENSED (private)

## Project Structure

```
ccsdk/
├── src/
│   ├── index.ts              # Entry point — re-exports all modules
│   ├── platformSdk.ts         # CcPlatformSdk class (main SDK, ~5000 lines)
│   ├── httpClient.ts          # HttpClient with auth header injection + refresh
│   ├── auth.ts                # Token providers (Memory, Storage, Hybrid) + RefreshCoordinator
│   ├── types.ts               # All TypeScript interfaces and type definitions
│   ├── types/blog.ts          # Blog-specific types
│   ├── query.ts               # TanStack Query helpers (queryKeys, options creators, prefetch)
│   ├── persister.ts           # Dexie-backed TanStack Query persister
│   ├── multipartUpload.ts     # S3 multipart upload with progress/resume/abort
│   └── cache/
│       └── cacheDB.ts         # IndexedDB cache layer (posts, users, feeds, notifications)
├── tests/
│   ├── httpClient.test.js     # Unit tests
│   └── integration.js         # Integration tests (requires live API)
├── dist/                      # Compiled output (ESM + declarations)
├── package.json
├── tsconfig.json
└── README.md
```

## Build & Development

```bash
pnpm install         # Install dependencies
pnpm build           # Compile TypeScript (tsc -b) → dist/
pnpm dev             # Watch mode (tsc -b --watch)
pnpm clean           # Remove dist/
pnpm test            # Run unit tests
pnpm test:integration  # Integration tests (needs API)
pnpm docs            # Generate TypeDoc documentation
```

**Target:** ES2021, ESM modules, Bundler module resolution
**Strict mode:** Enabled
**Output:** `dist/index.js` + `dist/index.d.ts`

## Dependencies

| Package | Purpose |
|---------|---------|
| `@tanstack/query-core` | Query/mutation lifecycle, cache keys, infinite queries |
| `dexie` | IndexedDB wrapper for offline caching |
| `@msgpack/msgpack` | Binary MessagePack response decoding (optional) |

**Dev only:** `typescript`, `typedoc`, `typedoc-plugin-markdown`, `rimraf`

## Architecture Overview

### Core Class: `CcPlatformSdk`

The main entry point. Instantiate with a base URL and auth configuration:

```typescript
import { CcPlatformSdk, HybridTokenProvider } from "@cc-consulting-nv/ccsdk";

const sdk = new CcPlatformSdk({
  baseUrl: "https://api.example.com",
  tokenProvider: new HybridTokenProvider(localStorage),
  onRefreshTokens: async () => { /* return fresh tokens */ },
  onUnauthorized: () => { /* redirect to login */ },
  enableLogging: false,  // Debug logging (default: false)
  useMsgpack: false,     // Binary responses (default: false)
});
```

### Constructor Options (`CcPlatformSdkOptions`)

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `baseUrl` | `string` | Yes | API server URL |
| `tokens` | `AuthTokens` | No | Initial access/refresh tokens |
| `tokenProvider` | `TokenProvider` | No | Token storage strategy (default: HybridTokenProvider) |
| `cache` | `CacheDB` | No | Custom cache instance |
| `dbName` | `string` | No | IndexedDB database name |
| `onRefreshTokens` | `() => Promise<AuthTokens>` | No | Token refresh handler |
| `onUnauthorized` | `() => void` | No | Called when refresh fails |
| `enableLogging` | `boolean` | No | SDK debug logging |
| `useMsgpack` | `boolean` | No | Use MessagePack responses |

### Authentication Layer

Three token provider strategies:

1. **`MemoryTokenProvider`** — Tokens in memory only (lost on refresh)
2. **`StorageTokenProvider`** — Tokens in localStorage/sessionStorage
3. **`HybridTokenProvider`** (default) — Access token in memory, refresh token in localStorage

The `RefreshCoordinator` deduplicates concurrent 401→refresh flows.

### HTTP Client

`HttpClient` wraps `fetch()` with:
- Automatic `Authorization: Bearer <token>` injection
- Acting context headers (`X-Acting-Context-Token`, `X-Acting-User-ULID`)
- Auto-retry on 401 with token refresh
- MessagePack response decoding support
- FormData and JSON body handling

### Cache Layer (`CacheDB`)

IndexedDB-backed via Dexie with stores for:
- **posts** — Cached by ULID with TTL and access tracking
- **users** — User profiles with sanitization for IndexedDB compatibility
- **feedResources** — Feed ULID ordering with pagination cursors
- **notifications** — Notification cache
- **notificationFeeds** — Notification feed pagination state
- **metadata** — Arbitrary key-value storage (used by query persister)

Default TTL: 24 hours. Access tracking (LRU-style) via `lastAccessed` and `accessCount`.

### TanStack Query Integration

```typescript
import { queryKeys, createPostQueryOptions, createMusicFeedInfiniteQueryOptions } from "@cc-consulting-nv/ccsdk";

// Query keys for cache invalidation
queryKeys.posts.all          // ["posts"]
queryKeys.posts.detail(ulid) // ["posts", "detail", ulid]
queryKeys.feed.all           // ["feed"]
queryKeys.feed.music()       // ["feed", "music"]

// Use with any TanStack Query adapter (React, Vue, Svelte)
const postOptions = createPostQueryOptions(sdk, ulid);
const feedOptions = createMusicFeedInfiniteQueryOptions(sdk);
```

## API Surface — Key Methods on `CcPlatformSdk`

### Authentication
- `login(email, password)` → `AuthTokens`
- `loginWithOAuth(provider, token)` → `AuthTokens`
- `requestMagicLink(email)`
- `redeemMagicLink(token)` → `AuthTokens`
- `requestAuthCode(email)` — Email verification code
- `logout()`
- `setTokens(tokens)` / `getTokens()` / `isAuthenticated()`
- `setActingContext(context)` / `getActingContext()` / `clearActingContext()` / `isActing()`

### Current User
- `getCurrentUser()` → `CurrentUser | null`
- `updateCurrentUser(data, callback?)` — Update profile fields

### Feeds
- `fetchFeedPage(cursor?, endpoint?, cacheKey?)` → `FeedPage`
- `fetchTrendingFeed(cursor?)` → `FeedPage`
- `fetchFollowingFeed(cursor?)` → `FeedPage`
- `fetchDiscoverFeed(cursor?)` → `FeedPage`
- `fetchLatestFeed(cursor?)` → `FeedPage`
- `fetchGenreFeed(genrePath, cursor?)` → `FeedPage`
- `fetchPopularGenresFeed(cursor?)` → `FeedPage`
- `fetchTrendingGenresFeed(cursor?)` → `FeedPage`
- `fetchTrendingUsersFeed(cursor?)` → `FeedPage`

### Posts
- `fetchPostsBatch(ulids[])` — Batch hydrate posts by ULID
- `getPostByUlid(ulid, forceRefresh?)` → `Post | null`
- `createPost(data)` / `updatePost(ulid, data)` / `deletePost(ulid)`

### Engagement
- `addReaction(postUlid, reaction)` / `removeReaction(postUlid)`
- `bookmarkPost(postUlid)` / `unbookmarkPost(postUlid)`
- `sharePost(postUlid)`
- `upvotePost(postUlid)`
- `fetchEngagement(ulids[])` — Batch fetch engagement data

### Ratings
- `ratePost(postUlid, rating)` / `removeRating(postUlid)`
- `getRatings(postUlid)` / `getMyRating(postUlid)`
- `getRatingsBatch(ulids[])`

### Comments
- `fetchComments(postUlid, cursor?)` — Returns hydrated comment posts
- `createComment(postUlid, body)` / `deleteComment(commentUlid)`

### Users
- `getUserProfile(usernameOrUlid)` → `UserProfile`
- `getUserFollowers(ulid, cursor?)` / `getUserFollowing(ulid, cursor?)`
- `getUserPosts(ulid, cursor?)`
- `followUser(ulid)` / `unfollowUser(ulid)`
- `blockUser(ulid)` / `unblockUser(ulid)`
- `muteUser(ulid)` / `unmuteUser(ulid)`
- `getSuggestedUsers()` → `SuggestedUser[]`

### Playlists
- `getPlaylists(userUlid)` / `getPlaylist(playlistId)`
- `createPlaylist(data)` / `updatePlaylist(id, data)` / `deletePlaylist(id)`
- `addPlaylistSongs(playlistId, songUlids[])` / `removePlaylistSong(playlistId, songUlid)`

### Search
- `searchPosts(query, cursor?)` → `SearchResult<Post>`
- `searchUsers(query, cursor?)` → `SearchResult<UserProfile>`
- `searchHashtags(query)` → `SearchResult`
- `searchAudio(query, cursor?)` → `SearchResult<AudioSearchResult>`

### Notifications
- `getNotifications(cursor?)` / `getUnreadNotificationCount()`
- `markNotificationRead(id)` / `markAllNotificationsRead()`

### Chat
- `getChatGroups()` / `createChatGroup(participantUlids[])`
- `markChatGroupRead(groupUlid)`
- `getChatMessages(groupUlid, cursor?)` / `sendChatMessage(groupUlid, body)`

### Badges
- `getAvailableBadges()` / `getUserBadges(userUlid)` / `awardBadge(userUlid, badgeId)`

### Settings
- `getAppSettings()` → `AppSettings` (reactions, badges, genres, violations, features)
- `getGlobalSettings()` / `getUserSettings()` / `updateUserSettings(data)`

### Songs
- `getSongDetail(ulid)` / `getSongChannels(ulid)` / `listSongChannels()`
- `importSong(data)` — POST to `/v1/songs/import`

### Uploads
- `uploadFile(path, file, additionalData?)` — Simple file upload
- `MultipartUpload` class — Large file uploads with progress/resume/abort

### Blog
- `getBlogPosts(options?)` / `getBlogPost(slugOrUlid)` / `getBlogPostBySlug(slug)`
- `createBlogPost(data)` / `updateBlogPost(ulid, data)` / `deleteBlogPost(ulid)`
- `publishBlogPost(ulid)` / `unpublishBlogPost(ulid)`
- `searchBlogPosts(options)` / `getBlogCategories()`

### Groups
- `getGroups(cursor?)` / `getGroup(groupId)` / `createGroup(data)` / `updateGroup(data)`
- `joinGroup(groupId)` / `leaveGroup(groupId)`
- `getGroupPosts(groupId, cursor?)` / `getGroupMembers(groupId, cursor?)`
- Group moderation: `getGroupModerationQueue(groupId)` / `approveGroupPost(groupId, postUlid)` / `rejectGroupPost(groupId, postUlid)`

### WSOM (World Series of Music)
- Contest management, entry submission, rating, leaderboards
- Both v2 (contest-based) and v3 (event-based) APIs

### Delegation / Managed Users
- `getManagedUsers()` / `createManagedUser(data)` / `revokeManagedUser(assignmentId)`
- `issueActingToken(assignmentId, request)` — Get delegation token

### CEO Dashboard
- `getDashboardSummary(days?)` / `getDashboardTimeseries(metric, days?)`
- `getDashboardListeningDistribution(days?)` / `getDashboardHourlyActiveUsers(date?)`

### Passkeys (WebAuthn)
- `getPasskeys()` / `registerPasskey(name)` / `deletePasskey(id)`
- `authenticateWithPasskey()` — Passwordless authentication

### Moderation Feed (Admin)
- `getModerationFeed(filters?)` / `getModerationFeedItem(id)`
- `takeModerationAction(id, action)` — Resolve/dismiss reported content

### Cache Helpers
- `updateCachedEngagement(ulid, engagement)` — Update cached engagement data
- `readCachedFeed(cacheKey)` — Read feed from IndexedDB
- `clearCache()` — Clear all cached data

## Key Types

### `Post`
The core content type. Posts can be text, songs, videos, podcasts, or bursts:
```typescript
interface Post {
  id: Ulid;              // ULID identifier
  type?: "POST" | "REPLY" | "REPOST" | "QUOTE" | "SONG" | "VIDEO" | "SHORT" | "PODCAST" | "BURST";
  title?: string;        // For songs/videos
  content?: string;      // Text body
  artist?: string;       // For songs
  streamUrl?: string;    // Audio URL
  videoUrls?: { hls?: string; mp4?: string; thumbnail?: string };
  postEngagement?: PostEngagement;
  [key: string]: unknown; // Extensible
}
```

### `FeedPage`
Cursor-paginated feed response:
```typescript
interface FeedPage {
  ulids: Ulid[];           // ULIDs for cache lookup
  posts: Post[];           // Full post objects
  nextCursor?: string | null;
}
```

### `UserProfile`
```typescript
interface UserProfile {
  ulid: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  followersCount?: number;
  followingCount?: number;
  ProfileEngagement?: ProfileEngagement; // Follow/block/mute state
  [key: string]: unknown;
}
```

### `AuthTokens`
```typescript
interface AuthTokens {
  accessToken?: string;
  refreshToken?: string;
}
```

## Design Patterns

### ULIDs as Primary Identifiers
All entities use ULIDs (Universally Unique Lexicographically Sortable Identifiers). ULIDs are 26-character strings sortable by creation time.

### Songs as Posts
Songs are posts with `type: "SONG"`. The feed endpoint `/v1/songs/feed/all` returns ULIDs; `/v1/posts` returns full bodies.

### Batch Fetching with Debounce
The SDK internally batches and debounces requests for posts and user profiles. Multiple concurrent calls to `getPostByUlid()` within 100ms are combined into a single batch API call.

### Engagement Hashing
Post engagement data is hashed to detect changes and avoid unnecessary cache updates.

### Acting Context (Delegation)
Managers can act on behalf of managed users. When `setActingContext()` is called, all subsequent API requests include delegation headers.

### Cache-First with Background Refresh
The SDK checks IndexedDB first, returns cached data immediately, then fetches fresh data in the background.

## API Response Envelope

All API responses follow this structure:
```typescript
interface ApiEnvelope<T> {
  data: T;
  meta?: { nextCursor?: string | null; pagination?: { ... } };
  nextCursor?: string | null;
}
```

## Adding New API Methods

When adding a new method to `CcPlatformSdk`:

1. **Add types** in `src/types.ts` (or `src/types/` subdirectory)
2. **Add the method** in `src/platformSdk.ts`
3. **Follow the pattern**: Use `this.client.get<ApiEnvelope<T>>()` and unwrap with `.data`
4. **Add caching** if the data should be available offline
5. **Export types** from `src/index.ts` if they're in a subdirectory
6. **Rebuild**: `pnpm build`

Example:
```typescript
// In platformSdk.ts
async getNewFeature(id: string): Promise<NewFeatureType> {
  const response = await this.client.get<ApiEnvelope<NewFeatureType>>(`/v1/features/${id}`);
  return response.data;
}
```

## Testing

- **Unit tests:** `tests/httpClient.test.js` — Tests HTTP client behavior
- **Integration tests:** `tests/integration.js` — Tests against a live API (requires credentials)
- **Run:** `pnpm test` for unit tests, `pnpm test:integration` for integration

## Publishing

Published to GitHub Packages via GitHub Actions on release creation:
1. Bump version in `package.json`
2. `git push --follow-tags`
3. Create a GitHub release → triggers auto-publish

## Consumer Projects

The SDK is consumed by multiple apps in the `~/social` monorepo:
- `apps/ui` — Main social media web app
- `apps/shared` — Shared utilities
- `apps/music-catalog` — Music catalog app
- `apps/sdk-playground` — SDK testing playground

When bumping the ccsdk version, update `package.json` in all consumer packages plus `pnpm-workspace.yaml` overrides.

## Common Gotchas

1. **IndexedDB serialization**: Objects with methods (functions) cannot be stored in IndexedDB. The SDK sanitizes user profiles before caching.
2. **Token refresh race**: The `RefreshCoordinator` prevents multiple simultaneous refresh requests. Don't bypass it.
3. **Feed cache merging**: `setFeedResource(route, ulids, cursor, replace)` — set `replace: true` to overwrite, `false` to merge.
4. **Post type normalization**: The API returns `postType`; the SDK normalizes it to `type`.
5. **MessagePack**: Enable with `useMsgpack: true` but only if the server supports `Accept: application/msgpack`.
6. **Acting context persistence**: Acting context is persisted in localStorage and restored on SDK init.
