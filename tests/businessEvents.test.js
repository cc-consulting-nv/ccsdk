/**
 * Business Event CRUD SDK Tests (mocked HTTP)
 *
 * Verifies createBusinessEvent, updateBusinessEvent, deleteBusinessEvent,
 * and fetchBusinessEvents with businessId filter — correct endpoints,
 * snake_case body transformation, response shapes, and auth headers.
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

// Matches the actual BusinessEventResource response shape from the API
const sampleEvent = {
  id: "01hxevt0000000000000000001",
  ulid: "01hxevt0000000000000000001",
  title: "Beach Cleanup",
  description: "Community beach cleanup event",
  slug: "beach-cleanup",
  category: "community",
  businessId: "01hxbiz0000000000000000001",
  venueName: "Maracas Bay",
  startsAt: "2026-06-15T09:00:00+00:00",
  endsAt: "2026-06-15T12:00:00+00:00",
  isAllDay: false,
  isFree: true,
  interestedCount: 10,
  goingCount: 5,
  status: "published",
};

// ---------------------------------------------------------------------------
// createBusinessEvent
// ---------------------------------------------------------------------------

test("createBusinessEvent sends POST to /v1/business-events", async () => {
  // First call: POST (create), second call: GET (read-after-write)
  let callCount = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    callCount++;
    if (callCount === 1) {
      return new Response(JSON.stringify(sampleEvent), { status: 201 });
    }
    return new Response(JSON.stringify(sampleEvent), { status: 200 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });

  await sdk.createBusinessEvent({
    businessId: "01hxbiz0000000000000000001",
    title: "Beach Cleanup",
    description: "Community beach cleanup event",
    category: "community",
    startsAt: "2026-06-15T09:00:00Z",
    isFree: true,
  });

  const createCall = calls[0];
  const url = new URL(createCall.url);
  assert.equal(url.pathname, "/v1/business-events");
  assert.equal(createCall.init.method, "POST");
});

test("createBusinessEvent transforms camelCase to snake_case in body", async () => {
  let callCount = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    callCount++;
    if (callCount === 1) {
      return new Response(JSON.stringify(sampleEvent), { status: 201 });
    }
    return new Response(JSON.stringify(sampleEvent), { status: 200 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });

  await sdk.createBusinessEvent({
    businessId: "01hxbiz0000000000000000001",
    title: "Beach Cleanup",
    startsAt: "2026-06-15T09:00:00Z",
    venueName: "Maracas Bay",
    isVirtual: false,
    isAllDay: false,
    isFree: true,
    ticketPrice: 0,
    ticketLink: "https://example.com/tickets",
    imageUrl: "https://example.com/image.jpg",
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.business_id, "01hxbiz0000000000000000001");
  assert.equal(body.starts_at, "2026-06-15T09:00:00Z");
  assert.equal(body.venue_name, "Maracas Bay");
  assert.equal(body.is_virtual, false);
  assert.equal(body.is_all_day, false);
  assert.equal(body.is_free, true);
  assert.equal(body.ticket_price, 0);
  assert.equal(body.ticket_link, "https://example.com/tickets");
  assert.equal(body.image_url, "https://example.com/image.jpg");
  // camelCase keys should not appear
  assert.equal(body.businessId, undefined);
  assert.equal(body.startsAt, undefined);
  assert.equal(body.venueName, undefined);
});

test("createBusinessEvent strips undefined optional fields from body", async () => {
  let callCount = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    callCount++;
    if (callCount === 1) {
      return new Response(JSON.stringify(sampleEvent), { status: 201 });
    }
    return new Response(JSON.stringify(sampleEvent), { status: 200 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });

  await sdk.createBusinessEvent({
    businessId: "01hxbiz0000000000000000001",
    title: "Minimal Event",
    startsAt: "2026-06-15T09:00:00Z",
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.business_id, "01hxbiz0000000000000000001");
  assert.equal(body.title, "Minimal Event");
  assert.equal(body.starts_at, "2026-06-15T09:00:00Z");
  // Optional fields should not be present
  assert.ok(!("venue_name" in body));
  assert.ok(!("is_virtual" in body));
  assert.ok(!("ticket_price" in body));
});

test("createBusinessEvent returns event data", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount++;
    if (callCount === 1) {
      return new Response(JSON.stringify(sampleEvent), { status: 201 });
    }
    return new Response(JSON.stringify(sampleEvent), { status: 200 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });

  const result = await sdk.createBusinessEvent({
    businessId: "01hxbiz0000000000000000001",
    title: "Beach Cleanup",
    startsAt: "2026-06-15T09:00:00Z",
  });

  assert.equal(result.ulid, sampleEvent.ulid);
  assert.equal(result.title, sampleEvent.title);
});

test("createBusinessEvent includes authorization header", async () => {
  let callCount = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    callCount++;
    if (callCount === 1) {
      return new Response(JSON.stringify(sampleEvent), { status: 201 });
    }
    return new Response(JSON.stringify(sampleEvent), { status: 200 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });

  await sdk.createBusinessEvent({
    businessId: "01hxbiz0000000000000000001",
    title: "Test",
    startsAt: "2026-06-15T09:00:00Z",
  });

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// updateBusinessEvent
// ---------------------------------------------------------------------------

test("updateBusinessEvent sends PUT to /v1/business-events/{ulid}", async () => {
  let callCount = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    callCount++;
    return new Response(JSON.stringify({ ...sampleEvent, title: "Updated Title" }), { status: 200 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });

  await sdk.updateBusinessEvent("01hxevt0000000000000000001", {
    title: "Updated Title",
  });

  const updateCall = calls[0];
  const url = new URL(updateCall.url);
  assert.equal(url.pathname, "/v1/business-events/01hxevt0000000000000000001");
  assert.equal(updateCall.init.method, "PUT");
});

test("updateBusinessEvent transforms camelCase to snake_case and sends only provided fields", async () => {
  let callCount = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    callCount++;
    return new Response(JSON.stringify(sampleEvent), { status: 200 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });

  await sdk.updateBusinessEvent("01hxevt0000000000000000001", {
    title: "New Title",
    venueName: "New Venue",
    startsAt: "2026-07-01T10:00:00Z",
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.title, "New Title");
  assert.equal(body.venue_name, "New Venue");
  assert.equal(body.starts_at, "2026-07-01T10:00:00Z");
  // Should not have fields that weren't provided
  assert.ok(!("description" in body));
  assert.ok(!("is_free" in body));
  assert.ok(!("capacity" in body));
});

test("updateBusinessEvent includes authorization header", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(sampleEvent), { status: 200 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });

  await sdk.updateBusinessEvent("01hxevt0000000000000000001", { title: "X" });

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// deleteBusinessEvent
// ---------------------------------------------------------------------------

test("deleteBusinessEvent sends DELETE to /v1/business-events/{ulid}", async () => {
  const { sdk, calls } = createMockSdk({}, 200);

  await sdk.deleteBusinessEvent("01hxevt0000000000000000001");

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/business-events/01hxevt0000000000000000001");
  assert.equal(calls[0].init.method, "DELETE");
});

test("deleteBusinessEvent includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({}, 200);

  await sdk.deleteBusinessEvent("01hxevt0000000000000000001");

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// fetchBusinessEvents: businessId filter
// ---------------------------------------------------------------------------

test("fetchBusinessEvents passes business_id as query param", async () => {
  const { sdk, calls } = createMockSdk({
    data: [sampleEvent],
    meta: { next_cursor: null },
  });

  await sdk.fetchBusinessEvents({ businessId: "01hxbiz0000000000000000001" });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("business_id"), "01hxbiz0000000000000000001");
});

test("fetchBusinessEvents omits business_id when not provided", async () => {
  const { sdk, calls } = createMockSdk({
    data: [],
    meta: { next_cursor: null },
  });

  await sdk.fetchBusinessEvents({ upcoming: true });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.has("business_id"), false);
  assert.equal(url.searchParams.get("upcoming"), "true");
});

test("fetchBusinessEvents passes category as query param", async () => {
  const { sdk, calls } = createMockSdk({
    data: [sampleEvent],
    meta: { next_cursor: null },
  });

  await sdk.fetchBusinessEvents({ category: "music" });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("category"), "music");
});

test("fetchBusinessEvents omits category when not provided", async () => {
  const { sdk, calls } = createMockSdk({
    data: [],
    meta: { next_cursor: null },
  });

  await sdk.fetchBusinessEvents({ upcoming: true });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.has("category"), false);
});
