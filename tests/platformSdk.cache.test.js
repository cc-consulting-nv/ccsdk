import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

const baseUrl = "https://api.example.com";

if (!globalThis.window) {
  globalThis.window = globalThis;
}

class MockCache {
  posts = new Map();
  feedResources = new Map();

  clone(value) {
    return value === undefined ? undefined : structuredClone(value);
  }

  async getPost(id) {
    return this.clone(this.posts.get(id) ?? null);
  }

  async getPosts(ids) {
    const result = {};
    for (const id of ids) {
      if (this.posts.has(id)) {
        result[id] = this.clone(this.posts.get(id));
      }
    }
    return result;
  }

  async setPost(id, post) {
    this.posts.set(id, this.clone(post));
  }

  async setPosts(posts) {
    for (const [id, post] of Object.entries(posts)) {
      this.posts.set(id, this.clone(post));
    }
  }

  async invalidatePost(id) {
    this.posts.delete(id);
  }

  async deletePost(id) {
    this.posts.delete(id);
    for (const [route, resource] of this.feedResources.entries()) {
      const filtered = resource.ulids.filter((ulid) => ulid !== id);
      this.feedResources.set(route, {
        ...resource,
        ulids: filtered,
      });
    }
  }

  async appendToFeedResource(route, ulids, cursor) {
    const existing = this.feedResources.get(route);
    const combined = existing
      ? Array.from(new Set([...existing.ulids, ...ulids]))
      : [...ulids];
    this.feedResources.set(route, {
      route,
      ulids: combined,
      cursor: cursor ?? existing?.cursor ?? null,
    });
  }

  async getFeedResource(route) {
    return this.clone(this.feedResources.get(route) ?? null);
  }
}

function createSdk(fetchImpl, cache = new MockCache()) {
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    cache,
    tokens: { accessToken: "test-token" },
  });
  return { sdk, cache };
}

