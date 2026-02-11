# CC Platform SDK

Cache-aware TypeScript SDK for the CC-API that mirrors the Social UI's IndexedDB + TanStack Query approach. It hydrates music feeds from `/v1/songs/feed/all`, fetches full posts via `/v1/posts`, and keeps ULID ordering cached for offline/instant navigation.

## Features
- HTTP client with token injection and refresh hook (pluggable fetch).
- Pluggable token provider (memory by default) for easy integration with your auth storage; refresh coordinator serializes concurrent refreshes; optional storage-backed provider.
- Dexie-backed cache for posts and feed ULID ordering.
- Batch post hydration (`/v1/posts`) for efficient feed rendering (ULIDs come from `/v1/songs/feed/all` by default).
- Query-core helpers for framework adapters (React Query, Vue Query, Svelte Query).

## Installation

This package is published to GitHub Packages. You need to configure npm to use GitHub Packages for the `@closedcircuitlogin` scope.

### 1. Configure npm registry

Create or update `.npmrc` in your project root:

```
@closedcircuitlogin:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

### 2. Authenticate with GitHub

Create a GitHub Personal Access Token (PAT) with `read:packages` scope:
1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate a new token with `read:packages` permission
3. Set it as an environment variable:

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

Or add to your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

### 3. Install the package

```bash
# npm
npm install @closedcircuitlogin/cc-platform-sdk

# pnpm
pnpm add @closedcircuitlogin/cc-platform-sdk

# yarn
yarn add @closedcircuitlogin/cc-platform-sdk
```

## Quickstart

```ts
import { CcPlatformSdk, createMusicFeedInfiniteQueryOptions, createPostQueryOptions } from "@closedcircuitlogin/cc-platform-sdk";
import { QueryClient } from "@tanstack/query-core";

const sdk = new CcPlatformSdk({
  baseUrl: "https://api.example.com",
  tokens: { accessToken: "token", refreshToken: "refresh" },
  onRefreshTokens: async () => ({ accessToken: "newToken" }),
  enableLogging: true, // Optional: enable debug logging (defaults to false)
});

const queryClient = new QueryClient();

// Prefetch a post
await queryClient.prefetchQuery(createPostQueryOptions(sdk, "01HX...ULID"));

// Infinite feed options (use in React/Vue/Svelte adapters)
const feedOptions = createMusicFeedInfiniteQueryOptions(sdk);
```

## API Surface
- `CcPlatformSdk`
  - `fetchFeedPage(cursor?, endpoint?, cacheKey?)` (defaults to `/v1/songs/feed/all`)
  - Convenience feed helpers: `fetchTrendingFeed`, `fetchFollowingFeed`, `fetchDiscoverFeed`, `fetchLatestFeed`, `fetchGenreFeed(genrePath)`, `fetchPopularGenresFeed`, `fetchTrendingGenresFeed`, `fetchTrendingUsersFeed`
  - `fetchPostsBatch(ulids[])`
  - `getPostByUlid(ulid, forceRefresh?)`
  - Mutations: `createPost`, `updatePost`, `deletePost`
  - Engagement: `addReaction/removeReaction`, `bookmarkPost/unbookmarkPost`, `sharePost`, `upvotePost`, `fetchEngagement`
  - Ratings: `ratePost/removeRating`, `getRatings`, `getMyRating`, `getRatingsBatch`
  - Notifications: `getNotifications`, `getUnreadNotificationCount`, `markNotificationRead`, `markAllNotificationsRead`
  - Notifications cache: `storeNotification`, `getNotification`, `setNotificationFeed`, `getNotificationFeed`, `clearNotificationFeeds`
  - Comments: `fetchComments` (returns hydrated posts), `createComment`, `deleteComment`
  - Playlists: `getPlaylists`, `getPlaylist`, `createPlaylist`, `updatePlaylist`, `deletePlaylist`, `addPlaylistSongs`, `removePlaylistSong`
  - Users: `getUserProfile`, `getUserFollowers`, `getUserFollowing`, `getUserPosts`
  - Search: `searchPosts`, `searchUsers`, `searchHashtags`
  - Badges: `getAvailableBadges`, `getUserBadges`, `awardBadge`
  - Settings: `getGlobalSettings`, `getUserSettings`, `updateUserSettings`
  - Uploads/Import: `importSong` (POST `/v1/songs/import`), `uploadFile(path, file, additionalData?)`
  - Songs: `getSongDetail`, `getSongChannels`, `listSongChannels`
  - Chat: `getChatGroups`, `createChatGroup`, `markChatGroupRead`, `getChatMessages`, `sendChatMessage`
  - Cache helpers: `updateCachedEngagement`
  - `readCachedFeed(cacheKey)`
  - `clearCache()`
- Auth helpers
  - `MemoryTokenProvider`, `StorageTokenProvider` (pass localStorage/AsyncStorage), `RefreshCoordinator`
- Cache utilities
  - `createCache(ttlMs?)`
  - `CacheDB` (if you want to provide your own instance)
- TanStack Query helpers (core)
  - `queryKeys` (posts + feed)
  - `createPostQueryOptions`
  - `createMusicFeedInfiniteQueryOptions` (defaults to `/v1/songs/feed/all`)
  - `createFeedInfiniteQueryOptions` (pass any feed endpoint + cacheKey)
  - `prefetchPost`, `prefetchMusicFeedFirstPage`
  - `createDexieQueryPersister(cache, { key?, maxAge? })`

## Configuration

### Debug Logging

SDK debug logging can be controlled in several ways:

1. **Via constructor option** (recommended):
   ```ts
   const sdk = new CcPlatformSdk({
     baseUrl: "https://api.example.com",
     enableLogging: true, // Enable logging
   });
   ```

2. **Via environment variable** (Node.js):
   ```bash
   SDK_ENABLE_LOGGING=true node your-app.js
   ```

3. **Via browser localStorage** (runtime toggle):
   ```ts
   localStorage.setItem("SDK_ENABLE_LOGGING", "true");
   ```

4. **Via global variable** (browser):
   ```ts
   (window as any).__SDK_ENABLE_LOGGING__ = true;
   ```

The constructor option takes precedence over environment variables. Logging is disabled by default.

## Documentation

Full API documentation is available:

- **Online**: Generated on each release and deployed to GitHub Pages
- **Local HTML**: Run `npm run docs:html` and open `docs/html/index.html`
- **Local Markdown**: Run `npm run docs:md` to generate markdown in `docs/markdown/`

### Generating Documentation

```bash
# Generate HTML documentation (best for browsing)
npm run docs:html

