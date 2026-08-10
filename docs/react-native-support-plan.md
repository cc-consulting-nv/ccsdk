# React Native support plan

Make `@cc-consulting-nv/ccsdk` run on React Native without forking. One package, two platform
adapters, shared by the existing Vue web app (`~/gunclub-ui`) and the planned RN app
(`~/cc-mobile`).

**Context:** RN port of `~/gunclub-ui`. Full port plan:
`/mnt/d/dev/cc-creator-desktop/artifacts/react-native-port-plan.md`.

**Estimate: 3–5 days.** The cache adapter is essentially all of it.

---

## Audit result — the SDK is already close

Measured file by file (2026-08-10). `tsconfig.json` targets **ES2021** with **no `"lib": ["DOM"]`**
and no `"types"` entry, so the package was never hard-wired to browser typings.

### Files with zero browser API usage — 7 of 15

`httpClient.ts` · `postProcessing.ts` · `query.ts` · `types.ts` · `types/blog.ts` ·
`types/business.ts` · `utils/s3Key.ts`

### Files whose only hits are doc comments — no code change

| File | Hits | Note |
|---|---:|---|
| `auth.ts` | 7 | All JSDoc. `StorageTokenProvider` already takes a `StorageLike` interface — inject MMKV and it works unchanged. |
| `realtime.ts` | 1 | Example in a comment. |
| `index.ts` | 3 | Package-level JSDoc. |
| `persister.ts` | 7 | Comments only (grep for `localStorage` matched prose). |

### Runtime dependencies

| Dependency | RN status |
|---|---|
| `@tanstack/query-core` 5.100.14 | Fine — platform-agnostic |
| `laravel-echo` ^2.3.4 | Fine |
| `pusher-js` ^8.5.0 | Fine |
| `@msgpack/msgpack` ^3.1.3 | Fine — pure JS |
| **`dexie` ^4.2.1** | **Blocker** — the only one |

---

## The three fixes

### Fix 1 — Cache behind an adapter interface (the real work)

`cache/cacheDB.ts` (1,266 LOC) and `blobStore.ts` (174 LOC) are the only IndexedDB consumers.

**Why this is smaller than it looks:** `platformSdk.ts` references the `CacheDB` *type* only
**4 times**, and calls exactly **27 distinct methods**. The interface is already implicitly defined
by usage — extracting it is mechanical.

```
cache.appendToFeedResource  cache.clearAll        cache.deleteGroup
cache.deletePost            cache.deleteUser      cache.fenceWrites
cache.getFeedResource       cache.getGroupEntry   cache.getPost
cache.getPosts              cache.getUser         cache.getUserByUsername
cache.getUserEntry          cache.getUsers        cache.invalidatePost
cache.isPastRefreshTTL      cache.observeUser     cache.reopen
cache.setFeedResource       cache.setGroup        cache.setGroups
cache.setMetadata           cache.setPost         cache.setPosts
cache.setUser               cache.setUsers        cache.unfenceWrites
```

**Steps**

1. Extract `interface CacheAdapter` in `src/cache/cacheAdapter.ts` from those 27 methods.
   Derive it from the existing class — do not redesign the API.
2. Rename the current class to `DexieCacheAdapter implements CacheAdapter`, unchanged internally.
   Keep `CacheDB` as a deprecated type alias so `~/gunclub-ui` keeps compiling.
3. Add `SqliteCacheAdapter implements CacheAdapter` using `@op-engineering/op-sqlite`.
   Port the **v6 schema only** — skip the 6-version migration chain; fresh installs have no
   IndexedDB data to migrate.
4. `createCache()` takes an adapter (or picks a default by platform), so consumers are unchanged.

**Semantics that must survive the port.** These are the parts a naive key-value cache loses:

- **Two-tier TTL.** Soft refresh at `DEFAULT_REFRESH_TTL_MS` (30 min): the entry is *still
  returned* but triggers a background refresh (stale-while-revalidate). Hard TTL 24h evicts.
  `lastCheckedAt` drives the soft tier and is distinct from `cachedAt`.
- **Access tracking.** `lastAccessed` / `accessCount` feed LRU eviction.
- **Feed pagination.** `feedResources` holds an ordered ULID array + cursor; posts are stored once
  and referenced. Do not denormalize.
- **`fenceWrites` / `unfenceWrites`.** Write-fencing during sign-out. Must behave identically or
  sign-out races reappear.
- **`observeUser` / `liveQuery`.** Dexie pushes updates on write; SQLite does not. On RN, map this
  onto TanStack Query's `invalidateQueries` / `setQueryData`, which the RN app already runs.
  **This is the least mechanical part of the port — budget for it.**

