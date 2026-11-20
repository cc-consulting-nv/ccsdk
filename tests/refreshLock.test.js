/**
 * Cross-tab refresh lock (navigator.locks) and cookie-mode invalid_grant retry.
 * "Tabs" are separate CcPlatformSdk instances sharing one storage mock.
 */
import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk, AuthSessionExpiredError } from "../dist/platformSdk.js";
import { HybridTokenProvider, MemoryTokenProvider, StorageTokenProvider } from "../dist/auth.js";

const baseUrl = "https://api.example.com";
const GLOBALS = ["navigator", "window", "document"];
const realGlobals = Object.fromEntries(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));

function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

/** Node 26 has navigator.locks but no window/document: plain-Node setup. */
function setNavigator(value) {
  setGlobal("navigator", value);
}

/** Browser-like setup: fake window + document, so the SDK uses the lock. */
function setBrowser(navigatorValue) {
  setGlobal("window", {});
  setGlobal("document", {});
  setGlobal("navigator", navigatorValue);
}

test.afterEach(() => {
  for (const k of GLOBALS) {
    if (realGlobals[k]) Object.defineProperty(globalThis, k, realGlobals[k]);
    else delete globalThis[k];
  }
});

/** Serialising fake of navigator.locks: one holder per name, FIFO queue. */
function fakeLocks() {
  const tails = new Map();
  const requested = [];
  return {
    requested,
    request(name, options, cb) {
      requested.push({ name, mode: options.mode });
      const prev = tails.get(name) ?? Promise.resolve();
      const run = prev.then(() => cb());
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

/** A lock manager whose lock is held forever by a hung tab. */
function hungLocks() {
  return {
    request(_name, options) {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    },
  };
}

function createMockStorage() {
  const store = new Map();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

const inAnHour = () => new Date(Date.now() + 3600_000).toISOString();

/**
 * Fake Passport /auth/refresh with rotation: only the current refresh token
 * is accepted; each success rotates it. Tracks overlap of in-flight calls.
 */
function rotatingServer(initial = "rt-0") {
  let current = initial;
  let n = 0;
  let inFlight = 0;
  const state = { calls: [], maxConcurrent: 0 };
  state.fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    state.calls.push(body.refresh_token);
    inFlight += 1;
    state.maxConcurrent = Math.max(state.maxConcurrent, inFlight);
    await new Promise((r) => setTimeout(r, 30));
    inFlight -= 1;
    if (body.refresh_token !== current) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    n += 1;
    current = `rt-${n}`;
    return new Response(
      JSON.stringify({ accessToken: `at-${n}`, refreshToken: current, expiresAt: inAnHour() }),
      { status: 200 },
    );
  };
  return state;
}

test("with navigator.locks, two instances refresh one after another, not in parallel", async () => {
  const locks = fakeLocks();
  setBrowser({ locks });
  const storage = createMockStorage();
  const server = rotatingServer();
  const mk = () =>
    new CcPlatformSdk({
      baseUrl,
      fetchImpl: server.fetchImpl,
      storage,
      tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-0", refreshToken: "rt-0" }),
    });
  const a = mk();
  const b = mk();

  const [ra, rb] = await Promise.all([a.refreshToken(), b.refreshToken()]);

  assert.equal(server.maxConcurrent, 1, "refresh calls never overlap");
  // Hybrid: B can't see A's in-memory access token, but re-reads the rotated
  // refresh token from shared storage instead of sending the stale one.
  assert.deepEqual(server.calls, ["rt-0", "rt-1"]);
  assert.ok(ra?.accessToken && rb?.accessToken, "both tabs keep a session");
  assert.equal(storage.getItem("refresh_token"), "rt-2");
  assert.ok(locks.requested.every((r) => r.name === `cc-refresh:${baseUrl}:CcPlatformSdkCache` && r.mode === "exclusive"));
});

test("storage mode: second instance reuses the pair another tab stored, no network call", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("auth_tokens", JSON.stringify({ accessToken: "at-0", refreshToken: "rt-0" }));
  const server = rotatingServer();
  const mk = () =>
    new CcPlatformSdk({
      baseUrl,
      fetchImpl: server.fetchImpl,
      storage,
      tokenProvider: new StorageTokenProvider(storage),
    });
  const a = mk();
  const b = mk();

  const [ra, rb] = await Promise.all([a.refreshToken(), b.refreshToken()]);

  assert.deepEqual(server.calls, ["rt-0"], "only one /auth/refresh, never with the stale token twice");
  assert.equal(ra.refreshToken, "rt-1");
  assert.equal(rb.refreshToken, "rt-1");
  assert.equal(rb.accessToken, "at-1");
});

test("without navigator.locks, behaviour matches today: per-instance dedupe only", async () => {
  setNavigator(undefined);
  const storage = createMockStorage();
  const server = rotatingServer();
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: server.fetchImpl,
    storage,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-0", refreshToken: "rt-0" }),
  });

  const [r1, r2] = await Promise.all([sdk.refreshToken(), sdk.refreshToken()]);

  assert.deepEqual(server.calls, ["rt-0"], "in-tab dedupe: one network call");
  assert.equal(r1, r2);

  // Two instances refresh in parallel, as before the lock existed.
  const s2 = createMockStorage();
  const server2 = rotatingServer();
  const mk = () =>
    new CcPlatformSdk({
      baseUrl,
      fetchImpl: server2.fetchImpl,
      storage: s2,
      tokenProvider: new HybridTokenProvider(s2, { accessToken: "at-0", refreshToken: "rt-0" }),
    });
  await Promise.all([mk().refreshToken(), mk().refreshToken()]);
  assert.equal(server2.maxConcurrent, 2);
});

