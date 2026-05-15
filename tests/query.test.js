import test from "node:test";
import assert from "node:assert/strict";
import {
  queryKeys,
  createPostQueryOptions,
  createMusicFeedInfiniteQueryOptions,
  createFeedInfiniteQueryOptions,
  createStoryFeedQueryOptions,
  createMyStoriesQueryOptions,
  createUserStoriesQueryOptions,
  createStoryQueryOptions,
  prefetchPost,
  prefetchMusicFeedFirstPage,
  hydrateFeedFromCache,
  prefetchStoryFeed,
  prefetchUserStories,
} from "../dist/query.js";

/* ── queryKeys ───────────────────────────────────────────────────────── */

test("queryKeys.posts.all", () => {
  assert.deepEqual(queryKeys.posts.all, ["posts"]);
});

test("queryKeys.posts.detail", () => {
  assert.deepEqual(queryKeys.posts.detail("u1"), ["posts", "detail", "u1"]);
});

test("queryKeys.feed.all", () => {
  assert.deepEqual(queryKeys.feed.all, ["feed"]);
});

test("queryKeys.feed.music", () => {
  assert.deepEqual(queryKeys.feed.music(), ["feed", "music"]);
});

test("queryKeys.stories.all", () => {
  assert.deepEqual(queryKeys.stories.all, ["stories"]);
});

test("queryKeys.stories.feed", () => {
  assert.deepEqual(queryKeys.stories.feed(), ["stories", "feed"]);
});

test("queryKeys.stories.mine", () => {
  assert.deepEqual(queryKeys.stories.mine(), ["stories", "mine"]);
});

test("queryKeys.stories.user", () => {
  assert.deepEqual(queryKeys.stories.user("u1"), ["stories", "user", "u1"]);
});

test("queryKeys.stories.detail", () => {
  assert.deepEqual(queryKeys.stories.detail("s1"), ["stories", "detail", "s1"]);
});

test("queryKeys.stories.viewers", () => {
  assert.deepEqual(queryKeys.stories.viewers("s1"), ["stories", "viewers", "s1"]);
});

/* ── createPostQueryOptions ──────────────────────────────────────────── */

test("createPostQueryOptions returns queryKey/queryFn/staleTime", () => {
  const sdk = {
    baseUrl: "https://api.com",
    client: {
      get: async () => ({ data: {} }),
      post: async () => null,
      patch: async () => null,
      delete: async () => null,
    },
    getPostByUlid: async () => ({ id: "ulid1", type: "SONG" }),
  };
  const o = createPostQueryOptions(sdk, "ulid1");
  assert.equal(typeof o.queryKey, "object");
  assert.deepEqual(o.queryKey, ["posts", "detail", "ulid1"]);
  assert.equal(typeof o.queryFn, "function");
  assert.equal(typeof o.staleTime, "number");
  assert.equal(o.staleTime, 30_000);
  assert.equal(typeof o.gcTime, "number");
});

test("createPostQueryOptions with opts spreads over", () => {
  const sdk = {
    baseUrl: "https://api.com",
    client: {
      get: async () => ({ data: {} }),
      post: async () => null,
      patch: async () => null,
      delete: async () => null,
    },
    getPostByUlid: async () => ({ id: "ulid1" }),
  };
  const o = createPostQueryOptions(sdk, "ulid1", { enabled: false, staleTime: 60_000 });
  assert.deepEqual(o.queryKey, ["posts", "detail", "ulid1"]);
  assert.equal(o.enabled, false);
  assert.equal(o.staleTime, 60_000); // opts staleTime overrides default
});

/* ── createMusicFeedInfiniteQueryOptions ───────────────────────────────── */

test("createMusicFeedInfiniteQueryOptions returns infinite options", () => {
  const sdk = {
    baseUrl: "https://api.com",
    client: {
      post: async () => ({ data: { ulids: [], posts: [] }, meta: {} }),
      get: async () => ({ data: null }),
      patch: async () => null,
      delete: async () => null,
    },
    fetchFeedPage: async () => ({ ulids: [], posts: [], nextCursor: null }),
  };
  const o = createMusicFeedInfiniteQueryOptions(sdk);
  assert.deepEqual(o.queryKey, ["feed", "music"]);
  assert.equal(typeof o.queryFn, "function");
  assert.equal(typeof o.initialPageParam, "undefined");
  assert.equal(typeof o.getNextPageParam, "function");
  assert.deepEqual(o.queryKey, ["feed", "music"]);
});

test("createMusicFeedInfiniteQueryOptions with opts spreads over", () => {
  const sdk = {
    baseUrl: "https://api.com",
    fetchFeedPage: async () => ({ ulids: [], posts: [], nextCursor: null }),
  };
  const o = createMusicFeedInfiniteQueryOptions(sdk, { staleTime: 10_000 });
  assert.equal(o.staleTime, 10_000);
});

/* ── createFeedInfiniteQueryOptions ────────────────────────────────────── */

test("createFeedInfiniteQueryOptions uses custom endpoint and cacheKey", () => {
  const sdk = {
    baseUrl: "https://api.com",
    fetchFeedPage: async () => ({ ulids: ["a"], posts: [], nextCursor: "c" }),
  };
  const o = createFeedInfiniteQueryOptions(sdk, {
    endpoint: "/v1/songs/feed/trending",
    cacheKey: ["feed", "trending"],
  });
  assert.deepEqual(o.queryKey, ["feed", "trending"]);
  assert.equal(typeof o.queryFn, "function");
  assert.equal(typeof o.getNextPageParam, "function");

  // Test getNextPageParam
  const cursor = o.getNextPageParam({ ulids: [], nextCursor: "next" });
  assert.equal(cursor, "next");
});

