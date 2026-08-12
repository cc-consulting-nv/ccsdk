/**
 * SessionManager tests — multi-profile account switcher.
 *
 * Covers the behavior the switcher UI depends on:
 * 1. Adding an account registers + activates it without disturbing the others
 * 2. Per-profile isolation: separate token stores and separate cache databases
 * 3. Switching restores the target session and keeps every other one signed in
 * 4. Re-adding a known account recovers it instead of duplicating
 * 5. Removing signs out only that profile and auto-switches
 * 6. The registry survives a reload (a fresh manager over the same stores)
 * 7. Failed auth leaves the registry untouched
 *
 * Note: a couple of assertions deliberately reach through the TS-private
 * `sdk.cachePromise` to verify per-profile database naming. TS privacy is
 * compile-time only; this is intentional test seam usage, matching
 * signout.test.js.
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { SessionManager, createStorageProfileRegistry } from "../dist/sessionManager.js";

let prefixCounter = 0;
function uniquePrefix(name) {
  prefixCounter += 1;
  return `sm-${name}-${prefixCounter}-${Date.now()}`;
}

/**
 * Fake API that issues a distinct bearer per account and resolves
 * `/v1/users/me` from whichever bearer is presented. That mapping is what makes
 * cross-profile isolation observable.
 */
function createApi() {
  const accounts = new Map(); // email -> account
  const calls = [];
  /** Bearers the API should start rejecting, to simulate a revoked session. */
  const denied = new Set();
  /** ULID -> gate promise; lets a test hold one account's logout mid-flight. */
  const logoutGates = new Map();

  function addAccount(email, ulid, username, displayName) {
    accounts.set(email, {
      email,
      ulid,
      username,
      displayName,
      accessToken: `access-${ulid}`,
      refreshToken: `refresh-${ulid}`,
    });
  }

  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    const bearer = String(init.headers?.Authorization ?? "").replace("Bearer ", "");
    calls.push({ path, method, bearer });

    if (path === "/v1/auth/login") {
      const body = JSON.parse(init.body);
      const account = accounts.get(body.email);
      if (!account) {
        return new Response(JSON.stringify({ message: "Invalid credentials" }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          token_type: "Bearer",
          expires_in: 3600,
          access_token: account.accessToken,
          refresh_token: account.refreshToken,
        }),
        { status: 200 },
      );
    }

    if (path === "/v1/users/me") {
      const account = [...accounts.values()].find((a) => a.accessToken === bearer);
      if (!account || denied.has(bearer)) {
        return new Response(JSON.stringify({ message: "Unauthenticated" }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          data: {
            ulid: account.ulid,
            username: account.username,
            displayName: account.displayName,
            avatarUrl: `https://cdn.example.com/${account.username}.png`,
          },
        }),
        { status: 200 },
      );
    }

    if (path === "/v1/auth/logout") {
      const account = [...accounts.values()].find((a) => a.accessToken === bearer);
      const gate = account ? logoutGates.get(account.ulid) : undefined;
      if (gate) await gate;
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }

    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };

  return {
    fetchImpl,
    calls,
    addAccount,
    /** Start rejecting this bearer, as the server would after a revocation. */
    revoke: (bearer) => denied.add(bearer),
    callsTo: (path) => calls.filter((c) => c.path === path),
    /**
     * Hold this ULID's logout open until the returned release() is called, so a
     * test can deterministically interleave two removals.
     */
    blockLogout(ulid) {
      let release;
      logoutGates.set(ulid, new Promise((r) => { release = r; }));
      return () => {
        logoutGates.delete(ulid);
        release();
      };
    },
  };
}

/**
 * Per-profile session stores backed by one shared map, so a later manager over
 * the same factory sees what an earlier one persisted (the reload case) and the
 * test can assert keys never collide.
 */
function createStoreFactory() {
  const slots = new Map();
  const factory = (profileId) => {
    if (!slots.has(profileId)) slots.set(profileId, { tokens: null });
    const slot = slots.get(profileId);
    return {
      async loadTokens() {
        return slot.tokens;
      },
      async saveTokens(tokens) {
        slot.tokens = tokens;
      },
      async clearTokens() {
        slot.tokens = null;
      },
    };
  };
  return { factory, slots };
}