test("lock timeout: refresh proceeds without the lock, after at least the worst-case hold", async () => {
  setBrowser({ locks: hungLocks() });
  const storage = createMockStorage();
  const server = rotatingServer();
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: server.fetchImpl,
    storage,
    // Below the floor: raised to 3 x 100 + max(1000, 800 + 0) + 1000 = 2300 ms.
    refreshLockTimeoutMs: 30,
    refreshRequestTimeoutMs: 100,
    refreshRetryDelayMs: 0,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-0", refreshToken: "rt-0" }),
  });

  const started = Date.now();
  const result = await sdk.refreshToken();

  assert.ok(Date.now() - started >= 2250, "waited the floored lock wait, not 30 ms");
  assert.equal(result?.accessToken, "at-1");
  assert.deepEqual(server.calls, ["rt-0"]);
});

test("refreshLockName option overrides the default lock name", async () => {
  const locks = fakeLocks();
  setBrowser({ locks });
  const server = rotatingServer();
  const storage = createMockStorage();
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: server.fetchImpl,
    storage,
    refreshLockName: "my-lock",
    tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-0", refreshToken: "rt-0" }),
  });
  await sdk.refreshToken();
  assert.deepEqual(locks.requested.map((r) => r.name), ["my-lock"]);
});

function cookieSdk(responses, extra = {}) {
  const calls = [];
  const storage = createMockStorage();
  let unauthorized = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), at: Date.now(), credentials: init?.credentials });
    const [status, body] = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(body), { status });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    storage,
    useRefreshCookie: true,
    refreshRetryDelayMs: 25,
    tokenProvider: new MemoryTokenProvider({ accessToken: "at-0" }),
    onUnauthorized: () => {
      unauthorized += 1;
    },
    ...extra,
  });
  return { sdk, calls, storage, unauthorized: () => unauthorized };
}

test("cookie mode: invalid_grant then 200 retries once after the delay, no sign-out", async () => {
  setBrowser({ locks: fakeLocks() });
  const { sdk, calls, storage } = cookieSdk([
    [400, { error: "invalid_grant", reason: "refresh_token_rotated", retryable: true }],
    [200, { accessToken: "at-1", expiresAt: inAnHour() }],
  ]);

  const result = await sdk.refreshTokenOrThrow();

  assert.equal(calls.length, 2);
  assert.ok(calls[1].at - calls[0].at >= 20, "waited ~refreshRetryDelayMs before retrying");
  assert.ok(calls.every((c) => c.credentials === "include"));
  assert.equal(result?.accessToken, "at-1");
  assert.ok(sdk.isAuthenticated());

  // The only key the new code writes is a numeric timestamp, never a token.
  const newKeys = [...storage.store.keys()].filter((k) => k.startsWith("cc-refresh"));
  assert.deepEqual(newKeys, [`cc-refresh:${baseUrl}:CcPlatformSdkCache:last-refresh-at`]);
  assert.match(storage.getItem(newKeys[0]), /^\d+$/);
  for (const [k, v] of storage.store) {
    assert.ok(!`${k}${v}`.includes("at-1"), `no token value in storage (${k})`);
  }
});

