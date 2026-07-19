# Auth / session-restore SDK gaps (feed empty-on-reload bug)

Written 2026-07-19 after fixing a gunclub-ui bug where a hard reload showed
**"Welcome to Gun Club"** (empty feed) to a logged-in user. Root cause was
UI-side and fully fixed there (gunclub-ui PR #580), but the fix exists only
because the SDK leaves two things to every consumer. Implementing the changes
below lets the UI delete its compensation code.

## Context: what the UI had to work around

On a hard reload the access token lives only in the in-memory `MemoryTokenProvider`
— gone until `restoreSession()` / `refreshSession()` runs. During that window:

- The UI's `authService.getTokens()` fell back to a stale localStorage snapshot,
  so it looked authenticated when the SDK's in-memory bearer was actually empty.
- The feed query fired before restore completed. `/v1/feeds/timeline` answers an
  **unauthenticated** request with `200 + { data: [] }` — it does **not** 401 —
  so the SDK's `401 → refresh → retry` never engaged, an empty page cached, and
  Welcome rendered.

UI fix: a hand-rolled `sessionRestored` ref (always starts false, flips true only
after auth init finishes) gating the feed query, plus reading `sdk.getTokens()`
directly instead of the localStorage fallback, plus always refreshing on 401.

The two SDK changes below remove the need for the UI to model any of this itself.

---

## Gap 1 — `getTokens()` / `isAuthenticated()` ignore expiry

`AuthTokens` already carries `expiresAt` (ISO 8601, `src/types.ts:41`), but nothing
reads it:

- `MemoryTokenProvider.getTokens()` (`src/auth.ts:65`) returns the raw stored object.
- `StorageTokenProvider.getTokens()` (`src/auth.ts:115`) same.
- `CcPlatformSdk.getTokens()` (`src/platformSdk.ts:916`) just proxies the provider.
- `CcPlatformSdk.isAuthenticated()` (`src/platformSdk.ts:920`) is a **presence**
  check: `Boolean(tokens?.accessToken)` — an expired token reads as authenticated.

Consequence for consumers: no way to ask "is this token still valid?". The UI's
`onRefreshTokens` had to *always* refresh on 401 rather than trusting the in-memory
token, because it couldn't tell a live token from an expired one.

### Proposed change

Add expiry-aware helpers on the SDK (do **not** change `getTokens()`'s return shape —
keep it a raw accessor):

```ts
/** True if there is an access token AND it has not passed its expiresAt. */
isAccessTokenValid(skewMs = 30_000): boolean

/** True if a token exists but expiresAt is in the past (needs refresh). */
isAccessTokenExpired(skewMs = 30_000): boolean
```

- Read `AuthTokens.expiresAt`; treat missing `expiresAt` as "unknown → not
  provably valid" (return false from `isAccessTokenValid` so callers refresh).
- `skewMs` clock-skew buffer so a token about to expire counts as expired.
- Then make `isAuthenticated()` continue to mean "has a token" (back-compat),
  but document the distinction and point callers at `isAccessTokenValid()` for
  the stricter check. Do not silently change `isAuthenticated()` semantics —
  existing callers rely on presence.

This lets `onRefreshTokens` skip the network round-trip when the token is still
valid, and lets any consumer gate on validity instead of presence.

---

## Gap 2 — no "session restore complete" signal

`restoreSession()` (`src/platformSdk.ts:883`) resolves with tokens-or-null but:

- Does **not** validate expiry — returns a stored token even if `expiresAt` is
  past (see Gap 1). A caller that awaits `restoreSession()` can still hold an
  expired token afterward.
- There is **no** event/observable/ready-promise a consumer can await for
  "in-memory bearer is now populated (or definitively absent)".

Consequence: the UI hand-rolled `sessionRestored` to answer "is it safe to fire
authed requests yet?". Every consumer that renders authed data on load has to
re-derive this.

### Proposed change

Pick one (A preferred):

**A. `ready()` / `whenReady` promise.**
Expose a promise that resolves once the SDK has completed its first
restore+refresh attempt (token populated, or guest confirmed):

```ts
/** Resolves after the first restore/refresh settles. Safe to await before
 *  firing authenticated requests on app load. Idempotent — returns the same
 *  settled promise on subsequent calls. */
ready(): Promise<void>
```

**B. Event.**
Emit `session-restored` (payload `{ authenticated: boolean }`) after the first
restore/refresh settles, via the SDK's existing event mechanism.

Also: `restoreSession()` should **refresh when the restored token is expired**
(reuse the `refreshSessionInFlight` dedup at `src/platformSdk.ts:1522`) so its
resolved token is always live, not merely present. That folds Gap 1's validity
check into the restore path.

---

## After these land — UI cleanup (gunclub-ui)

Once Gap 1 + Gap 2 ship, gunclub-ui can:

- Delete the `sessionRestored` ref in `useAuth.ts`; gate the feed on
  `await sdk.ready()` / the `session-restored` event instead.
- Drop the `authService.getTokens()` localStorage fallback confusion by reading
  SDK validity directly.
- Simplify `onRefreshTokens` to refresh only when `!sdk.isAccessTokenValid()`.

Coordinate the UI cleanup PR with the SDK version bump. Related open SDK work:
signout/cache gaps (ccsdk#138) and the "public cache API" note in gunclub-ui
`CLAUDE.md` (quote-post media). Same theme: the UI is compensating for
session/cache lifecycle the SDK should own.

## Priority

- **Gap 1** first — small, self-contained, unblocks the 401 refresh simplification.
- **Gap 2** next — bigger surface (public API + restore-path refresh), removes the
  UI's `sessionRestored` entirely.

Neither is a correctness bug in the SDK today; both are missing affordances that
push lifecycle logic into every consumer.
