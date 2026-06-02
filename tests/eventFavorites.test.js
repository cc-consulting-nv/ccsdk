/**
 * Event Favorites SDK Unit Tests (mocked HTTP)
 *
 * Verifies checkEventFavorite, saveEventFavorite, removeEventFavorite,
 * and fetchMyEventFavorites — correct endpoints, HTTP methods, request
 * bodies, auth headers, and response shapes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

const baseUrl = "https://api.example.com";
const eventUlid = "01hxevt0000000000000000001";

function createMockSdk(responseData, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responseData), { status });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });
  return { sdk, calls };
}

// ---------------------------------------------------------------------------
// saveEventFavorite
// ---------------------------------------------------------------------------

test("saveEventFavorite sends POST to /v1/business-events/{ulid}/favorite", async () => {
  const { sdk, calls } = createMockSdk({ favorited: true });

  await sdk.saveEventFavorite(eventUlid);

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, `/v1/business-events/${eventUlid}/favorite`);
  assert.equal(calls[0].init.method, "POST");
});

test("saveEventFavorite includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ favorited: true });

  await sdk.saveEventFavorite(eventUlid);

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

test("saveEventFavorite returns { favorited: true } on success", async () => {
  const { sdk } = createMockSdk({ favorited: true });

  const result = await sdk.saveEventFavorite(eventUlid);

  assert.equal(result.favorited, true);
});

test("saveEventFavorite URL-encodes the event ULID", async () => {
  const { sdk, calls } = createMockSdk({ favorited: true });
  const ulid = "01hw abc+special";

  await sdk.saveEventFavorite(ulid);

  const url = new URL(calls[0].url);
  assert.ok(!url.pathname.includes(" "), "pathname should not contain raw spaces");
});

// ---------------------------------------------------------------------------
// removeEventFavorite
// ---------------------------------------------------------------------------

test("removeEventFavorite sends DELETE to /v1/business-events/{ulid}/favorite", async () => {
  const { sdk, calls } = createMockSdk({ favorited: false });

  await sdk.removeEventFavorite(eventUlid);

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, `/v1/business-events/${eventUlid}/favorite`);
  assert.equal(calls[0].init.method, "DELETE");
});

test("removeEventFavorite includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ favorited: false });

  await sdk.removeEventFavorite(eventUlid);

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

test("removeEventFavorite resolves without error on 200", async () => {
  const { sdk } = createMockSdk({ favorited: false }, 200);

  await assert.doesNotReject(sdk.removeEventFavorite(eventUlid));
});

// ---------------------------------------------------------------------------
// checkEventFavorite
// ---------------------------------------------------------------------------

test("checkEventFavorite sends GET to /v1/business-events/{ulid}/favorite", async () => {
  const { sdk, calls } = createMockSdk({ favorited: true });

  await sdk.checkEventFavorite(eventUlid);

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, `/v1/business-events/${eventUlid}/favorite`);
  assert.equal(calls[0].init.method, "GET");
});

test("checkEventFavorite includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ favorited: false });

  await sdk.checkEventFavorite(eventUlid);

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

test("checkEventFavorite returns { favorited: true } when event is saved", async () => {
  const { sdk } = createMockSdk({ favorited: true });

  const result = await sdk.checkEventFavorite(eventUlid);

  assert.equal(result.favorited, true);
});

test("checkEventFavorite returns { favorited: false } when event is not saved", async () => {
  const { sdk } = createMockSdk({ favorited: false });

  const result = await sdk.checkEventFavorite(eventUlid);

  assert.equal(result.favorited, false);
});

test("checkEventFavorite sends no request body", async () => {
  const { sdk, calls } = createMockSdk({ favorited: false });

  await sdk.checkEventFavorite(eventUlid);

  assert.ok(!calls[0].init.body, "GET request should have no body");
});

// ---------------------------------------------------------------------------
// fetchMyEventFavorites
// ---------------------------------------------------------------------------

test("fetchMyEventFavorites sends GET to /v1/users/me/event-favorites", async () => {
  const { sdk, calls } = createMockSdk({ eventIds: [] });

  await sdk.fetchMyEventFavorites();

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/users/me/event-favorites");
  assert.equal(calls[0].init.method, "GET");
});

test("fetchMyEventFavorites includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ eventIds: [] });

  await sdk.fetchMyEventFavorites();

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

test("fetchMyEventFavorites returns { eventIds } array", async () => {
  const ids = ["01hxevt0000000000000000001", "01hxevt0000000000000000002"];
  const { sdk } = createMockSdk({ eventIds: ids });

  const result = await sdk.fetchMyEventFavorites();

  assert.ok(Array.isArray(result.eventIds));
  assert.deepEqual(result.eventIds, ids);
});

test("fetchMyEventFavorites returns empty array when user has no saved events", async () => {
  const { sdk } = createMockSdk({ eventIds: [] });

  const result = await sdk.fetchMyEventFavorites();

  assert.ok(Array.isArray(result.eventIds));
  assert.equal(result.eventIds.length, 0);
});

test("fetchMyEventFavorites sends no request body", async () => {
  const { sdk, calls } = createMockSdk({ eventIds: [] });

  await sdk.fetchMyEventFavorites();

  assert.ok(!calls[0].init.body, "GET request should have no body");
});