/** In-memory registry that deep-copies, so aliasing bugs can't hide. */
function createRegistry() {
  let snapshot = null;
  return {
    async load() {
      return snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
    },
    async save(next) {
      snapshot = JSON.parse(JSON.stringify(next));
    },
    peek: () => snapshot,
  };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

function createManager({ api, stores, registry, prefix, ...rest }) {
  return new SessionManager({
    baseUrl: "https://api.example.com",
    createSessionStore: stores.factory,
    registryStore: registry,
    dbNamePrefix: prefix,
    disableCrossTabSync: true,
    sdkOptions: { fetchImpl: api.fetchImpl },
    ...rest,
  });
}

async function setupTwoAccounts(prefix) {
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  api.addAccount("bob@example.com", "01BOB", "bob", "Bob");

  const stores = createStoreFactory();
  const registry = createRegistry();
  const manager = createManager({ api, stores, registry, prefix });
  await manager.ready();

  return { api, stores, registry, manager };
}

// ---------------------------------------------------------------------------
// Adding accounts
// ---------------------------------------------------------------------------

test("addProfile registers the account, activates it, and resolves its identity", async () => {
  const { api, manager } = await setupTwoAccounts(uniquePrefix("add"));

  const profile = await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));

  assert.equal(profile.ulid, "01ALICE");
  assert.equal(profile.username, "alice");
  assert.equal(profile.displayName, "Alice");
  assert.equal(profile.isActive, true);
  assert.equal(profile.isTokenExpired, false);

  assert.equal(manager.activeProfileUlid, "01ALICE");
  assert.equal(manager.active?.getTokens()?.accessToken, "access-01ALICE");
  assert.equal(manager.list().length, 1);

  // Identity was resolved through the staged session.
  assert.ok(api.callsTo("/v1/users/me").length >= 1);

  await manager.dispose();
});

test("each profile gets its own token store and its own cache database", async () => {
  const prefix = uniquePrefix("isolation");
  const { stores, manager } = await setupTwoAccounts(prefix);

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  const aliceCache = await manager.active.cachePromise;
  assert.equal(aliceCache.db.name, `${prefix}:01ALICE`);

  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));
  const bobCache = await manager.active.cachePromise;
  assert.equal(bobCache.db.name, `${prefix}:01BOB`);

  // Separate store slots, each holding only its own tokens.
  assert.equal(stores.slots.get("01ALICE").tokens.accessToken, "access-01ALICE");
  assert.equal(stores.slots.get("01BOB").tokens.accessToken, "access-01BOB");

  await manager.dispose();
});

test("adding an already-signed-in account switches to it instead of duplicating", async () => {
  const { manager } = await setupTwoAccounts(uniquePrefix("dedupe"));

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));
  assert.equal(manager.activeProfileUlid, "01BOB");

  const readded = await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));

  assert.equal(manager.list().length, 2, "no duplicate profile");
  assert.equal(readded.ulid, "01ALICE");
  assert.equal(manager.activeProfileUlid, "01ALICE", "re-adding switches to the account");
  assert.equal(readded.isTokenExpired, false);

  await manager.dispose();
});

test("re-adding recovers a profile that was marked needsReauth", async () => {
  const prefix = uniquePrefix("reauth");
  const { registry, stores, api, manager } = await setupTwoAccounts(prefix);

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.dispose();

  // Simulate a definitively rejected refresh: ccsdk clears the session on a 4xx,
  // so needsReauth and an empty token store go together.
  const stale = await registry.load();
  stale.profiles[0].needsReauth = true;
  await registry.save(stale);
  stores.slots.get("01ALICE").tokens = null;

  const revived = createManager({ api, stores, registry, prefix });
  await revived.ready();
  assert.equal(revived.list()[0].isTokenExpired, true, "surfaced as needing re-auth");

  const recovered = await revived.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  assert.equal(recovered.isTokenExpired, false);
  assert.equal(revived.list().length, 1);

  await revived.dispose();
});

test("a failed auth flow leaves the registry untouched", async () => {
  const { registry, manager } = await setupTwoAccounts(uniquePrefix("failed-add"));

  await assert.rejects(() => manager.addProfile((sdk) => sdk.login("nobody@example.com", "pw")));

  assert.equal(manager.list().length, 0);
  assert.equal(manager.activeProfileUlid, null);
  assert.equal(registry.peek(), null, "nothing persisted");

  // The manager stays usable after a failure.
  const ok = await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  assert.equal(ok.ulid, "01ALICE");

  await manager.dispose();
});

