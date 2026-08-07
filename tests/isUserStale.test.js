import test from "node:test";
import assert from "node:assert/strict";

// Polyfill IndexedDB for Node.js (the SDK constructor opens a cache)
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../dist/platformSdk.js";

// isUserStale is `private` in TypeScript, which is erased at runtime. Reaching it
// directly keeps the test on the actual comparison logic instead of standing up a
// feed-hydration fixture just to observe one boolean.
const sdk = new CcPlatformSdk({ baseUrl: "https://example.invalid", dbName: "ccsdk-test-stale" });
const isStale = (cachedIso, hint) => sdk.isUserStale({ updatedAt: cachedIso }, hint);

// Derived rather than hardcoded so the epoch can't drift out of sync with the ISO
// strings below. This is the whole-second value the API would send for 12:00:01Z.
const SEC_12_00_01 = Date.parse("2026-08-07T12:00:01.000Z") / 1000;

test("isUserStale: no hint means not stale", () => {
  assert.equal(isStale("2026-08-07T12:00:00.000Z", undefined), false);
});

// The API sends the feed hint as Carbon->timestamp (whole seconds) but caches the
// profile from an ISO string carrying milliseconds. Flooring only one side made a
// newer hint compare as older, so follow-count touches were silently dropped.
test("isUserStale: seconds-epoch hint newer than a sub-second cache is stale", () => {
  // cache 12:00:00.700, hint 12:00:01 -> genuinely newer, must refetch
  assert.equal(isStale("2026-08-07T12:00:00.700Z", SEC_12_00_01), true);
});

test("isUserStale: seconds-epoch hint older than cache is not stale", () => {
  // cache 12:00:05.000, hint 12:00:01 -> older, must not refetch
  assert.equal(isStale("2026-08-07T12:00:05.000Z", SEC_12_00_01), false);
});

test("isUserStale: seconds-epoch hint in the same second as cache does not refetch forever", () => {
  // cache 12:00:01.700, hint 12:00:01 -> same second. Must be false, otherwise this
  // user refetches on every single feed load.
  assert.equal(isStale("2026-08-07T12:00:01.700Z", SEC_12_00_01), false);
});

test("isUserStale: ISO string hints keep millisecond precision", () => {
  assert.equal(isStale("2026-08-07T12:00:00.100Z", "2026-08-07T12:00:00.900Z"), true);
  assert.equal(isStale("2026-08-07T12:00:00.900Z", "2026-08-07T12:00:00.100Z"), false);
});

test("isUserStale: unparseable values are not stale", () => {
  assert.equal(isStale("not-a-date", SEC_12_00_01), false);
  assert.equal(isStale("2026-08-07T12:00:00.000Z", "not-a-date"), false);
});

// updatedAt is typed `string | number`, so a cached profile can hold an epoch
// number. Scaling only the hint made a seconds-epoch cache read as 1970, which
// reported every such profile stale on every feed load.
test("isUserStale: numeric seconds cache compares in the same unit as the hint", () => {
  assert.equal(sdk.isUserStale({ updatedAt: SEC_12_00_01 + 4 }, SEC_12_00_01), false);
  assert.equal(sdk.isUserStale({ updatedAt: 4102444800 }, SEC_12_00_01), false, "year 2100 cache");
  assert.equal(sdk.isUserStale({ updatedAt: SEC_12_00_01 - 4 }, SEC_12_00_01), true);
});

test("isUserStale: numeric milliseconds cache compares correctly", () => {
  const ms = SEC_12_00_01 * 1000;
  assert.equal(sdk.isUserStale({ updatedAt: ms - 4000 }, SEC_12_00_01), true);
  assert.equal(sdk.isUserStale({ updatedAt: ms + 4000 }, SEC_12_00_01), false);
});

// fetchUserProfileById is public, so a consumer can pass milliseconds. Scaling by
// magnitude keeps that from becoming a year-58569 hint that never stops refetching.
test("isUserStale: a millisecond hint is not scaled again", () => {
  const ms = SEC_12_00_01 * 1000;
  assert.equal(isStale("2026-08-07T12:00:05.000Z", ms), false);
  assert.equal(isStale("2026-08-06T12:00:00.000Z", ms), true);
});

// A JSON-stringified epoch used to hit Date.parse, return NaN, and be dropped.
test("isUserStale: numeric-string hints are treated as epochs", () => {
  assert.equal(isStale("2026-08-07T12:00:00.000Z", String(SEC_12_00_01)), true);
  assert.equal(isStale("2026-08-07T12:00:05.000Z", String(SEC_12_00_01)), false);
});

test("isUserStale: non-finite and missing values are never stale", () => {
  assert.equal(isStale("2026-08-07T12:00:00.000Z", 0), false);
  assert.equal(isStale("2026-08-07T12:00:00.000Z", NaN), false);
  assert.equal(isStale("2026-08-07T12:00:00.000Z", Infinity), false);
  assert.equal(isStale("2026-08-07T12:00:00.000Z", -5), false);
  assert.equal(sdk.isUserStale({}, SEC_12_00_01), false);
});

// Guards the *1000: with the scaling dropped, a raw seconds hint is ~1.78e9
// against a ~1.78e12 cache, so even a decades-old cache reads as fresh.
test("isUserStale: a decades-old cache is stale against a seconds hint", () => {
  assert.equal(isStale("1990-01-01T00:00:00.000Z", SEC_12_00_01), true);
});