test("cookie mode: invalid_grant twice means exactly 2 calls, then the existing sign-out", async () => {
  setBrowser({ locks: fakeLocks() });
  const { sdk, calls } = cookieSdk([[400, { error: "invalid_grant" }]]);

  await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);

  assert.equal(calls.length, 2, "one retry, no loop");
  assert.ok(!sdk.isAuthenticated(), "session cleared as before");
});

test("cookie mode: a shaped 401 without invalid_grant is not retried", async () => {
  setBrowser({ locks: fakeLocks() });
  const { sdk, calls } = cookieSdk([[401, { message: "Unauthenticated." }]]);

  await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);
  assert.equal(calls.length, 1);
});

test("cookie mode: a network error is not retried by the invalid_grant path", async () => {
  setBrowser({ locks: fakeLocks() });
  let n = 0;
  const sdk = new CcPlatformSdk({
    baseUrl,
    storage: createMockStorage(),
    useRefreshCookie: true,
    refreshRetryDelayMs: 1,
    tokenProvider: new MemoryTokenProvider({ accessToken: "at-0" }),
    fetchImpl: async () => {
      n += 1;
      throw new TypeError("Failed to fetch");
    },
  });

  assert.equal(await sdk.refreshToken(), null, "transient, as before");
  assert.equal(n, 1);
});

/** A lock held by another tab until `release()`; then it serialises normally. */
function gatedLocks() {
  let release;
  const gate = new Promise((r) => (release = r));
  const requested = [];
  return {
    requested,
    release: () => release(),
    request(name, options, cb) {
      requested.push({ name, mode: options.mode });
      return gate.then(() => cb());
    },
  };
}

const jwt = (sub, jti) =>
  `h.${Buffer.from(JSON.stringify({ sub, jti })).toString("base64url")}.s`;

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function countingFetch(responder) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), refreshToken: body.refresh_token, at: Date.now() });
    return responder(String(url), calls.length);
  };
  return { calls, fetchImpl, refreshCalls: () => calls.filter((c) => c.url.endsWith("/auth/refresh") && !c.url.includes("/v1/")) };
}

const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

for (const kind of ["local", "remote"]) {
  test(`${kind} sign-out while waiting on the lock: no /auth/refresh, result null`, async () => {
    const locks = gatedLocks();
    setBrowser({ locks });
    const storage = createMockStorage();
    const f = countingFetch(() => ok({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: inAnHour() }));
    const sdk = new CcPlatformSdk({
      baseUrl,
      fetchImpl: f.fetchImpl,
      storage,
      tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-0", refreshToken: "rt-0" }),
    });

    const pending = sdk.refreshToken();
    await tick();
    assert.equal(locks.requested.length, 1, "waiting on the held lock");

    const signedOut = kind === "local" ? sdk.logout().catch(() => {}) : sdk.onRemoteSignOut();
    locks.release();

    assert.equal(await pending, null);
    await signedOut;
    assert.equal(f.refreshCalls().length, 0, "no refresh after sign-out");
  });
}

test("sign out and back in while waiting: stale refresh doesn't touch the new session", async () => {
  const locks = gatedLocks();
  setBrowser({ locks });
  const storage = createMockStorage();
  const f = countingFetch(() => ok({ accessToken: "at-x", refreshToken: "rt-x", expiresAt: inAnHour() }));
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: f.fetchImpl,
    storage,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-old", refreshToken: "rt-old" }),
  });

  const pending = sdk.refreshToken();
  await tick();
  sdk.onRemoteSignOut();
  await sdk.setSession({ accessToken: "at-new", refreshToken: "rt-new" });
  locks.release();

  assert.equal(await pending, null);
  assert.equal(f.refreshCalls().length, 0, "new session's refresh token not sent");
  assert.equal(sdk.getTokens().accessToken, "at-new");
  assert.equal(storage.getItem("refresh_token"), "rt-new");
});

test("plain Node (no window/document): navigator.locks present but never requested", async () => {
  const locks = fakeLocks();
  setNavigator({ locks });
  const storage = createMockStorage();
  const server = rotatingServer();
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: server.fetchImpl,
    storage,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-0", refreshToken: "rt-0" }),
  });

  assert.equal((await sdk.refreshToken())?.accessToken, "at-1");
  assert.equal(locks.requested.length, 0);
});

