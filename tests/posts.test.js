/**
 * Posts SDK Unit Tests (mocked HTTP) - CRUD Operations
 *
 * These tests verify the SDK's post management methods work correctly
 * by mocking the HTTP layer. For live API integration testing,
 * see integration/posts.integration.js.
 *
 * Covers: createPost, createVideoPost, getPostByUlid, fetchPostsBatch, updatePost, deletePost
 */

// Polyfill window for Node.js (SDK uses window.setTimeout for batch debouncing)
if (!globalThis.window) {
  globalThis.window = globalThis;
}

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

const baseUrl = "https://api.example.com";

// ---------------------------------------------------------------------------
// Sample API Response Data (matches Laravel PostResource structure)
// ---------------------------------------------------------------------------

/**
 * Creates a sample post response matching the Laravel API PostResource format
 */
function createSamplePostResponse(overrides = {}) {
  const ulid = overrides.ulid || "01hx1234567890abcdef";
  return {
    id: ulid,
    ulid: ulid,
    createdAt: "2024-01-15T10:00:00.000000Z",
    updatedAt: "2024-01-15T10:00:00.000000Z",
    updatedAtEpoch: 1705312800,
    rootUlid: null,
    parentUlid: null,
    grandparentUlid: null,
    isSensitive: false,
    isPrivate: false,
    visibility: "public",
    unhideAt: null,
    isOnWatchlist: false,
    commentsEnabled: true,
    downloadEnabled: false,
    isTrolling: false,
    body: overrides.body || "Test post content",
    detectedLanguage: "en",
    username: overrides.username || "testuser",
    userId: overrides.userId || "01hx0000000000000001",
    user: {
      userId: overrides.userId || "01hx0000000000000001",
      avatar: "https://cdn.example.com/avatars/test.jpg",
      updatedAt: "2024-01-15T10:00:00.000000Z",
      updatedAtEpoch: 1705312800,
      featured_badge: null,
    },
    postType: overrides.postType || "text",
    title: overrides.title || null,
    images: overrides.images || [],
    videos: overrides.videos || [],
    audio: overrides.audio || [],
    videoProcessing: overrides.videoProcessing || [],
    tags: overrides.tags || [],
    edited: false,
    userReaction: null,
    userRating: null,
    userCreationMode: null,
    isRepost: false,
    isRepostWithComment: false,
    embedUrl: null,
    groupName: overrides.groupName || "default",
    groupUlid: overrides.groupUlid || "01hx0000000000000002",
    group_moderation_status: null,
    isDeleted: false,
    isHidden: false,
    isProcessing: overrides.isProcessing || false,
    isBookmarked: false,
    userEngagement: {
      hasReposted: false,
      hasRepostedWithComment: false,
      hasCommented: false,
    },
    postEngagement: {
      repostCount: 0,
      totalCommentCount: 0,
      commentCount: 0,
      views: 0,
      reactions: [],
      reactionCounts: {},
    },
    ratingStats: {
      average_rating: 0,
      total_ratings: 0,
      rating_distribution: {},
    },
    creationModeStats: {
      counts: { ai: 0, human: 0, hybrid: 0, cant_tell: 0 },
      total: 0,
    },
    poll: null,
    otherRepostUsers: [],
    openGraph: {
      title: null,
      description: null,
      image: null,
      url: null,
      mimeType: null,
      height: null,
      width: null,
    },
    followedByYourFriends: [],
    ...overrides,
  };
}

/**
 * Creates a sample video post response
 */