/* ── createStoryFeedQueryOptions ─────────────────────────────────────── */

test("createStoryFeedQueryOptions returns options", () => {
  const sdk = {
    baseUrl: "https://api.com",
    getStoryFeed: async () => ({ data: [] }),
  };
  const o = createStoryFeedQueryOptions(sdk);
  assert.deepEqual(o.queryKey, ["stories", "feed"]);
  assert.equal(typeof o.queryFn, "function");
  assert.equal(o.staleTime, 30_000);
  assert.equal(o.gcTime, 5 * 60 * 1000);
});

test("createStoryFeedQueryOptions spreads opts", () => {
  const sdk = {
    baseUrl: "https://api.com",
    getStoryFeed: async () => ({ data: [] }),
  };
  const o = createStoryFeedQueryOptions(sdk, { enabled: false });
  assert.equal(o.enabled, false);
});

/* ── createMyStoriesQueryOptions ─────────────────────────────────────── */

test("createMyStoriesQueryOptions returns options", () => {
  const sdk = {
    baseUrl: "https://api.com",
    getMyStories: async () => ({ data: [] }),
  };
  const o = createMyStoriesQueryOptions(sdk);
  assert.deepEqual(o.queryKey, ["stories", "mine"]);
  assert.equal(typeof o.queryFn, "function");
});

/* ── createUserStoriesQueryOptions ───────────────────────────────────── */

test("createUserStoriesQueryOptions includes username in key and query", () => {
  const sdk = {
    baseUrl: "https://api.com",
    getUserStories: async () => ({ data: [] }),
  };
  const o = createUserStoriesQueryOptions(sdk, "alice");
  assert.deepEqual(o.queryKey, ["stories", "user", "alice"]);
  assert.equal(typeof o.queryFn, "function");
});

/* ── createStoryQueryOptions ─────────────────────────────────────────── */

test("createStoryQueryOptions returns options", () => {
  const sdk = {
    baseUrl: "https://api.com",
    getStory: async () => ({ id: "s1" }),
  };
  const o = createStoryQueryOptions(sdk, "s1");
  assert.deepEqual(o.queryKey, ["stories", "detail", "s1"]);
  assert.equal(typeof o.queryFn, "function");
});

/* ── prefetchPost ────────────────────────────────────────────────────── */

test("prefetchPost calls queryClient.prefetchQuery", async () => {
  let called = false;
  let capturedUlid = null;
  const sdk = {
    baseUrl: "https://api.com",
    client: {
      get: async () => ({ data: { id: "u1", type: "SONG" } }),
      post: async () => null,
      patch: async () => null,
      delete: async () => null,
    },
    getPostByUlid: async (ulid, forceRefresh) => {
      capturedUlid = ulid;
      return { id: "u1", type: "SONG" };
    },
  };
  const qc = {
    prefetchQuery: async (options) => {
      called = true;
      const result = await options.queryFn();
      assert.equal(result.id, "u1");
      assert.equal(result.type, "SONG");
    },
  };
  await prefetchPost(sdk, qc, "u1");
  assert.equal(called, true);
  assert.equal(capturedUlid, "u1");
});

/* ── prefetchMusicFeedFirstPage ───────────────────────────────────────── */

test("prefetchMusicFeedFirstPage calls queryClient.prefetchInfiniteQuery", async () => {
  let called = false;
  const sdk = {
    baseUrl: "https://api.com",
    fetchFeedPage: async () => ({ ulids: ["a", "b"], posts: [], nextCursor: "c" }),
  };
  const qc = {
    prefetchInfiniteQuery: async (options) => {
      called = true;
      assert.deepEqual(options.queryKey, ["feed", "music"]);
    },
  };
  await prefetchMusicFeedFirstPage(sdk, qc);
  assert.equal(called, true);
});

/* ── hydrateFeedFromCache ────────────────────────────────────────────── */

test("hydrateFeedFromCache sets query data with cached feed page", () => {
  let setDataArgs = null;
  const qc = {
    setQueryData: (key, data) => {
      setDataArgs = { key, data };
    },
  };
  const cached = { ulids: ["s1"], posts: [], nextCursor: null };
  hydrateFeedFromCache(qc, ["stories", "feed"], cached);
  assert.deepEqual(setDataArgs.key, ["stories", "feed"]);
  assert.deepEqual(setDataArgs.data.pageParams, [undefined]);
  assert.deepEqual(setDataArgs.data.pages, [cached]);
});

/* ── prefetchStoryFeed ──────────────────────────────────────────────── */

test("prefetchStoryFeed calls queryClient.prefetchQuery", async () => {
  let called = false;
  const sdk = {
    baseUrl: "https://api.com",
    getStoryFeed: async () => ({ data: [] }),
  };
  const qc = {
    prefetchQuery: async (options) => {
      called = true;
      assert.deepEqual(options.queryKey, ["stories", "feed"]);
    },
  };
  await prefetchStoryFeed(sdk, qc);
  assert.equal(called, true);
});

/* ── prefetchUserStories ────────────────────────────────────────────── */

test("prefetchUserStories calls queryClient.prefetchQuery with username", async () => {
  let called = false;
  let receivedQueryKey = null;
  const sdk = {
    baseUrl: "https://api.com",
    getUserStories: async () => ({ data: [] }),
  };
  const qc = {
    prefetchQuery: async (options) => {
      called = true;
      receivedQueryKey = options.queryKey;
    },
  };
  await prefetchUserStories(sdk, qc, "bob");
  assert.equal(called, true);
  assert.deepEqual(receivedQueryKey, ["stories", "user", "bob"]);
});