test("crossTabRefreshLock: true forces the lock in Node, false disables it in a browser", async () => {
  const forced = fakeLocks();
  setNavigator({ locks: forced });
  const s1 = createMockStorage();
  await new CcPlatformSdk({
    baseUrl,
    fetchImpl: rotatingServer().fetchImpl,
    storage: s1,
    crossTabRefreshLock: true,
    tokenProvider: new HybridTokenProvider(s1, { accessToken: "at-0", refreshToken: "rt-0" }),
  }).refreshToken();
  assert.equal(forced.requested.length, 1);

  const off = fakeLocks();
  setBrowser({ locks: off });
  const s2 = createMockStorage();
  await new CcPlatformSdk({
    baseUrl,
    fetchImpl: rotatingServer().fetchImpl,
    storage: s2,
    crossTabRefreshLock: false,
    tokenProvider: new HybridTokenProvider(s2, { accessToken: "at-0", refreshToken: "rt-0" }),
  }).refreshToken();
  assert.equal(off.requested.length, 0);
});

test("reuse: tokens another tab stored for a different user are not adopted", async () => {
  const locks = gatedLocks();
  setBrowser({ locks });
  const storage = createMockStorage();
  storage.setItem("auth_tokens", JSON.stringify({ accessToken: jwt("u1", 1), refreshToken: "rt-0" }));
  // Server rotates for u1; the u2 pair must not be returned without asking it.
  const f = countingFetch(() => ok({ accessToken: jwt("u1", 2), refreshToken: "rt-1", expiresAt: inAnHour() }));
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: f.fetchImpl,
    storage,
    tokenProvider: new StorageTokenProvider(storage),
  });

  const pending = sdk.refreshToken();
  await tick();
  const other = { accessToken: jwt("u2", 1), refreshToken: "rt-u2", expiresAt: inAnHour() };
  storage.setItem("auth_tokens", JSON.stringify(other));
  locks.release();
  const result = await pending;

  assert.equal(f.refreshCalls().length, 1, "went to the network instead of adopting");
  assert.notEqual(result?.accessToken, other.accessToken);
});

test("cookie mode: a 5xx with retryable: true gets only the 5xx retry, not the cookie retry", async () => {
  setBrowser({ locks: fakeLocks() });
  const { sdk, calls } = cookieSdk([[503, { retryable: true }]]);

  assert.equal(await sdk.refreshTokenOrThrow(), null, "transient, as before");
  assert.equal(calls.length, 2, "original + the existing 5xx retry");
});

test("cookie mode: skips the retry delay when another tab refreshed since the attempt started", async () => {
  setBrowser({ locks: fakeLocks() });
  const { sdk, calls, storage } = cookieSdk(
    [
      [400, { error: "invalid_grant" }],
      [200, { accessToken: "at-1", expiresAt: inAnHour() }],
    ],
    { refreshRetryDelayMs: 5000 },
  );
  // Another tab records a successful refresh right after our attempt starts.
  const origGet = storage.getItem;
  storage.getItem = (key) =>
    key.endsWith(":last-refresh-at") && calls.length ? String(calls[0].at + 1) : origGet(key);

  const started = Date.now();
  const result = await sdk.refreshTokenOrThrow();

  assert.equal(result?.accessToken, "at-1");
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started < 1000, "did not wait refreshRetryDelayMs");
});

test("cookie mode: sign-out during the retry delay means no retry", async () => {
  setBrowser({ locks: fakeLocks() });
  const { sdk, calls } = cookieSdk([
    [400, { error: "invalid_grant" }],
    [200, { accessToken: "at-1", expiresAt: inAnHour() }],
  ], { refreshRetryDelayMs: 50 });

  const pending = sdk.refreshTokenOrThrow();
  while (calls.length === 0) await tick(1);
  await tick(10);
  sdk.onRemoteSignOut();

  assert.equal(await pending, null);
  assert.equal(calls.length, 1, "retry not sent after sign-out");
});

