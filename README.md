# CC Platform SDK

Cache-aware TypeScript SDK for the CC-API that mirrors the Social UI's IndexedDB + TanStack Query approach. It hydrates music feeds from `/v1/songs/feed/all`, fetches full posts via `/v1/posts`, and keeps ULID ordering cached for offline/instant navigation.

## Features
- HTTP client with token injection and refresh hook (pluggable fetch).
- Pluggable token provider (memory by default) for easy integration with your auth storage; refresh coordinator serializes concurrent refreshes; optional storage-backed provider.
- Async session-store support for native secure storage and other non-blocking persistence backends.
- Optional cookie-backed refresh mode for web apps using in-memory bearer tokens plus `httpOnly` refresh cookies.
- Dexie-backed cache for posts and feed ULID ordering.
- Batch post hydration (`/v1/posts`) for efficient feed rendering (ULIDs come from `/v1/songs/feed/all` by default).
- Query-core helpers for framework adapters (React Query, Vue Query, Svelte Query).

## Installation

This package is published to GitHub Packages. Configure npm to use GitHub Packages for the `@cc-consulting-nv` scope.

### 1. Configure npm registry

Create or update `.npmrc` in your project root:

```
@cc-consulting-nv:registry=https://npm.pkg.github.com
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
npm install @cc-consulting-nv/ccsdk

# pnpm
pnpm add @cc-consulting-nv/ccsdk

# yarn
yarn add @cc-consulting-nv/ccsdk
```

## Quickstart

```ts
import { CcPlatformSdk, createMusicFeedInfiniteQueryOptions, createPostQueryOptions } from "@cc-consulting-nv/ccsdk";
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
  - `MemoryTokenProvider`, `StorageTokenProvider`, `HybridTokenProvider`, `RefreshCoordinator`
  - Session helpers: `setSession`, `restoreSession`, `clearSession`, `refreshSession`
  - Session readiness: `ready()` (await before firing authed requests on load)
  - Multi-profile switching: `SessionManager`, `createStorageProfileRegistry`
  - Token validity: `isAccessTokenValid(skewMs?)`, `isAccessTokenExpired(skewMs?)` (expiry-aware, vs presence-only `isAuthenticated()`)
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

### Auth Session Storage

The SDK supports two complementary auth persistence layers:

- `tokenProvider` for synchronous storage strategies such as in-memory or Web Storage
- `sessionStore` for async persistence such as secure native storage or IndexedDB-backed session adapters

```ts
const sdk = new CcPlatformSdk({
  baseUrl: "https://api.example.com",
  sessionStore: {
    async loadTokens() {
      return await secureStore.get("session");
    },
    async saveTokens(tokens) {
      await secureStore.set("session", tokens);
    },
    async clearTokens() {
      await secureStore.delete("session");
    },
  },
});
```

### Multi-Profile Session Switching

`SessionManager` keeps several accounts signed in at once and swaps the active one (Facebook/Instagram style). Each account gets its own `CcPlatformSdk`, its own token storage, and its own IndexedDB cache database, so no viewer-specific state leaks between profiles.

```ts
import { SessionManager } from "@cc-consulting-nv/ccsdk";

const sessions = new SessionManager({
  baseUrl: "https://api.example.com",
  // Called once per account. Namespace your keys by profileId, and wrap this
  // if the platform requires encryption at rest.
  createSessionStore: (profileId) => ({
    async loadTokens() {
      return await secureStore.get(`session:${profileId}`);
    },
    async saveTokens(tokens) {
      await secureStore.set(`session:${profileId}`, tokens);
    },
    async clearTokens() {
      await secureStore.delete(`session:${profileId}`);
    },
  }),
});

await sessions.ready();          // restores the last active profile
sessions.active;                 // the active account's CcPlatformSdk
sessions.list();                 // profiles for the switcher UI

// Add an account — drive any auth flow into the staged instance
await sessions.addProfile((sdk) => sdk.login(email, password));

