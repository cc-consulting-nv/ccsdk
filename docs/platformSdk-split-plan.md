# platformSdk.ts split plan (Alt approach: helper extraction)

`src/platformSdk.ts` = 9790 lines. One class `CcPlatformSdk` with ~250 methods spanning many domains. Split by extracting per-domain helper modules. Class stays single file, methods become 1-line delegators.

## Approach

Each domain becomes module under `src/sdk/<domain>.ts` exporting plain async functions. Functions take explicit deps (`client: HttpClient`, batching state, `log`, etc.) instead of `this`. `CcPlatformSdk` class methods delegate:

```ts
async login(email: string, password: string): Promise<AuthTokens> {
  return authHelpers.login(this.client, this.tokens, this.sessionStore, email, password);
}
```

Pros: minimal type gymnastics, no mixin/prototype magic, each helper unit-testable in isolation, tree-shakeable. Cons: class file shrinks but doesn't disappear — every method keeps a delegator stub (1-3 lines each). Net: class file drops from ~9800 → ~2000 lines of thin shells + state.

Public API surface unchanged. `src/index.ts` keeps `export * from "./platformSdk"`. No consumer breakage.

## Shared utilities — `src/sdk/internal.ts`

Lines 7229-7444 of current `platformSdk.ts` contain shared private helpers used **123 times** across the class. These are NOT a domain — they are foundational. Extract first, before any domain module.

| Helper | Call count | Signature after extraction |
|---|---|---|
| `unwrap<T>(payload)` | 79 | `unwrap<T>(payload: ApiEnvelope<T> \| T): T` (pure) |
| `normalizePost(post)` | 9 | `normalizePost(post: Post): Post` (pure) |
| `cachePost(post)` | 9 | `cachePost(cache: CacheDB, post: Post): Promise<void>` |
| `getPostIdentifier(post)` | (used by cachePost) | `getPostIdentifier(post): Ulid \| null` (pure) |
| `extractAuthTokens(payload, ctx)` | (auth-only, ~5) | `extractAuthTokens(payload, ctx): AuthTokens` (pure) |
| `extractNextCursor(payload)` | (feeds, ~3) | `extractNextCursor(payload): string \| null \| undefined` (pure) |
| `hasAuthTokens(tokens)` | (session) | `hasAuthTokens(tokens): tokens is AuthTokens` (pure) |

Every domain module imports `{ unwrap, normalizePost, cachePost, ... } from "./internal"`. No `this`, no Deps thread for these.

## Constants — `src/sdk/constants.ts`

`private readonly` constants that helpers need. Module-level `const` instead of class state.

- `postBatchDelay = 100`
- `userBatchDelay = 50`
- `userBatchMaxSize = 20`
- `engagementBatchDelay = 100`
- `negativeCacheTtlMs = 60 * 1000`

## File map by domain

Line ranges reference current `src/platformSdk.ts`.