test("unlocked race + invalid_grant: tab B adopts tab A's rotated pair instead of clearing storage", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("auth_tokens", JSON.stringify({ accessToken: "at-0", refreshToken: "rt-0" }));
  const server = rotatingServer();
  const mk = (extra) =>
    new CcPlatformSdk({ baseUrl, fetchImpl: server.fetchImpl, storage, tokenProvider: new StorageTokenProvider(storage), ...extra });
  // Neither takes the lock (as when a lock wait times out), so they race.
  const a = mk({ crossTabRefreshLock: false });
  const b = mk({ crossTabRefreshLock: false });

  const pa = a.refreshTokenOrThrow();
  const rb = await b.refreshTokenOrThrow();
  const ra = await pa;

  assert.deepEqual(server.calls, ["rt-0", "rt-0"], "B sent the stale token and lost");
  assert.equal(ra.refreshToken, "rt-1");
  assert.equal(rb?.refreshToken, "rt-1", "B adopted A's pair");
  assert.equal(rb?.accessToken, "at-1");
  assert.equal(JSON.parse(storage.getItem("auth_tokens")).refreshToken, "rt-1", "storage not wiped");
});

test("unlocked race + invalid_grant, hybrid: tab B retries once with the stored rotated refresh token", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  const server = rotatingServer();
  const mk = (extra) =>
    new CcPlatformSdk({
      baseUrl,
      fetchImpl: server.fetchImpl,
      storage,
      tokenProvider: new HybridTokenProvider(storage, { accessToken: jwt("u1", 0), refreshToken: "rt-0" }),
      ...extra,
    });
  const a = mk({ crossTabRefreshLock: false });
  const b = mk({ crossTabRefreshLock: false });

  const pa = a.refreshTokenOrThrow();
  const rb = await b.refreshTokenOrThrow();
  await pa;

  // B can't see A's in-memory access token, so it retries with A's rt-1.
  assert.deepEqual(server.calls, ["rt-0", "rt-0", "rt-1"]);
  assert.equal(rb?.accessToken, "at-2");
  assert.equal(storage.getItem("refresh_token"), "rt-2", "nobody logged out");
});

test("invalid_grant with storage unchanged still clears and throws AuthSessionExpiredError", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("auth_tokens", JSON.stringify({ accessToken: "at-0", refreshToken: "rt-dead" }));
  const f = countingFetch(() => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl: f.fetchImpl, storage, tokenProvider: new StorageTokenProvider(storage) });

  await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);
  assert.equal(f.refreshCalls().length, 1);
  assert.equal(storage.getItem("auth_tokens"), null);
});

test("refresh request timeout: hung fetch is aborted, lock released, session kept", async () => {
  const locks = fakeLocks();
  setBrowser({ locks });
  const storage = createMockStorage();
  let signal;
  let hang = true;
  const fetchImpl = async (_url, init) => {
    if (hang) {
      signal = init.signal;
      return new Promise(() => {}); // never settles, ignores the signal
    }
    return ok({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: inAnHour() });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    storage,
    refreshRequestTimeoutMs: 30,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-0", refreshToken: "rt-0" }),
  });

  assert.equal(await sdk.refreshTokenOrThrow(), null, "timeout is transient");
  assert.equal(signal?.aborted, true);
  assert.equal(storage.getItem("refresh_token"), "rt-0", "session not cleared");

  hang = false;
  const second = await sdk.refreshTokenOrThrow(); // would hang if the lock were still held
  assert.equal(second?.accessToken, "at-1");
  assert.equal(locks.requested.length, 2);
});

test("another tab clears storage while we wait for the lock: no POST, null, token not resurrected", async () => {
  const locks = gatedLocks();
  setBrowser({ locks });
  const storage = createMockStorage();
  const f = countingFetch(() => ok({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: inAnHour() }));
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: f.fetchImpl,
    storage,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-0", refreshToken: "rt-0" }),
  });

  const pending = sdk.refreshToken();
  await tick();
  storage.removeItem("refresh_token");
  locks.release();

  assert.equal(await pending, null);
  assert.equal(f.refreshCalls().length, 0);
  assert.equal(storage.getItem("refresh_token"), null);
});