test("addProfile rejects when the flow produces no access token", async () => {
  const { manager, registry } = await setupTwoAccounts(uniquePrefix("no-token"));

  await assert.rejects(
    () => manager.addProfile(async () => {
      /* never authenticates */
    }),
    /no access token/,
  );
  assert.equal(manager.list().length, 0);
  assert.equal(registry.peek(), null);

  await manager.dispose();
});

// ---------------------------------------------------------------------------
// Auth failures must not leak across profiles
// ---------------------------------------------------------------------------

test("a rejected add does not trigger the app's global unauthorized handler", async () => {
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  const stores = createStoreFactory();
  const registry = createRegistry();

  // The app handler typically clears storage and redirects to login. Mistyping a
  // password while adding a second account must not do that to the account the
  // user is already signed in as.
  let globalUnauthorized = 0;
  const manager = createManager({
    api,
    stores,
    registry,
    prefix: uniquePrefix("add-401"),
    sdkOptions: { fetchImpl: api.fetchImpl, onUnauthorized: () => { globalUnauthorized += 1; } },
  });
  await manager.ready();

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  assert.equal(manager.activeProfileUlid, "01ALICE");

  await assert.rejects(() => manager.addProfile((sdk) => sdk.login("nobody@example.com", "wrong")));

  assert.equal(globalUnauthorized, 0, "the existing session was left alone");
  assert.equal(manager.activeProfileUlid, "01ALICE", "still signed in as Alice");
  assert.equal(manager.active?.getTokens()?.accessToken, "access-01ALICE");
  assert.equal(manager.list()[0].isTokenExpired, false, "Alice was not flagged");

  await manager.dispose();
});

test("a background profile going stale flags it without signing out the active one", async () => {
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  api.addAccount("bob@example.com", "01BOB", "bob", "Bob");
  const stores = createStoreFactory();
  const registry = createRegistry();

  let globalUnauthorized = 0;
  const flagged = [];
  const manager = createManager({
    api,
    stores,
    registry,
    prefix: uniquePrefix("background-401"),
    onProfileUnauthorized: (ulid) => flagged.push(ulid),
    sdkOptions: { fetchImpl: api.fetchImpl, onUnauthorized: () => { globalUnauthorized += 1; } },
  });
  await manager.ready();

  const alice = await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  assert.equal(alice.ulid, "01ALICE");
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));
  const aliceSdk = await manager.switchTo("01ALICE");
  await manager.switchTo("01BOB");

  // Alice is now a background profile whose session the server has revoked.
  api.revoke("access-01ALICE");
  await aliceSdk.getCurrentUser();

  assert.equal(globalUnauthorized, 0, "Bob's session was not disturbed");
  assert.equal(manager.activeProfileUlid, "01BOB");
  assert.deepEqual(flagged, ["01ALICE"], "reported per-profile instead");
  assert.equal(manager.get("01ALICE").isTokenExpired, true, "flagged for re-auth");
  assert.equal(manager.get("01BOB").isTokenExpired, false);

  await manager.dispose();
});

test("the active profile going stale does reach the app's unauthorized handler", async () => {
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  const stores = createStoreFactory();
  const registry = createRegistry();

  let globalUnauthorized = 0;
  const manager = createManager({
    api,
    stores,
    registry,
    prefix: uniquePrefix("active-401"),
    sdkOptions: { fetchImpl: api.fetchImpl, onUnauthorized: () => { globalUnauthorized += 1; } },
  });
  await manager.ready();

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));

  api.revoke("access-01ALICE");
  await manager.active.getCurrentUser();

  assert.equal(globalUnauthorized, 1, "the app is told the current session died");
  assert.equal(manager.get("01ALICE").isTokenExpired, true);

  await manager.dispose();
});

// ---------------------------------------------------------------------------
// Switching
// ---------------------------------------------------------------------------

test("switchTo swaps the active session while the others stay signed in", async () => {
  const { manager } = await setupTwoAccounts(uniquePrefix("switch"));

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));

  const alice = await manager.switchTo("01ALICE");
  assert.equal(manager.activeProfileUlid, "01ALICE");
  assert.equal(alice.getTokens()?.accessToken, "access-01ALICE");

  const bob = await manager.switchTo("01BOB");
  assert.equal(manager.activeProfileUlid, "01BOB");
  assert.equal(bob.getTokens()?.accessToken, "access-01BOB");

  // Alice's session was never torn down by the round trip.
  assert.equal(alice.getTokens()?.accessToken, "access-01ALICE");
  assert.equal(alice.isAuthenticated(), true);

  const flags = manager.list().map((p) => [p.ulid, p.isActive]);
  assert.deepEqual(
    flags.sort(),
    [
      ["01ALICE", false],
      ["01BOB", true],
    ].sort(),
  );

  await manager.dispose();
});