| Lines | Target file | Methods |
|---|---|---|
| 104-240 | `src/types/moderation.ts` (verify against `src/types/index.ts` re-export pattern) | — |
| 242-380 | `src/sdk/errors.ts` | error classes + helpers |
| 390-480 | `src/sdk/options.ts` | `CcPlatformSdkOptions` interface |
| 482-780 | stay in `platformSdk.ts` | class shell, ctor, state, `log`, session, acting context |
| 780-995 | `src/sdk/currentUser.ts` | getCurrentUser, updateCurrentUser, email change, username check (5) |
| 995-1383 | `src/sdk/auth.ts` | login/oauth/magic/register/logout/refresh/password + private `performRefreshToken` (14) |
| 1385-1577 | `src/sdk/posts.ts` (group A: fetch/batch) | getPostByUlid, fetchPostsBatch + private `flushPostBatch` |
| 1579-2010 | `src/sdk/feeds.ts` | fetchFeedCount, fetchFeedPage + all fetch*Feed (13) |
| 2011-2034 | `src/sdk/cache.ts` | clearCache, invalidateUserCache (2) |
| 2036-2289 | `src/sdk/media.ts` | presignedUploadUrl, uploadMediaFile, createMultipartUpload, watchPostProcessing + private `uploadDirect`, `validateMediaFile` (7) |
| 2291-2835 | `src/sdk/posts.ts` (group B: CRUD/engagement) | CRUD, reactions, reposts, votes, ratings, pins + private `updateCachedPostPoll` (~30) |
| 2836-3092 | `src/sdk/engagement.ts` | fetchEngagementSnapshot, fetchEngagement + private `flushEngagementBatch`, `executeEngagementFetch` (4) |
| 3093-3232 | `src/sdk/notifications.ts` | get/count/markRead/delete (7) |
| 3235-3393 | `src/sdk/comments.ts` | fetch/create/delete/getPost (4) |
| 3395-3879 | `src/sdk/playlists.ts` | playlist CRUD + featured artists + private `refetchPlaylistOrFallback` (18) |
| 3881-4335 | `src/sdk/radio.ts` | radio stations (13) |
| 4337-4602 | `src/sdk/profiles.ts` (part 1) | getUserProfile*, profile feeds, batch + private `normalizeUserProfile` (13) |
| 4604-4690 | `src/sdk/follows.ts` | follow/unfollow username + ulid (4) |
| 4691-4756 | `src/sdk/invites.ts` | inviteByEmail* (2) |
| 4757-4912 | `src/sdk/blocks.ts` | block/mute/ban + reports + private `invalidateUserCacheByUsername`, `refreshCurrentUserCache`, `hasFreshNegativeCache` (12) |
| 4915-5175 | `src/sdk/profiles.ts` (part 2) | fetchUserProfileById, observeUserProfile + private `queueUserFetch`, `flushUserBatch`, `isUserStale`, `hydrateUsersFromHints` (6) |
| 5176-5468 | `src/sdk/search.ts` | searchUsers/audio/hashtags/posts + private `hydrateSearchResults` (10) |
| 5470-5763 | `src/sdk/badges.ts` | badges + roles + admin (13) |
| 5765-5824 | `src/sdk/settings.ts` | global/user settings, notification types (3) |
| 5826-5868 | `src/sdk/uploadLegacy.ts` | importSong, uploadFile (2) |
| 5870-6106 | `src/sdk/analytics.ts` | user analytics + CEO dashboard (10) |
| 6108-6122 | `src/sdk/push.ts` | createPushSubscription, deletePushSubscription (2) |
| 6124-6240 | `src/sdk/profiles.ts` (part 3) | getProfileLikes, updateCachedEngagement |
| 6242-6342 | `src/sdk/songs.ts` | getSongDetail, createSong, channels, mix queue (5) |
| 6344-6483 | `src/sdk/chat.ts` | chat groups, DMs, messages (7) |
| 6485-6664 | `src/sdk/moderation.ts` | queue + feed + actions + stats (9) |
| 6666-6776 | `src/sdk/genres.ts` | prefs + trending genres/users/hashtags/songs (7) |
| 6778-6830 | `src/sdk/signup.ts` | config, demographics, agreements (4) |
| 6832-6939 | `src/sdk/passkeys.ts` | passkey* (7) |
| 6941-7005 | `src/sdk/polls.ts` | poll* (5) |
| 7007-7199 | `src/sdk/trending.ts` | trendingGet* + videos/bursts (6) |
| 7201-7218 | `src/sdk/push.ts` (merge with above) | pushNotificationRegister |
| 7220-7223 | `src/sdk/branding.ts` | brandingGet (1) |
| 7229-7444 | `src/sdk/internal.ts` | unwrap, normalizePost, cachePost, getPostIdentifier, extractAuthTokens, extractNextCursor (6, used 123x) |
| 7446-7728 | `src/sdk/managedUsers.ts` | delegation (6) |
| 7730-7842 | `src/sdk/views.ts` | sendAudio/Video views (3) |
| 7844-7897 | `src/sdk/smartPlaylists.ts` | daily mixes, discover weekly, music prefs (4) |
| 7899-8012 | `src/sdk/ads.ts` | audio ads, boosts, impressions, clicks (6) |
| 8014-8161 | `src/sdk/blog.ts` | blog CRUD + search (9) |
| 8164-8606 | `src/sdk/groups.ts` | groups CRUD + moderation + private `fetchGroupFromNetwork` (19) |
| 8608-8695 | `src/sdk/referrals.ts` | recordReferralVisit, feedback, bug reports (3) |
| 8697-9651 | `src/sdk/businesses.ts` | businesses + reviews + collections + analytics + private `serializeCollectionPayload` (31) |
| 9655-9789 | `src/sdk/stories.ts` | story* (8) |

Note: `posts.ts` groups A and B are non-contiguous in source but become **one module** in target. Line ranges are extraction roadmap, not target structure.

## Helper signature pattern

Three flavors depending on dep count.

