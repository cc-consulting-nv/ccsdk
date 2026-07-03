/**
 * Artist entitlements SDK unit tests (mocked HTTP)
 *
 * Covers: getArtistEntitlements
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
    });

    return new Response(JSON.stringify(responseData), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetchImpl, calls };
}

let dbCounter = 0;
function uniqueDbName() {
  dbCounter += 1;
  return `artist-entitlements-test-${dbCounter}-${Date.now()}`;
}

test("getArtistEntitlements normalizes snake_case API response to camelCase", async () => {
  const { fetchImpl, calls } = createMockFetch({
    artist_pro: false,
    artist_studio: false,
    songs_used: 7,
    songs_limit: 10,
    storage_bytes_used: 1048576,
    storage_bytes_limit: 524288000,
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    dbName: uniqueDbName(),
  });

  const entitlements = await sdk.getArtistEntitlements();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/users/me/entitlements`);
  assert.equal(calls[0].method, "GET");
  assert.deepEqual(entitlements, {
    artistPro: false,
    artistStudio: false,
    songsUsed: 7,
    songsLimit: 10,
    storageBytesUsed: 1048576,
    storageBytesLimit: 524288000,
  });
});

test("getArtistEntitlements returns null songsLimit for pro plans", async () => {
  const { fetchImpl } = createMockFetch({
    artist_pro: true,
    artist_studio: false,
    songs_used: 42,
    songs_limit: null,
    storage_bytes_used: 0,
    storage_bytes_limit: 5368709120,
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    dbName: uniqueDbName(),
  });

  const entitlements = await sdk.getArtistEntitlements();

  assert.equal(entitlements.artistPro, true);
  assert.equal(entitlements.songsLimit, null);
  assert.equal(entitlements.storageBytesLimit, 5368709120);
});

test("startArtistSubscriptionCheckout returns checkout URL", async () => {
  const { fetchImpl, calls } = createMockFetch({
    checkout_url: "https://checkout.stripe.com/c/pay/test_session",
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    dbName: uniqueDbName(),
  });

  const result = await sdk.startArtistSubscriptionCheckout({
    plan: "artist_pro",
    successUrl: "https://app.example/settings?checkout=success",
    cancelUrl: "https://app.example/pricing",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/users/me/artist-subscription/checkout`);
  assert.equal(calls[0].method, "POST");
  assert.equal(result.checkoutUrl, "https://checkout.stripe.com/c/pay/test_session");
});

test("confirmArtistSubscriptionCheckout normalizes entitlements", async () => {
  const { fetchImpl, calls } = createMockFetch({
    artist_pro: true,
    artist_studio: false,
    songs_used: 12,
    songs_limit: null,
    storage_bytes_used: 2048,
    storage_bytes_limit: 5368709120,
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    dbName: uniqueDbName(),
  });

  const entitlements = await sdk.confirmArtistSubscriptionCheckout("cs_test_confirm");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/users/me/artist-subscription/confirm`);
  assert.equal(calls[0].method, "POST");
  assert.equal(entitlements.artistPro, true);
  assert.equal(entitlements.songsUsed, 12);
});