Store payloads as JSON `TEXT` rather than shredding models into columns — matches Dexie's
object-store shape, and 187 types' worth of DTOs is not worth normalizing. Index `cachedAt` and
`lastAccessed` for the eviction sweep.

> `ponytail:` JSON blobs, not normalized columns. Normalize a table only when a query needs to
> filter on a field inside the blob.

**`blobStore.ts`** — same treatment, smaller. Guarded by `typeof indexedDB !== "undefined"`
(line 53), so it already degrades rather than crashing. RN impl backed by the filesystem.

### Fix 2 — Drop `window.` from two `setTimeout` calls

| File | Line | Current |
|---|---:|---|
| `platformSdk.ts` | 1847 | `this.postBatchTimer = window.setTimeout(() => {` |
| `platformSdk.ts` | 3295 | `this.engagementBatchTimer = window.setTimeout(() => {` |

Bare `setTimeout` works in browsers, RN, and Node. **Two-character deletion, twice.**

Note the return type: browser `window.setTimeout` returns `number`, Node's returns `Timeout`.
Type the timer fields as `ReturnType<typeof setTimeout> | null` to stay portable.

### Fix 3 — Replace the `online` event listener

`multipartUpload.ts` lines 492 and 495:

```ts
window.removeEventListener("online", onOnline);
window.addEventListener("online", onOnline);
```

The surrounding `navigator.onLine` checks (lines 432, 486) are already guarded with
`typeof navigator !== "undefined"`, so only the listener needs work.

Inject a connectivity source rather than importing NetInfo into the SDK — keeps
`@react-native-community/netinfo` out of the package's dependencies and off the web app's bundle:

```ts
export interface ConnectivitySource {
  isOnline(): boolean;
  onOnline(cb: () => void): () => void;  // returns unsubscribe
}
```

Web impl wraps `window.addEventListener("online", …)`; RN impl wraps NetInfo. ~10 lines each.

---

## Also needs an adapter — `actingContext` persistence

Not a crash, a **silent feature loss**, so it is easy to miss in testing.

`platformSdk.ts` lines 1037–1081 persist `actingContext` to `localStorage`, each access guarded by
`typeof localStorage !== "undefined"`. On RN `localStorage` is undefined, so the guards hold and
nothing throws — but acting-context selection stops surviving app restarts.

Fix with the pattern the SDK already uses: accept a `StorageLike` in the constructor (the same
interface `StorageTokenProvider` takes) and use it for `actingContext` instead of reaching for the
global. Line 599 already falls back to a no-op storage object when `localStorage` is missing —
extend that to be injectable.

`SDK_ENABLE_LOGGING` (line 368) reads `localStorage` too. Guarded, low-stakes, leave it.

---

## Non-issues — verified, no action

- **`BroadcastChannel`** (`platformSdk.ts` 582, 624–625) — cross-tab sign-out propagation, guarded
  by `typeof BroadcastChannel !== "undefined"`. No tabs on mobile; it correctly no-ops.
- **`document.querySelector`** (`platformSdk.ts` 8373) — inside a JSDoc example.
- **`FormData`** — available in RN.

---

## Sequence

1. ~~**Connectivity + timers** (Fixes 2 and 3)~~ — **done.**
2. ~~**`CacheAdapter` interface extraction**~~ — **done.**
3. ~~**`StorageLike` for `actingContext`**~~ — **done.**
4. **`SqliteCacheAdapter`** — the bulk of the work. **Not started.**
5. **`blobStore` RN impl.** **Not started.**

### Status (2026-08-10) — steps 1–3 landed

Steps 4–5 are deliberately not started: `@op-engineering/op-sqlite` is a native module that cannot
be installed, built, or exercised in the WSL dev environment, so the adapter parity suite — which
this plan calls "the check that matters" — cannot run. Start them from `~/cc-mobile`, where a
device or simulator can actually execute the result.

The **open decision below is now settled: option 1.** `observeUser`/`observeGroup` stay on
`CacheAdapter` returning `Observable`. The Dexie adapter is unchanged; the RN adapter maps them
onto TanStack Query invalidation behind the same signature, so no interface churn when it lands.

What changed:

| Area | Change |
|---|---|
| `src/platform/connectivity.ts` (new) | `ConnectivitySource` + `WebConnectivitySource` + `defaultConnectivitySource`. |
| `src/multipartUpload.ts` | Takes an optional `connectivity` source; the `online` listener and both `navigator.onLine` checks now route through it. |
| `src/platformSdk.ts` | Both `window.setTimeout` → bare `setTimeout`; timer fields retyped `ReturnType<typeof setTimeout> \| null`. New `storage?: StorageLike` option, resolved once and shared by the default token provider and `actingContext`. `CacheDB` type references → `CacheAdapter`. |
| `src/cache/cacheAdapter.ts` (new) | `CacheAdapter` interface — the **full 37-method public surface**, not just the 27 `platformSdk.ts` calls (see note below). |
| `src/cache/cacheDB.ts` | `CacheDB` class renamed `DexieCacheAdapter implements CacheAdapter`, internals untouched. `CacheEntry`/`FeedResource`/`NotificationFeedResource` now exported (the interface references them). `createCache()` takes an optional adapter. `CacheDB` retained as a deprecated value+type alias. |

**Correction to this plan's audit:** the 27 methods listed above are what `platformSdk.ts` calls,
not the class's public surface. The real surface is 37 — the extra 10 (`getGroup`, `observeGroup`,
`trimCache`, `startTrimSchedule`, `stopTrimSchedule`, `open`, `getRefreshTtlMs`,
`setNotificationFeed`, `getNotificationFeed`, `clearNotificationFeeds`, `getMetadata`,
`deleteMetadata`) are called by `~/gunclub-ui` or internally. An interface built from the 27 would
have broken the web app. `SqliteCacheAdapter` must implement all 37;
`tests/cacheAdapter.test.js` asserts the list.

**Verification actually run:** `pnpm test` 574 pass / 0 fail (553 before). New coverage:
`tests/connectivity.test.js` (5), `tests/multipartUpload.connectivity.test.js` (5),
`tests/cacheAdapter.test.js` (5), plus 6 `actingContext` persistence tests in `tests/auth.test.js`.
A simulated-consumer type-check confirms `new CacheDB(...)` still compiles as both value and type,
and that an RN-shaped construction (injected `storage` + `connectivity`, no browser globals) type-checks.
`~/gunclub-ui` was **not** built against this branch — do that before publishing.

Steps 1–3 are safe to land on `main` behind no flag: they change no public API and the web app
keeps using the Dexie adapter throughout.

---

## Packaging

Keep **one package**. Do not fork, do not publish `ccsdk-native`.

- Platform impls in `src/cache/adapters/` and `src/platform/`.
- RN-only deps (`@op-engineering/op-sqlite`, NetInfo) must be **`peerDependencies`, optional** —
  never hard `dependencies`, or the web app pulls native modules it cannot build.
- Consumers pick an adapter at construction. Default selection may sniff the platform, but explicit
  injection stays supported for tests.
- **Publishing reminder:** first-party packages are exempt from the pnpm release-age cooldown. If
  `~/cc-mobile` blocks on a fresh `@cc-consulting-nv/ccsdk` publish, add it to
  `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` (not `.npmrc`).

---

## Verification

The SDK has a test suite (`~/ccsdk/tests`, run via `pnpm test`). Extend rather than replace:

- **Adapter parity suite** — run the same assertions against `DexieCacheAdapter` and
  `SqliteCacheAdapter`. This is the check that matters; the two must be behaviourally identical on
  TTL tiers, LRU fields, feed ordering, and write-fencing.
- **Web regression** — `~/gunclub-ui` must build and its smoke suite pass after each step, since it
  consumes this package.
- Do not claim a step done on a green type-check alone. The cache bugs this plan risks (TTL tier
  confusion, feed ordering, fence races) all type-check fine.

Use `pnpm` / `pnpm dlx` — a hook blocks `npm`/`npx` in this environment.

---

## Interaction with `docs/platformSdk-split-plan.md`

That plan splits `platformSdk.ts` into per-domain helper modules. Both plans touch the same file
but barely overlap: this one changes 2 `setTimeout` calls, the `actingContext` block, and the cache
*type*. If the split lands first, the line numbers here move — re-grep rather than trusting them.
Recommend landing these RN fixes first; they are far smaller and unblock the mobile port.

---

## Open decision — RESOLVED (2026-08-10): option 1

`observeUser` / `liveQuery` on RN:

1. **Map to TanStack Query invalidation** — **chosen.** The RN app runs `@tanstack/react-query`
   anyway; no second reactivity system.
2. ~~Build an observable layer over SQLite writes~~ — rejected: more faithful to the Dexie API,
   more code.

`observeUser`/`observeGroup` remain on `CacheAdapter` returning `Observable`, so the interface is
already final on this point and `SqliteCacheAdapter` can start without reshaping it.
