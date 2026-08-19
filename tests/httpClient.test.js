import test from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../dist/httpClient.js";

const baseUrl = "https://api.example.com";

test("HttpClient injects bearer token and baseUrl", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new HttpClient({
    baseUrl,
    fetchImpl,
    getAuthTokens: () => ({ accessToken: "abc123" }),
  });

  await client.get("/ping");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/ping`);
  assert.equal(calls[0].init.headers.Authorization, "Bearer abc123");
});

test("HttpClient POST serializes JSON bodies", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new HttpClient({
    baseUrl,
    fetchImpl,
  });

  await client.post("/echo", { body: { foo: "bar" } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/echo`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ foo: "bar" }));
});

// Regression: a transient refresh failure (offline / 5xx / timeout) must not
// latch the logout cascade. The latch is cleared only by setTokens() installing
// a session, which itself needs a successful refresh — so latching on a
// transient blip wedged the client into permanent 401s on every later request.
test("transient refresh failure does not disable future refreshes", async () => {
  let refreshShouldFail = true;
  let refreshCount = 0;
  let unauthorizedCount = 0;

  const fetchImpl = async (_url, init) =>
    init.headers.Authorization === "Bearer good"
      ? new Response(JSON.stringify({ ok: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      : new Response("{}", {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });

  const client = new HttpClient({
    baseUrl: "https://api.test",
    fetchImpl,
    getAuthTokens: () => ({ accessToken: "stale" }),
    onRefreshTokens: async () => {
      refreshCount += 1;
      if (refreshShouldFail) {
        throw Object.assign(new Error("network down"), { status: 503 });
      }
      return { accessToken: "good" };
    },
    onUnauthorized: () => {
      unauthorizedCount += 1;
    },
  });

  await assert.rejects(() => client.get("/a"));
  assert.equal(refreshCount, 1);
  assert.equal(unauthorizedCount, 0, "a 5xx is transient - no logout cascade");

  // Network recovers. The client must be *willing* to refresh again — but a
  // transient failure now arms a backoff window, so the very next request is
  // throttled rather than retried. That is the intended tradeoff: recovery
  // costs up to one backoff window instead of a refresh storm per 401.
  refreshShouldFail = false;
  await assert.rejects(() => client.get("/b"));
  assert.equal(refreshCount, 1, "inside the backoff window, no retry");

  client.resetAuthLatch();
  const result = await client.get("/c");
  assert.equal(refreshCount, 2, "refresh retried after recovery");
  assert.deepEqual(result, { ok: 1 });
});

// The other half: a definitive 4xx rejection still latches exactly once.
test("definitive refresh rejection latches the logout cascade once", async () => {
  let unauthorizedCount = 0;
  let refreshCount = 0;

  const fetchImpl = async () =>
    new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } });

  const client = new HttpClient({
    baseUrl: "https://api.test",
    fetchImpl,
    getAuthTokens: () => ({ accessToken: "stale" }),
    onRefreshTokens: async () => {
      refreshCount += 1;
      // A definitive rejection declares itself. A bare `status: 400` no longer
      // qualifies — a captive portal answers 400 to everything.
      throw Object.assign(new Error("invalid_grant"), {
        status: 401,
        isAuthSessionExpired: true,
      });
    },
    onUnauthorized: () => {
      unauthorizedCount += 1;
    },
  });

  await assert.rejects(() => client.get("/a"));
  await assert.rejects(() => client.get("/b"));

  assert.equal(unauthorizedCount, 1, "logout cascade fires exactly once");
  assert.equal(refreshCount, 1, "latch stops a second refresh after a 4xx");
});

// --- Regression coverage for the definitive-vs-transient discriminator ---
//
// The discriminator used to be `400 <= status < 500`, which was wrong in both
// directions: it swept in transient 4xx codes (429/408) and it let a
// status-less error fall through as transient, silently disabling the logout
// cascade that shipped before. Both directions are pinned here.

/** Build a client whose refresh handler always throws `err`. */
function clientRejectingWith(err, counters) {
  return new HttpClient({
    baseUrl: "https://api.test",
    fetchImpl: async () =>
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
    getAuthTokens: () => ({ accessToken: "stale" }),
    onRefreshTokens: async () => {
      counters.refresh += 1;
      throw err;
    },
    onUnauthorized: () => {
      counters.unauthorized += 1;
    },
  });
}

for (const [label, status] of [
  ["429 rate limited", 429],
  ["408 request timeout", 408],
  ["400 captive portal", 400],
  ["503 service unavailable", 503],
]) {
  test(`transient: ${label} does not latch the logout cascade`, async () => {
    const counters = { refresh: 0, unauthorized: 0 };
    const client = clientRejectingWith(
      Object.assign(new Error(label), { status }),
      counters,
    );

    await assert.rejects(() => client.get("/a"));
    await assert.rejects(() => client.get("/b"));

    assert.equal(counters.unauthorized, 0, `${label} must not log the user out`);
    // Backoff throttles the immediate retry, so the second request refreshes
    // zero more times. That is throttling, NOT the logout latch: unauthorized
    // stays 0 above, and clearing the backoff below restores refreshing.
    assert.equal(counters.refresh, 1, `${label} is throttled, not latched`);

    client.resetAuthLatch();
    await assert.rejects(() => client.get("/c"));
    assert.equal(counters.refresh, 2, `${label} must leave refresh enabled`);
    assert.equal(counters.unauthorized, 0, `${label} still must not log out`);
  });
}

