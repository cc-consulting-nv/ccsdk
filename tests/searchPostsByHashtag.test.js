/**
 * searchPostsByHashtag SDK Unit Tests (mocked HTTP)
 *
 * Covers: request body (tag stripping, cursor forwarding) and nextCursor passthrough.
 */

if (!globalThis.window) {
  globalThis.window = globalThis;
}

import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

const baseUrl = "https://api.example.com";

let dbCounter = 0;
function createSdk(body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  dbCounter += 1;
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    dbName: `hashtag-search-test-${dbCounter}-${Date.now()}`,
  });
  return { sdk, calls };
}

test("searchPostsByHashtag strips # and sends no cursor on the first page", async () => {
  const { sdk, calls } = createSdk({
    data: { items: [{ ulid: "01hxpost0001", type: "POST" }], nextCursor: "abc123" },
  });

  const response = await sdk.searchPostsByHashtag("#guns");

  assert.equal(calls[0].url, `${baseUrl}/v1/search/posts/hashtag`);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { hashtag: "guns" });
  assert.equal(response.data.items.length, 1);
  assert.equal(response.data.nextCursor, "abc123");
});

test("searchPostsByHashtag sends the cursor in the body", async () => {
  const { sdk, calls } = createSdk({ data: { items: [], nextCursor: null } });

  const response = await sdk.searchPostsByHashtag("guns", "abc123");

  assert.deepEqual(calls[0].body, { hashtag: "guns", cursor: "abc123" });
  assert.equal(response.data.nextCursor, null);
});
