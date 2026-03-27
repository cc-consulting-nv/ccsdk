/**
 * Stories SDK Unit Tests (mocked HTTP)
 *
 * These tests verify the SDK's Stories API methods work correctly
 * by mocking the HTTP layer. For live API integration testing,
 * see integration/stories.integration.js.
 */

// Polyfill IndexedDB for Node.js (must be before SDK import)
import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../src/platformSdk.ts";

const baseUrl = "https://api.example.com";

/**
 * Creates a mock fetch implementation that returns the provided response
 */
function createMockFetch(responseData, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responseData), { status });
  };
  return { fetchImpl, calls };
}

/**
 * Creates a CcPlatformSdk instance with mocked HTTP
 */
function createMockSdk(responseData, status = 200) {
  const { fetchImpl, calls } = createMockFetch(responseData, status);
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });
  return { sdk, calls };
}

// Sample data for tests
const sampleUser = {
  ulid: "01hx1234567890abcdef",
  username: "testuser",
  displayName: "Test User",
  avatar: "avatars/test.jpg",
};

const sampleStory = {
  ulid: "01hx9876543210fedcba",
  caption: "Test story caption",
  visibility: "followers",
  media: [
    {
      url: "https://cdn.example.com/stories/test.jpg",
      mimeType: "image/jpeg",
      width: 1080,
      height: 1920,
    },
  ],
  viewCount: 5,
  hasViewed: false,
  isOwn: true,
  isExpired: false,
  createdAt: "2024-01-15T10:00:00Z",
  expiresAt: "2024-01-16T10:00:00Z",
  user: sampleUser,
};

const sampleFeedUser = {
  user: sampleUser,
  stories: [sampleStory],
  hasUnviewed: true,
  storyCount: 1,
  latestAt: "2024-01-15T10:00:00Z",
};

// ---------------------------------------------------------------------------
// getStoryFeed tests
// ---------------------------------------------------------------------------

test("getStoryFeed returns story feed data", async () => {
  const { sdk, calls } = createMockSdk({ data: [sampleFeedUser] });

  const feed = await sdk.getStoryFeed();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/stories/feed`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(feed.data.length, 1);
  assert.equal(feed.data[0].user.username, "testuser");
  assert.equal(feed.data[0].storyCount, 1);
  assert.equal(feed.data[0].hasUnviewed, true);
});

test("getStoryFeed handles empty feed", async () => {
  const { sdk, calls } = createMockSdk({ data: [] });

  const feed = await sdk.getStoryFeed();

  assert.equal(calls.length, 1);
  assert.equal(feed.data.length, 0);
});

test("getStoryFeed includes authorization header", async () => {
  const { sdk, calls } = createMockSdk({ data: [] });

  await sdk.getStoryFeed();

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// getMyStories tests
// ---------------------------------------------------------------------------

test("getMyStories returns user's own stories", async () => {
  const { sdk, calls } = createMockSdk({ data: [sampleStory] });

  const stories = await sdk.getMyStories();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/stories/me`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(stories.length, 1);
  assert.equal(stories[0].ulid, sampleStory.ulid);
  assert.equal(stories[0].caption, "Test story caption");
});

test("getMyStories handles no stories", async () => {
  const { sdk } = createMockSdk({ data: [] });

  const stories = await sdk.getMyStories();

  assert.equal(stories.length, 0);
});

// ---------------------------------------------------------------------------
// getUserStories tests
// ---------------------------------------------------------------------------

test("getUserStories returns stories for a specific user", async () => {
  const { sdk, calls } = createMockSdk({ data: [sampleStory] });

  const stories = await sdk.getUserStories("testuser");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/stories/user/testuser`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(stories.length, 1);
});

test("getUserStories encodes username in URL", async () => {
  const { sdk, calls } = createMockSdk({ data: [] });

  await sdk.getUserStories("user@name");

  assert.equal(calls[0].url, `${baseUrl}/v1/stories/user/user%40name`);
});

// ---------------------------------------------------------------------------
// getStory tests
// ---------------------------------------------------------------------------

test("getStory returns a single story by ULID", async () => {
  const { sdk, calls } = createMockSdk({ data: sampleStory });

  const story = await sdk.getStory("01hx9876543210fedcba");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/stories/01hx9876543210fedcba`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(story.ulid, sampleStory.ulid);
  assert.equal(story.caption, "Test story caption");
  assert.equal(story.isOwn, true);
});