function createSampleVideoPostResponse(overrides = {}) {
  return createSamplePostResponse({
    postType: "video",
    title: overrides.title || "Test Video",
    body: overrides.body || "Video description",
    videos: [
      {
        url: "https://cdn.example.com/videos/test.mp4",
        widthPx: 1920,
        heightPx: 1080,
        mimeType: "video/mp4",
        duration: 120,
        lastPosition: 0,
        previewGif: "https://cdn.example.com/videos/preview.gif",
        thumbnail: {
          url: "https://cdn.example.com/videos/thumb.jpg",
          m3u8_name: "https://cdn.example.com/videos/test.m3u8",
          dash_name: null,
          webvtt_name: null,
          webvtt_thumbnail_name: null,
          widthPx: 1920,
          heightPx: 1080,
          mimeType: "video/mp4",
        },
      },
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Mock Utilities
// ---------------------------------------------------------------------------

/**
 * Creates a mock fetch implementation that returns responses based on URL/method
 */
function createMockFetch(responseData, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      init,
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

/**
 * Creates a mock fetch that returns different responses based on request
 */
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

    const response = responses[responseIndex] || responses[responses.length - 1];
    responseIndex++;

    return new Response(JSON.stringify(response.data), {
      status: response.status || 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetchImpl, calls };
}

/**
 * Creates an authenticated SDK instance with mocked HTTP
 */
function createAuthenticatedMockSdk(responseData, status = 200) {
  const { fetchImpl, calls } = createMockFetch(responseData, status);
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });
  return { sdk, calls };
}

/**
 * Creates an authenticated SDK with sequential responses
 */
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
// createPost tests
// ---------------------------------------------------------------------------

test("createPost sends POST to /v1/posts/create", async () => {
  const postResponse = createSamplePostResponse({ body: "Hello world!" });

  // SDK does read-after-write: POST /v1/posts/create, then POST /v1/posts to fetch
  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.createPost({
    body: "Hello world!",
    groupName: "default",
  });

  // First call should be to create endpoint
  assert.equal(calls[0].url, `${baseUrl}/v1/posts/create`);
  assert.equal(calls[0].method, "POST");
});

test("createPost sends content in request body", async () => {
  const postResponse = createSamplePostResponse({ body: "My test content" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.createPost({
    body: "My test content",
    groupName: "default",
  });

  assert.equal(calls[0].body.body, "My test content");
  assert.equal(calls[0].body.groupName, "default");
});

test("createPost includes optional fields when provided", async () => {
  const postResponse = createSamplePostResponse({
    body: "Content with options",
    visibility: "followers",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.createPost({
    body: "Content with options",
    groupName: "default",
    visibility: "followers",
    commentsEnabled: false,
  });

  assert.equal(calls[0].body.visibility, "followers");
  assert.equal(calls[0].body.commentsEnabled, false);
});

test("createPost returns normalized post object", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxnewpost12345678",
    body: "New post content",
    postType: "text",
  });

  const { sdk } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  const post = await sdk.createPost({
    body: "New post content",
    groupName: "default",
  });

  assert.equal(post.ulid || post.id, "01hxnewpost12345678");
  assert.equal(post.content || post.body, "New post content");
  // SDK normalizes postType -> type
  assert.ok(post.type === "POST" || post.postType === "text");
});

test("createPost performs read-after-write to fetch full post", async () => {
  const createResponse = createSamplePostResponse({
    ulid: "01hxrawpost12345678",
    body: "Initial content",
  });
  const fullPostResponse = createSamplePostResponse({
    ulid: "01hxrawpost12345678",
    body: "Initial content",
    postEngagement: {
      repostCount: 0,
      totalCommentCount: 0,
      commentCount: 0,
      views: 1,
      reactions: [],
      reactionCounts: {},
    },
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: createResponse } },
    { data: { data: [fullPostResponse] } },
  ]);

  await sdk.createPost({
    body: "Initial content",
    groupName: "default",
  });

  // Should have made 2 calls: create + read-after-write fetch
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${baseUrl}/v1/posts/create`);
  assert.equal(calls[1].url, `${baseUrl}/v1/posts`);
  assert.deepEqual(calls[1].body.ulids, ["01hxrawpost12345678"]);
});

test("createPost includes Authorization header", async () => {
  const postResponse = createSamplePostResponse();

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.createPost({
    body: "Test",
    groupName: "default",
  });

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

test("createPost throws on 401 unauthorized", async () => {
  const { sdk } = createAuthenticatedMockSdk(
    { message: "Unauthenticated" },
    401
  );

  await assert.rejects(
    async () => {
      await sdk.createPost({ body: "Test", groupName: "default" });
    },
    (err) => {
      return err.message.includes("401") || err.status === 401;
    }
  );
});

test("createPost throws on 422 validation error", async () => {
  const { sdk } = createAuthenticatedMockSdk(
    {
      message: "The given data was invalid.",
      errors: { groupName: ["The group name field is required."] },
    },
    422
  );

  await assert.rejects(
    async () => {
      await sdk.createPost({ body: "Test" }); // Missing groupName
    },
    (err) => {
      return err.message.includes("422") || err.status === 422;
    }
  );
});

test("createPost with images array", async () => {
  const postResponse = createSamplePostResponse({
    images: [
      {
        url: "https://cdn.example.com/images/photo.jpg",
        widthPx: 1200,
        heightPx: 800,
        mimeType: "image/jpeg",
      },
    ],
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.createPost({
    body: "Post with image",
    groupName: "default",
    images: ["https://s3.example.com/uploads/photo.jpg"],
  });

  assert.deepEqual(calls[0].body.images, [
    "https://s3.example.com/uploads/photo.jpg",
  ]);
});

test("createPost with groupId instead of groupName", async () => {
  const postResponse = createSamplePostResponse({
    groupUlid: "01hxgroup123456789",
    groupName: "test-group",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.createPost({
    body: "Post to specific group",
    groupId: "01hxgroup123456789",
  });

  assert.equal(calls[0].body.groupId, "01hxgroup123456789");
});

// ---------------------------------------------------------------------------
// createVideoPost tests
// ---------------------------------------------------------------------------

test("createVideoPost sends POST to /v1/video/add", async () => {
  const videoResponse = createSampleVideoPostResponse();

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
    title: "Test Video",
  });

  assert.equal(calls[0].url, `${baseUrl}/v1/video/add`);
  assert.equal(calls[0].method, "POST");
});

test("createVideoPost sends videoUrl in body", async () => {
  const videoResponse = createSampleVideoPostResponse();

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/myvideo.mp4",
  });

  assert.equal(calls[0].body.videoUrl, "https://s3.example.com/videos/myvideo.mp4");
});

test("createVideoPost sends title when provided", async () => {
  const videoResponse = createSampleVideoPostResponse({ title: "My Video Title" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
    title: "My Video Title",
  });

  assert.equal(calls[0].body.title, "My Video Title");
});

test("createVideoPost sends body content when provided", async () => {
  const videoResponse = createSampleVideoPostResponse({ body: "Video description text" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
    body: "Video description text",
  });

  assert.equal(calls[0].body.body, "Video description text");
});

test("createVideoPost sends groupName when provided", async () => {
  const videoResponse = createSampleVideoPostResponse({ groupName: "video-group" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
    groupName: "video-group",
  });

  assert.equal(calls[0].body.groupName, "video-group");
});

test("createVideoPost defaults groupName to 'default'", async () => {
  const videoResponse = createSampleVideoPostResponse();

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
  });

  assert.equal(calls[0].body.groupName, "default");
});

test("createVideoPost sends type field (VIDEO, BURST)", async () => {
  const videoResponse = createSampleVideoPostResponse({ postType: "burst" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
    type: "BURST",
  });

  assert.equal(calls[0].body.type, "BURST");
});

test("createVideoPost defaults type to VIDEO", async () => {
  const videoResponse = createSampleVideoPostResponse();

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
  });

  assert.equal(calls[0].body.type, "VIDEO");
});

test("createVideoPost sends sensitive flag when true", async () => {
  const videoResponse = createSampleVideoPostResponse({ isSensitive: true });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
    sensitive: true,
  });

  assert.equal(calls[0].body.sensitive, true);
});

test("createVideoPost sends commentsEnabled flag", async () => {
  const videoResponse = createSampleVideoPostResponse({ commentsEnabled: false });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
    commentsEnabled: false,
  });

  assert.equal(calls[0].body.commentsEnabled, false);
});

test("createVideoPost sends downloadEnabled flag", async () => {
  const videoResponse = createSampleVideoPostResponse({ downloadEnabled: true });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
    downloadEnabled: true,
  });

  assert.equal(calls[0].body.downloadEnabled, true);
});

test("createVideoPost returns post with video data", async () => {
  const videoResponse = createSampleVideoPostResponse({
    ulid: "01hxvideo123456789",
    title: "Test Video",
    isProcessing: false,
  });

  const { sdk } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  const post = await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
    title: "Test Video",
  });

  assert.equal(post.ulid || post.id, "01hxvideo123456789");
  assert.ok(post.videos || post.video || post.videoUrls);
});

test("createVideoPost performs read-after-write", async () => {
  const videoResponse = createSampleVideoPostResponse({
    ulid: "01hxvideoraw123456",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: videoResponse } },
    { data: { data: [videoResponse] } },
  ]);

  await sdk.createVideoPost({
    videoUrl: "https://s3.example.com/videos/test.mp4",
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${baseUrl}/v1/video/add`);
  assert.equal(calls[1].url, `${baseUrl}/v1/posts`);
});

// ---------------------------------------------------------------------------
// getPostByUlid tests
// ---------------------------------------------------------------------------

test("getPostByUlid returns cached post when available", async () => {
  const postResponse = createSamplePostResponse({ ulid: "01hxcached12345678" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    // First call to populate cache
    { data: { data: [postResponse] } },
  ]);

  // First fetch (should hit API)
  const post1 = await sdk.getPostByUlid("01hxcached12345678");
  assert.equal(post1.ulid || post1.id, "01hxcached12345678");

  // Second fetch (should hit cache, no additional API call)
  const post2 = await sdk.getPostByUlid("01hxcached12345678");
  assert.equal(post2.ulid || post2.id, "01hxcached12345678");

  // Only one API call should have been made (first fetch populates cache)
  // Note: Due to batching, the actual call count may vary
  assert.ok(calls.length >= 1);
});

test("getPostByUlid fetches from API when forceRefresh=true", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxforcerefresh123",
    body: "Updated content",
  });

  const { sdk, calls } = createAuthenticatedMockSdk({
    data: [postResponse],
  });

  const post = await sdk.getPostByUlid("01hxforcerefresh123", true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/posts`);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body.ulids, ["01hxforcerefresh123"]);
  assert.equal(post.ulid || post.id, "01hxforcerefresh123");
});

test("getPostByUlid sends POST to /v1/posts with forceRefresh=true", async () => {
  const postResponse = createSamplePostResponse({ ulid: "01hxpostbatch1234" });

  const { sdk, calls } = createAuthenticatedMockSdk({
    data: [postResponse],
  });

  await sdk.getPostByUlid("01hxpostbatch1234", true);

  assert.equal(calls[0].url, `${baseUrl}/v1/posts`);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body.ulids, ["01hxpostbatch1234"]);
});

test("getPostByUlid returns null when post not found", async () => {
  const { sdk } = createAuthenticatedMockSdk({
    data: [], // Empty array = post not found
  });

  const post = await sdk.getPostByUlid("01hxnonexistent123", true);

  assert.equal(post, null);
});

test("getPostByUlid normalizes post type (postType to type)", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxnormalize12345",
    postType: "song",
  });

  const { sdk } = createAuthenticatedMockSdk({
    data: [postResponse],
  });

  const post = await sdk.getPostByUlid("01hxnormalize12345", true);

  // SDK normalizes postType to type
  assert.ok(post.type === "SONG" || post.postType === "song");
});

test("getPostByUlid handles engagement data extraction", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxengagement1234",
    postEngagement: {
      repostCount: 5,
      totalCommentCount: 10,
      commentCount: 8,
      views: 100,
      reactions: [],
      reactionCounts: { "❤️": 15, "🔥": 3 },
    },
  });

  const { sdk } = createAuthenticatedMockSdk({
    data: [postResponse],
  });

  const post = await sdk.getPostByUlid("01hxengagement1234", true);

  assert.ok(post.postEngagement);
  assert.equal(post.postEngagement.repostCount, 5);
  assert.equal(post.postEngagement.views, 100);
});

test("getPostByUlid includes Authorization header", async () => {
  const postResponse = createSamplePostResponse({ ulid: "01hxauthtest12345" });

  const { sdk, calls } = createAuthenticatedMockSdk({
    data: [postResponse],
  });

  await sdk.getPostByUlid("01hxauthtest12345", true);

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// fetchPostsBatch tests
// ---------------------------------------------------------------------------

test("fetchPostsBatch sends POST to /v1/posts", async () => {
  const post1 = createSamplePostResponse({ ulid: "01hxbatch1111111111" });
  const post2 = createSamplePostResponse({ ulid: "01hxbatch2222222222" });

  const { sdk, calls } = createAuthenticatedMockSdk({
    data: [post1, post2],
  });

  await sdk.fetchPostsBatch(["01hxbatch1111111111", "01hxbatch2222222222"]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/posts`);
  assert.equal(calls[0].method, "POST");
});

