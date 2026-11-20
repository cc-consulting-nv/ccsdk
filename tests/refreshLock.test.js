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
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

test.afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
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
  setNavigator({ locks });
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
  assert.ok(locks.requested.every((r) => r.name === `cc-refresh:${baseUrl}` && r.mode === "exclusive"));
});

test("storage mode: second instance reuses the pair another tab stored, no network call", async () => {
  setNavigator({ locks: fakeLocks() });
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

test("lock timeout: refresh proceeds without the lock", async () => {
  setNavigator({ locks: hungLocks() });
  const storage = createMockStorage();
  const server = rotatingServer();
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl: server.fetchImpl,
    storage,
    refreshLockTimeoutMs: 30,
    tokenProvider: new HybridTokenProvider(storage, { accessToken: "at-0", refreshToken: "rt-0" }),
  });

  const result = await sdk.refreshToken();

  assert.equal(result?.accessToken, "at-1");
  assert.deepEqual(server.calls, ["rt-0"]);
});

test("refreshLockName option overrides the default lock name", async () => {
  const locks = fakeLocks();
  setNavigator({ locks });
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
  setNavigator({ locks: fakeLocks() });
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
  assert.deepEqual(newKeys, [`cc-refresh:${baseUrl}:last-refresh-at`]);
  assert.match(storage.getItem(newKeys[0]), /^\d+$/);
  for (const [k, v] of storage.store) {
    assert.ok(!`${k}${v}`.includes("at-1"), `no token value in storage (${k})`);
  }
});

test("cookie mode: invalid_grant twice means exactly 2 calls, then the existing sign-out", async () => {
  setNavigator({ locks: fakeLocks() });
  const { sdk, calls } = cookieSdk([[400, { error: "invalid_grant" }]]);

  await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);

  assert.equal(calls.length, 2, "one retry, no loop");
  assert.ok(!sdk.isAuthenticated(), "session cleared as before");
});

test("cookie mode: a shaped 401 without invalid_grant is not retried", async () => {
  setNavigator({ locks: fakeLocks() });
  const { sdk, calls } = cookieSdk([[401, { message: "Unauthenticated." }]]);

  await assert.rejects(sdk.refreshTokenOrThrow(), AuthSessionExpiredError);
  assert.equal(calls.length, 1);
});

test("cookie mode: a network error is not retried by the invalid_grant path", async () => {
  setNavigator({ locks: fakeLocks() });
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
