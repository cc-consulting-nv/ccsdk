/**
 * Cross-tab refresh lock (navigator.locks) and cookie-mode invalid_grant retry.
 * "Tabs" are separate CcPlatformSdk instances sharing one storage mock.
 */
import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk, AuthSessionExpiredError } from "../dist/platformSdk.js";
import { HybridTokenProvider, MemoryTokenProvider, StorageTokenProvider } from "../dist/auth.js";
import { SessionManager, createStorageProfileRegistry } from "../dist/sessionManager.js";

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
function rotatingServer(initial = "rt-0", accessFor = (n) => `at-${n}`) {
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
      JSON.stringify({ accessToken: accessFor(n), refreshToken: current, expiresAt: inAnHour() }),
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
  storage.setItem("auth_tokens", JSON.stringify({ accessToken: jwt("u1", 0), refreshToken: "rt-0" }));
  const server = rotatingServer("rt-0", (n) => jwt("u1", n));
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
  assert.equal(rb.accessToken, jwt("u1", 1));
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
    tokenProvider: new MemoryTokenProvider({ accessToken: jwt("u1", 0) }),
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
    [200, { accessToken: jwt("u1", 1), expiresAt: inAnHour() }],
  ]);

  const result = await sdk.refreshTokenOrThrow();

  assert.equal(calls.length, 2);
  assert.ok(calls[1].at - calls[0].at >= 20, "waited ~refreshRetryDelayMs before retrying");
  assert.ok(calls.every((c) => c.credentials === "include"));
  assert.equal(result?.accessToken, jwt("u1", 1));
  assert.ok(sdk.isAuthenticated());

  // The only key the new code writes is a numeric timestamp, never a token.
  const newKeys = [...storage.store.keys()].filter((k) => k.startsWith("cc-refresh"));
  assert.deepEqual(newKeys, [`cc-refresh:${baseUrl}:CcPlatformSdkCache:last-refresh-at`]);
  assert.match(storage.getItem(newKeys[0]), /^\d+$/);
  for (const [k, v] of storage.store) {
    assert.ok(!`${k}${v}`.includes(jwt("u1", 1)), `no token value in storage (${k})`);
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

test("reuse: tokens another tab stored for a different user are not adopted or rotated", async () => {
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

  assert.equal(f.refreshCalls().length, 0, "u2's refresh token not POSTed");
  assert.equal(result, null);
  assert.deepEqual(JSON.parse(storage.getItem("auth_tokens")), other);
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
      [200, { accessToken: jwt("u1", 1), expiresAt: inAnHour() }],
    ],
    { refreshRetryDelayMs: 5000 },
  );
  // Another tab records a successful refresh right after our attempt starts.
  const origGet = storage.getItem;
  storage.getItem = (key) =>
    key.endsWith(":last-refresh-at") && calls.length ? String(calls[0].at + 1) : origGet(key);

  const started = Date.now();
  const result = await sdk.refreshTokenOrThrow();

  assert.equal(result?.accessToken, jwt("u1", 1));
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started < 1000, "did not wait refreshRetryDelayMs");
});