# Generate Markdown documentation (for IDE integration)
npm run docs:md

# Generate both
npm run docs
```

The documentation includes:
- Full API reference with method signatures
- Type definitions with property descriptions
- Code examples for common operations
- Searchable index for quick lookups

## Development

### Building

```bash
npm install
npm run build
```

### Testing

```bash
npm test                  # Unit tests
npm run test:integration  # Integration tests (requires API access)
```

### Publishing

Publishing is automated via GitHub Actions when you create a release. To publish manually:

```bash
npm version patch  # or minor, major
git push --follow-tags
# Then create a GitHub release from the tag
```

## Local Development with `pnpm link`

When developing the SDK alongside a consumer project (e.g. `~/social`), use `pnpm link` to test changes locally before publishing.

### Setup

```bash
# 1. Build the SDK
cd ~/ccsdk
pnpm build

# 2. Link into the consumer project
cd ~/social
pnpm link ~/ccsdk
```

This creates a symlink at `node_modules/@cc-consulting-nv/ccsdk` pointing to `~/ccsdk`. All workspace packages in the monorepo will resolve to the local SDK.

### Development Loop

```bash
# Make changes in ~/ccsdk/src/...
# Then rebuild:
cd ~/ccsdk && pnpm build

# The consumer project picks up changes immediately.
# If the Vite dev server is running, it will hot-reload.
```

**Always run `pnpm build` after SDK changes** — the link points to `dist/`, not the TypeScript source.

### Watch Mode (Optional)

For faster iteration, use the SDK's watch mode in a separate terminal:

```bash
cd ~/ccsdk
pnpm dev   # runs tsc -b --watch
```

### Teardown

When done testing, restore the published version:

```bash
cd ~/social

# Remove the symlink and reinstall
rm node_modules/@cc-consulting-nv/ccsdk
pnpm install

# Clear Vite's dependency cache (if dev server was running)
find apps/ui/node_modules/.vite -type f -delete 2>/dev/null
```

Verify the published version is restored:

```bash
ls -la node_modules/@cc-consulting-nv/ccsdk
# Should point to .pnpm/... not ~/ccsdk
```

### Publish Workflow

1. **Develop** — Edit SDK source, `pnpm build`, test via link
2. **Finalize** — Push SDK branch, merge PR, create GitHub release (triggers auto-publish)
3. **Consume** — In the consumer project: remove link, bump version in all `package.json` files, `pnpm install`

### Files to Update When Bumping ccsdk Version

In `~/social`, update the version in all of these:

- `package.json` (root)
- `pnpm-workspace.yaml` (overrides)
- `apps/ui/package.json`
- `apps/shared/package.json`
- `apps/music-catalog/package.json`
- `apps/sdk-playground/package.json`

Then run `pnpm install` to update the lockfile.

## Design Notes
- Songs are treated as posts with `type = "SONG"`; `/v1/songs/feed/all` returns ULIDs, `/v1/posts` returns full post bodies.
- Persistence stays in IndexedDB (Dexie) to match existing behavior; TanStack Query handles request lifecycle and memory cache.
- The HTTP client is fetch-based and framework-agnostic; inject your own refresh handler to integrate with auth flows.