test("lock name and last-refresh-at key are per dbName", async () => {
  const locks = fakeLocks();
  setBrowser({ locks });
  const storage = createMockStorage();
  const f = countingFetch(() => ok({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: inAnHour() }));
  const mk = (dbName) =>
    new CcPlatformSdk({
      baseUrl,
      dbName,
      fetchImpl: f.fetchImpl,
      storage,
      tokenProvider: new MemoryTokenProvider({ accessToken: "at-0", refreshToken: "rt-0" }),
    });

  await mk("p1").refreshToken();
  await mk("p2").refreshToken();
  await mk("p1").refreshToken();

  assert.deepEqual(locks.requested.map((r) => r.name), [
    `cc-refresh:${baseUrl}:p1`,
    `cc-refresh:${baseUrl}:p2`,
    `cc-refresh:${baseUrl}:p1`,
  ]);
  const keys = [...storage.store.keys()].filter((k) => k.endsWith(":last-refresh-at")).sort();
  assert.deepEqual(keys, [`cc-refresh:${baseUrl}:p1:last-refresh-at`, `cc-refresh:${baseUrl}:p2:last-refresh-at`]);
});

/**
 * Fake of cc-api's /auth/refresh: a body refresh_token wins over the cookie
 * (the cookie is read only when the body has none); each success rotates the
 * token, revokes the old one and sets the shared cookie jar.
 */
function ccApiServer(sub = "u1") {
  const jar = { cookie: "rt-0" };
  let current = "rt-0";
  let n = 0;
  const forTab = () => {
    const posts = [];
    const fetchImpl = async (_url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      posts.push(body);
      const presented = "refresh_token" in body ? body.refresh_token : jar.cookie;
      if (presented !== current) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      n += 1;
      current = `rt-${n}`;
      jar.cookie = current;
      return ok({ accessToken: jwt(sub, n), refreshToken: current, expiresAt: inAnHour() });
    };
    return { posts, fetchImpl };
  };
  return { jar, forTab };
}

test("incident: cookie mode with a per-tab body token, another tab rotated: retry sends no body and uses the cookie", async () => {
  setBrowser({ locks: fakeLocks() });
  const server = ccApiServer();
  const mk = (tab) =>
    new CcPlatformSdk({
      baseUrl,
      fetchImpl: tab.fetchImpl,
      storage: createMockStorage(),
      useRefreshCookie: true,
      refreshRetryDelayMs: 25,
      tokenProvider: new MemoryTokenProvider({ accessToken: jwt("u1", 0), refreshToken: "rt-0" }),
    });
  const tabB = server.forTab();
  const tabA = server.forTab();
  const b = mk(tabB);
  const a = mk(tabA);

  // Tab B rotates first: cookie jar now rt-1, rt-0 revoked.
  assert.equal((await b.refreshTokenOrThrow())?.refreshToken, "rt-1");
  assert.equal(server.jar.cookie, "rt-1");

  const result = await a.refreshTokenOrThrow();

  assert.equal(tabA.posts.length, 2, "exactly 2 POSTs");
  assert.deepEqual(tabA.posts[0], { refresh_token: "rt-0" });
  assert.ok(!("refresh_token" in tabA.posts[1]), "retry had no body refresh_token");
  assert.equal(result?.accessToken, jwt("u1", 2));
  assert.ok(a.isAuthenticated(), "session kept");
  assert.equal(server.jar.cookie, "rt-2");
});

test("adopt-or-retry: another user's tokens in shared storage are not POSTed, storage untouched, null", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("auth_tokens", JSON.stringify({ accessToken: jwt("u1", 1), refreshToken: "rt-0" }));
  const other = JSON.stringify({ accessToken: jwt("u2", 1), refreshToken: "rt-u2", expiresAt: inAnHour() });
  const f = countingFetch(() => {
    // Another tab signs in as u2 while our rt-0 is being rejected.
    storage.setItem("auth_tokens", other);
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl: f.fetchImpl, storage, tokenProvider: new StorageTokenProvider(storage) });

  const result = await sdk.refreshTokenOrThrow();

  assert.equal(result, null);
  assert.deepEqual(f.refreshCalls().map((c) => c.refreshToken), ["rt-0"], "rt-u2 never sent");
  assert.equal(storage.getItem("auth_tokens"), other, "storage untouched");
});

