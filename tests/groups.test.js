/**
 * Groups SDK Unit Tests (mocked HTTP)
 *
 * Verifies updateGroup PATCH behavior at the SDK layer.
 * For live API integration testing, see integration/.
 *
 * Covers: updateGroup
 */

if (!globalThis.window) {
  globalThis.window = globalThis;
}

import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

const baseUrl = "https://api.example.com";

function createSampleGroupResponse(overrides = {}) {
  return {
    ulid: overrides.ulid || "01hxgroup0000000001",
    id: overrides.id || "01hxgroup0000000001",
    name: overrides.name || "Test Group",
    description: overrides.description ?? "Test description",
    avatar: overrides.avatar ?? "https://cdn.example.com/avatars/group.jpg",
    background:
      overrides.background ?? "https://cdn.example.com/banners/group.jpg",
    visibility: overrides.visibility || "public",
    membersCount: 1,
    isJoined: true,
    isFavorite: false,
    memberRole: "owner",
    owner: {
      ulid: "01hxuser0000000001",
      username: "owner",
    },
    createdAt: "2024-01-15T10:00:00.000000Z",
    ...overrides,
  };
}

function createSequentialMockFetch(responses) {
  const calls = [];
  let responseIndex = 0;

  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      init,
      method: init?.method || "GET",
      body: init?.body ? JSON.parse(init.body) : null,
    });

    const response =
      responses[responseIndex] || responses[responses.length - 1];
    responseIndex++;

    return new Response(JSON.stringify(response.data), {
      status: response.status || 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetchImpl, calls };
}

function createAuthenticatedSequentialSdk(responses) {
  const { fetchImpl, calls } = createSequentialMockFetch(responses);
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });
  return { sdk, calls };
}

// ---------------------------------------------------------------------------
// updateGroup tests
// ---------------------------------------------------------------------------

test("updateGroup sends PATCH to /v1/group/edit", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgrouppatch001",
    name: "Renamed Group",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  await sdk.updateGroup({
    groupId: "01hxgrouppatch001",
    name: "Renamed Group",
  });

  assert.equal(calls[0].url, `${baseUrl}/v1/group/edit`);
  assert.equal(calls[0].method, "PATCH");
});

test("updateGroup sends name in body when provided", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgroupname001",
    name: "Brand New Name",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  await sdk.updateGroup({
    groupId: "01hxgroupname001",
    name: "Brand New Name",
  });

  assert.equal(calls[0].body.groupId, "01hxgroupname001");
  assert.equal(calls[0].body.name, "Brand New Name");
});

test("updateGroup sends description when provided", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgroupdesc001",
    description: "New description here",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  await sdk.updateGroup({
    groupId: "01hxgroupdesc001",
    description: "New description here",
  });

  assert.equal(calls[0].body.description, "New description here");
});

test("updateGroup sends avatar and background URLs", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgroupmedia001",
    avatar: "https://cdn.example.com/new-avatar.jpg",
    background: "https://cdn.example.com/new-banner.jpg",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  await sdk.updateGroup({
    groupId: "01hxgroupmedia001",
    avatar: "https://cdn.example.com/new-avatar.jpg",
    background: "https://cdn.example.com/new-banner.jpg",
  });

  assert.equal(
    calls[0].body.avatar,
    "https://cdn.example.com/new-avatar.jpg",
  );
  assert.equal(
    calls[0].body.background,
    "https://cdn.example.com/new-banner.jpg",
  );
});

test("updateGroup forwards null avatar/background to remove media", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgroupclear001",
    avatar: null,
    background: null,
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  await sdk.updateGroup({
    groupId: "01hxgroupclear001",
    avatar: null,
    background: null,
  });

  assert.equal(calls[0].body.avatar, null);
  assert.equal(calls[0].body.background, null);
});

test("updateGroup sends visibility when changed", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgroupvis00001",
    visibility: "private",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  await sdk.updateGroup({
    groupId: "01hxgroupvis00001",
    visibility: "private",
  });

  assert.equal(calls[0].body.visibility, "private");
});

test("updateGroup performs read-after-write via getGroup", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgrouprw00001",
    name: "Updated",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  await sdk.updateGroup({
    groupId: "01hxgrouprw00001",
    name: "Updated",
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[1].method, "GET");
  assert.equal(calls[1].url, `${baseUrl}/v1/groups/01hxgrouprw00001`);
});

test("updateGroup returns the refreshed group from getGroup", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgroupreturn01",
    name: "Returned Name",
    description: "Returned description",
  });

  const { sdk } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  const result = await sdk.updateGroup({
    groupId: "01hxgroupreturn01",
    name: "Returned Name",
  });

  assert.equal(result.ulid, "01hxgroupreturn01");
  assert.equal(result.name, "Returned Name");
  assert.equal(result.description, "Returned description");
});

test("updateGroup includes Authorization header on PATCH", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgroupauth0001",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  await sdk.updateGroup({
    groupId: "01hxgroupauth0001",
    name: "Auth Test",
  });

  const authHeader =
    calls[0].init?.headers?.Authorization ??
    calls[0].init?.headers?.authorization;
  assert.equal(authHeader, "Bearer test-token");
});

test("updateGroup throws on 403 forbidden", async () => {
  const { sdk } = createAuthenticatedSequentialSdk([
    { status: 403, data: { message: "Forbidden" } },
  ]);

  await assert.rejects(
    async () => {
      await sdk.updateGroup({
        groupId: "01hxgroupforbid01",
        name: "Hacked",
      });
    },
    (err) => err instanceof Error,
  );
});

test("updateGroup throws on 404 not found", async () => {
  const { sdk } = createAuthenticatedSequentialSdk([
    { status: 404, data: { message: "Not found" } },
  ]);

  await assert.rejects(
    async () => {
      await sdk.updateGroup({
        groupId: "01hxgroup404nope1",
        name: "Missing",
      });
    },
    (err) => err instanceof Error,
  );
});

test("updateGroup sends only fields that were provided", async () => {
  const groupResponse = createSampleGroupResponse({
    ulid: "01hxgrouppartial1",
    name: "Only Name Changed",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { success: true } } },
    { data: { data: groupResponse } },
  ]);

  await sdk.updateGroup({
    groupId: "01hxgrouppartial1",
    name: "Only Name Changed",
  });

  const body = calls[0].body;
  assert.equal(body.name, "Only Name Changed");
  assert.equal("description" in body, false);
  assert.equal("avatar" in body, false);
  assert.equal("background" in body, false);
  assert.equal("visibility" in body, false);
});