test("switchTo rejects an unknown profile", async () => {
  const { manager } = await setupTwoAccounts(uniquePrefix("switch-unknown"));
  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));

  await assert.rejects(() => manager.switchTo("01NOPE"), /unknown profile/);
  assert.equal(manager.activeProfileUlid, "01ALICE", "active profile unchanged");

  await manager.dispose();
});

test("requests from the active session carry that profile's bearer", async () => {
  const { api, manager } = await setupTwoAccounts(uniquePrefix("bearer"));

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));

  await manager.switchTo("01ALICE");
  const user = await manager.active.getCurrentUser();
  assert.equal(user?.ulid, "01ALICE", "API answered as Alice");

  await manager.switchTo("01BOB");
  const other = await manager.active.getCurrentUser();
  assert.equal(other?.ulid, "01BOB", "API answered as Bob");

  const meBearers = api.callsTo("/v1/users/me").map((c) => c.bearer);
  assert.ok(meBearers.includes("access-01ALICE"));
  assert.ok(meBearers.includes("access-01BOB"));

  await manager.dispose();
});

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

test("remove signs out only that profile and auto-switches to the next", async () => {
  const { api, stores, manager } = await setupTwoAccounts(uniquePrefix("remove"));

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));
  assert.equal(manager.activeProfileUlid, "01BOB");

  await manager.remove("01BOB");

  assert.equal(manager.list().length, 1);
  assert.equal(manager.list()[0].ulid, "01ALICE");
  assert.equal(manager.activeProfileUlid, "01ALICE", "auto-switched to the remaining account");
  assert.equal(manager.active?.getTokens()?.accessToken, "access-01ALICE");

  // Bob revoked server-side with Bob's bearer; Alice's tokens untouched.
  const logouts = api.callsTo("/v1/auth/logout");
  assert.equal(logouts.length, 1);
  assert.equal(logouts[0].bearer, "access-01BOB");
  assert.equal(stores.slots.get("01BOB").tokens, null, "Bob's store cleared");
  assert.equal(stores.slots.get("01ALICE").tokens.accessToken, "access-01ALICE");

  await manager.dispose();
});

test("removing the last profile leaves no active profile", async () => {
  const { registry, manager } = await setupTwoAccounts(uniquePrefix("remove-last"));

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.remove("01ALICE");

  assert.equal(manager.list().length, 0);
  assert.equal(manager.activeProfileUlid, null);
  assert.equal(manager.active, null);
  assert.deepEqual(registry.peek(), { profiles: [], activeUlid: null });

  await manager.dispose();
});

test("remove tolerates a failed revocation and still drops the profile", async () => {
  const prefix = uniquePrefix("remove-offline");
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  const stores = createStoreFactory();
  const registry = createRegistry();

  let failLogout = false;
  const guardedFetch = async (url, init) => {
    if (failLogout && new URL(url).pathname === "/v1/auth/logout") {
      throw new TypeError("network down");
    }
    return api.fetchImpl(url, init);
  };

  const manager = new SessionManager({
    baseUrl: "https://api.example.com",
    createSessionStore: stores.factory,
    registryStore: registry,
    dbNamePrefix: prefix,
    disableCrossTabSync: true,
    sdkOptions: { fetchImpl: guardedFetch },
  });
  await manager.ready();

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  failLogout = true;
  await manager.remove("01ALICE");

  assert.equal(manager.list().length, 0, "profile removed despite revocation failure");
  assert.equal(manager.activeProfileUlid, null);
  assert.equal(stores.slots.get("01ALICE").tokens, null, "local tokens cleared anyway");

  await manager.dispose();
});

test("signOutAll empties the registry", async () => {
  const { manager } = await setupTwoAccounts(uniquePrefix("signout-all"));

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));

  await manager.signOutAll();

  assert.equal(manager.list().length, 0);
  assert.equal(manager.activeProfileUlid, null);

  await manager.dispose();
});