test("timing options: lock wait always exceeds the worst-case hold; bad values fall back", () => {
  const mk = (extra) =>
    new CcPlatformSdk({ baseUrl, storage: createMockStorage(), fetchImpl: async () => ok({}), ...extra })["refreshTimings"];
  const worstHold = (t) => 3 * t.requestTimeoutMs + Math.max(1000, 800 + t.retryDelayMs);

  const d = mk({});
  assert.equal(d.requestTimeoutMs, 8000);
  assert.equal(d.retryDelayMs, 400);
  assert.equal(d.holdBudgetMs, worstHold(d));
  assert.equal(d.holdBudgetMs, 25_200);
  assert.ok(d.lockWaitMs > d.holdBudgetMs);
  assert.equal(d.lockWaitMs, 26_200);

  assert.equal(mk({ refreshLockTimeoutMs: 5 }).lockWaitMs, 26_200, "explicit value below the floor is raised");
  assert.equal(mk({ refreshLockTimeoutMs: 60_000 }).lockWaitMs, 60_000, "explicit value above the floor kept");
  for (const bad of [0, -1, NaN, Infinity]) {
    const t = mk({ refreshRequestTimeoutMs: bad, refreshLockTimeoutMs: bad, refreshRetryDelayMs: bad });
    assert.equal(t.requestTimeoutMs, 8000, `requestTimeout ${bad}`);
    assert.ok(t.lockWaitMs > worstHold(t), `lockWait ${bad}`);
  }
  const huge = mk({ refreshRequestTimeoutMs: 2 ** 40, refreshLockTimeoutMs: 2 ** 40 });
  assert.equal(huge.requestTimeoutMs, 600_000);
  assert.ok(huge.lockWaitMs <= 2 ** 31 - 1 && huge.lockWaitMs > worstHold(huge));
});

/** Serialising navigator.locks fake that honours `signal` like the real one. */
function abortableLocks() {
  let tail = Promise.resolve();
  const state = { aborted: 0, granted: 0 };
  state.request = (_name, options, cb) =>
    new Promise((resolve, reject) => {
      let granted = false;
      let aborted = false;
      let release;
      const held = new Promise((r) => (release = r));
      const prev = tail;
      tail = prev.then(() => held);
      options.signal?.addEventListener("abort", () => {
        if (granted) return;
        aborted = true;
        state.aborted += 1;
        release();
        reject(new DOMException("aborted", "AbortError"));
      });
      prev.then(async () => {
        if (aborted) return;
        granted = true;
        state.granted += 1;
        try {
          resolve(await cb());
        } catch (e) {
          reject(e);
        } finally {
          release();
        }
      });
    });
  return state;
}

test("slow server: a second tab waits out a 3-POST hold and gets the lock, no unlocked fallback", async () => {
  const locks = abortableLocks();
  setBrowser({ locks });
  let inFlight = 0;
  let maxConcurrent = 0;
  const tabFetch = (script) => {
    const calls = [];
    const fetchImpl = async () => {
      calls.push(Date.now());
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await tick(90);
      inFlight -= 1;
      const [status, body] = script[Math.min(calls.length - 1, script.length - 1)];
      return new Response(body, { status });
    };
    return { calls, fetchImpl };
  };
  const ok1 = JSON.stringify({ accessToken: jwt("u1", 1), refreshToken: "rt-1", expiresAt: inAnHour() });
  // A: ambiguous 401 -> retry gets invalid_grant -> adopt poll -> cookie retry 200.
  const fa = tabFetch([[401, ""], [400, JSON.stringify({ error: "invalid_grant" })], [200, ok1]]);
  const fb = tabFetch([[200, ok1]]);
  const mk = (f) =>
    new CcPlatformSdk({
      baseUrl,
      fetchImpl: f.fetchImpl,
      storage: createMockStorage(),
      useRefreshCookie: true,
      refreshRequestTimeoutMs: 100,
      refreshRetryDelayMs: 0,
      tokenProvider: new MemoryTokenProvider({ accessToken: jwt("u1", 0), refreshToken: "rt-0" }),
    });
  const a = mk(fa);
  const b = mk(fb);
  assert.equal(b["refreshTimings"].lockWaitMs, 2300);

  const pa = a.refreshTokenOrThrow();
  await tick(5);
  const started = Date.now();
  const rb = await b.refreshTokenOrThrow();
  const ra = await pa;

  assert.equal(fa.calls.length, 3, "A used all 3 POSTs");
  assert.ok(Date.now() - started > 900, "B really waited on A's hold");
  assert.equal(locks.aborted, 0, "B never gave up on the lock");
  assert.equal(locks.granted, 2);
  assert.equal(maxConcurrent, 1, "B's POST never overlapped A's");
  assert.ok(ra?.accessToken && rb?.accessToken);
});
