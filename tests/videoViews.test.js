/**
 * Video view SDK Unit Tests (mocked HTTP)
 *
 * Covers: sendVideoViews / sendVideoViewsNoAuth pass play_id through and
 * split batches over 100 views into several requests (the backend rejects
 * more than 100 per request).
 */

if (!globalThis.window) {
  globalThis.window = globalThis;
}
import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

function createSdk() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(null, { status: 202 });
  };
  const sdk = new CcPlatformSdk({
    baseUrl: "https://api.example.com",
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });
  return { sdk, calls };
}

const view = (i, playId) => ({
  post_ulid: "01hxpost",
  start_second: i,
  end_second: i + 4,
  last_position: i + 4,
  ...(playId ? { play_id: playId } : {}),
});

test("sendVideoViews sends play_id in one request for a small batch", async () => {
  const { sdk, calls } = createSdk();
  const playId = "3f2b8c1e-9d4a-4e7b-8a6f-2c1d0e9b7a54";

  await sdk.sendVideoViews({ views: [view(0, playId), view(5, playId)] });

  assert.equal(calls.length, 1);
  assert.ok(String(calls[0].url).endsWith("/v1/video-views"));
  assert.equal(calls[0].body.views.length, 2);
  assert.equal(calls[0].body.views[0].play_id, playId);
});

test("sendVideoViews splits 250 views into requests of 100, 100, 50", async () => {
  const { sdk, calls } = createSdk();
  const views = Array.from({ length: 250 }, (_, i) => view(i));

  await sdk.sendVideoViews({ views });

  assert.deepEqual(calls.map((c) => c.body.views.length), [100, 100, 50]);
  assert.deepEqual(calls.flatMap((c) => c.body.views), views);
});

test("sendVideoViewsNoAuth splits too and posts to video-views-na", async () => {
  const { sdk, calls } = createSdk();

  await sdk.sendVideoViewsNoAuth({ views: Array.from({ length: 101 }, (_, i) => view(i)) });

  assert.deepEqual(calls.map((c) => c.body.views.length), [100, 1]);
  assert.ok(calls.every((c) => String(c.url).endsWith("/v1/video-views-na")));
});

test("sendVideoViews sends nothing for an empty batch", async () => {
  const { sdk, calls } = createSdk();

  await sdk.sendVideoViews({ views: [] });

  assert.equal(calls.length, 0);
});