test("createPost re-reads full post data when create response only includes id", async () => {
  const calls = [];
  const cache = new MockCache();
  const { sdk } = createSdk(async (url, init) => {
    calls.push({ url, init });

    if (url === `${baseUrl}/v1/posts/create`) {
      return new Response(JSON.stringify({
        data: {
          id: "post-1",
          title: "partial",
        },
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts`) {
      return new Response(JSON.stringify({
        data: [{
          id: "post-1",
          ulid: "post-1",
          title: "full",
          content: "server body",
        }],
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, cache);

  const post = await sdk.createPost({ title: "client title" });

  assert.equal(post.title, "full");
  assert.equal(post.content, "server body");
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].init.body), { ulids: ["post-1"] });
  assert.equal((await cache.getPost("post-1")).content, "server body");
});

test("updatePost uses the requested ULID for read-after-write when patch response omits identifiers", async () => {
  const calls = [];
  const cache = new MockCache();
  const { sdk } = createSdk(async (url, init) => {
    calls.push({ url, init });

    if (url === `${baseUrl}/v1/posts/post-2`) {
      return new Response(JSON.stringify({
        data: {
          title: "patched",
        },
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts`) {
      return new Response(JSON.stringify({
        data: [{
          id: "post-2",
          ulid: "post-2",
          title: "server canonical",
          content: "after patch",
        }],
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, cache);

  const post = await sdk.updatePost("post-2", { title: "patched" });

  assert.equal(post.title, "server canonical");
  assert.equal(post.content, "after patch");
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].init.body), { ulids: ["post-2"] });
  assert.equal((await cache.getPost("post-2")).content, "after patch");
});

test("fetchFeedPage keeps other cached feeds intact when refreshing a stale post body", async () => {
  const cache = new MockCache();
  await cache.setPost("post-3", {
    id: "post-3",
    ulid: "post-3",
    title: "stale",
    updatedAt: "2024-01-01T00:00:00Z",
  });
  await cache.appendToFeedResource("other-feed", ["post-3"], null);

  const { sdk } = createSdk(async (url, init) => {
    if (url.startsWith(`${baseUrl}/v1/songs/feed/trending`)) {
      return new Response(JSON.stringify({
        data: [{
          ulid: "post-3",
          updatedAt: "2024-01-02T00:00:00Z",
        }],
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts`) {
      return new Response(JSON.stringify({
        data: [{
          id: "post-3",
          ulid: "post-3",
          title: "fresh",
          updatedAt: "2024-01-02T00:00:00Z",
        }],
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, cache);

  const page = await sdk.fetchTrendingFeed();
  const cachedOtherFeed = await sdk.readCachedFeed("other-feed");

  assert.equal(page.posts[0].title, "fresh");
  assert.deepEqual(cachedOtherFeed.ulids, ["post-3"]);
  assert.equal(cachedOtherFeed.posts[0].title, "fresh");
});

test("fetchFeedPage caches full post objects for offline reads", async () => {
  const { sdk } = createSdk(async (url) => {
    if (url.startsWith(`${baseUrl}/v1/songs/feed/trending`)) {
      return new Response(JSON.stringify({
        data: [{
          id: "post-4",
          ulid: "post-4",
          title: "cached full post",
          content: "ready offline",
        }],
        nextCursor: "cursor-1",
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const page = await sdk.fetchTrendingFeed();
  const cached = await sdk.readCachedFeed("/v1/songs/feed/trending");

  assert.equal(page.posts[0].content, "ready offline");
  assert.deepEqual(cached.ulids, ["post-4"]);
  assert.equal(cached.posts[0].title, "cached full post");
  assert.equal(cached.nextCursor, "cursor-1");
});

test("createComment refreshes parent engagement even when the comment reread misses", async () => {
  const cache = new MockCache();
  await cache.setPost("parent-1", {
    id: "parent-1",
    ulid: "parent-1",
    title: "parent",
    postEngagement: {
      commentCount: 1,
    },
  });

  const { sdk } = createSdk(async (url, init) => {
    if (url === `${baseUrl}/v1/comments`) {
      return new Response(JSON.stringify({
        data: {
          id: "comment-1",
          parentId: "parent-1",
          content: "comment body",
        },
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts`) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts/engagement`) {
      assert.deepEqual(JSON.parse(init.body), { ulids: ["parent-1"] });
      return new Response(JSON.stringify({
        data: {
          "parent-1": {
            postEngagement: {
              commentCount: 2,
            },
          },
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, cache);

  const comment = await sdk.createComment({
    parentId: "parent-1",
    body: "comment body",
  });

  const parent = await cache.getPost("parent-1");

  assert.equal(comment.id, "comment-1");
  assert.equal(parent.postEngagement.commentCount, 2);
  assert.equal((await cache.getPost("comment-1")).content, "comment body");
});

test("createComment refreshes parent engagement exactly once when reread succeeds", async () => {
  let engagementCalls = 0;
  const { sdk } = createSdk(async (url, init) => {
    if (url === `${baseUrl}/v1/comments`) {
      return new Response(JSON.stringify({
        data: {
          id: "comment-2",
        },
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts`) {
      return new Response(JSON.stringify({
        data: [{
          id: "comment-2",
          ulid: "comment-2",
          content: "hydrated comment",
        }],
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts/engagement`) {
      engagementCalls += 1;
      assert.deepEqual(JSON.parse(init.body), { ulids: ["parent-2"] });
      return new Response(JSON.stringify({
        data: {
          "parent-2": {
            postEngagement: {
              commentCount: 3,
            },
          },
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, new MockCache());

  const comment = await sdk.createComment({
    parentId: "parent-2",
    body: "comment body",
  });

  assert.equal(comment.content, "hydrated comment");
  assert.equal(engagementCalls, 1);
});

test("createComment forwards full request body (openGraph, embedUrl, etc.)", async () => {
  let capturedBody;
  const { sdk } = createSdk(async (url, init) => {
    if (url === `${baseUrl}/v1/comments`) {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        data: {
          id: "comment-og",
          parentId: "parent-og",
          content: "with link preview",
        },
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts`) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts/engagement`) {
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, new MockCache());

  const openGraph = { title: "Example", url: "https://example.com" };
  await sdk.createComment({
    parentId: "parent-og",
    body: "check this",
    images: ["img-1"],
    embedUrl: "https://example.com/page",
    openGraph,
    title: "optional title",
  });

  assert.deepEqual(capturedBody, {
    parentId: "parent-og",
    body: "check this",
    images: ["img-1"],
    embedUrl: "https://example.com/page",
    openGraph,
    title: "optional title",
  });
});

test("repost refreshes original engagement exactly once when reread succeeds", async () => {
  let engagementCalls = 0;
  const cache = new MockCache();
  const { sdk } = createSdk(async (url, init) => {
    if (url === `${baseUrl}/v1/posts/original-post/reposts`) {
      return new Response(JSON.stringify({
        data: {
          id: "repost-1",
        },
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts`) {
      return new Response(JSON.stringify({
        data: [{
          id: "repost-1",
          ulid: "repost-1",
          content: "hydrated repost",
        }],
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts/engagement`) {
      engagementCalls += 1;
      assert.deepEqual(JSON.parse(init.body), { ulids: ["original-post"] });
      return new Response(JSON.stringify({
        data: {
          "original-post": {
            postEngagement: {
              repostCount: 2,
            },
          },
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, cache);

  await cache.setPost("original-post", {
    id: "original-post",
    ulid: "original-post",
    postEngagement: {
      repostCount: 1,
    },
  });

  const repost = await sdk.repost("original-post");

  assert.equal(repost.content, "hydrated repost");
  assert.equal(engagementCalls, 1);
});

test("quotePost refreshes original engagement exactly once when reread succeeds", async () => {
  let engagementCalls = 0;
  const { sdk } = createSdk(async (url, init) => {
    if (url === `${baseUrl}/v1/posts/original-quote/quote`) {
      return new Response(JSON.stringify({
        data: {
          id: "quote-1",
        },
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts`) {
      return new Response(JSON.stringify({
        data: [{
          id: "quote-1",
          ulid: "quote-1",
          content: "hydrated quote",
        }],
      }), { status: 200 });
    }

    if (url === `${baseUrl}/v1/posts/engagement`) {
      engagementCalls += 1;
      assert.deepEqual(JSON.parse(init.body), { ulids: ["original-quote"] });
      return new Response(JSON.stringify({
        data: {
          "original-quote": {
            postEngagement: {
              repostCount: 5,
            },
          },
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, new MockCache());

  const quote = await sdk.quotePost("original-quote", "hello");

  assert.equal(quote.content, "hydrated quote");
  assert.equal(engagementCalls, 1);
});

// Helper: a MockCache that tracks users like the real CacheDB does
class MockCacheWithUsers extends MockCache {
  users = new Map();

  async setUser(id, user) {
    this.users.set(id, this.clone(user));
  }

  async getUser(id) {
    return this.users.get(id) ?? null;
  }

  async getUserByUsername(username) {
    const lower = username.toLowerCase();
    for (const [, user] of this.users) {
      if (user?.username?.toLowerCase() === lower) return this.clone(user);
    }
    return null;
  }

  async deleteUser(id) {
    this.users.delete(id);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// follow / unfollow — read-after-write on /v1/users/me
// ─────────────────────────────────────────────────────────────────────────

test("followUser calls GET /v1/users/me after following and caches the response", async () => {
  const calls = [];
  const mockCache = new MockCacheWithUsers();
  const { sdk } = createSdk(async (url, init) => {
    calls.push({ url, method: init.method || "GET" });

    if (url === `${baseUrl}/v1/profile/johndoe/follow`) {
      return new Response({ ok: true }, { status: 200 });
    }

    if (url === `${baseUrl}/v1/users/me`) {
      return new Response(JSON.stringify({
        data: {
          ulid: "meUid",
          followingCount: 42,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, mockCache);

  await sdk.followUser("johndoe");

  // verify the read-after-write call happened
  const meCalls = calls.filter((c) => c.url === `${baseUrl}/v1/users/me`);
  assert.equal(meCalls.length, 1, "should fetch /v1/users/me after follow");

  // verify the response is cached with incremented followingCount
  const cached = await mockCache.users.get("meUid");
  assert.ok(cached, "me profile should be cached");
  assert.equal(cached.followingCount, 42);
});

test("followUser refreshes the acting profile cache via /v1/profile/ulid/{managedUserUlid}", async () => {
  const calls = [];
  const mockCache = new MockCacheWithUsers();
  const managedUserUlid = "01hx9876543210fedcba";
  const actingProfileUrl = `${baseUrl}/v1/profile/ulid/${managedUserUlid}`;
  const { sdk } = createSdk(async (url, init) => {
    calls.push({ url, method: init.method || "GET" });

    if (url === `${baseUrl}/v1/profile/johndoe/follow`) {
      return new Response({ ok: true }, { status: 200 });
    }

    if (url === actingProfileUrl) {
      return new Response(JSON.stringify({
        data: {
          ulid: managedUserUlid,
          followingCount: 42,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, mockCache);

  sdk.setActingContext({
    token: "acting-token-123",
    managedUserUlid,
    managedUserName: "Managed User",
    managedUserUsername: "manageduser",
    managedUserAvatar: "avatars/managed.jpg",
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    grantedScopes: ["edit_profile", "view_content"],
  });

  await sdk.followUser("johndoe");

  const actingProfileCalls = calls.filter((c) => c.url === actingProfileUrl);
  const meCalls = calls.filter((c) => c.url === `${baseUrl}/v1/users/me`);
  assert.equal(actingProfileCalls.length, 1, "should fetch acting profile after follow");
  assert.equal(meCalls.length, 0, "should not fetch /v1/users/me when acting context is set");

  const cached = await mockCache.users.get(managedUserUlid);
  assert.ok(cached, "acting profile should be cached");
  assert.equal(cached.followingCount, 42);
});

test("unfollowUser calls GET /v1/users/me after unfollowing and caches the response", async () => {
  const calls = [];
  const mockCache = new MockCacheWithUsers();
  const { sdk } = createSdk(async (url, init) => {
    calls.push({ url, method: init.method || "GET" });

    if (url === `${baseUrl}/v1/profile/johndoe/follow`) {
      assert.equal(init.method, "DELETE");
      return new Response({ ok: true }, { status: 200 });
    }

    if (url === `${baseUrl}/v1/users/me`) {
      return new Response(JSON.stringify({
        data: {
          ulid: "meUid",
          followingCount: 41,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, mockCache);

  await sdk.unfollowUser("johndoe");

  const meCalls = calls.filter((c) => c.url === `${baseUrl}/v1/users/me`);
  assert.equal(meCalls.length, 1, "should fetch /v1/users/me after unfollow");

  const cached = await mockCache.users.get("meUid");
  assert.ok(cached, "me profile should be cached");
  assert.equal(cached.followingCount, 41);
});

test("follow then unfollow yields decremented followingCount", async () => {
  const calls = [];
  let meCallCount = 0;
  const mockCache = new MockCacheWithUsers();
  const { sdk } = createSdk(async (url, init) => {
    calls.push({ url, method: init.method || "GET" });

    if (url === `${baseUrl}/v1/profile/johndoe/follow`) {
      return new Response({ ok: true }, { status: 200 });
    }

    if (url === `${baseUrl}/v1/users/me`) {
      meCallCount += 1;
      // The first /v1/users/me call (after follow) returns incremented,
      // the second (after unfollow call — which returns decremented)
      return new Response(JSON.stringify({
        data: {
          ulid: "meUid",
          followingCount: meCallCount === 1 ? 42 : 41,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, mockCache);

  await sdk.followUser("johndoe");
  assert.equal((await mockCache.users.get("meUid")).followingCount, 42);

  await sdk.unfollowUser("johndoe");
  assert.equal((await mockCache.users.get("meUid")).followingCount, 41);
});

// ─────────────────────────────────────────────────────────────────────────
// block / unblock — read-after-write on /v1/users/me
// ─────────────────────────────────────────────────────────────────────────

test("blockUser calls GET /v1/users/me after blocking", async () => {
  const calls = [];
  const mockCache = new MockCacheWithUsers();
  const { sdk } = createSdk(async (url, init) => {
    calls.push({ url, method: init.method || "GET" });

    if (url === `${baseUrl}/v1/users/blockedUid/block`) {
      return new Response({ ok: true }, { status: 200 });
    }

    if (url === `${baseUrl}/v1/users/me`) {
      return new Response(JSON.stringify({
        data: {
          ulid: "meUid",
          blockedCount: 1,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, mockCache);

  await sdk.blockUser("blockedUid");

  const meCalls = calls.filter((c) => c.url === `${baseUrl}/v1/users/me`);
  assert.equal(meCalls.length, 1, "should fetch /v1/users/me after block");

  const cached = await mockCache.getUser("meUid");
  assert.ok(cached, "me profile should be cached");
  assert.equal(cached.blockedCount, 1);
});

test("block then unblock yields incremented then decremented blockedCount", async () => {
  const meCallCount = { n: 0 };
  const mockCache = new MockCacheWithUsers();
  const { sdk } = createSdk(async (url, init) => {
    if (url === `${baseUrl}/v1/users/blockedUid/block`) {
      if (init.method === "POST") {
        return new Response({ ok: true }, { status: 200 });
      }
      if (init.method === "DELETE") {
        return new Response({ ok: true }, { status: 200 });
      }
    }

    if (url === `${baseUrl}/v1/users/me`) {
      meCallCount.n += 1;
      return new Response(JSON.stringify({
        data: {
          ulid: "meUid",
          blockedCount: meCallCount.n === 1 ? 1 : 0,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, mockCache);

  await sdk.blockUser("blockedUid");
  assert.equal((await mockCache.getUser("meUid")).blockedCount, 1, "blockedCount should increment after block");

  await sdk.unblockUser("blockedUid");
  const cached = await mockCache.getUser("meUid");
  assert.equal(cached.blockedCount, 0, "blockedCount should decrement after unblock");
});

// ─────────────────────────────────────────────────────────────────────────
// mute / unmute — read-after-write on /v1/users/me
// ─────────────────────────────────────────────────────────────────────────

test("muteUser calls GET /v1/users/me and muting increments mutedCount", async () => {
  const calls = [];
  const mockCache = new MockCacheWithUsers();
  const { sdk } = createSdk(async (url, init) => {
    calls.push({ url, method: init.method || "GET" });

    if (url === `${baseUrl}/v1/users/spammerUid/mute`) {
      return new Response({ ok: true }, { status: 200 });
    }

    if (url === `${baseUrl}/v1/users/me`) {
      return new Response(JSON.stringify({
        data: {
          ulid: "meUid",
          mutedCount: 1,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, mockCache);

  await sdk.muteUser("spammerUid");

  const meCalls = calls.filter((c) => c.url === `${baseUrl}/v1/users/me`);
  assert.equal(meCalls.length, 1, "should fetch /v1/users/me after mute");

  const cached = await mockCache.getUser("meUid");
  assert.ok(cached, "me profile should be cached");
  assert.equal(cached.mutedCount, 1, "mutedCount should increment after mute");
});

test("unmuteUser calls GET /v1/users/me and unmuting decrements mutedCount", async () => {
  const meCallCount = { n: 0 };
  const mockCache = new MockCacheWithUsers();
  const { sdk } = createSdk(async (url, init) => {
    if (url === `${baseUrl}/v1/users/spammerUid/mute`) {
      if (init.method === "POST") {
        return new Response({ ok: true }, { status: 200 });
      }
      if (init.method === "DELETE") {
        return new Response({ ok: true }, { status: 200 });
      }
    }

    if (url === `${baseUrl}/v1/users/me`) {
      meCallCount.n += 1;
      return new Response(JSON.stringify({
        data: {
          ulid: "meUid",
          mutedCount: meCallCount.n === 1 ? 1 : 0,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, mockCache);

  await sdk.muteUser("spammerUid");
  assert.equal((await mockCache.getUser("meUid")).mutedCount, 1, "mutedCount should increment after mute");

  await sdk.unmuteUser("spammerUid");
  const cached = await mockCache.getUser("meUid");
  assert.equal(cached.mutedCount, 0, "mutedCount should decrement after unmute");
});

// ─────────────────────────────────────────────────────────────────────────
// followersCount — we verify that /v1/users/me is called after follow and that all
// profile fields (followersCount, followingCount, displayName) are cached
// ─────────────────────────────────────────────────────────────────────────

test("followUser caches full profile with both followersCount and followingCount", async () => {
  const calls = [];
  const mockCache = new MockCacheWithUsers();
  const { sdk } = createSdk(async (url, init) => {
    calls.push({ url, method: init.method || "GET" });

    if (url === `${baseUrl}/v1/profile/johndoe/follow`) {
      return new Response({ ok: true }, { status: 200 });
    }

    if (url === `${baseUrl}/v1/users/me`) {
      return new Response(JSON.stringify({
        data: {
          ulid: "meUid",
          displayName: "Me",
          followersCount: 7,
          followingCount: 42,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, mockCache);

  await sdk.followUser("johndoe");

  const cached = await mockCache.getUser("meUid");
  assert.ok(cached, "me profile should be cached");
  assert.equal(cached.followersCount, 7, "followersCount should be present");
  assert.equal(cached.followingCount, 42, "followingCount should be present");
  assert.equal(cached.displayName, "Me", "displayName should be cached");
});
