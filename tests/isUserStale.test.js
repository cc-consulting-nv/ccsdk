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
