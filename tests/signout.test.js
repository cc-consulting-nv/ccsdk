/**
 * Sign-out cache wipe tests (issue #138)
 *
 * Covers the three sign-out gaps plus the hardening from the pre-landing
 * review:
 * 1. clearAll() falls back to deleting the whole database on partial failure
 * 2. Cache write fencing (all write methods) + cross-tab sign-out broadcast
 * 3. In-flight token refresh cannot resurrect a cleared session — including
 *    refreshes that start mid-logout (401-triggered), 5xx retries, remote
 *    tabs, and persists that race the epoch bump
 * 4. Fence lifts on any re-auth path (setSession, restoreSession, setTokens)
 * 5. dispose() detaches the instance from sign-out broadcasts
 *
 * Note: several tests intentionally do white-box things — monkey-patching
 * `cache.db.<table>` methods and reading the TS-private `sdk.cachePromise`.
 * TS privacy is compile-time only; this is deliberate test seam usage.
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CacheDB } from "../dist/cache/cacheDB.js";
import { CcPlatformSdk } from "../dist/platformSdk.js";
import { MemoryTokenProvider } from "../dist/auth.js";

const baseUrl = "https://api.example.com";
const HOUR = 60 * 60 * 1000;

let dbCounter = 0;
function uniqueDbName(prefix) {
  dbCounter += 1;
  return `${prefix}-${dbCounter}-${Date.now()}`;
}

function createMockSessionStore(initialTokens = null) {
  let tokens = initialTokens;
  return {
    async loadTokens() {
      return tokens;
    },
    async saveTokens(nextTokens) {
      tokens = nextTokens;
    },
    async clearTokens() {
      tokens = null;
    },
    getSnapshot() {
      return tokens;
    },
  };
}

function okFetch() {
  return async () => new Response(JSON.stringify({ data: {} }), { status: 200 });
}

const tokenResponse = (at, rt) =>
  new Response(
    JSON.stringify({
      token_type: "Bearer",
      expires_in: 3600,
      access_token: at,
      refresh_token: rt,
    }),
    { status: 200 },
  );

async function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// 1. clearAll fallback
// ---------------------------------------------------------------------------

test("clearAll deletes and recreates the database when a table clear fails", async () => {
  const cache = new CacheDB(HOUR, uniqueDbName("signout-clearall"));
  await cache.open();

  await cache.setUser("01USER", { ulid: "01USER", username: "alice" });
  await cache.setPost("01POST", { ulid: "01POST", title: "hello" });

  // Force a partial failure: posts.clear() rejects, the rest would succeed.
  cache.db.posts.clear = () => Promise.reject(new Error("boom"));

  await cache.clearAll();

  assert.equal(await cache.getUser("01USER"), null, "users wiped");
  assert.equal(await cache.getPost("01POST"), null, "posts wiped via db.delete fallback");

  // Recreated database must be fully usable.
  await cache.setPost("01NEW", { ulid: "01NEW" });
  assert.ok(await cache.getPost("01NEW"), "cache usable after recreate");
});

test("clearAll rethrows when the fallback delete also fails", async () => {
  const cache = new CacheDB(HOUR, uniqueDbName("signout-clearall-fail"));
  await cache.open();

  cache.db.posts.clear = () => Promise.reject(new Error("boom"));
  cache.db.delete = () => Promise.reject(new Error("delete failed"));

  await assert.rejects(() => cache.clearAll(), /delete failed/);
});

// ---------------------------------------------------------------------------
// 2. Write fencing
// ---------------------------------------------------------------------------

test("fenceWrites drops every write method, unfenceWrites restores them", async () => {
  const cache = new CacheDB(HOUR, uniqueDbName("signout-fence"));
  await cache.open();

  cache.fenceWrites();

  await cache.setPost("01P", { ulid: "01P" });
  await cache.setPosts({ "01A": { ulid: "01A" } });
  await cache.setUser("01U", { ulid: "01U", username: "bob" });
  await cache.setUsers([{ ulid: "01U2", username: "carol" }]);
  await cache.setGroup("01G", { ulid: "01G" });
  await cache.setGroups([{ ulid: "01G2" }]);
  await cache.setFeedResource("/v1/feed", ["01P"]);
  await cache.appendToFeedResource("/v1/feed2", ["01P"]);
  await cache.setNotificationFeed("/recent", "u1", ["01N"], null, false);
  await cache.setMetadata("k", "v");

  assert.equal(await cache.getPost("01P"), null, "fenced setPost dropped");
  assert.equal(await cache.getPost("01A"), null, "fenced setPosts dropped");
  assert.equal(await cache.getUser("01U"), null, "fenced setUser dropped");
  assert.equal(await cache.getUser("01U2"), null, "fenced setUsers dropped");
  assert.equal(await cache.getGroup("01G"), null, "fenced setGroup dropped");
  assert.equal(await cache.getGroup("01G2"), null, "fenced setGroups dropped");
  assert.equal(await cache.getFeedResource("/v1/feed"), null, "fenced setFeedResource dropped");
  assert.equal(await cache.getFeedResource("/v1/feed2"), null, "fenced appendToFeedResource dropped");
  assert.equal(await cache.getNotificationFeed("/recent", "u1"), null, "fenced setNotificationFeed dropped");
  assert.equal(await cache.getMetadata("k"), null, "fenced setMetadata dropped");

  cache.unfenceWrites();

  await cache.setPost("01P", { ulid: "01P" });
  assert.ok(await cache.getPost("01P"), "unfenced setPost works");
});

test("read-path touch cannot reinsert entries wiped by clearAll", async () => {
  const cache = new CacheDB(HOUR, uniqueDbName("touch-resurrect"));
  await cache.open();
  await cache.setPost("01P", { ulid: "01P", title: "previous-user-data" });

  // Stall an in-flight read between its get and its touch write.
  const realGet = cache.db.posts.get.bind(cache.db.posts);
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  cache.db.posts.get = async (id) => {
    const entry = await realGet(id);
    await gate;
    return entry;
  };

  const inFlightRead = cache.getPost("01P");
  await tick(); // let the read pass its get and park on the gate
  cache.db.posts.get = realGet;
  await cache.clearAll();
  release();
  await inFlightRead;

  assert.equal(
    await cache.getPost("01P"),
    null,
    "wiped entry must not be resurrected by the read-path touch",
  );
});

test("logout fences cache writes; new session unfences them", async () => {
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "at" }),
    dbName: uniqueDbName("signout-sdk-fence"),
  });

  await sdk.logout();

  const cache = await sdk.cachePromise;
  await cache.setPost("01P", { ulid: "01P" });
  assert.equal(await cache.getPost("01P"), null, "writes fenced after logout");

  await sdk.setSession({ accessToken: "fresh-at" });
  await tick(); // unfence is scheduled, epoch-guarded

  await cache.setPost("01P", { ulid: "01P" });
  assert.ok(await cache.getPost("01P"), "writes unfenced after new session");
});

test("direct setTokens() re-auth also lifts the fence", async () => {
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "at" }),
    dbName: uniqueDbName("signout-settokens-unfence"),
  });

  await sdk.logout();
  const cache = await sdk.cachePromise;
  await cache.setPost("01P", { ulid: "01P" });
  assert.equal(await cache.getPost("01P"), null, "fenced after logout");

  sdk.setTokens({ accessToken: "direct-at" });
  await tick();

  await cache.setPost("01P", { ulid: "01P" });
  assert.ok(await cache.getPost("01P"), "setTokens lifts the fence");
});

// ---------------------------------------------------------------------------
// 2b. Cross-tab sign-out broadcast
// ---------------------------------------------------------------------------

test("logout broadcasts sign-out: other instances drop tokens and fence writes", async () => {
  const dbName = uniqueDbName("signout-broadcast");

  const sdkA = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "tab-a" }),
    dbName,
  });
  const sdkB = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "tab-b", refreshToken: "rt-b" }),
    dbName,
  });

  assert.ok(sdkB.getTokens(), "sdkB starts authenticated");

  await sdkA.logout();
  await waitFor(() => sdkB.getTokens() === null);

  const cacheB = await sdkB.cachePromise;
  await cacheB.setPost("01P", { ulid: "01P" });
  assert.equal(await cacheB.getPost("01P"), null, "sdkB cache writes fenced after broadcast");
});

test("remote sign-out clears the receiving tab's persisted session store", async () => {
  const dbName = uniqueDbName("signout-remote-store");
  const storeB = createMockSessionStore({ accessToken: "b-at", refreshToken: "b-rt" });

  const sdkA = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "a-at" }),
    dbName,
  });
  const sdkB = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "b-at", refreshToken: "b-rt" }),
    sessionStore: storeB,
    dbName,
  });

  await sdkA.logout();
  await waitFor(() => sdkB.getTokens() === null && storeB.getSnapshot() === null);

  const restored = await sdkB.restoreSession();
  assert.equal(restored, null, "remotely signed-out tab cannot resurrect tokens from its store");
});

test("sign-out broadcast does not cross dbName boundaries", async () => {
  const sdkA = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "a" }),
    dbName: uniqueDbName("iso-a"),
  });
  const sdkB = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "b" }),
    dbName: uniqueDbName("iso-b"),
  });

  await sdkA.logout();
  await new Promise((r) => setTimeout(r, 100)); // allow any (wrong) broadcast to land

  assert.ok(sdkB.getTokens(), "sdkB unaffected by sdkA sign-out");
  const cacheB = await sdkB.cachePromise;
  await cacheB.setPost("01P", { ulid: "01P" });
  assert.ok(await cacheB.getPost("01P"), "sdkB cache not fenced");
});

test("restoreSession after remote sign-out unfences once a new session exists", async () => {
  const dbName = uniqueDbName("signout-refence");
  const storeB = createMockSessionStore({ accessToken: "b-at", refreshToken: "b-rt" });

  const sdkA = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "a-at" }),
    dbName,
  });
  const sdkB = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "b-at" }),
    sessionStore: storeB,
    dbName,
  });

  await sdkA.logout();
  await waitFor(() => sdkB.getTokens() === null);

  // User logs in again elsewhere; the store now holds fresh tokens.
  await storeB.saveTokens({ accessToken: "new-at", refreshToken: "new-rt" });
  await sdkB.restoreSession();
  await tick();

  const cacheB = await sdkB.cachePromise;
  await cacheB.setPost("01P", { ulid: "01P" });
  assert.ok(await cacheB.getPost("01P"), "cache writes resume after session restore");
});

test("dispose() detaches an instance from sign-out broadcasts", async () => {
  const dbName = uniqueDbName("signout-dispose");

  const sdkA = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "a" }),
    dbName,
  });
  const sdkB = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "b" }),
    dbName,
  });

  await sdkB.dispose();
  await sdkA.logout();
  await new Promise((r) => setTimeout(r, 100));

  assert.ok(sdkB.getTokens(), "disposed instance no longer reacts to broadcasts");
});

// ---------------------------------------------------------------------------
// 3. In-flight refresh vs sign-out
// ---------------------------------------------------------------------------

test("in-flight refresh resolving mid-logout cannot resurrect the session", async () => {
  let releaseRefresh;
  const refreshGate = new Promise((r) => {
    resolveLater(r);
  });
  function resolveLater(r) {
    releaseRefresh = r;
  }
  let refreshStarted;
  const startedGate = new Promise((r) => {
    refreshStarted = r;
  });

  const fetchImpl = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      refreshStarted();
      await refreshGate;
      return tokenResponse("resurrected-at", "resurrected-rt");
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };

  const sessionStore = createMockSessionStore({
    accessToken: "old-at",
    refreshToken: "old-rt",
  });
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({ accessToken: "old-at", refreshToken: "old-rt" }),
    sessionStore,
    dbName: uniqueDbName("signout-refresh-race"),
  });

  const refreshPromise = sdk.refreshToken();
  await startedGate; // deterministic: refresh is parked on its network call

  const logoutPromise = sdk.logout();
  releaseRefresh();

  const refreshed = await refreshPromise;
  await logoutPromise;

  assert.equal(refreshed, null, "refresh result discarded after sign-out began");
  assert.equal(sdk.getTokens(), null, "no tokens in memory after logout");
  assert.equal(sessionStore.getSnapshot(), null, "no tokens persisted after logout");
});

test("refresh completing before logout still ends signed out", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      return tokenResponse("new-at", "new-rt");
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };

  const sessionStore = createMockSessionStore({
    accessToken: "old-at",
    refreshToken: "old-rt",
  });
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({ accessToken: "old-at", refreshToken: "old-rt" }),
    sessionStore,
    dbName: uniqueDbName("signout-refresh-then-logout"),
  });

  const refreshed = await sdk.refreshToken();
  assert.equal(refreshed.accessToken, "new-at", "refresh before logout persists normally");

  await sdk.logout();

  assert.equal(sdk.getTokens(), null);
  assert.equal(sessionStore.getSnapshot(), null);
});

test("refresh that starts during the logout wipe is refused", async () => {
  // Simulates the 401-on-logout path: a refresh initiated AFTER beginSignOut
  // captures the post-bump epoch, so only the signOutInProgress guard stops
  // it from re-persisting tokens and unfencing mid-wipe.
  let refreshCalls = 0;
  let releaseLogout;
  const logoutGate = new Promise((r) => {
    releaseLogout = r;
  });

  const fetchImpl = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      refreshCalls += 1;
      return tokenResponse("zombie-at", "zombie-rt");
    }
    if (String(url).includes("/v1/auth/logout")) {
      await logoutGate; // hold logout at its network call
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };

  const sessionStore = createMockSessionStore({
    accessToken: "old-at",
    refreshToken: "old-rt",
  });
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({ accessToken: "old-at", refreshToken: "old-rt" }),
    sessionStore,
    dbName: uniqueDbName("signout-mid-wipe-refresh"),
  });

  const logoutPromise = sdk.logout();
  await tick(); // logout is parked on its POST; signOutInProgress is set

  const refreshed = await sdk.refreshToken(); // e.g. spawned by a 401 handler
  assert.equal(refreshed, null, "refresh refused during sign-out wipe");
  assert.equal(refreshCalls, 0, "refused before any network call");

  releaseLogout();
  await logoutPromise;

  assert.equal(sdk.getTokens(), null);
  assert.equal(sessionStore.getSnapshot(), null);

  const cache = await sdk.cachePromise;
  await cache.setPost("01P", { ulid: "01P" });
  assert.equal(await cache.getPost("01P"), null, "fence stayed up through the wipe");
});

test("refresh persist racing the epoch bump is undone and keeps the fence up", async () => {
  // Refresh passes its epoch check, then suspends inside persistSession;
  // logout bumps the epoch mid-persist. updateSession must undo the persist.
  let releaseSave;
  const saveGate = new Promise((r) => {
    releaseSave = r;
  });
  let saveGateArmed = false;

  let stored = { accessToken: "old-at", refreshToken: "old-rt" };
  const sessionStore = {
    async loadTokens() {
      return stored;
    },
    async saveTokens(t) {
      if (saveGateArmed) {
        saveGateArmed = false;
        await saveGate;
      }
      stored = t;
    },
    async clearTokens() {
      stored = null;
    },
    getSnapshot() {
      return stored;
    },
  };

  const fetchImpl = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      return tokenResponse("raced-at", "raced-rt");
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({ accessToken: "old-at", refreshToken: "old-rt" }),
    sessionStore,
    dbName: uniqueDbName("signout-persist-race"),
  });

  saveGateArmed = true;
  const refreshPromise = sdk.refreshToken();
  // Let the refresh reach saveTokens and park there (epoch check passed).
  await waitFor(() => saveGateArmed === false);

  const logoutPromise = sdk.logout(); // bumps epoch, fences, waits for refresh
  releaseSave();

  await refreshPromise;
  await logoutPromise;

  assert.equal(sdk.getTokens(), null, "raced persist undone");
  assert.equal(sessionStore.getSnapshot(), null, "store ends cleared");

  const cache = await sdk.cachePromise;
  await cache.setPost("01P", { ulid: "01P" });
  assert.equal(await cache.getPost("01P"), null, "fence never lifted by the raced refresh");
});

test("refresh 5xx retry resolving mid-logout cannot resurrect the session", async () => {
  let refreshCalls = 0;
  let releaseRetry;
  const retryGate = new Promise((r) => {
    releaseRetry = r;
  });

  const fetchImpl = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      refreshCalls += 1;
      if (refreshCalls === 1) return new Response("{}", { status: 500 });
      await retryGate;
      return tokenResponse("zombie-at", "zombie-rt");
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };

  const sessionStore = createMockSessionStore({
    accessToken: "old-at",
    refreshToken: "old-rt",
  });
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({ accessToken: "old-at", refreshToken: "old-rt" }),
    sessionStore,
    dbName: uniqueDbName("signout-retry-race"),
  });

  const refreshPromise = sdk.refreshToken();
  await waitFor(() => refreshCalls === 1);

  const logoutPromise = sdk.logout();
  releaseRetry();

  assert.equal(await refreshPromise, null, "retry tokens discarded after sign-out began");
  await logoutPromise;
  assert.equal(sessionStore.getSnapshot(), null);
});

test("refresh 4xx mid-logout defers cleanup to the sign-out", async () => {
  let clearCount = 0;
  let releaseRefresh;
  const refreshGate = new Promise((r) => {
    releaseRefresh = r;
  });
  let refreshStarted;
  const startedGate = new Promise((r) => {
    refreshStarted = r;
  });

  const sessionStore = {
    async loadTokens() {
      return { accessToken: "a", refreshToken: "r" };
    },
    async saveTokens() {},
    async clearTokens() {
      clearCount += 1;
    },
  };
  const fetchImpl = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      refreshStarted();
      await refreshGate;
      return new Response("{}", { status: 401 });
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({ accessToken: "a", refreshToken: "r" }),
    sessionStore,
    dbName: uniqueDbName("signout-fourxx-race"),
  });

  const refreshPromise = sdk.refreshToken();
  await startedGate;

  const logoutPromise = sdk.logout();
  releaseRefresh();

  await refreshPromise;
  await logoutPromise;

  assert.equal(clearCount, 1, "only the sign-out's own clearSession ran");
});

test("remote sign-out discards the receiving tab's in-flight refresh", async () => {
  const dbName = uniqueDbName("signout-remote-refresh");
  let releaseRefresh;
  const refreshGate = new Promise((r) => {
    releaseRefresh = r;
  });
  let refreshStarted;
  const startedGate = new Promise((r) => {
    refreshStarted = r;
  });

  const fetchB = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      refreshStarted();
      await refreshGate;
      return tokenResponse("zombie-at", "zombie-rt");
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };

  const storeB = createMockSessionStore({ accessToken: "b-at", refreshToken: "b-rt" });
  const sdkA = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "a-at" }),
    dbName,
  });
  const sdkB = new CcPlatformSdk({
    baseUrl,
    fetchImpl: fetchB,
    tokenProvider: new MemoryTokenProvider({ accessToken: "b-at", refreshToken: "b-rt" }),
    sessionStore: storeB,
    dbName,
  });

  const refreshPromise = sdkB.refreshToken();
  await startedGate;

  await sdkA.logout();
  await waitFor(() => sdkB.getTokens() === null);

  releaseRefresh();
  assert.equal(await refreshPromise, null, "remote epoch bump discards the refresh");
  assert.equal(storeB.getSnapshot(), null, "nothing re-persisted in the remote tab");
});

test("deleteAccount fences cache writes and broadcasts sign-out", async () => {
  const dbName = uniqueDbName("signout-delete-account");
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "at" }),
    dbName,
  });
  const sdkOther = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "at2" }),
    dbName,
  });

  await sdk.deleteAccount();

  const cache = await sdk.cachePromise;
  await cache.setPost("01P", { ulid: "01P" });
  assert.equal(await cache.getPost("01P"), null, "writes fenced after deleteAccount");

  await waitFor(() => sdkOther.getTokens() === null);
});

test("logout completes even when an in-flight refresh never resolves", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      await new Promise(() => {}); // black hole
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({ accessToken: "at", refreshToken: "rt" }),
    dbName: uniqueDbName("signout-hung-refresh"),
  });

  void sdk.refreshToken(); // hangs forever
  await tick();

  const started = Date.now();
  await sdk.logout(); // must not hang behind the dead refresh
  const elapsed = Date.now() - started;

  // beginSignOut() caps the hung refresh at 2000ms (the cache-fence leg
  // settles in <30ms and never nears its own 1000ms cap). Assert only that
  // logout is BOUNDED, with enough slack that setTimeout drift under full-
  // suite load cannot trip it -- measured drift reaches ~1200ms on the 2000ms
  // timer, which made a 4000ms bound flaky at ~1-in-5 full-suite runs.
  assert.ok(elapsed < 8000, `logout bounded despite hung refresh (took ${elapsed}ms)`);
  assert.equal(sdk.getTokens(), null);
});

// ---------------------------------------------------------------------------
// 4. Red-team round: holes found in (and introduced by) the first fixes
// ---------------------------------------------------------------------------

test("clearSession rejection still wipes the cache and releases the flag", async () => {
  const sessionStore = {
    async loadTokens() {
      return { accessToken: "at", refreshToken: "rt" };
    },
    async saveTokens() {},
    async clearTokens() {
      throw new Error("native store flake");
    },
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "at" }),
    sessionStore,
    dbName: uniqueDbName("signout-store-reject"),
  });
  const cache = await sdk.cachePromise;
  await cache.setPost("01OLD", { ulid: "01OLD", title: "previous user" });

  await assert.rejects(() => sdk.logout(), /native store flake/);

  assert.equal(await cache.getPost("01OLD"), null, "cache wiped despite store failure");

  // Flag must be released: a new login must work and unfence.
  await sdk.setSession({ accessToken: "next-at" });
  await tick();
  await cache.setPost("01NEW", { ulid: "01NEW" });
  assert.ok(await cache.getPost("01NEW"), "login after failed clearSession still works");
});

test("logout cannot be hung by a wedged cache wipe, and logins still work after", async () => {
  // Injected cache whose clearAll never settles — the iOS wedge case.
  const mockCache = {
    open: async () => {},
    clearAll: () => new Promise(() => {}),
    fenceWrites() {},
    unfenceWrites() {},
    stopTrimSchedule() {},
  };
  const sessionStore = createMockSessionStore({ accessToken: "at", refreshToken: "rt" });
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "at" }),
    sessionStore,
    cache: mockCache,
    dbName: uniqueDbName("signout-wedged-wipe"),
  });

  const started = Date.now();
  await sdk.logout();
  assert.ok(Date.now() - started < 8000, "logout bounded despite wedged clearAll");

  // signOutInProgress must not be latched: login persists and stays.
  await sdk.setSession({ accessToken: "next-at" });
  assert.equal(sdk.getTokens().accessToken, "next-at", "login works after wedged wipe");
  assert.equal(sessionStore.getSnapshot().accessToken, "next-at", "login persisted, not undone");
});

test("deletePost while fenced does not touch feed resources", async () => {
  const cache = new CacheDB(HOUR, uniqueDbName("fence-delete-post"));
  await cache.open();
  await cache.setFeedResource("/v1/feed", ["01A", "01B"]);

  cache.fenceWrites();
  await cache.deletePost("01A");
  cache.unfenceWrites();

  const feed = await cache.getFeedResource("/v1/feed");
  assert.deepEqual(feed.ulids, ["01A", "01B"], "feed membership untouched while fenced");
});

test("hung pre-logout refresh is not handed to the next session", async () => {
  let refreshCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      refreshCalls += 1;
      if (refreshCalls === 1) await new Promise(() => {}); // black hole
      return tokenResponse("fresh-at", "fresh-rt");
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };
  const sessionStore = createMockSessionStore({ accessToken: "at", refreshToken: "rt" });
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({ accessToken: "at", refreshToken: "rt" }),
    sessionStore,
    dbName: uniqueDbName("signout-stale-slot"),
  });

  void sdk.refreshToken(); // hangs forever in fetch
  await tick();
  await sdk.logout(); // waits 2s cap, then drops the stale in-flight slot

  await sdk.setSession({ accessToken: "new-at", refreshToken: "new-rt" });
  const refreshed = await sdk.refreshToken();
  assert.equal(refreshCalls, 2, "next session got a fresh refresh, not the hung one");
  assert.equal(refreshed.accessToken, "fresh-at");
});

test("acting context is cleared on sign-out (local and remote)", async () => {
  const dbName = uniqueDbName("signout-acting-context");
  const sdkA = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "a" }),
    dbName,
  });
  const sdkB = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "b" }),
    dbName,
  });
  sdkA.setActingContext({ token: "delegate-token", managedUserUlid: "01MU" });
  sdkB.setActingContext({ token: "delegate-token-b", managedUserUlid: "01MU" });

  await sdkA.logout();
  assert.equal(sdkA.actingContext, null, "originating tab acting context wiped");
  await waitFor(() => sdkB.actingContext === null);
});

test("remote sign-out blocks refreshes that start after the broadcast", async () => {
  const dbName = uniqueDbName("signout-remote-latch");
  let refreshCalls = 0;
  const fetchB = async (url) => {
    if (String(url).includes("/auth/refresh")) {
      refreshCalls += 1;
      return tokenResponse("zombie-at", "zombie-rt");
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };
  const sdkA = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "a" }),
    dbName,
  });
  const sdkB = new CcPlatformSdk({
    baseUrl,
    fetchImpl: fetchB,
    tokenProvider: new MemoryTokenProvider({ accessToken: "b", refreshToken: "rb" }),
    useRefreshCookie: true, // cookie mode: refresh could succeed with no local tokens
    dbName,
  });

  await sdkA.logout();
  await waitFor(() => sdkB.getTokens() === null);

  const refreshed = await sdkB.refreshToken(); // starts AFTER the broadcast
  assert.equal(refreshed, null, "post-broadcast refresh refused");
  assert.equal(refreshCalls, 0, "refused before any network call");

  // An explicit new session lifts the latch.
  await sdkB.setSession({ accessToken: "fresh", refreshToken: "fresh-rt" });
  const after = await sdkB.refreshToken();
  assert.ok(after, "refresh allowed again after explicit re-login");
});

test("login racing a sign-out fails loudly instead of returning discarded tokens", async () => {
  const dbName = uniqueDbName("signout-login-race");
  let releaseSave;
  const saveGate = new Promise((r) => {
    releaseSave = r;
  });
  let armed = true;
  let stored = null;
  const storeB = {
    async loadTokens() {
      return stored;
    },
    async saveTokens(t) {
      if (armed) {
        armed = false;
        await saveGate;
      }
      stored = t;
    },
    async clearTokens() {
      stored = null;
    },
  };
  const sdkA = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "a" }),
    dbName,
  });
  const sdkB = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider(),
    sessionStore: storeB,
    dbName,
  });

  const loginPromise = sdkB.setSession({ accessToken: "new-user", refreshToken: "new-rt" });
  await waitFor(() => armed === false); // parked inside saveTokens

  await sdkA.logout(); // broadcast bumps sdkB's epoch mid-persist
  await waitFor(() => sdkB.getTokens() === null || stored === null);
  releaseSave();

  await assert.rejects(() => loginPromise, /sign-out began/);
  assert.equal(sdkB.getTokens(), null, "discarded login leaves no tokens");
  assert.equal(stored, null, "discarded login leaves nothing persisted");
});

test("httpClient 401 latch resets when a new session is installed", async () => {
  let unauthorizedCalls = 0;
  let fail = true;
  const fetchImpl = async (url) => {
    if (String(url).includes("/v1/ping")) {
      return new Response("{}", { status: fail ? 401 : 200 });
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({ accessToken: "at" }),
    onUnauthorized: async () => {
      unauthorizedCalls += 1;
    },
    dbName: uniqueDbName("signout-latch-reset"),
  });

  // No onRefreshTokens configured: first 401 latches isLoggingOut.
  await sdk.client.get("/v1/ping").catch(() => {});
  assert.equal(unauthorizedCalls, 1, "first 401 cascade fired");
  await sdk.client.get("/v1/ping").catch(() => {});
  assert.equal(unauthorizedCalls, 1, "latched: no second cascade");

  sdk.setTokens({ accessToken: "fresh" }); // new session resets the latch
  await sdk.client.get("/v1/ping").catch(() => {});
  assert.equal(unauthorizedCalls, 2, "new session re-arms the 401 cascade");
});

test("persister removeClient works while writes are fenced", async () => {
  const { createDexieQueryPersister } = await import("../dist/persister.js");
  const cache = new CacheDB(HOUR, uniqueDbName("fence-persister"));
  await cache.open();
  const persister = createDexieQueryPersister(cache, { key: "qc" });

  await persister.persistClient({ some: "state" });
  assert.ok(await persister.restoreClient(), "persisted");

  cache.fenceWrites();
  await persister.removeClient();

  assert.equal(await persister.restoreClient(), undefined, "removed despite fence");
});

test("dispose() leaves an injected shared cache's trim schedule running", async () => {
  const cache = new CacheDB(HOUR, uniqueDbName("dispose-shared-cache"));
  await cache.open();
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: okFetch(),
    tokenProvider: new MemoryTokenProvider({ accessToken: "a" }),
    cache,
    dbName: uniqueDbName("dispose-shared"),
  });

  await sdk.dispose();
  assert.notEqual(cache.trimTimer, null, "shared cache trim schedule untouched");
  cache.stopTrimSchedule();
});