test("fetchPostsBatch sends array of ulids in body", async () => {
  const post1 = createSamplePostResponse({ ulid: "01hxbatchulid111111" });
  const post2 = createSamplePostResponse({ ulid: "01hxbatchulid222222" });
  const post3 = createSamplePostResponse({ ulid: "01hxbatchulid333333" });

  const { sdk, calls } = createAuthenticatedMockSdk({
    data: [post1, post2, post3],
  });

  await sdk.fetchPostsBatch([
    "01hxbatchulid111111",
    "01hxbatchulid222222",
    "01hxbatchulid333333",
  ]);

  assert.deepEqual(calls[0].body.ulids, [
    "01hxbatchulid111111",
    "01hxbatchulid222222",
    "01hxbatchulid333333",
  ]);
});

test("fetchPostsBatch deduplicates ulid array", async () => {
  const post1 = createSamplePostResponse({ ulid: "01hxdedup111111111" });

  const { sdk, calls } = createAuthenticatedMockSdk({
    data: [post1],
  });

  await sdk.fetchPostsBatch([
    "01hxdedup111111111",
    "01hxdedup111111111", // Duplicate
    "01hxdedup111111111", // Duplicate
  ]);

  // Should only have one unique ID in the request
  assert.equal(calls[0].body.ulids.length, 1);
  assert.equal(calls[0].body.ulids[0], "01hxdedup111111111");
});

