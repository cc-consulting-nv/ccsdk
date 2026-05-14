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

let groupsDbCounter = 0;
function uniqueGroupsDbName() {
  groupsDbCounter += 1;
  return `groups-test-${groupsDbCounter}-${Date.now()}-${Math.random()}`;
}

function createAuthenticatedSequentialSdk(responses) {
  const { fetchImpl, calls } = createSequentialMockFetch(responses);
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    dbName: uniqueGroupsDbName(),
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

// ---------------------------------------------------------------------------
// getGroup cache + 30-min refresh TTL
// ---------------------------------------------------------------------------

function waitForBackgroundRefresh(predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      try {
        if (await predicate()) return resolve();
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("background refresh did not occur in time"));
      }
      setTimeout(check, 10);
    };
    check();
  });
}

test("getGroup serves second call from cache (no second GET)", async () => {
  const groupResponse = createSampleGroupResponse({ ulid: "01hxgroupcache01" });
  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: groupResponse } },
  ]);

  const first = await sdk.getGroup("01hxgroupcache01");
  const second = await sdk.getGroup("01hxgroupcache01");

  assert.equal(first.ulid, "01hxgroupcache01");
  assert.equal(second.ulid, "01hxgroupcache01");
  assert.equal(calls.length, 1, "second getGroup should hit cache, not network");
});

test("getGroup past refresh TTL returns cached value AND fires background refresh", async () => {
  const original = createSampleGroupResponse({ ulid: "01hxgroupswr0001", name: "Original" });
  const refreshed = createSampleGroupResponse({ ulid: "01hxgroupswr0001", name: "Refreshed" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: original } },
    { data: { data: refreshed } },
  ]);

  // Prime cache
  const first = await sdk.getGroup("01hxgroupswr0001");
  assert.equal(first.name, "Original");
  assert.equal(calls.length, 1);

  // Force the cached entry past the soft refresh TTL by rewriting it with
  // a backdated lastCheckedAt directly via cache internals.
  const cache = await sdk.cachePromise;
  const entry = await cache.db.groups.get("01hxgroupswr0001");
  entry.lastCheckedAt = Date.now() - 31 * 60 * 1000; // 31 min ago
  await cache.db.groups.put(entry);

  // Second call returns the cached (stale) value immediately, but triggers
  // a background refresh.
  const second = await sdk.getGroup("01hxgroupswr0001");
  assert.equal(second.name, "Original", "stale cached value returned synchronously");

  await waitForBackgroundRefresh(() => calls.length === 2);
  assert.equal(calls.length, 2, "background refresh should have fired");

  // Wait until the refreshed value lands in IndexedDB (network fetch resolves
  // before the cache write completes).
  await waitForBackgroundRefresh(async () => {
    const row = await cache.db.groups.get("01hxgroupswr0001");
    return row?.data?.name === "Refreshed";
  });

  // Subsequent call sees the refreshed value.
  const third = await sdk.getGroup("01hxgroupswr0001");
  assert.equal(third.name, "Refreshed");
});

test("getGroups warms per-group cache so getGroup hits IndexedDB", async () => {
  const list = [
    createSampleGroupResponse({ ulid: "01hxgrouplist001", name: "G1" }),
    createSampleGroupResponse({ ulid: "01hxgrouplist002", name: "G2" }),
  ];

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: list },
  ]);

  await sdk.getGroups();
  assert.equal(calls.length, 1);

  const fetched = await sdk.getGroup("01hxgrouplist001");
  assert.equal(fetched.name, "G1");
  assert.equal(calls.length, 1, "getGroup should hit warmed cache, no extra network");
});

test("joinGroup invalidates cached group", async () => {
  const before = createSampleGroupResponse({
    ulid: "01hxgroupjoin001",
    isJoined: false,
    membersCount: 5,
  });
  const after = createSampleGroupResponse({
    ulid: "01hxgroupjoin001",
    isJoined: true,
    membersCount: 6,
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: before } }, // initial getGroup
    { data: { data: { success: true } } }, // joinGroup
    { data: { data: after } }, // post-join getGroup
  ]);

  const first = await sdk.getGroup("01hxgroupjoin001");
  assert.equal(first.isJoined, false);

  await sdk.joinGroup("01hxgroupjoin001");

  const second = await sdk.getGroup("01hxgroupjoin001");
  assert.equal(second.isJoined, true);
  assert.equal(second.membersCount, 6);
  assert.equal(calls.length, 3, "join should invalidate cache and force refetch");
});