test("cookie mode: sign-out during the retry delay means no retry", async () => {
  setBrowser({ locks: fakeLocks() });
  const { sdk, calls } = cookieSdk([
    [400, { error: "invalid_grant" }],
    [200, { accessToken: jwt("u1", 1), expiresAt: inAnHour() }],
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
  storage.setItem("auth_tokens", JSON.stringify({ accessToken: jwt("u1", 0), refreshToken: "rt-0" }));
  const server = rotatingServer("rt-0", (n) => jwt("u1", n));
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
  assert.equal(rb?.accessToken, jwt("u1", 1));
  assert.equal(JSON.parse(storage.getItem("auth_tokens")).refreshToken, "rt-1", "storage not wiped");
});

test("unlocked race + invalid_grant, hybrid: tab B can't verify the stored token's owner, returns null, sends it next time", async () => {
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

  // B can't see A's in-memory access token, so it can't tell rt-1 is u1's:
  // transient null, no sign-out. Its next refresh sends rt-1 normally.
  assert.deepEqual(server.calls, ["rt-0", "rt-0"]);
  assert.equal(rb, null);
  assert.equal(storage.getItem("refresh_token"), "rt-1", "nobody logged out");
  assert.equal((await b.refreshTokenOrThrow())?.accessToken, "at-2");
  assert.deepEqual(server.calls, ["rt-0", "rt-0", "rt-1"]);
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

// --- Review 4 regressions -------------------------------------------------

const invalidGrant = () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });

/** Cookie-mode SDK, no stored refresh token, POSTs answered by `script(n)`. */
function scriptedCookieSdk(script, extra = {}) {
  let n = 0;
  const sdk = new CcPlatformSdk({
    baseUrl,
    storage: createMockStorage(),
    useRefreshCookie: true,
    refreshRetryDelayMs: 1,
    refreshRequestTimeoutMs: 50,
    tokenProvider: new MemoryTokenProvider({ accessToken: jwt("u1", 0) }),
    fetchImpl: async () => script(++n),
    ...extra,
  });
  return { sdk, posts: () => n };
}

for (const [kind, second] of [
  ["503", () => new Response("{}", { status: 503 })],
  ["network error", () => { throw new TypeError("Failed to fetch"); }],
  ["timeout", () => new Promise(() => {})],
]) {
  test(`cookie mode: invalid_grant then retry ${kind} keeps the rejection and signs out`, async () => {
    setBrowser({ locks: fakeLocks() });
    const { sdk, posts } = scriptedCookieSdk((n) => (n === 1 ? invalidGrant() : second()));

    await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);
    assert.equal(posts(), 2);
    assert.ok(!sdk.isAuthenticated(), "session cleared");
  });
}

/** Hybrid tab whose POSTs are answered by `script(n, body)`; storage shared via `storage`. */
function scriptedTab(storage, script) {
  const posts = [];
  const sdk = new CcPlatformSdk({
    baseUrl,
    storage,
    refreshRequestTimeoutMs: 50,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: jwt("u1", 0) }),
    fetchImpl: async (_url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      posts.push(body.refresh_token);
      return script(posts.length, body);
    },
  });
  return { sdk, posts };
}

test("timeout then invalid_grant for the same token: one transient null, then sign-out", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("refresh_token", "rt-0");
  const { sdk, posts } = scriptedTab(storage, (n) => (n === 1 ? new Promise(() => {}) : invalidGrant()));

  assert.equal(await sdk.refreshTokenOrThrow(), null, "timeout is transient");
  for (const [k, v] of storage.store) assert.ok(!(k.endsWith("refresh-timeout-at") && v.includes("rt-")), "no token in marker");

  assert.equal(await sdk.refreshTokenOrThrow(), null, "server may have rotated on the timed-out POST");
  assert.equal(storage.getItem("refresh_token"), "rt-0", "session kept");

  await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);
  assert.equal(storage.getItem("refresh_token"), null, "dead token signs out on the next attempt");
  assert.deepEqual(posts, ["rt-0", "rt-0", "rt-0"]);
});

test("timeout in one tab gives another tab's invalid_grant the same one-pass grace", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("refresh_token", "rt-0");
  const a = scriptedTab(storage, () => new Promise(() => {}));
  const b = scriptedTab(storage, () => invalidGrant());

  assert.equal(await a.sdk.refreshTokenOrThrow(), null);
  assert.equal(await b.sdk.refreshTokenOrThrow(), null, "grace from the shared marker");
  assert.equal(storage.getItem("refresh_token"), "rt-0");
  await assert.rejects(b.sdk.refreshTokenOrThrow(), AuthSessionExpiredError);
});

test("a successful refresh clears the timeout marker: the next invalid_grant signs out", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("refresh_token", "rt-0");
  const { sdk } = scriptedTab(storage, (n) =>
    n === 1
      ? new Promise(() => {})
      : n === 2
        ? ok({ accessToken: jwt("u1", 1), refreshToken: "rt-1", expiresAt: inAnHour() })
        : invalidGrant(),
  );

  assert.equal(await sdk.refreshTokenOrThrow(), null);
  assert.equal((await sdk.refreshTokenOrThrow())?.refreshToken, "rt-1");
  await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);
});

/** Async sessionStore whose loadTokens answers `script(n)` (may throw). */
function scriptedSessionStore(script) {
  let n = 0;
  let saved = null;
  return {
    reads: () => n,
    saved: () => saved,
    async loadTokens() {
      return script(++n, saved);
    },
    async saveTokens(t) {
      saved = t;
    },
    async clearTokens() {
      saved = "cleared";
    },
  };
}