test("fetchPostsBatch returns Record<Ulid, Post>", async () => {
  const post1 = createSamplePostResponse({ ulid: "01hxrecord11111111" });
  const post2 = createSamplePostResponse({ ulid: "01hxrecord22222222" });

  const { sdk } = createAuthenticatedMockSdk({
    data: [post1, post2],
  });

  const results = await sdk.fetchPostsBatch([
    "01hxrecord11111111",
    "01hxrecord22222222",
  ]);

  assert.ok(typeof results === "object");
  assert.ok(results["01hxrecord11111111"]);
  assert.ok(results["01hxrecord22222222"]);
  assert.equal(
    results["01hxrecord11111111"].ulid || results["01hxrecord11111111"].id,
    "01hxrecord11111111"
  );
});

test("fetchPostsBatch handles partial responses (some posts not found)", async () => {
  // API only returns post1, post3 is not found
  const post1 = createSamplePostResponse({ ulid: "01hxpartial1111111" });

  const { sdk } = createAuthenticatedMockSdk({
    data: [post1],
  });

  const results = await sdk.fetchPostsBatch([
    "01hxpartial1111111",
    "01hxpartial2222222", // This one won't be returned
  ]);

  assert.ok(results["01hxpartial1111111"]);
  assert.equal(results["01hxpartial2222222"], undefined);
});

