/**
 * Polls SDK Unit Tests (mocked HTTP)
 *
 * Covers: pollBatchGet — ensures the SDK sends the request shape the
 * Laravel PollController expects (`{ ulids: [...] }`, not `postUlids`).
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
// pollBatchGet
// ---------------------------------------------------------------------------

test("pollBatchGet POSTs to /v1/posts/polls/batch with { ulids: [...] }", async () => {
  const ulid1 = "01hgd4abcd1234567890abcdef";
  const ulid2 = "01hgd4abcd1234567890abcxyz";

  const apiResponse = {
    polls: {
      [ulid1]: {
        id: "42",
        question: "Favorite color?",
        endsAt: null,
        hasEnded: false,
        multipleChoice: false,
        totalVotes: 0,
        options: [],
        userVote: null,
        createdAt: "2026-04-20T00:00:00+00:00",
      },
      [ulid2]: null,
    },
  };

  const { sdk, calls } = createAuthenticatedMockSdk(apiResponse);

  const result = await sdk.pollBatchGet([ulid1, ulid2]);

  assert.equal(calls.length, 1, "expected one HTTP call");
  const [call] = calls;
  assert.equal(call.method, "POST");
  assert.match(call.url, /\/v1\/posts\/polls\/batch$/);
  assert.deepEqual(
    call.body,
    { ulids: [ulid1, ulid2] },
    "SDK must send { ulids: [...] } to match the Laravel PollController validation rules (NOT { postUlids })",
  );

  assert.equal(result.polls[ulid1].question, "Favorite color?");
  assert.equal(result.polls[ulid2], null);
});

test("pollBatchGet returns the polls map verbatim from the API envelope", async () => {
  const ulid = "01hgd4abcd1234567890abcdef";
  const apiResponse = { polls: { [ulid]: null } };

  const { sdk } = createAuthenticatedMockSdk(apiResponse);
  const result = await sdk.pollBatchGet([ulid]);

  assert.ok("polls" in result);
  assert.equal(result.polls[ulid], null);
});