test("remove is a no-op for an unknown profile", async () => {
  const { manager } = await setupTwoAccounts(uniquePrefix("remove-unknown"));
  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));

  await manager.remove("01NOPE");

  assert.equal(manager.list().length, 1);
  assert.equal(manager.activeProfileUlid, "01ALICE");

  await manager.dispose();
});

test("concurrent removes both take effect", async () => {
  // Regression: remove() captured the splice index before awaiting a network
  // logout. A second remove() landing in that window shifted the array, so the
  // first spliced a stale index — leaving a profile signed out but still listed,
  // and (if it had been active) still selected as the active profile.
  const prefix = uniquePrefix("remove-concurrent");
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  api.addAccount("bob@example.com", "01BOB", "bob", "Bob");
  api.addAccount("carol@example.com", "01CAROL", "carol", "Carol");

  const stores = createStoreFactory();
  const registry = createRegistry();
  const manager = createManager({ api, stores, registry, prefix });
  await manager.ready();

  // Registered in this order, so internal order is [ALICE, BOB, CAROL].
  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("carol@example.com", "pw"));

  // Hold Carol's logout open, start her removal, then let Alice's finish first.
  const releaseCarol = api.blockLogout("01CAROL");
  const carolRemoval = manager.remove("01CAROL");
  await manager.remove("01ALICE");
  releaseCarol();
  await carolRemoval;

  const remaining = manager.list().map((p) => p.ulid);
  assert.deepEqual(remaining, ["01BOB"], "both removals applied");
  assert.equal(manager.activeProfileUlid, "01BOB", "a removed profile is never left active");
  assert.deepEqual(
    registry.peek().profiles.map((p) => p.ulid),
    ["01BOB"],
    "the persisted registry matches, so a reload cannot resurrect a removed profile",
  );

  await manager.dispose();
});

test("acting context does not leak between profiles sharing one storage backend", async () => {
  // Regression: the acting context was persisted under a fixed "actingContext"
  // key. Every profile instance falls back to the same platform storage
  // (localStorage in a browser), so one profile's delegated-access context was
  // readable — and clobberable — by its siblings. The key is namespaced by
  // dbName, which the manager already makes unique per profile.
  const prefix = uniquePrefix("acting-context");
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  api.addAccount("bob@example.com", "01BOB", "bob", "Bob");

  // One storage backend behind every profile — what localStorage is in a
  // browser. Without this the SDK falls back to a no-op store in Node and the
  // leak is invisible, so the assertions below would pass either way.
  const shared = new Map();
  const storage = {
    getItem: (k) => (shared.has(k) ? shared.get(k) : null),
    setItem: (k, v) => { shared.set(k, String(v)); },
    removeItem: (k) => { shared.delete(k); },
  };

  const stores = createStoreFactory();
  const registry = createRegistry();
  const manager = createManager({
    api,
    stores,
    registry,
    prefix,
    sdkOptions: { fetchImpl: api.fetchImpl, storage },
  });
  await manager.ready();

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));

  await manager.switchTo("01ALICE");
  const alice = manager.active;
  await manager.switchTo("01BOB");
  const bob = manager.active;
  assert.ok(alice && bob && alice !== bob, "each profile gets its own instance");

  alice.setActingContext({
    managedUserUlid: "01MANAGED",
    token: "acting-token-alice",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  assert.equal(bob.getActingContext(), null, "Bob must not see Alice's acting context");
  assert.equal(alice.getActingContext()?.token, "acting-token-alice");

  // And the reverse: Bob setting his own must not disturb Alice's.
  bob.setActingContext({
    managedUserUlid: "01OTHER",
    token: "acting-token-bob",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  assert.equal(alice.getActingContext()?.token, "acting-token-alice");
  assert.equal(bob.getActingContext()?.token, "acting-token-bob");

  await manager.dispose();
});

// ---------------------------------------------------------------------------
// Persistence and notification
// ---------------------------------------------------------------------------

test("a fresh manager restores the registry and the last active profile", async () => {
  const prefix = uniquePrefix("restore");
  const { api, stores, registry, manager } = await setupTwoAccounts(prefix);

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));
  await manager.switchTo("01ALICE");
  await manager.dispose();

  // Simulates a page reload: new manager, same persisted stores.
  const reloaded = createManager({ api, stores, registry, prefix });
  await reloaded.ready();

  assert.equal(reloaded.activeProfileUlid, "01ALICE");
  assert.equal(reloaded.list().length, 2);
  assert.equal(
    reloaded.active?.getTokens()?.accessToken,
    "access-01ALICE",
    "active session rehydrated from its own store",
  );

  // The other account is still available to switch back to.
  const bob = await reloaded.switchTo("01BOB");
  assert.equal(bob.getTokens()?.accessToken, "access-01BOB");

  await reloaded.dispose();
});