### Pure (no state, no client)

```ts
// src/sdk/internal.ts
export function unwrap<T>(payload: ApiEnvelope<T> | T): T {
  if (payload && typeof payload === "object" && "data" in (payload as any)) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
}
```

Class:
```ts
import { unwrap } from "./sdk/internal";
// inside helper that lives in another module: import { unwrap } from "./internal";
```

### Client-only

```ts
// src/sdk/invites.ts
import type { HttpClient } from "../httpClient";

export async function inviteByEmail(
  client: HttpClient,
  email: string,
): Promise<{ message: string; success: boolean }> {
  return client.post("/v1/invites", { email });
}
```

Delegator:
```ts
async inviteByEmail(email: string) {
  return inviteHelpers.inviteByEmail(this.client, email);
}
```

### Stateful (batching queues, cache, log)

Pass a `Deps` object. Use **lazy getters** for state that can be rebuilt (cache via `reopenCache`).

```ts
// src/sdk/posts.ts
export interface PostsDeps {
  client: HttpClient;
  getCache: () => Promise<CacheDB>;          // lazy — survives reopenCache
  log: (...args: unknown[]) => void;
  batchQueue: Set<Ulid>;                      // mutable refs shared with class
  pendingResolvers: Map<Ulid, Array<{ resolve: (p: Post) => void; reject: (e: unknown) => void }>>;
  getBatchTimer: () => number | null;
  setBatchTimer: (id: number | null) => void;
}
```

Class holds state, exposes one Deps builder per domain, allocated **once in ctor** (not per call) to avoid hot-path overhead:

```ts
private postsDeps!: PostsDeps;

constructor(...) {
  // ... existing ctor body ...
  this.postsDeps = {
    client: this.client,
    getCache: () => this.cachePromise,
    log: this.log.bind(this),
    batchQueue: this.postBatchQueue,
    pendingResolvers: this.postPendingResolvers,
    getBatchTimer: () => this.postBatchTimer,
    setBatchTimer: (id) => { this.postBatchTimer = id; },
  };
}

async getPostByUlid(ulid: Ulid, forceRefresh = false) {
  return postHelpers.getPostByUlid(this.postsDeps, ulid, forceRefresh);
}
```

## State that must stay on class

`private` fields stay on `CcPlatformSdk`, exposed to helpers via Deps builders.

**Mutable state (reference-shared with helpers):**
- `postBatchQueue`, `postPendingResolvers`, `postBatchTimer`
- `userBatchQueue`, `userPendingResolvers`, `userBatchTimer`
- `userRefreshInFlight`, `groupRefreshInFlight`
- `userNotFound`, `groupNotFound` (negative cache)
- `engagementBatchQueue`, `engagementPendingResolvers`, `engagementBatchTimer`, `engagementInFlight`
- `notificationCountsInFlight`
- `refreshSessionInFlight`
- `actingContext`

**Singletons:**
- `tokens`, `sessionStore`, `cachePromise`, `client`, `refreshCoordinator`

**Constants** → moved to `src/sdk/constants.ts` (see above).

## Cross-module call graph

Measured: 135 `this.x()` calls cross domain boundaries. Distribution:

| Callee | Count | Owner module | Callers |
|---|---|---|---|
| `unwrap` | 79 | internal.ts | everywhere (pure import) |
| `fetchFeedPage` | 17 | feeds.ts | profiles, playlists, trending, posts |
| `fetchPostsBatch` | 12 | posts.ts | feeds (hydration) |
| `normalizePost` | 9 | internal.ts | search, feeds, posts (pure import) |
| `cachePost` | 9 | internal.ts | posts, feeds, search (takes `cache` arg) |
| `getPostByUlid` | 7 | posts.ts | intra-module mostly |
| `fetchEngagement` | 1 | engagement.ts | feeds (hydration) |

### Confirmed circular: feeds ↔ posts

- feeds.ts needs `fetchPostsBatch` (posts.ts) for hydration
- posts.ts needs `fetchFeedPage` (feeds.ts) for `getReposts`, `getQuotes`, `getBookmarks`, `getLikedPosts`

**Resolution: one-way module import + Deps callback for back-edge.**

- feeds.ts directly imports `{ fetchPostsBatch } from "./posts"` — one-way dep.
- posts.ts does NOT import feeds.ts. Posts methods needing `fetchFeedPage` receive it via Deps:

```ts
// posts.ts
export interface PostsDeps {
  // ... existing ...
  fetchFeedPage: (cursor: string | null | undefined, endpoint: string, cacheKey: string) => Promise<FeedPage>;
}

export async function getReposts(deps: PostsDeps, postUlid: Ulid, cursor?: string | null) {
  return deps.fetchFeedPage(cursor, `/v1/posts/${postUlid}/reposts`, `reposts-${postUlid}`);
}
```

Class wires it up:

```ts
this.postsDeps = {
  // ...
  fetchFeedPage: (cursor, endpoint, key) => feedsHelpers.fetchFeedPage(this.feedsDeps, cursor, endpoint, key),
};
```

Same pattern for feeds → engagement (single call site, also via Deps callback).

### Other one-way deps (direct import safe)

- profiles.ts → feeds.ts (uses `fetchFeedPage` for profile feeds)
- playlists.ts → feeds.ts
- trending.ts → feeds.ts
- search.ts → internal.ts (`normalizePost`)
- comments.ts → posts.ts (returns Post, may call `getPostByUlid`)
- All → internal.ts, constants.ts

## Execution order

1. **Setup foundation** (no behavior change):
   - Create `src/sdk/internal.ts` with `unwrap`, `normalizePost`, `cachePost`, `getPostIdentifier`, `extractAuthTokens`, `extractNextCursor`. Class methods now call `internal.unwrap(x)` instead of `this.unwrap(x)`. Replace all 123 sites.
   - Create `src/sdk/constants.ts` with batch/cache constants. Replace `this.postBatchDelay` references.
   - Move types: lines 104-240 → `src/types/moderation.ts`. Verify `src/types/index.ts` re-exports.
   - Move `CcPlatformSdkOptions` → `src/sdk/options.ts`. Move `InvalidAuthResponseError` + helpers → `src/sdk/errors.ts`.
2. **Pilot domains** (tiny, validate pattern):
   - `uploadLegacy` (2)
   - `invites` (2)
   - `push` (3, merge 6108-6122 and 7201-7218)
   - `referrals` (3)
   - `views` (3)
   - `settings` (3)
   - `cache` (2)
3. **Run tests after each.** Confirm `dist/platformSdk.js` still emits and consumers resolve.
4. **Mid-size domains**: `comments`, `signup`, `polls`, `genres`, `notifications`, `passkeys`, `chat`, `analytics`, `moderation`, `search`, `follows`, `blocks`, `badges`, `radio`, `branding`, `songs`, `smartPlaylists`, `ads`, `blog`, `stories`, `managedUsers`, `currentUser`, `auth`.
5. **Large + circular domains last**: `engagement` (paired with feeds), `posts`, `feeds` (resolve cycle via Deps callback), `playlists`, `profiles`, `groups`, `businesses`.

## Validation per step

After each domain extraction:
- `npm run build` (tsc emit clean)
- `npm test` (full suite)
- `git diff --stat src/platformSdk.ts` (line count dropping)
- `grep -nE '\bthis\.[a-zA-Z]' src/sdk/<file>.ts` — must be empty; or rely on TS compiler errors (helpers don't declare `this` param)
- For circular-risk pairs: `madge --circular src/` or visual inspection of imports

## Risks

- **Test imports**: `tests/*.test.js` import from `../dist/platformSdk.js`; integration tests import `../../src/platformSdk.ts`. Class stays in same path → both consumers covered. No path changes.
- **Bundle size**: helpers add Deps object alloc once in ctor (not per call). Tree-shaking improves since unused domains drop entirely.
- **Circular imports**: feeds ↔ posts handled via Deps callback (above). Other pairs to watch: engagement ↔ feeds (same pattern), comments → posts (one-way verified). Validate with `madge`.
- **`query.ts` typeof import**: `src/query.ts:26` does `import type { CcPlatformSdk } from "./platformSdk"`. Still works — class still exported from same path.
- **`reopenCache`**: rebuilds `cachePromise`. Deps builders use lazy `getCache: () => this.cachePromise` (function ref, not snapshot). Each helper call gets the current cache.

## End state

- `src/platformSdk.ts`: ~2000 lines (class shell + 250 delegator stubs + Deps builders in ctor)
- `src/sdk/internal.ts`: shared utilities (6 functions, used 123x)
- `src/sdk/constants.ts`: module-level constants
- `src/sdk/options.ts`, `src/sdk/errors.ts`: types/utilities
- `src/sdk/*.ts`: ~40 domain modules, 50-800 lines each
- Zero public API change
