/**
 * Push Subscription SDK Unit Tests (mocked HTTP)
 *
 * Covers: createPushSubscription, deletePushSubscription — ensures the SDK
 * sends the flat payload shape the Laravel UserController expects
 * (endpoint, publicKey, authToken, contentEncoding), NOT the nested
 * PushSubscriptionJSON wrapper.
 */

if (!globalThis.window) {
  globalThis.window = globalThis;
}
import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

const baseUrl = "https://api.example.com";

function createMockFetch(responseData, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      method: init?.method || "GET",
      body: init?.body ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify(responseData), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

function createAuthenticatedMockSdk(responseData, status = 200) {
  const { fetchImpl, calls } = createMockFetch(responseData, status);
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });
  return { sdk, calls };
}

// ---------------------------------------------------------------------------
// createPushSubscription
// ---------------------------------------------------------------------------

test("createPushSubscription POSTs flat fields to /v1/subscriptions", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    data: { success: true },
  });

  await sdk.createPushSubscription({
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: {
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfXso",
      auth: "tBHItJI5svbpC7htQK8mzw",
    },
  });

  assert.equal(calls.length, 1, "expected one HTTP call");
  const [call] = calls;
  assert.equal(call.method, "POST");
  assert.match(call.url, /\/v1\/subscriptions$/);
  assert.deepEqual(
    call.body,
    {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      publicKey: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfXso",
      authToken: "tBHItJI5svbpC7htQK8mzw",
      contentEncoding: "aes128gcm",
    },
    "SDK must send flat { endpoint, publicKey, authToken, contentEncoding } to match Laravel UserController validation",
  );
});

test("createPushSubscription handles missing keys gracefully", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    data: { success: true },
  });

  await sdk.createPushSubscription({
    endpoint: "https://fcm.googleapis.com/fcm/send/xyz",
  });

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.deepEqual(call.body, {
    endpoint: "https://fcm.googleapis.com/fcm/send/xyz",
    publicKey: null,
    authToken: null,
    contentEncoding: "aes128gcm",
  });
});

// ---------------------------------------------------------------------------
// deletePushSubscription
// ---------------------------------------------------------------------------

test("deletePushSubscription DELETEs to /v1/subscriptions with { endpoint }", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({ success: true });

  await sdk.deletePushSubscription("https://fcm.googleapis.com/fcm/send/abc123");

  assert.equal(calls.length, 1, "expected one HTTP call");
  const [call] = calls;
  assert.equal(call.method, "DELETE");
  assert.match(call.url, /\/v1\/subscriptions$/);
  assert.deepEqual(
    call.body,
    { endpoint: "https://fcm.googleapis.com/fcm/send/abc123" },
  );
});