test("restore heals an active pointer whose record is gone", async () => {
  const prefix = uniquePrefix("stale-pointer");
  const { api, stores, registry, manager } = await setupTwoAccounts(prefix);

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.dispose();

  const snapshot = await registry.load();
  snapshot.activeUlid = "01GONE";
  await registry.save(snapshot);

  const healed = createManager({ api, stores, registry, prefix });
  await healed.ready();

  assert.equal(healed.activeProfileUlid, "01ALICE", "fell back to a real profile");

  await healed.dispose();
});

test("subscribe fires on add, switch, and remove", async () => {
  const { manager } = await setupTwoAccounts(uniquePrefix("subscribe"));

  const seen = [];
  const unsubscribe = manager.subscribe((profiles) => {
    seen.push(profiles.map((p) => `${p.ulid}${p.isActive ? "*" : ""}`).join(","));
  });

  assert.deepEqual(seen, [""], "fires immediately with the current list");

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  assert.equal(seen.at(-1), "01ALICE*");

  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));
  assert.equal(seen.at(-1), "01BOB*,01ALICE");

  await manager.switchTo("01ALICE");
  assert.equal(seen.at(-1), "01ALICE*,01BOB");

  await manager.remove("01ALICE");
  assert.equal(seen.at(-1), "01BOB*");

  unsubscribe();
  const count = seen.length;
  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  assert.equal(seen.length, count, "no notifications after unsubscribe");

  await manager.dispose();
});

test("list is ordered most recently active first", async () => {
  const { manager } = await setupTwoAccounts(uniquePrefix("order"));

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.addProfile((sdk) => sdk.login("bob@example.com", "pw"));
  assert.deepEqual(manager.list().map((p) => p.ulid), ["01BOB", "01ALICE"]);

  await manager.switchTo("01ALICE");
  assert.deepEqual(manager.list().map((p) => p.ulid), ["01ALICE", "01BOB"]);

  await manager.dispose();
});

test("an expired stored session surfaces as isTokenExpired", async () => {
  const prefix = uniquePrefix("expired");
  const { api, stores, registry, manager } = await setupTwoAccounts(prefix);

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.dispose();

  // Age out the persisted session. The refresh attempt on restore fails (the
  // fake API has no /auth/refresh), so the expiry stands.
  const past = new Date(Date.now() - 60_000).toISOString();
  stores.slots.get("01ALICE").tokens.expiresAt = past;
  const snapshot = await registry.load();
  snapshot.profiles[0].tokenExpiresAt = past;
  await registry.save(snapshot);

  const reloaded = createManager({ api, stores, registry, prefix });
  await reloaded.ready();

  assert.equal(reloaded.list()[0].isTokenExpired, true);

  await reloaded.dispose();
});

test("an unknown expiry is not treated as expired", async () => {
  const prefix = uniquePrefix("unknown-expiry");
  const { api, stores, registry, manager } = await setupTwoAccounts(prefix);

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await manager.dispose();

  // A refresh-only store (no expiry) must not read as expired — switchTo() can
  // still mint a fresh access token from the refresh token.
  const snapshot = await registry.load();
  delete snapshot.profiles[0].tokenExpiresAt;
  await registry.save(snapshot);

  const reloaded = createManager({ api, stores, registry, prefix });
  await reloaded.ready();

  assert.equal(reloaded.list()[0].isTokenExpired, false);

  await reloaded.dispose();
});

test("a throwing subscriber does not break other subscribers", async () => {
  const { manager } = await setupTwoAccounts(uniquePrefix("bad-subscriber"));

  manager.subscribe(() => {
    throw new Error("boom");
  });
  const seen = [];
  manager.subscribe((profiles) => seen.push(profiles.length));

  await manager.addProfile((sdk) => sdk.login("alice@example.com", "pw"));

  assert.equal(seen.at(-1), 1, "healthy subscriber still notified");

  await manager.dispose();
});