test("leaveGroup invalidates cached group", async () => {
  const joined = createSampleGroupResponse({
    ulid: "01hxgroupleave01",
    isJoined: true,
  });
  const left = createSampleGroupResponse({
    ulid: "01hxgroupleave01",
    isJoined: false,
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: joined } },
    { data: { data: { success: true } } },
    { data: { data: left } },
  ]);

  await sdk.getGroup("01hxgroupleave01");
  await sdk.leaveGroup("01hxgroupleave01");
  const after = await sdk.getGroup("01hxgroupleave01");

  assert.equal(after.isJoined, false);
  assert.equal(calls.length, 3);
});

test("createGroup writes through to cache", async () => {
  const created = createSampleGroupResponse({
    ulid: "01hxgroupcreate1",
    name: "Brand New",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: { group: created } } },
  ]);

  const result = await sdk.createGroup({ name: "Brand New" });
  assert.equal(result.ulid, "01hxgroupcreate1");

  // Subsequent getGroup should not hit the network.
  const cached = await sdk.getGroup("01hxgroupcreate1");
  assert.equal(cached.name, "Brand New");
  assert.equal(calls.length, 1, "createGroup should warm cache, no follow-up GET");
});

test("updateGroup invalidates cache and serves fresh data", async () => {
  const before = createSampleGroupResponse({
    ulid: "01hxgroupupd001",
    name: "Old Name",
  });
  const after = createSampleGroupResponse({
    ulid: "01hxgroupupd001",
    name: "New Name",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: before } }, // initial getGroup
    { data: { data: { success: true } } }, // PATCH
    { data: { data: after } }, // read-after-write GET
  ]);

  const first = await sdk.getGroup("01hxgroupupd001");
  assert.equal(first.name, "Old Name");

  const result = await sdk.updateGroup({ groupId: "01hxgroupupd001", name: "New Name" });
  assert.equal(result.name, "New Name");

  // Cache should now hold the refreshed value.
  const fromCache = await sdk.getGroup("01hxgroupupd001");
  assert.equal(fromCache.name, "New Name");
  assert.equal(calls.length, 3, "no extra network call after read-after-write");
});

// ---------------------------------------------------------------------------
// fetchUserProfileById SWR (mirror of getGroup SWR test)
// ---------------------------------------------------------------------------

function userProfileBatchResponse(users) {
  return { data: { data: users } };
}