test("cookie retry: another user's stored refresh token is never sent; retry goes cookie-only", async () => {
  setBrowser({ locks: fakeLocks() });
  const u2 = { accessToken: jwt("u2", 1), refreshToken: "rt-u2", expiresAt: inAnHour() };
  let otherTabSignedIn = false;
  const store = scriptedSessionStore(() => (otherTabSignedIn ? u2 : null));
  const bodies = [];
  const sdk = new CcPlatformSdk({
    baseUrl,
    storage: createMockStorage(),
    sessionStore: store,
    useRefreshCookie: true,
    refreshRetryDelayMs: 1,
    tokenProvider: new MemoryTokenProvider({ accessToken: jwt("u1", 0) }),
    fetchImpl: async (_url, init) => {
      bodies.push(init?.body ? JSON.parse(init.body) : {});
      otherTabSignedIn = true; // another tab signs in as u2 meanwhile
      return invalidGrant();
    },
  });

  await sdk.refreshToken();

  assert.equal(bodies.length, 2);
  assert.ok(bodies.every((b) => !("refresh_token" in b)), "rt-u2 never sent");
});

test("sessionStore read throwing after the lock: no sign-out, onUnauthorized not called, null", async () => {
  setBrowser({ locks: fakeLocks() });
  const store = scriptedSessionStore((n) => {
    if (n === 1) return { accessToken: jwt("u1", 0), refreshToken: "rt-0" };
    throw new Error("IndexedDB unavailable");
  });
  let unauthorized = 0;
  const f = countingFetch((url) => (url.endsWith("/auth/refresh") ? invalidGrant() : new Response("{}", { status: 401 })));
  const sdk = new CcPlatformSdk({
    baseUrl,
    storage: createMockStorage(),
    sessionStore: store,
    fetchImpl: f.fetchImpl,
    onRefreshTokens: () => sdk.refreshTokenOrThrow(),
    onUnauthorized: () => {
      unauthorized += 1;
    },
  });

  await assert.rejects(sdk["client"].get("/v1/me"));
  assert.equal(unauthorized, 0, "store read failure is transient");
  assert.equal(store.saved(), null, "nothing cleared");
  assert.equal(f.refreshCalls().length, 0);
});

test("sessionStore read throwing during the adopt poll: null, no clear", async () => {
  setBrowser({ locks: fakeLocks() });
  const store = scriptedSessionStore((n) => {
    if (n <= 2) return { accessToken: jwt("u1", 0), refreshToken: "rt-0" };
    throw new Error("IndexedDB unavailable");
  });
  const sdk = new CcPlatformSdk({
    baseUrl,
    storage: createMockStorage(),
    sessionStore: store,
    fetchImpl: async () => invalidGrant(),
  });

  assert.equal(await sdk.refreshTokenOrThrow(), null);
  assert.equal(store.saved(), null, "nothing cleared");
});

test("store moved on after the adopt poll: final invalid_grant returns null and doesn't clear", async () => {
  setBrowser({ locks: fakeLocks() });
  const dead = { accessToken: jwt("u1", 0), refreshToken: "rt-0" };
  const moved = { accessToken: jwt("u1", 1), refreshToken: "rt-1", expiresAt: inAnHour() };
  // Reads: pre-lock, post-lock, 3 adopt polls see rt-0; the final read sees rt-1.
  const store = scriptedSessionStore((n) => (n <= 5 ? dead : moved));
  const f = countingFetch(() => invalidGrant());
  const sdk = new CcPlatformSdk({ baseUrl, storage: createMockStorage(), sessionStore: store, fetchImpl: f.fetchImpl });

  assert.equal(await sdk.refreshTokenOrThrow(), null);
  assert.equal(store.reads(), 6);
  assert.equal(store.saved(), null, "not cleared");
  assert.equal(f.refreshCalls().length, 1);
});

test("hold budget clips the last POST's timeout to what's left", async () => {
  setBrowser({ locks: fakeLocks() });
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    const starts = [];
    const sdk = new CcPlatformSdk({
      baseUrl,
      storage: createMockStorage(),
      refreshRequestTimeoutMs: 2000, // budget 3 x 2000 + 1000 = 7000
      tokenProvider: new MemoryTokenProvider({ accessToken: "at-0", refreshToken: "rt-0" }),
      fetchImpl: async () => {
        starts.push(realNow());
        if (starts.length === 1) {
          skew = 5900; // pretend 5.9 s passed: ~100 ms of budget left after the 1 s 5xx wait
          return new Response("{}", { status: 503 });
        }
        return new Promise(() => {});
      },
    });

    const t0 = realNow();
    assert.equal(await sdk.refreshTokenOrThrow(), null);
    assert.equal(starts.length, 2);
    assert.ok(realNow() - starts[1] < 1000, `second POST aborted at the budget, not after 2 s (${realNow() - starts[1]} ms)`);
    assert.ok(realNow() - t0 < 2500);
  } finally {
    Date.now = realNow;
  }
});