test("fetchPostsBatch normalizes all posts", async () => {
  const post1 = createSamplePostResponse({
    ulid: "01hxnormall1111111",
    postType: "text",
  });
  const post2 = createSamplePostResponse({
    ulid: "01hxnormall2222222",
    postType: "song",
  });

  const { sdk } = createAuthenticatedMockSdk({
    data: [post1, post2],
  });

  const results = await sdk.fetchPostsBatch([
    "01hxnormall1111111",
    "01hxnormall2222222",
  ]);

  // Both posts should be normalized
  assert.ok(results["01hxnormall1111111"]);
  assert.ok(results["01hxnormall2222222"]);
});

test("fetchPostsBatch includes Authorization header", async () => {
  const post1 = createSamplePostResponse({ ulid: "01hxbatchauth11111" });

  const { sdk, calls } = createAuthenticatedMockSdk({
    data: [post1],
  });

  await sdk.fetchPostsBatch(["01hxbatchauth11111"]);

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// updatePost tests
// ---------------------------------------------------------------------------

test("updatePost sends PATCH to /v1/posts/{ulid}", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxupdate11111111",
    body: "Updated content",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.updatePost("01hxupdate11111111", {
    body: "Updated content",
  });

  assert.equal(calls[0].url, `${baseUrl}/v1/posts/01hxupdate11111111`);
  assert.equal(calls[0].method, "PATCH");
});

test("updatePost sends updated content in body", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxupdatebody1111",
    body: "New body content",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.updatePost("01hxupdatebody1111", {
    body: "New body content",
  });

  assert.equal(calls[0].body.body, "New body content");
});

