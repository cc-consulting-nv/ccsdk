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

  // Network recovers: the client must be willing to refresh again.
  refreshShouldFail = false;
  const result = await client.get("/b");
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
      throw Object.assign(new Error("invalid_grant"), { status: 400 });
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