test("adopt without sessionStore: an expired stored pair isn't adopted; its refresh token is used", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("auth_tokens", JSON.stringify({ accessToken: jwt("u1", 0), refreshToken: "rt-0" }));
  const f = countingFetch((_url, n) => {
    if (n === 1) {
      storage.setItem(
        "auth_tokens",
        JSON.stringify({ accessToken: jwt("u1", 1), refreshToken: "rt-1", expiresAt: new Date(Date.now() - 1000).toISOString() }),
      );
      return invalidGrant();
    }
    return ok({ accessToken: jwt("u1", 2), refreshToken: "rt-2", expiresAt: inAnHour() });
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl: f.fetchImpl, storage, tokenProvider: new StorageTokenProvider(storage) });

  const result = await sdk.refreshTokenOrThrow();

  assert.deepEqual(f.refreshCalls().map((c) => c.refreshToken), ["rt-0", "rt-1"]);
  assert.equal(result?.accessToken, jwt("u1", 2));
});

test("post-lock reuse needs a new access token: same bearer + rotated refresh token still POSTs", async () => {
  const locks = gatedLocks();
  setBrowser({ locks });
  const storage = createMockStorage();
  const f = countingFetch(() => ok({ accessToken: jwt("u1", 2), refreshToken: "rt-2", expiresAt: inAnHour() }));
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: f.fetchImpl,
    storage,
    // Live-looking bearer the server just 401'd; that's why we refresh.
    tokenProvider: new HybridTokenProvider(storage, { accessToken: jwt("u1", 0), refreshToken: "rt-0", expiresAt: inAnHour() }),
  });

  const pending = sdk.refreshToken();
  await tick();
  storage.setItem("refresh_token", "rt-1"); // another tab rotated
  locks.release();

  assert.equal((await pending)?.accessToken, jwt("u1", 2));
  assert.deepEqual(f.refreshCalls().map((c) => c.refreshToken), ["rt-1"]);
});

// --- Review 5 regressions -------------------------------------------------

/** Per-profile sessionStore (SessionManager keys one per profile). */
function profileStore(initial) {
  let tokens = initial;
  const saves = [];
  return {
    saves,
    current: () => tokens,
    async loadTokens() {
      return tokens;
    },
    async saveTokens(t) {
      saves.push(t);
      tokens = t;
    },
    async clearTokens() {
      saves.push(null);
      tokens = null;
    },
  };
}

/**
 * One browser cookie jar shared by every profile. A body refresh_token wins;
 * with no body the server answers for whoever the cookie names.
 */
function sharedCookieServer(cookieAccess) {
  const posts = [];
  const fetchImpl = async (_url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    posts.push(body);
    if ("refresh_token" in body) return invalidGrant();
    return ok({ accessToken: cookieAccess(), refreshToken: "rt-cookie-next", expiresAt: inAnHour() });
  };
  return { posts, fetchImpl };
}

function cookieProfile(dbName, store, fetchImpl, accessToken) {
  return new CcPlatformSdk({
    baseUrl,
    dbName,
    fetchImpl,
    storage: createMockStorage(),
    sessionStore: store,
    useRefreshCookie: true,
    refreshRetryDelayMs: 1,
    tokenProvider: new MemoryTokenProvider(accessToken ? { accessToken } : undefined),
  });
}

