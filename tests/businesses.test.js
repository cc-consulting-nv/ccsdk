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

// ---------------------------------------------------------------------------
// fetchFeaturedBusinesses
// ---------------------------------------------------------------------------

test("fetchFeaturedBusinesses returns businesses from flat array response", async () => {
  // API returns a flat array, not { data: [...] }
  const { sdk } = createMockSdk([sampleBusiness, sampleBusiness]);

  const result = await sdk.fetchFeaturedBusinesses(5);

  assert.ok(Array.isArray(result), "result is an array");
  assert.equal(result.length, 2);
});

test("fetchFeaturedBusinesses returns empty array when API returns []", async () => {
  const { sdk } = createMockSdk([]);

  const result = await sdk.fetchFeaturedBusinesses(3);

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);
});

test("fetchFeaturedBusinesses passes limit as query param", async () => {
  const { sdk, calls } = createMockSdk([]);

  await sdk.fetchFeaturedBusinesses(7);

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("limit"), "7");
});

// ---------------------------------------------------------------------------
// setBusinessFeatured
// ---------------------------------------------------------------------------

test("setBusinessFeatured sends POST to correct endpoint", async () => {
  const { sdk, calls } = createMockSdk({ ...sampleBusiness, isFeatured: true });

  const result = await sdk.setBusinessFeatured("01hxbiz0000000000000000001");

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/businesses/01hxbiz0000000000000000001/featured");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(result.isFeatured, true);
});

test("setBusinessFeatured sends featured_until when provided", async () => {
  const { sdk, calls } = createMockSdk({ ...sampleBusiness, isFeatured: true, featuredUntil: "2026-12-31T00:00:00Z" });

  await sdk.setBusinessFeatured("01hxbiz0000000000000000001", {
    featuredUntil: "2026-12-31T00:00:00Z",
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.featured_until, "2026-12-31T00:00:00Z");
});

test("setBusinessFeatured sends no body when no options", async () => {
  const { sdk, calls } = createMockSdk({ ...sampleBusiness, isFeatured: true });

  await sdk.setBusinessFeatured("01hxbiz0000000000000000001");

  // No body or empty body
  const body = calls[0].init.body;
  assert.ok(!body || body === "{}" || body === "null" || body === undefined);
});

// ---------------------------------------------------------------------------
// clearBusinessFeatured
// ---------------------------------------------------------------------------

test("clearBusinessFeatured sends DELETE to correct endpoint", async () => {
  const { sdk, calls } = createMockSdk({ ...sampleBusiness, isFeatured: false });

  const result = await sdk.clearBusinessFeatured("01hxbiz0000000000000000001");

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/businesses/01hxbiz0000000000000000001/featured");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(result.isFeatured, false);
});

test("clearBusinessFeatured includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ ...sampleBusiness, isFeatured: false });

  await sdk.clearBusinessFeatured("01hxbiz0000000000000000001");

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// fetchMyBusinesses
// ---------------------------------------------------------------------------

test("fetchMyBusinesses calls GET /v1/me/businesses", async () => {
  const { sdk, calls } = createMockSdk({ data: [sampleBusiness] });

  await sdk.fetchMyBusinesses();

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/me/businesses");
  assert.equal(calls[0].init.method, "GET");
});

test("fetchMyBusinesses returns array of businesses", async () => {
  const { sdk } = createMockSdk({ data: [sampleBusiness, { ...sampleBusiness, ulid: "01hxbiz0000000000000000002", name: "Second Biz" }] });

  const result = await sdk.fetchMyBusinesses();

  assert.ok(Array.isArray(result), "result is an array");
  assert.equal(result.length, 2);
  assert.equal(result[0].ulid, sampleBusiness.ulid);
  assert.equal(result[1].name, "Second Biz");
});

test("fetchMyBusinesses returns empty array when user owns no businesses", async () => {
  const { sdk } = createMockSdk({ data: [] });

  const result = await sdk.fetchMyBusinesses();

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);
});

test("fetchMyBusinesses includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ data: [] });

  await sdk.fetchMyBusinesses();

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// fetchBusinessAnalytics
// ---------------------------------------------------------------------------

test("fetchBusinessAnalytics calls GET /v1/businesses/{id}/analytics/dashboard", async () => {
  const analyticsData = {
    totalViews: 100,
    saves: 20,
    phoneCalls: 5,
    emailInquiries: 3,
    websiteClicks: 10,
    directionRequests: 2,
    trends: { views: 12.5, saves: -5.0, phoneCalls: 0, emailInquiries: 100 },
  };
  const { sdk, calls } = createMockSdk({ data: analyticsData });

  await sdk.fetchBusinessAnalytics("01hxbiz0000000000000000001");

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/businesses/01hxbiz0000000000000000001/analytics/dashboard");
  assert.equal(calls[0].init.method, "GET");
});

test("fetchBusinessAnalytics returns BusinessAnalytics shape", async () => {
  const analyticsData = {
    totalViews: 100,
    saves: 20,
    phoneCalls: 5,
    emailInquiries: 3,
    websiteClicks: 10,
    directionRequests: 2,
    trends: { views: 12.5, saves: -5.0, phoneCalls: 0, emailInquiries: 100 },
  };
  const { sdk } = createMockSdk({ data: analyticsData });

  const result = await sdk.fetchBusinessAnalytics("01hxbiz0000000000000000001");

  assert.equal(result.totalViews, 100);
  assert.equal(result.saves, 20);
  assert.equal(result.phoneCalls, 5);
  assert.equal(result.emailInquiries, 3);
  assert.equal(result.websiteClicks, 10);
  assert.equal(result.directionRequests, 2);
  assert.equal(result.trends.views, 12.5);
  assert.equal(result.trends.phoneCalls, 0);
});

test("fetchBusinessAnalytics includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ data: { totalViews: 0, saves: 0, phoneCalls: 0, emailInquiries: 0, websiteClicks: 0, directionRequests: 0, trends: {} } });

  await sdk.fetchBusinessAnalytics("01hxbiz0000000000000000001");

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// fetchMyBusinessesAnalytics (aggregate)
// ---------------------------------------------------------------------------

test("fetchMyBusinessesAnalytics calls GET /v1/me/businesses/analytics", async () => {
  const analyticsData = { totalViews: 50, saves: 10, phoneCalls: 5, emailInquiries: 2, websiteClicks: 8, directionRequests: 3, trends: { views: 10, saves: 5, phoneCalls: 0, emailInquiries: 100 } };
  const { sdk, calls } = createMockSdk({ data: analyticsData });

  await sdk.fetchMyBusinessesAnalytics();

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/me/businesses/analytics");
  assert.equal(calls[0].init.method, "GET");
});

test("fetchMyBusinessesAnalytics returns aggregated BusinessAnalytics shape", async () => {
  const analyticsData = { totalViews: 150, saves: 30, phoneCalls: 12, emailInquiries: 5, websiteClicks: 28, directionRequests: 14, trends: { views: 25, saves: -10, phoneCalls: 33.3, emailInquiries: 0 } };
  const { sdk } = createMockSdk({ data: analyticsData });

  const result = await sdk.fetchMyBusinessesAnalytics();

  assert.equal(result.totalViews, 150);
  assert.equal(result.phoneCalls, 12);
  assert.equal(result.trends.views, 25);
  assert.equal(result.trends.phoneCalls, 33.3);
});

test("fetchMyBusinessesAnalytics includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ data: { totalViews: 0, saves: 0, phoneCalls: 0, emailInquiries: 0, websiteClicks: 0, directionRequests: 0, trends: {} } });

  await sdk.fetchMyBusinessesAnalytics();

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// searchBusinesses: geo params (lat, lng, radius)
// ---------------------------------------------------------------------------

test("searchBusinesses serializes lat/lng/radius into query string", async () => {
  const { sdk, calls } = createMockSdk({ data: [], found: 0, page: 1, per_page: 20 });

  await sdk.searchBusinesses("pizza", {
    lat: 10.6573,
    lng: -61.5175,
    radius: 40,
  });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("q"), "pizza");
  assert.equal(url.searchParams.get("lat"), "10.6573");
  assert.equal(url.searchParams.get("lng"), "-61.5175");
  assert.equal(url.searchParams.get("radius"), "40");
});

test("searchBusinesses omits lat/lng/radius when not provided", async () => {
  const { sdk, calls } = createMockSdk({ data: [], found: 0 });

  await sdk.searchBusinesses("pizza", { city: "Port of Spain" });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.has("lat"), false);
  assert.equal(url.searchParams.has("lng"), false);
  assert.equal(url.searchParams.has("radius"), false);
});

test("searchBusinesses can combine city filter with geo params", async () => {
  const { sdk, calls } = createMockSdk({ data: [sampleBusiness], found: 1, page: 1, per_page: 20 });

  await sdk.searchBusinesses("pizza", {
    city: "Port of Spain",
    lat: 10.6573,
    lng: -61.5175,
    radius: 25,
  });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("city"), "Port of Spain");
  assert.equal(url.searchParams.get("lat"), "10.6573");
  assert.equal(url.searchParams.get("radius"), "25");
});

test("searchBusinesses preserves lat=0 and lng=0 (no truthiness drop)", async () => {
  const { sdk, calls } = createMockSdk({ data: [], found: 0 });

  await sdk.searchBusinesses("pizza", { lat: 0, lng: 0, radius: 10 });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("lat"), "0");
  assert.equal(url.searchParams.get("lng"), "0");
  assert.equal(url.searchParams.get("radius"), "10");
});