test("ready is idempotent and safe to await concurrently", async () => {
  const { manager } = await setupTwoAccounts(uniquePrefix("ready"));

  await Promise.all([manager.ready(), manager.ready(), manager.ready()]);
  assert.equal(manager.activeProfileUlid, null);

  await manager.dispose();
});

// ---------------------------------------------------------------------------
// Cross-tab sync
// ---------------------------------------------------------------------------

test("a switch in one tab is followed by the others", async () => {
  const prefix = uniquePrefix("crosstab-switch");
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  api.addAccount("bob@example.com", "01BOB", "bob", "Bob");
  const stores = createStoreFactory();
  const registry = createRegistry();

  const tabA = createManager({ api, stores, registry, prefix, disableCrossTabSync: false });
  await tabA.ready();
  await tabA.addProfile((sdk) => sdk.login("alice@example.com", "pw"));
  await tabA.addProfile((sdk) => sdk.login("bob@example.com", "pw"));

  const tabB = createManager({ api, stores, registry, prefix, disableCrossTabSync: false });
  await tabB.ready();
  assert.equal(tabB.activeProfileUlid, "01BOB");

  await tabA.switchTo("01ALICE");

  await waitFor(() => tabB.activeProfileUlid === "01ALICE");
  assert.equal(
    tabB.active?.getTokens()?.accessToken,
    "access-01ALICE",
    "the following tab has a usable session, not just a pointer",
  );

  await tabA.dispose();
  await tabB.dispose();
});

test("an added account shows up in other tabs", async () => {
  const prefix = uniquePrefix("crosstab-add");
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  api.addAccount("bob@example.com", "01BOB", "bob", "Bob");
  const stores = createStoreFactory();
  const registry = createRegistry();

  const tabA = createManager({ api, stores, registry, prefix, disableCrossTabSync: false });
  await tabA.ready();
  await tabA.addProfile((sdk) => sdk.login("alice@example.com", "pw"));

  const tabB = createManager({ api, stores, registry, prefix, disableCrossTabSync: false });
  await tabB.ready();
  assert.equal(tabB.list().length, 1);

  const seen = [];
  tabB.subscribe((profiles) => seen.push(profiles.length));

  await tabA.addProfile((sdk) => sdk.login("bob@example.com", "pw"));

  await waitFor(() => tabB.list().length === 2);
  assert.deepEqual(
    tabB.list().map((p) => p.ulid).sort(),
    ["01ALICE", "01BOB"],
  );
  assert.ok(seen.includes(2), "subscribers were notified of the remote change");

  await tabA.dispose();
  await tabB.dispose();
});

test("cross-tab sync can be disabled", async () => {
  const prefix = uniquePrefix("crosstab-off");
  const api = createApi();
  api.addAccount("alice@example.com", "01ALICE", "alice", "Alice");
  api.addAccount("bob@example.com", "01BOB", "bob", "Bob");
  const stores = createStoreFactory();
  const registry = createRegistry();

  const tabA = createManager({ api, stores, registry, prefix, disableCrossTabSync: false });
  await tabA.ready();
  await tabA.addProfile((sdk) => sdk.login("alice@example.com", "pw"));

  const isolated = createManager({ api, stores, registry, prefix });
  await isolated.ready();

  await tabA.addProfile((sdk) => sdk.login("bob@example.com", "pw"));
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(isolated.list().length, 1, "opted-out manager did not follow");

  await tabA.dispose();
  await isolated.dispose();
});

// ---------------------------------------------------------------------------
// Default registry store
// ---------------------------------------------------------------------------

test("createStorageProfileRegistry round-trips and tolerates corruption", async () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  const registry = createStorageProfileRegistry(storage, "test_registry");

  assert.equal(await registry.load(), null, "empty storage reads as no registry");

  await registry.save({
    profiles: [{ ulid: "01ALICE", addedAt: 1, lastActiveAt: 2 }],
    activeUlid: "01ALICE",
  });
  const loaded = await registry.load();
  assert.equal(loaded.activeUlid, "01ALICE");
  assert.equal(loaded.profiles[0].ulid, "01ALICE");

  storage.setItem("test_registry", "{not json");
  assert.equal(await registry.load(), null, "corrupt registry reads as empty");

  storage.setItem("test_registry", JSON.stringify({ profiles: "nope", activeUlid: 1 }));
  assert.equal(await registry.load(), null, "malformed registry reads as empty");
});
