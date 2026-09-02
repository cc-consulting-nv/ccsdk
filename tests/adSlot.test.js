/**
 * Ad slot SDK Unit Tests (mocked HTTP)
 *
 * Covers: getSlotAds — the banner placement endpoint. Asserts the request
 * carries slot + count as query params and that an unfilled slot (empty
 * `ads`) resolves rather than throwing.
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
// getSlotAds
// ---------------------------------------------------------------------------

test("getSlotAds GETs /v1/ads/slot with the slot as a query param", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    slot: "sidebar_medrec",
    width: 300,
    height: 250,
    ads: [],
  });

  await sdk.getSlotAds("sidebar_medrec");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/ads/slot");
  assert.equal(url.searchParams.get("slot"), "sidebar_medrec");
});

test("getSlotAds forwards the count option", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    slot: "profile_banner",
    width: 1200,
    height: 300,
    ads: [],
  });

  await sdk.getSlotAds("profile_banner", { count: 3 });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("slot"), "profile_banner");
  assert.equal(url.searchParams.get("count"), "3");
});

test("getSlotAds returns the placement dimensions", async () => {
  const { sdk } = createAuthenticatedMockSdk({
    slot: "sidebar_skyscraper",
    width: 300,
    height: 600,
    ads: [],
  });

  const result = await sdk.getSlotAds("sidebar_skyscraper");

  assert.equal(result.slot, "sidebar_skyscraper");
  assert.equal(result.width, 300);
  assert.equal(result.height, 600);
});

// An unfilled slot is the normal case on a tenant with thin inventory —
// it must resolve with an empty array, never reject.
test("getSlotAds resolves with an empty ads array for an unfilled slot", async () => {
  const { sdk } = createAuthenticatedMockSdk({
    slot: "sidebar_medrec",
    width: 300,
    height: 250,
    ads: [],
  });

  const result = await sdk.getSlotAds("sidebar_medrec");

  assert.deepEqual(result.ads, []);
});

test("getSlotAds passes creatives through", async () => {
  const ulid = "01hgd4abcd1234567890abcdef";
  const { sdk } = createAuthenticatedMockSdk({
    slot: "sidebar_medrec",
    width: 300,
    height: 250,
    ads: [
      {
        ulid,
        isAd: true,
        adType: "standard",
        targetUrl: "https://example.com/promo",
      },
    ],
  });

  const result = await sdk.getSlotAds("sidebar_medrec");

  assert.equal(result.ads.length, 1);
  assert.equal(result.ads[0].ulid, ulid);
  assert.equal(result.ads[0].isAd, true);
  assert.equal(result.ads[0].targetUrl, "https://example.com/promo");
});