test("C1: reloaded cookie-mode profile with no bearer never installs the cookie owner's (B's) tokens", async () => {
  setBrowser({ locks: fakeLocks() });
  const server = sharedCookieServer(() => jwt("uB", 9));
  const storeA = profileStore({ refreshToken: "rt-a-dead" });
  const bTokens = { accessToken: jwt("uB", 1), refreshToken: "rt-b", expiresAt: inAnHour() };
  const storeB = profileStore(bTokens);
  const a = cookieProfile("profile-a", storeA, server.fetchImpl);
  cookieProfile("profile-b", storeB, server.fetchImpl, bTokens.accessToken);

  const result = await a.refreshTokenOrThrow().catch((e) => e);

  assert.ok(result === null || result instanceof AuthSessionExpiredError, `unexpected ${result}`);
  assert.ok(server.posts.every((b) => "refresh_token" in b), "no cookie-only POST");
  assert.ok(!storeA.saves.some((t) => t && t.accessToken === jwt("uB", 9)), "B's tokens never saved into A");
  assert.notEqual(a.getTokens()?.accessToken, jwt("uB", 9), "B's bearer not in A's memory");
  assert.deepEqual(storeB.current(), bTokens, "B's store untouched");
});

for (const [kind, cookieAccess] of [
  ["B's JWT", () => jwt("uB", 9)],
  ["an opaque bearer", () => "opaque-cookie-bearer"],
]) {
  test(`C1: profile A with a decodable bearer, cookie answers with ${kind}: rejected, nothing saved, null`, async () => {
    setBrowser({ locks: fakeLocks() });
    const server = sharedCookieServer(cookieAccess);
    const aTokens = { accessToken: jwt("uA", 0), refreshToken: "rt-a-dead" };
    const storeA = profileStore(aTokens);
    const a = cookieProfile("profile-a", storeA, server.fetchImpl, aTokens.accessToken);

    const result = await a.refreshTokenOrThrow();

    assert.equal(result, null, "transient: profile A not signed out");
    assert.equal(server.posts.length, 2);
    assert.ok(!("refresh_token" in server.posts[1]), "the retry was cookie-only");
    assert.deepEqual(storeA.saves, [], "A's store untouched");
    assert.equal(a.getTokens()?.accessToken, jwt("uA", 0));
  });
}

test("C1: happy path, A's cookie rotated by another tab of A: cookie-only retry installs A's new tokens", async () => {
  setBrowser({ locks: fakeLocks() });
  const server = sharedCookieServer(() => jwt("uA", 2));
  const storeA = profileStore({ accessToken: jwt("uA", 0), refreshToken: "rt-a-dead" });
  const a = cookieProfile("profile-a", storeA, server.fetchImpl, jwt("uA", 0));

  const result = await a.refreshTokenOrThrow();

  assert.equal(result?.accessToken, jwt("uA", 2));
  assert.equal(storeA.current().accessToken, jwt("uA", 2));
  assert.ok(!("refresh_token" in server.posts[1]));
});

const timeoutKey = `cc-refresh:${baseUrl}:CcPlatformSdkCache:refresh-timeout-at`;

for (const kind of ["local", "remote"]) {
  test(`timeout marker: ${kind} sign-out clears it (memory and storage)`, async () => {
    setBrowser({ locks: fakeLocks() });
    const storage = createMockStorage();
    storage.setItem("refresh_token", "rt-0");
    const { sdk } = scriptedTab(storage, (n) => (n === 1 ? new Promise(() => {}) : ok({})));

    assert.equal(await sdk.refreshTokenOrThrow(), null);
    assert.ok(storage.getItem(timeoutKey), "marker set by the timeout");

    if (kind === "local") await sdk.logout();
    else sdk["onRemoteSignOut"]();
    await tick(5);

    assert.equal(storage.getItem(timeoutKey), null);
    assert.equal(sdk["hasRefreshTimeoutMarker"](), false);
  });
}

test("timeout marker: a new session ignores the old marker; its invalid_grant signs out", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("refresh_token", "rt-0");
  const { sdk } = scriptedTab(storage, (n) => (n === 1 ? new Promise(() => {}) : invalidGrant()));

  assert.equal(await sdk.refreshTokenOrThrow(), null);
  await sdk.setSession({ accessToken: jwt("u1", 5), refreshToken: "rt-new" });

  await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);
});

test("timeout marker: an expired marker from another tab gives no pass", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("refresh_token", "rt-0");
  storage.setItem(timeoutKey, String(Date.now() - 10 * 60_000));
  const { sdk } = scriptedTab(storage, () => invalidGrant());

  await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);
});

test("timeout marker: the timer firing after a sign-out sets nothing", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("refresh_token", "rt-0");
  const { sdk } = scriptedTab(storage, () => new Promise(() => {}));

  const pending = sdk.refreshTokenOrThrow();
  await tick(10);
  sdk["onRemoteSignOut"]();

  assert.equal(await pending, null);
  await tick(5);
  assert.equal(storage.getItem(timeoutKey), null);
  assert.equal(sdk["hasRefreshTimeoutMarker"](), false);
});