test("definitive: a bare 401 latches the logout cascade", async () => {
  const counters = { refresh: 0, unauthorized: 0 };
  const client = clientRejectingWith(
    Object.assign(new Error("unauthorized"), { status: 401 }),
    counters,
  );

  await assert.rejects(() => client.get("/a"));
  await assert.rejects(() => client.get("/b"));

  assert.equal(counters.unauthorized, 1, "401 is definitive");
  assert.equal(counters.refresh, 1, "latch stops the second refresh");
});

test("definitive: a status-less error latches (fail-closed default)", async () => {
  // The pre-existing contract: handlers that `throw new Error("...")` with no
  // status — the shape every current consumer throws — must still trigger
  // exactly one logout cascade. Reading these as transient produced silent
  // infinite 401s against a dead session.
  const counters = { refresh: 0, unauthorized: 0 };
  const client = clientRejectingWith(new Error("Token refresh failed"), counters);

  await assert.rejects(() => client.get("/a"));
  await assert.rejects(() => client.get("/b"));

  assert.equal(counters.unauthorized, 1, "status-less failure is definitive");
  assert.equal(counters.refresh, 1, "latch stops the second refresh");
});

test("definitive: isAuthSessionExpired marker wins over a transient status", async () => {
  // Duck-typed, so an error from another copy of the SDK still counts.
  const counters = { refresh: 0, unauthorized: 0 };
  const client = clientRejectingWith(
    Object.assign(new Error("Session expired"), { status: 429, isAuthSessionExpired: true }),
    counters,
  );

  await assert.rejects(() => client.get("/a"));
  assert.equal(counters.unauthorized, 1, "explicit marker is authoritative");
});

test("transient: an explicit TransientRefreshError shape never latches", async () => {
  const counters = { refresh: 0, unauthorized: 0 };
  const client = clientRejectingWith(
    Object.assign(new Error("Token refresh failed"), { status: 503 }),
    counters,
  );

  await assert.rejects(() => client.get("/a"));
  await assert.rejects(() => client.get("/b"));

  assert.equal(counters.unauthorized, 0);
  assert.equal(counters.refresh, 1, "throttled by backoff, not latched");

  client.resetAuthLatch();
  await assert.rejects(() => client.get("/c"));
  assert.equal(counters.refresh, 2, "still refreshing after a transient failure");
  assert.equal(counters.unauthorized, 0);
});

test("a transient failure followed by a definitive one still latches once", async () => {
  // The ordering that the old flag-based verdict got wrong: the transient
  // attempt must not consume the latch, and the later definitive rejection
  // must still fire the cascade.
  let attempt = 0;
  let unauthorized = 0;
  const client = new HttpClient({
    baseUrl: "https://api.test",
    fetchImpl: async () =>
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
    getAuthTokens: () => ({ accessToken: "stale" }),
    onRefreshTokens: async () => {
      attempt += 1;
      throw attempt === 1
        ? Object.assign(new Error("offline"), { status: 429 })
        : Object.assign(new Error("expired"), { status: 401, isAuthSessionExpired: true });
    },
    onUnauthorized: () => {
      unauthorized += 1;
    },
  });

  await assert.rejects(() => client.get("/a"));
  assert.equal(unauthorized, 0, "transient first attempt does not latch");

  // Clear the transient backoff so the second attempt actually reaches the
  // refresh handler — this test is about the verdict, not the throttle.
  client.resetAuthLatch();
  await assert.rejects(() => client.get("/b"));
  assert.equal(unauthorized, 1, "definitive second attempt latches");

  await assert.rejects(() => client.get("/c"));
  assert.equal(attempt, 2, "latched: no third refresh");
  assert.equal(unauthorized, 1, "cascade fires exactly once");
});

// --- Regression coverage for refresh backoff ---
//
// Measured before the fix: 30 sequential requests against a 429ing refresh
// endpoint produced 30 refresh attempts inside a 9ms window — the client
// manufacturing the rate limiting that was already hurting it.

test("backoff: a storm of 401s produces one refresh, not one per request", async () => {
  const counters = { refresh: 0, unauthorized: 0 };
  const client = clientRejectingWith(
    Object.assign(new Error("rate limited"), { status: 429 }),
    counters,
  );

  for (let i = 0; i < 30; i++) {
    await assert.rejects(() => client.get(`/req-${i}`));
  }

  assert.equal(counters.refresh, 1, "30 requests must not mean 30 refreshes");
  assert.equal(counters.unauthorized, 0, "throttling is not logging out");
});

test("backoff: a successful refresh clears the throttle", async () => {
  let attempt = 0;
  const client = new HttpClient({
    baseUrl: "https://api.test",
    // 401 once per request so every call attempts a refresh; the retry after a
    // successful refresh 401s too, which is fine — we only count attempts.
    fetchImpl: async () =>
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
    getAuthTokens: () => ({ accessToken: "stale" }),
    onRefreshTokens: async () => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("rate limited"), { status: 429 });
      return { accessToken: "fresh" };
    },
  });

  await assert.rejects(() => client.get("/a"));
  assert.equal(attempt, 1);

  await assert.rejects(() => client.get("/b"));
  assert.equal(attempt, 1, "still inside the backoff window");

  client.resetAuthLatch();
  await assert.rejects(() => client.get("/c"));
  assert.equal(attempt, 2, "refresh succeeded");

  // The success cleared refreshBlockedUntil, so the next 401 refreshes again
  // without needing resetAuthLatch().
  await assert.rejects(() => client.get("/d"));
  assert.equal(attempt, 3, "a successful refresh un-throttles the client");
});