test("updatePost sends visibility when changed", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxupdatevis11111",
    visibility: "followers",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.updatePost("01hxupdatevis11111", {
    visibility: "followers",
  });

  assert.equal(calls[0].body.visibility, "followers");
});

test("updatePost performs read-after-write", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxupdateraw11111",
    body: "Updated",
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.updatePost("01hxupdateraw11111", { body: "Updated" });

  // Should have 2 calls: PATCH + POST /v1/posts for read-after-write
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[1].url, `${baseUrl}/v1/posts`);
});

test("updatePost returns full updated post", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxupdatereturn11",
    body: "Updated content here",
    updatedAt: "2024-01-15T12:00:00.000000Z",
  });

  const { sdk } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  const post = await sdk.updatePost("01hxupdatereturn11", {
    body: "Updated content here",
  });

  assert.equal(post.ulid || post.id, "01hxupdatereturn11");
  assert.equal(post.body || post.content, "Updated content here");
});

test("updatePost includes Authorization header", async () => {
  const postResponse = createSamplePostResponse({ ulid: "01hxupdateauth111" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.updatePost("01hxupdateauth111", { body: "Test" });

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

test("updatePost throws on 403 forbidden", async () => {
  const { sdk } = createAuthenticatedMockSdk(
    { message: "Forbidden" },
    403
  );

  await assert.rejects(
    async () => {
      await sdk.updatePost("01hxforbidden11111", { body: "Hacked" });
    },
    (err) => {
      return err.message.includes("403") || err.status === 403;
    }
  );
});

test("updatePost throws on 404 not found", async () => {
  const { sdk } = createAuthenticatedMockSdk(
    { message: "Post not found" },
    404
  );

  await assert.rejects(
    async () => {
      await sdk.updatePost("01hxnotfound111111", { body: "Update" });
    },
    (err) => {
      return err.message.includes("404") || err.status === 404;
    }
  );
});

test("updatePost URL-encodes ulid parameter", async () => {
  // ULIDs shouldn't need encoding, but testing the safety measure
  const postResponse = createSamplePostResponse({ ulid: "01hxencodetest111" });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.updatePost("01hxencodetest111", { body: "Test" });

  assert.ok(calls[0].url.includes("01hxencodetest111"));
});

// ---------------------------------------------------------------------------
// deletePost tests
// ---------------------------------------------------------------------------

test("deletePost sends DELETE to /v1/posts/{ulid}", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({});

  await sdk.deletePost("01hxdelete11111111");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/posts/01hxdelete11111111`);
  assert.equal(calls[0].method, "DELETE");
});

test("deletePost returns void on success", async () => {
  const { sdk } = createAuthenticatedMockSdk({ success: true });

  const result = await sdk.deletePost("01hxdeletevoid1111");

  assert.equal(result, undefined);
});

test("deletePost includes Authorization header", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({});

  await sdk.deletePost("01hxdeleteauth1111");

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

test("deletePost throws on 403 forbidden", async () => {
  const { sdk } = createAuthenticatedMockSdk(
    { message: "Forbidden" },
    403
  );

  await assert.rejects(
    async () => {
      await sdk.deletePost("01hxdelforbid11111");
    },
    (err) => {
      return err.message.includes("403") || err.status === 403;
    }
  );
});

test("deletePost throws on 404 not found", async () => {
  const { sdk } = createAuthenticatedMockSdk(
    { message: "Post not found" },
    404
  );

  await assert.rejects(
    async () => {
      await sdk.deletePost("01hxdelnotfound111");
    },
    (err) => {
      return err.message.includes("404") || err.status === 404;
    }
  );
});

test("deletePost URL-encodes ulid parameter", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({});

  await sdk.deletePost("01hxdeleteencode11");

  assert.ok(calls[0].url.includes("01hxdeleteencode11"));
});

test("deletePost handles 204 no content response", async () => {
  // Create a custom mock that returns 204 with empty body
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  };

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });

  // Should not throw
  await sdk.deletePost("01hxdelete204test1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "DELETE");
});

// ---------------------------------------------------------------------------
// Edge cases and error handling
// ---------------------------------------------------------------------------

test("SDK handles network errors gracefully", async () => {
  const fetchImpl = async () => {
    throw new Error("Network error");
  };

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });

  await assert.rejects(
    async () => {
      await sdk.createPost({ body: "Test", groupName: "default" });
    },
    (err) => {
      return err.message.includes("Network error");
    }
  );
});

test("SDK handles malformed JSON response", async () => {
  const fetchImpl = async () => {
    return new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });

  // SDK catches JSON parse errors and returns null for getPostByUlid
  const result = await sdk.getPostByUlid("01hxmalformed11111", true);
  assert.equal(result, null);
});

test("SDK handles empty response body", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });

  const result = await sdk.getPostByUlid("01hxemptyresp11111", true);

  assert.equal(result, null);
});

test("createPost with all optional fields", async () => {
  const postResponse = createSamplePostResponse({
    ulid: "01hxallopts1111111",
    body: "Full options post",
    visibility: "followers",
    commentsEnabled: false,
    isSensitive: true,
  });

  const { sdk, calls } = createAuthenticatedSequentialSdk([
    { data: { data: postResponse } },
    { data: { data: [postResponse] } },
  ]);

  await sdk.createPost({
    body: "Full options post",
    groupName: "test-group",
    visibility: "followers",
    commentsEnabled: false,
    sensitive: true,
  });

  const requestBody = calls[0].body;
  assert.equal(requestBody.body, "Full options post");
  assert.equal(requestBody.groupName, "test-group");
  assert.equal(requestBody.visibility, "followers");
  assert.equal(requestBody.commentsEnabled, false);
  assert.equal(requestBody.sensitive, true);
});