// ---------------------------------------------------------------------------
// createStory tests
// ---------------------------------------------------------------------------

test("createStory posts story with caption only", async () => {
  const { sdk, calls } = createMockSdk({ data: sampleStory });

  const story = await sdk.createStory({
    caption: "New story!",
    visibility: "followers",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/stories`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.caption, "New story!");
  assert.equal(body.visibility, "followers");
  assert.equal(story.ulid, sampleStory.ulid);
});

test("createStory posts story with image IDs", async () => {
  const { sdk, calls } = createMockSdk({ data: sampleStory });

  await sdk.createStory({
    imageIds: [123, 456],
    caption: "Photo story",
    visibility: "public",
  });

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.image_ids, [123, 456]);
  assert.equal(body.caption, "Photo story");
  assert.equal(body.visibility, "public");
});

test("createStory posts story with image URLs", async () => {
  const { sdk, calls } = createMockSdk({ data: sampleStory });

  await sdk.createStory({
    imageUrls: ["s3://bucket/image.jpg"],
    caption: "URL story",
  });

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.image_urls, ["s3://bucket/image.jpg"]);
});

test("createStory posts story with group ID", async () => {
  const { sdk, calls } = createMockSdk({ data: sampleStory });

  await sdk.createStory({
    caption: "Group story",
    groupId: 42,
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.group_id, 42);
});

// ---------------------------------------------------------------------------
// deleteStory tests
// ---------------------------------------------------------------------------

test("deleteStory sends DELETE request", async () => {
  const { sdk, calls } = createMockSdk({});

  await sdk.deleteStory("01hx9876543210fedcba");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/stories/01hx9876543210fedcba`);
  assert.equal(calls[0].init.method, "DELETE");
});

test("deleteStory encodes ULID in URL", async () => {
  const { sdk, calls } = createMockSdk({});

  await sdk.deleteStory("ulid/with/slashes");

  assert.equal(
    calls[0].url,
    `${baseUrl}/v1/stories/ulid%2Fwith%2Fslashes`
  );
});

// ---------------------------------------------------------------------------
// markStoryViewed tests
// ---------------------------------------------------------------------------

test("markStoryViewed sends POST request", async () => {
  const { sdk, calls } = createMockSdk({});

  await sdk.markStoryViewed("01hx9876543210fedcba");

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `${baseUrl}/v1/stories/01hx9876543210fedcba/view`
  );
  assert.equal(calls[0].init.method, "POST");
});

// ---------------------------------------------------------------------------
// getStoryViewers tests
// ---------------------------------------------------------------------------

test("getStoryViewers returns list of viewers", async () => {
  const viewerData = {
    data: [
      {
        user: {
          id: 1,
          ulid: "01hx1111111111111111",
          username: "viewer1",
          displayName: "Viewer One",
          avatar: "avatars/v1.jpg",
        },
        viewedAt: "2024-01-15T11:00:00Z",
      },
      {
        user: {
          id: 2,
          ulid: "01hx2222222222222222",
          username: "viewer2",
          displayName: "Viewer Two",
          avatar: null,
        },
        viewedAt: "2024-01-15T12:00:00Z",
      },
    ],
  };

  const { sdk, calls } = createMockSdk(viewerData);

  const response = await sdk.getStoryViewers("01hx9876543210fedcba");

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `${baseUrl}/v1/stories/01hx9876543210fedcba/viewers`
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(response.data.length, 2);
  assert.equal(response.data[0].user.username, "viewer1");
  assert.equal(response.data[1].user.username, "viewer2");
});

test("getStoryViewers handles no viewers", async () => {
  const { sdk, calls } = createMockSdk({ data: [] });

  const response = await sdk.getStoryViewers("01hx9876543210fedcba");

  assert.equal(response.data.length, 0);
});
