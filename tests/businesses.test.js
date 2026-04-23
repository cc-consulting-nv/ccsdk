/**
 * Business Directory SDK Unit Tests (mocked HTTP)
 *
 * Verifies searchBusinesses filter serialization, return shape, and hasMore
 * pagination semantics (both the server-provided `found` path and the
 * full-page heuristic fallback).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

const baseUrl = "https://api.example.com";

function createMockFetch(responseData, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responseData), { status });
  };
  return { fetchImpl, calls };
}

function createMockSdk(responseData, status = 200) {
  const { fetchImpl, calls } = createMockFetch(responseData, status);
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });
  return { sdk, calls };
}

const sampleBusiness = {
  ulid: "01hxbiz0000000000000000001",
  name: "Sample Pizza",
  slug: "sample-pizza",
  city: "Port of Spain",
};

// ---------------------------------------------------------------------------
// searchBusinesses: return shape
// ---------------------------------------------------------------------------

test("searchBusinesses returns BusinessListResponse shape", async () => {
  const { sdk } = createMockSdk({
    data: [sampleBusiness],
    found: 1,
    page: 1,
    per_page: 20,
  });

  const result = await sdk.searchBusinesses("pizza");

  assert.ok(Array.isArray(result.businesses), "businesses is an array");
  assert.equal(result.businesses.length, 1);
  assert.equal(result.businesses[0].ulid, sampleBusiness.ulid);
  assert.equal(typeof result.hasMore, "boolean");
  assert.ok("nextCursor" in result, "result has nextCursor key");
});

test("searchBusinesses handles empty result set", async () => {
  const { sdk } = createMockSdk({ data: [], found: 0, page: 1, per_page: 20 });

  const result = await sdk.searchBusinesses("nonsense");

  assert.equal(result.businesses.length, 0);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
});

// ---------------------------------------------------------------------------
// searchBusinesses: filter serialization
// ---------------------------------------------------------------------------

test("searchBusinesses serializes all filters into query string", async () => {
  const { sdk, calls } = createMockSdk({ data: [], found: 0, page: 2, per_page: 5 });

  await sdk.searchBusinesses("pizza", {
    city: "Port of Spain",
    category: "restaurants",
    region: "north",
    perPage: 5,
    page: 2,
  });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/businesses/search");
  assert.equal(url.searchParams.get("q"), "pizza");
  assert.equal(url.searchParams.get("city"), "Port of Spain");
  assert.equal(url.searchParams.get("category"), "restaurants");
  assert.equal(url.searchParams.get("region"), "north");
  assert.equal(url.searchParams.get("per_page"), "5");
  assert.equal(url.searchParams.get("page"), "2");
});

test("searchBusinesses omits optional filters when not provided", async () => {
  const { sdk, calls } = createMockSdk({ data: [], found: 0 });

  await sdk.searchBusinesses("pizza");

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("q"), "pizza");
  assert.equal(url.searchParams.has("city"), false);
  assert.equal(url.searchParams.has("category"), false);
  assert.equal(url.searchParams.has("per_page"), false);
  assert.equal(url.searchParams.has("page"), false);
});

test("searchBusinesses preserves perPage=0 and page=0 (no truthiness drop)", async () => {
  const { sdk, calls } = createMockSdk({ data: [], found: 0 });

  await sdk.searchBusinesses("pizza", { perPage: 0, page: 0 });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("per_page"), "0");
  assert.equal(url.searchParams.get("page"), "0");
});

// ---------------------------------------------------------------------------
// searchBusinesses: hasMore pagination
// ---------------------------------------------------------------------------

test("searchBusinesses hasMore is true when page * perPage < found", async () => {
  const { sdk } = createMockSdk({
    data: new Array(20).fill(sampleBusiness),
    found: 45,
    page: 1,
    per_page: 20,
  });

  const result = await sdk.searchBusinesses("pizza", { perPage: 20, page: 1 });

  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, "2");
});

test("searchBusinesses hasMore is false at the final page boundary", async () => {
  const { sdk } = createMockSdk({
    data: new Array(5).fill(sampleBusiness),
    found: 45,
    page: 3,
    per_page: 20,
  });

  const result = await sdk.searchBusinesses("pizza", { perPage: 20, page: 3 });

  // 3 * 20 = 60 >= 45 → no more
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
});

test("searchBusinesses falls back to full-page heuristic when 'found' missing", async () => {
  // Full page (20 items, perPage 20) with no `found` → assume more
  const { sdk } = createMockSdk({ data: new Array(20).fill(sampleBusiness) });

  const result = await sdk.searchBusinesses("pizza", { perPage: 20 });

  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, "2");
});

test("searchBusinesses heuristic returns hasMore=false on partial page", async () => {
  // Partial page (5 of 20) with no `found` → assume done
  const { sdk } = createMockSdk({ data: new Array(5).fill(sampleBusiness) });

  const result = await sdk.searchBusinesses("pizza", { perPage: 20 });

  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
});

// ---------------------------------------------------------------------------
// searchBusinesses: auth
// ---------------------------------------------------------------------------

test("searchBusinesses includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ data: [], found: 0 });

  await sdk.searchBusinesses("pizza");

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});