test("another tab signs in as u2 while we wait for the lock: no POST, nothing adopted, null", async () => {
  const locks = gatedLocks();
  setBrowser({ locks });
  const storage = createMockStorage();
  storage.setItem("auth_tokens", JSON.stringify({ accessToken: jwt("u1", 0), refreshToken: "rt-0" }));
  const f = countingFetch(() => ok({ accessToken: jwt("u2", 2), refreshToken: "rt-u2-next", expiresAt: inAnHour() }));
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl: f.fetchImpl, storage, tokenProvider: new StorageTokenProvider(storage) });

  const pending = sdk.refreshToken();
  await tick();
  const u2 = JSON.stringify({ accessToken: jwt("u2", 1), refreshToken: "rt-u2", expiresAt: inAnHour() });
  storage.setItem("auth_tokens", u2); // no sign-out first
  locks.release();

  assert.equal(await pending, null);
  assert.equal(f.refreshCalls().length, 0, "u2's refresh token not rotated");
  assert.equal(storage.getItem("auth_tokens"), u2, "u2's session untouched");
});

test("5xx retry: a sign-out during the 1 s wait means no second POST", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("refresh_token", "rt-0");
  const { sdk, posts } = scriptedTab(storage, () => new Response("{}", { status: 503 }));

  const pending = sdk.refreshTokenOrThrow();
  await tick(50);
  sdk["onRemoteSignOut"]();

  assert.equal(await pending, null);
  assert.deepEqual(posts, ["rt-0"]);
});

// --- Review 6 regressions -------------------------------------------------

test("ambiguous 401 retry: a sign-out during the first POST means no second POST", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  storage.setItem("refresh_token", "rt-0");
  let tab;
  tab = scriptedTab(storage, () => {
    tab.sdk["onRemoteSignOut"]();
    return new Response("", { status: 401 });
  });

  assert.equal(await tab.sdk.refreshTokenOrThrow(), null);
  assert.deepEqual(tab.posts, ["rt-0"]);
});

test("D1: hybrid tabs, another tab signs in as uB during A's refresh: B's refresh token never POSTed by A", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  const bTokens = { accessToken: jwt("uB", 1), refreshToken: "rt-b", expiresAt: inAnHour() };
  const b = new CcPlatformSdk({ baseUrl, storage, tokenProvider: new HybridTokenProvider(storage), fetchImpl: async () => invalidGrant() });
  let unauthorized = 0;
  const posts = [];
  const a = new CcPlatformSdk({
    baseUrl,
    storage,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: jwt("uA", 0), refreshToken: "rt-a" }),
    onUnauthorized: () => {
      unauthorized += 1;
    },
    fetchImpl: async (_url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      posts.push(body.refresh_token);
      if (posts.length === 1) {
        await b.setSession(bTokens); // tab B signs in as uB, rotating the shared key
        return invalidGrant();
      }
      return ok({ accessToken: jwt("uB", 2), refreshToken: "rt-b-2", expiresAt: inAnHour() });
    },
  });

  const result = await a.refreshTokenOrThrow();

  assert.equal(result, null);
  assert.deepEqual(posts, ["rt-a"], "rt-b never sent");
  assert.equal(storage.getItem("refresh_token"), "rt-b", "B's stored refresh token unchanged");
  assert.deepEqual(b.getTokens(), bTokens);
  assert.equal(a.getTokens()?.accessToken, jwt("uA", 0), "A not signed out");
  assert.equal(unauthorized, 0);
});

test("D1: hybrid cookie tab, another tab signs in as uB: the cookie retry doesn't POST B's refresh token", async () => {
  setBrowser({ locks: fakeLocks() });
  const storage = createMockStorage();
  const b = new CcPlatformSdk({ baseUrl, storage, tokenProvider: new HybridTokenProvider(storage), fetchImpl: async () => invalidGrant() });
  const posts = [];
  const a = new CcPlatformSdk({
    baseUrl,
    storage,
    useRefreshCookie: true,
    refreshRetryDelayMs: 1,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: jwt("uA", 0) }),
    fetchImpl: async (_url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      posts.push(body);
      if (posts.length === 1) {
        await b.setSession({ accessToken: jwt("uB", 1), refreshToken: "rt-b", expiresAt: inAnHour() });
        return invalidGrant();
      }
      return ok({ accessToken: jwt("uB", 2), refreshToken: "rt-b-2", expiresAt: inAnHour() });
    },
  });

  assert.equal(await a.refreshTokenOrThrow(), null);
  assert.ok(!posts.some((p) => p.refresh_token === "rt-b"), "rt-b never sent");
  assert.equal(storage.getItem("refresh_token"), "rt-b");
});