test("fetchUserProfileById past refresh TTL returns cached AND fires background batch refresh", async () => {
  const original = { ulid: "01hxuserttl00001", username: "v1", name: "Original" };
  const refreshed = { ulid: "01hxuserttl00001", username: "v1", name: "Refreshed" };

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    userProfileBatchResponse([original]), // initial fetch (cache miss)
    userProfileBatchResponse([refreshed]), // background refresh
  ]);

  // Cache miss → batched POST to /v1/profile
  const first = await sdk.fetchUserProfileById("01hxuserttl00001");
  assert.equal(first.name, "Original");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/profile`);

  // Backdate the cache row past the soft TTL.
  const cache = await sdk.cachePromise;
  const row = await cache.db.users.get("01hxuserttl00001");
  row.lastCheckedAt = Date.now() - 31 * 60 * 1000;
  await cache.db.users.put(row);

  // Stale value returned synchronously, refresh fires in background.
  const second = await sdk.fetchUserProfileById("01hxuserttl00001");
  assert.equal(second.name, "Original", "stale cached value returned without awaiting network");

  await waitForBackgroundRefresh(() => calls.length === 2);
  await waitForBackgroundRefresh(async () => {
    const r = await cache.db.users.get("01hxuserttl00001");
    return r?.data?.name === "Refreshed";
  });

  const third = await sdk.fetchUserProfileById("01hxuserttl00001");
  assert.equal(third.name, "Refreshed");
});

test("fetchUserProfileById in-flight Set clears after background refresh completes", async () => {
  const u = { ulid: "01hxuserlock0001", username: "lock" };
  const { sdk, calls } = createAuthenticatedSequentialSdk([
    userProfileBatchResponse([u]),
    userProfileBatchResponse([u]),
  ]);

  await sdk.fetchUserProfileById("01hxuserlock0001");
  const cache = await sdk.cachePromise;
  const row = await cache.db.users.get("01hxuserlock0001");
  row.lastCheckedAt = Date.now() - 31 * 60 * 1000;
  await cache.db.users.put(row);

  await sdk.fetchUserProfileById("01hxuserlock0001"); // triggers background refresh
  await waitForBackgroundRefresh(() => calls.length === 2);
  await waitForBackgroundRefresh(() => sdk.userRefreshInFlight.size === 0);
  assert.equal(sdk.userRefreshInFlight.size, 0, "in-flight Set should be empty once refresh settles");
});

test("getGroup deduplicates concurrent past-TTL refreshes into single GET", async () => {
  const original = createSampleGroupResponse({ ulid: "01hxgroupdedup01", name: "Original" });
  const refreshed = createSampleGroupResponse({ ulid: "01hxgroupdedup01", name: "Refreshed" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: original } },
    { data: { data: refreshed } },
  ]);

  await sdk.getGroup("01hxgroupdedup01"); // prime
  const cache = await sdk.cachePromise;
  const row = await cache.db.groups.get("01hxgroupdedup01");
  row.lastCheckedAt = Date.now() - 31 * 60 * 1000;
  await cache.db.groups.put(row);

  // Fire 3 concurrent reads — only ONE background GET should land.
  await Promise.all([
    sdk.getGroup("01hxgroupdedup01"),
    sdk.getGroup("01hxgroupdedup01"),
    sdk.getGroup("01hxgroupdedup01"),
  ]);

  await waitForBackgroundRefresh(() => calls.length === 2);
  // Wait a tick to let any duplicate refreshes resolve (they shouldn't exist).
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.length, 2, "concurrent refreshes deduped to single GET");
});

// ---------------------------------------------------------------------------
// C: negative cache for 404 user/group
// ---------------------------------------------------------------------------

test("getGroup negative cache: 404 short-circuits subsequent reads for 60s", async () => {
  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { status: 404, data: { message: "Not found" } },
  ]);

  await assert.rejects(() => sdk.getGroup("01hxgroup404neg1"));
  assert.equal(calls.length, 1, "first read hits API");

  // Second read should short-circuit — no extra network call.
  await assert.rejects(() => sdk.getGroup("01hxgroup404neg1"));
  assert.equal(calls.length, 1, "tombstone short-circuits the second read");

  // Tombstone is in the SDK's groupNotFound map.
  assert.ok(sdk.groupNotFound.has("01hxgroup404neg1"));
});

test("getGroup negative cache cleared on successful refetch after expiry", async () => {
  const groupResp = createSampleGroupResponse({ ulid: "01hxgroup404clr1", name: "Found" });
  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { status: 404, data: { message: "Not found" } },
    { data: { data: groupResp } },
  ]);

  await assert.rejects(() => sdk.getGroup("01hxgroup404clr1"));
  // Force-expire the tombstone.
  sdk.groupNotFound.set("01hxgroup404clr1", Date.now() - 1);

  const result = await sdk.getGroup("01hxgroup404clr1");
  assert.equal(result.name, "Found");
  assert.equal(calls.length, 2);
  assert.equal(sdk.groupNotFound.has("01hxgroup404clr1"), false, "tombstone cleared on success");
});

test("createGroup clears any prior 404 tombstone for the new id", async () => {
  const created = createSampleGroupResponse({ ulid: "01hxgroupcrtnf01", name: "New" });
  const { sdk } = createAuthenticatedSequentialSdk([
    { data: { data: { group: created } } },
  ]);

  // Pre-poison the tombstone (simulates: someone tried to fetch this id and 404'd
  // before it was created).
  sdk.groupNotFound.set("01hxgroupcrtnf01", Date.now() + 60_000);

  await sdk.createGroup({ name: "New" });
  assert.equal(sdk.groupNotFound.has("01hxgroupcrtnf01"), false);
});

test("clearCache wipes negative caches", async () => {
  const { sdk } = createAuthenticatedSequentialSdk([{ data: { data: { ok: true } } }]);
  sdk.userNotFound.set("01uX", Date.now() + 60_000);
  sdk.groupNotFound.set("01gX", Date.now() + 60_000);

  await sdk.clearCache();
  assert.equal(sdk.userNotFound.size, 0);
  assert.equal(sdk.groupNotFound.size, 0);
});

test("fetchUserProfileById negative cache: missing-from-batch tombstoned, then short-circuits", async () => {
  // Batch endpoint returns empty array — id requested but not present in response.
  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: [] } },
  ]);

  const first = await sdk.fetchUserProfileById("01hxuser404nf01");
  assert.equal(first, null);
  assert.equal(calls.length, 1);
  assert.ok(sdk.userNotFound.has("01hxuser404nf01"));

  // Second call should short-circuit, no batch fetch.
  const second = await sdk.fetchUserProfileById("01hxuser404nf01");
  assert.equal(second, null);
  assert.equal(calls.length, 1, "tombstone prevents re-fetch");
});