// ---------------------------------------------------------------------------
// geocodeCityCoordinates
// ---------------------------------------------------------------------------

test("geocodeCityCoordinates returns coordinates on success", async () => {
  const { sdk } = createMockSdk({
    data: { query: "Port of Spain", latitude: 10.6573, longitude: -61.5175 },
  });

  const result = await sdk.geocodeCityCoordinates("Port of Spain");

  assert.notEqual(result, null);
  assert.equal(result.query, "Port of Spain");
  assert.equal(result.latitude, 10.6573);
  assert.equal(result.longitude, -61.5175);
});

test("geocodeCityCoordinates calls correct endpoint with query param", async () => {
  const { sdk, calls } = createMockSdk({
    data: { query: "San Fernando", latitude: 10.2834, longitude: -61.4678 },
  });

  await sdk.geocodeCityCoordinates("San Fernando");

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/businesses/geocode-city");
  assert.equal(url.searchParams.get("q"), "San Fernando");
});

test("geocodeCityCoordinates returns null on 404 (unrecognized city)", async () => {
  const { sdk } = createMockSdk({ message: "Could not locate that city." }, 404);

  const result = await sdk.geocodeCityCoordinates("Nonexistent Place");

  assert.equal(result, null);
});

test("geocodeCityCoordinates returns null on network error", async () => {
  const fetchImpl = async () => { throw new Error("Network error"); };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });

  const result = await sdk.geocodeCityCoordinates("Port of Spain");

  assert.equal(result, null);
});

test("geocodeCityCoordinates includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({
    data: { query: "Port of Spain", latitude: 10.6573, longitude: -61.5175 },
  });

  await sdk.geocodeCityCoordinates("Port of Spain");

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});
