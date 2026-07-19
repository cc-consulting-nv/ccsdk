# Auth / session-restore SDK gaps (feed empty-on-reload bug)

> **Status: DONE (shipped in 1.2.0, PR #150)**  
> Gap 1 and Gap 2 are implemented. Consumers can migrate off UI compensation
> code (see [UI cleanup](#after-these-land--ui-cleanup-gunclub-ui)). Keep this
> file as historical context; do not re-implement the proposed APIs.

Written 2026-07-19 after fixing a gunclub-ui bug where a hard reload showed
**"Welcome to Gun Club"** (empty feed) to a logged-in user. Root cause was
UI-side and fully fixed there (gunclub-ui PR #580), but the fix existed only
because the SDK left two things to every consumer. Implementing the changes
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

## Gap 1 — `getTokens()` / `isAuthenticated()` ignore expiry — **DONE**

`AuthTokens` already carries `expiresAt` (ISO 8601), but nothing used to read it:

- `MemoryTokenProvider.getTokens()` returns the raw stored object.
- `StorageTokenProvider.getTokens()` same.
- `CcPlatformSdk.getTokens()` just proxies the provider.
- `CcPlatformSdk.isAuthenticated()` is a **presence** check:
  `Boolean(tokens?.accessToken)` — an expired token reads as authenticated.

Consequence for consumers: no way to ask "is this token still valid?". The UI's
`onRefreshTokens` had to *always* refresh on 401 rather than trusting the
in-memory token, because it couldn't tell a live token from an expired one.

### Shipped API (1.2.0)

```ts
/** True if there is an access token AND it has not passed its expiresAt. */
isAccessTokenValid(skewMs = 30_000): boolean

/** True if a token exists but expiresAt is in the past (needs refresh). */
isAccessTokenExpired(skewMs = 30_000): boolean
```

- Reads `AuthTokens.expiresAt`; missing `expiresAt` is "unknown → not
  provably valid" (false from `isAccessTokenValid` so callers refresh).
- `skewMs` clock-skew buffer so a token about to expire counts as expired.
- `isAuthenticated()` remains presence-only (back-compat). Callers that need
  validity use `isAccessTokenValid()`.

---

## Gap 2 — no "session restore complete" signal — **DONE**

Previously `restoreSession()` resolved with tokens-or-null but:

- Did **not** validate expiry — returned a stored token even if `expiresAt` was
  past (see Gap 1).
- There was **no** event/observable/ready-promise a consumer could await for
  "in-memory bearer is now populated (or definitively absent)".

### Shipped API (1.2.0)

Preferred option A shipped:

```ts
/** Resolves after the first restore/refresh settles. Safe to await before
 *  firing authenticated requests on app load. Idempotent — returns the same
 *  settled promise on subsequent calls. */
ready(): Promise<void>
```

Also: `restoreSession()` **refreshes when the restored token is not live**
(reuses the `refreshSessionInFlight` dedup) so its resolved token is a usable
bearer, not merely present:

- expired access (`expiresAt` in the past)
- **refresh-only store** (cookie-mode reload: no access token, only refresh)
- unknown expiry (missing `expiresAt` → not provably valid)

Shipped through 1.2.0 for expiry; **refresh-only mint completed in 1.2.2**.

---

## After these land — UI cleanup (gunclub-ui)

Once Gap 1 + Gap 2 ship (now shipped), gunclub-ui can:

- Delete the `sessionRestored` ref in `useAuth.ts`; gate the feed on
  `await sdk.ready()` instead.
- Drop the `authService.getTokens()` localStorage fallback confusion by reading
  SDK validity directly.
- Simplify `onRefreshTokens` to refresh only when `!sdk.isAccessTokenValid()`.

Coordinate the UI cleanup PR with the SDK version bump (≥ 1.2.0). Related open
SDK work: signout/cache gaps (ccsdk#138) and the "public cache API" note in
gunclub-ui `CLAUDE.md` (quote-post media). Same theme: the UI is compensating
for session/cache lifecycle the SDK should own.

## Priority (historical)

- **Gap 1** first — small, self-contained, unblocks the 401 refresh simplification.
- **Gap 2** next — bigger surface (public API + restore-path refresh), removes the
  UI's `sessionRestored` entirely.

Neither was a correctness bug in the SDK; both were missing affordances that
pushed lifecycle logic into every consumer. Both are now shipped.