await sessions.switchTo(userUlid);
await sessions.remove(userUlid); // signs out only that account
```

Notes:

- Profile identity is the account's user ULID. Re-adding a known account re-installs fresh tokens and switches to it, which is how you recover a profile whose refresh was rejected (`isTokenExpired`).
- **The per-profile store is the session carrier, not a refresh cookie.** One httpOnly cookie cannot represent several concurrent sessions — it names whichever account authenticated last, so a cookie-first host will answer a refresh for account A with account B's bearer. `useRefreshCookie: true` is safe to keep for single-session back-compat (the SDK always sends `refresh_token` in the body and prefers each profile's own stored session), but switching is only correct because each profile persists its own tokens.
- Persist `accessToken` and `expiresAt` as well as `refreshToken` where you can. Refresh-only stores work — the manager mints a bearer on demand — but each restore costs a `/auth/refresh` round trip, and with no `expiresAt` the SDK cannot distinguish a live bearer from a dead one so it refreshes defensively.
- `switchTo` guarantees a live bearer: it restores, and refreshes from that profile's own refresh token if needed. If no bearer can be established it flags the profile `isTokenExpired` and **throws**, leaving the previously active account active rather than activating a session that cannot make requests.
- Each profile's cache database is named `${dbNamePrefix}:${userUlid}`.
- Registry records carry display metadata only, never tokens, so the default `localStorage` registry is safe. Override with `registryStore`.
- A switch in one tab is followed by the others; opt out with `disableCrossTabSync: true`.
- Maximum profile counts and badge/role gating are deliberately **not** enforced here — that is app policy.
- Use one TanStack Query client per profile. `queryKeys` have no account dimension, so a shared client would serve one account's cached data to another.

### Cookie-Backed Web Refresh

For browser apps that keep the access token in memory and store the refresh token in an `httpOnly` cookie:

```ts
const sdk = new CcPlatformSdk({
  baseUrl: "https://api.example.com",
  useRefreshCookie: true,
});
```

In this mode, login/logout/refresh auth calls include `credentials: "include"`, while normal API calls continue to use the bearer access token.

### Cross-Tab Refresh

The API rotates refresh tokens, so two tabs calling `/auth/refresh` with the same token or cookie at once leave one of them with `invalid_grant`. In a browser (including Capacitor/WebViews) with the Web Locks API (`navigator.locks`), `refreshToken()` holds an exclusive lock around the network call, so tabs of the same origin refresh one at a time. Within a tab, concurrent refreshes still share one in-flight call (and one lock request).

- After getting the lock, the SDK re-reads stored tokens. If another tab cleared them while this tab waited (and this isn't cookie mode), the refresh returns `null` without a request. With a `sessionStore`, an empty store falls back to this tab's in-memory tokens, so one request goes out with the old refresh token unless the clear came with a sign-out signal. If another tab rotated the refresh token, the new one is sent. If that tab also left a new, live access token this tab can read (`StorageTokenProvider`, or a `sessionStore` that persists bearers) and both bearers decode to the same JWT `sub`, no request is made. Opaque or missing access tokens never match, so then (cookie mode after a reload, non-JWT bearers) the SDK refreshes over the network. If the store read throws, the refresh returns `null` (transient, no sign-out).
- If a sign-out (local or from another tab) happens while waiting for the lock, the cookie-mode retry delay or the 1 s 5xx retry delay, the refresh returns `null` without calling `/auth/refresh`. A sign-out during any refresh request means no further retry, and the refresh returns `null` rather than throwing `AuthSessionExpiredError`, so the app's logout handling doesn't run a second time. The same happens if, after the lock wait, the stored access token and the one this refresh started with decode to different JWT `sub`s (another tab signed in as someone else): nothing is sent or adopted.
- The lock is only used where `window` and `document` exist. Node also has `navigator.locks`, but on a server one process-wide lock would serialise every user's refresh, so Node/SSR refreshes run unlocked, as do browsers without `navigator.locks` (older Safari). `crossTabRefreshLock` overrides this.
- If the lock isn't granted within `refreshLockTimeoutMs`, the refresh runs without it. The wait is never shorter than one holder's worst-case hold plus 1 s: default and floor 3 × `refreshRequestTimeoutMs` + max(1 s, 0.8 s + `refreshRetryDelayMs`) + 1 s (26.2 s with defaults). A smaller explicit value is raised to that floor.
- On a 400/401 `invalid_grant`, before signing out the SDK re-reads the shared store (the `sessionStore`, else the token provider) for up to ~800 ms. If it now holds a different refresh token (another tab won the rotation), the SDK adopts the stored pair. With a `sessionStore` (one per account) any stored access token qualifies, since adopting sends nothing to the server; without one the access token must be new, live, and decode to the same JWT `sub` as this session's. Otherwise it retries once with the stored refresh token, but only if the stored access token and this session's decode to the same JWT `sub`; if not (another user, or opaque/missing tokens) the refresh returns `null` without a request and leaves the store alone. Without a `sessionStore`, a stored access token equal to this tab's own proves nothing: with the default `HybridTokenProvider` only the refresh token is shared, so the access token read back is this tab's in-memory one, and the refresh token next to it may belong to a user another tab just signed in. That case also returns `null` without a request; the next refresh sends the stored token as usual. If that retry fails for a transient reason (timeout, network error, 5xx, a 4xx without `invalid_grant`), the original `invalid_grant` stands. The session is cleared only when the store still holds a token the server rejected, or nothing. A store read that throws at any of these points makes the refresh return `null` instead.
- Each `/auth/refresh` request is aborted after `refreshRequestTimeoutMs` (default 8000), or sooner when the hold budget below runs out. A timeout counts as transient: the refresh returns `null`, nothing is cleared, and the lock is released.
- The server may have rotated the token on a request the SDK timed out. After a timeout the SDK sets a marker (in memory, plus `<lock name>:refresh-timeout-at` with an epoch ms in storage, never a token), and the next refresh in any tab that ends in `invalid_grant` within 2 × `refreshRequestTimeoutMs` of the timeout returns `null` instead of signing out. The marker is cleared by any successful refresh or adoption, by sign-out (local or from another tab), by any new session (`setSession`, login), and by that one transient pass, so a dead token signs out on the attempt after. In body-token mode a rotation whose response was lost can't be recovered; the pass delays the sign-out by one attempt.
- Worst-case lock hold: at most 3 POSTs per refresh, within a budget of 3 × `refreshRequestTimeoutMs` + max(1 s, 0.8 s + `refreshRetryDelayMs`) (25.2 s with defaults). Once the budget is spent no further POST is sent. A `sessionStore` read that hangs after the last POST is not bounded.
- Cookie mode only: if a refresh answers 400 or 401 with `invalid_grant` (or `reason: "refresh_token_rotated"` / `retryable: true`), the SDK waits `refreshRetryDelayMs` (default 400) and retries once. The API reads the refresh cookie only when the body has no `refresh_token`, so the retry never resends a body token the server just rejected: it sends a stored token only if it is a different one and the stored access token decodes to this session's JWT `sub`, else no body, and the server uses the cookie. A different stored token whose owner can't be checked (no `sessionStore` and the stored access token is this tab's own, as above) is not sent and the refresh returns `null`. The no-body retry runs only when this session holds a JWT access token with a `sub`, and its answer is installed only if its access token decodes to the same `sub`; otherwise nothing is installed and the refresh returns `null`. Without a decodable access token (e.g. a reload with a refresh-only store) there is no cookie-only retry, because the shared cookie may belong to another `SessionManager` profile. SDKs built by `SessionManager` never send the no-body retry (`cookieOnlyRefreshRetry: false`): profiles share one cookie, so it could rotate another profile's session. There an `invalid_grant` with nothing newer in the profile's store signs out, as before this retry existed. A second `invalid_grant` signs out as before; a retry that fails transiently (timeout, network error, 5xx) keeps the first `invalid_grant`, so a dead session still signs out. Network errors, 5xx (which have their own single retry) and a 401 without `invalid_grant`, `refresh_token_rotated` or `retryable: true` are not retried by this path.
- The default lock name, and so the `last-refresh-at` key, includes `dbName`, which `SessionManager` sets per profile, so profiles don't block each other or skip each other's retry delay. Cookie mode caveat: profiles in one browser share a single refresh cookie jar. The SDK sends each profile's own refresh token in the body, so the lock is still per profile, but a host that only reads the cookie can still see two profiles race on it.
- Each successful refresh writes `<lock name>:last-refresh-at` (epoch ms, no token values) to the SDK's storage.

| Option | Default | |
|--------|---------|-|
| `crossTabRefreshLock` | `'auto'` | `'auto'`: lock only in a browser-like environment. `true`: lock wherever `navigator.locks` exists, Node included. `false`: never lock. |
| `refreshLockName` | `cc-refresh:<baseUrl>:<dbName>` | Lock name (also prefixes the `last-refresh-at` key). The default includes the API base URL and `dbName` so SDKs for different API hosts or `SessionManager` profiles in one origin don't wait on each other. |
| `refreshLockTimeoutMs` | `26200` (derived) | Max wait for the lock before refreshing without it. Never below 3 × `refreshRequestTimeoutMs` + max(1000, 800 + `refreshRetryDelayMs`) + 1000. |
| `refreshRetryDelayMs` | `400` | Cookie mode: delay before the single `invalid_grant` retry. Clamped to 0-5000; NaN uses the default. |
| `cookieOnlyRefreshRetry` | `true` | Cookie mode: allow the `invalid_grant` retry with no body token. `SessionManager` sets `false` for its profiles. |
| `refreshRequestTimeoutMs` | `8000` | Abort a `/auth/refresh` request after this long. Treated as transient. 0, negative or NaN use the default; capped at 600000. |

Apps that pass their own `onRefreshTokens` and do the fetch themselves (instead of calling `sdk.refreshToken()`) bypass the lock.

Every transient case above makes `refreshToken()` return `null`. An `onRefreshTokens` that calls it must turn `null` into `TransientRefreshError`, not a plain `Error`: the HTTP client treats an error without a numeric status as a definitive rejection and calls `onUnauthorized`, which signs the user out. `SessionManager` already does this.

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
