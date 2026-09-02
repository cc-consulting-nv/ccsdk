/**
 * Boost SDK Unit Tests (mocked HTTP)
 *
 * Covers: boostPost — asserts the Stripe Checkout redirect targets reach
 * the wire. AdController requires successUrl/cancelUrl whenever amountCents
 * is present, so a body that drops them 422s.
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
// boostPost
// ---------------------------------------------------------------------------

test("boostPost forwards the checkout redirect URLs on a paid boost", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    checkout_url: "https://checkout.stripe.com/c/pay/cs_test_123",
  });

  await sdk.boostPost({
    id: "01jd8kq4h9v2n3xkq7w5r6t8y0",
    startDate: "2026-09-03T00:00:00Z",
    endDate: "2026-09-10T00:00:00Z",
    amountCents: 5000,
    successUrl: "https://gunclub.example.com/post/abc?boosted=1",
    cancelUrl: "https://gunclub.example.com/post/abc",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/v1\/ads\/boosted$/);
  assert.equal(
    calls[0].body.successUrl,
    "https://gunclub.example.com/post/abc?boosted=1",
  );
  assert.equal(calls[0].body.cancelUrl, "https://gunclub.example.com/post/abc");
  assert.equal(calls[0].body.amountCents, 5000);
});

test("boostPost omits the redirect URLs on a legacy draft boost", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({ data: [] });

  await sdk.boostPost({
    id: "01jd8kq4h9v2n3xkq7w5r6t8y0",
    startDate: "2026-09-03T00:00:00Z",
    endDate: "2026-09-10T00:00:00Z",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.successUrl, undefined);
  assert.equal(calls[0].body.cancelUrl, undefined);
  assert.equal(calls[0].body.amountCents, undefined);
});