test("D2: SessionManager cookie-mode profile: invalid_grant gets no cookie-only retry, other profile untouched", async () => {
  setBrowser({ locks: fakeLocks() });
  const server = sharedCookieServer(() => jwt("uA", 2));
  const bTokens = { accessToken: jwt("uB", 1), refreshToken: "rt-b", expiresAt: inAnHour() };
  const stores = {
    "01A": profileStore({ accessToken: jwt("uA", 0), refreshToken: "rt-a-dead" }),
    "01B": profileStore(bTokens),
  };
  const manager = new SessionManager({
    baseUrl,
    createSessionStore: (id) => stores[id],
    registryStore: createStorageProfileRegistry(createMockStorage()),
    disableCrossTabSync: true,
    sdkOptions: { fetchImpl: server.fetchImpl, storage: createMockStorage(), useRefreshCookie: true, refreshRetryDelayMs: 1 },
  });
  const a = manager["createProfileSdk"]("01A");
  manager["createProfileSdk"]("01B");

  await assert.rejects(a.refreshTokenOrThrow(), AuthSessionExpiredError);

  assert.ok(server.posts.every((p) => "refresh_token" in p), "no cookie-only POST");
  assert.deepEqual(stores["01B"].current(), bTokens, "B's store untouched");
  await manager.dispose();
});

test("SessionManager ignores a shared refreshLockName: each profile keeps its own lock and marker keys", async () => {
  setBrowser({ locks: fakeLocks() });
  const manager = new SessionManager({
    baseUrl,
    createSessionStore: () => profileStore({ accessToken: jwt("uA", 0), refreshToken: "rt-a" }),
    registryStore: createStorageProfileRegistry(createMockStorage()),
    disableCrossTabSync: true,
    // Plain-JS callers can still pass it; the type Omit alone doesn't stop that.
    sdkOptions: { storage: createMockStorage(), refreshLockName: "shared-lock" },
  });
  const a = manager["createProfileSdk"]("01A");
  const b = manager["createProfileSdk"]("01B");
  const staging = manager["createStagingSdk"]();

  const names = [a, b, staging].map((sdk) => sdk["refreshLockName"]);
  assert.ok(names.every((n) => n !== "shared-lock"), `got ${names.join(", ")}`);
  assert.equal(new Set(names).size, 3, "every profile and the staging SDK get their own lock");
  assert.ok(names[0].includes("01A") && names[1].includes("01B"));
  await manager.dispose();
});

test("D3: a sign-out during the cookie retry: null, no throw, onUnauthorized not called", async () => {
  setBrowser({ locks: fakeLocks() });
  let unauthorized = 0;
  let refreshPosts = 0;
  const sdk = new CcPlatformSdk({
    baseUrl,
    storage: createMockStorage(),
    useRefreshCookie: true,
    refreshRetryDelayMs: 1,
    tokenProvider: new MemoryTokenProvider({ accessToken: jwt("u1", 0) }),
    onRefreshTokens: () => sdk.refreshTokenOrThrow(),
    onUnauthorized: () => {
      unauthorized += 1;
    },
    fetchImpl: async (url) => {
      if (!String(url).endsWith("/auth/refresh")) return new Response("{}", { status: 401 });
      refreshPosts += 1;
      if (refreshPosts === 2) sdk["onRemoteSignOut"](); // the sign-out owns logout handling
      return invalidGrant();
    },
  });

  assert.equal(await sdk.refreshTokenOrThrow(), null, "no AuthSessionExpiredError");
  assert.equal(refreshPosts, 2);

  // Through the HTTP client: the 401 path must not run logout handling again.
  refreshPosts = 0;
  sdk["remoteSignedOut"] = false;
  await sdk.setSession({ accessToken: jwt("u1", 0) });
  await assert.rejects(sdk["client"].get("/v1/me"));
  assert.equal(refreshPosts, 2);
  assert.equal(unauthorized, 0);
});
