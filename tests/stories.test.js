/**
 * Stories SDK Integration Test
 *
 * Run with:
 *   API_TOKEN=<your-token> npx tsx tests/stories.test.js
 *
 * Get a token by logging in via the UI and grabbing the access_token from localStorage.
 */

// Silence IndexedDB errors (expected in Node.js environment)
process.on('unhandledRejection', (reason) => {
  if (reason?.name === 'MissingAPIError' || reason?.message?.includes('IndexedDB')) {
    return; // Expected - no IndexedDB in Node.js
  }
  console.error('Unhandled Rejection:', reason);
});

import { CcPlatformSdk } from "../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/stories.test.js\n" +
    "Get your token from localStorage after logging into the UI."
  );
  process.exit(0);
}

// Create SDK instance
const sdk = new CcPlatformSdk({
  baseUrl: API_BASE,
  tokens: { accessToken: API_TOKEN },
});

async function testStoriesFeed() {
  console.log("\n=== Testing getStoryFeed ===");
  try {
    const feed = await sdk.getStoryFeed();
    console.log(`Feed contains ${feed.data.length} user(s) with stories`);

    for (const userStories of feed.data) {
      console.log(`  - ${userStories.user.username}: ${userStories.storyCount} stories (hasUnviewed: ${userStories.hasUnviewed})`);
      for (const story of userStories.stories) {
        console.log(`    * ${story.ulid} - "${story.caption?.substring(0, 30) || '(no caption)'}"`);
        console.log(`      expires: ${story.expiresAt}, media: ${story.media.length}`);
      }
    }
    return true;
  } catch (err) {
    console.error("getStoryFeed failed:", err.message || err);
    console.error("Full error:", JSON.stringify(err, null, 2));
    return false;
  }
}

async function testMyStories() {
  console.log("\n=== Testing getMyStories ===");
  try {
    const stories = await sdk.getMyStories();
    console.log(`You have ${stories.length} active stories`);

    for (const story of stories) {
      console.log(`  - ${story.ulid}: "${story.caption?.substring(0, 30) || '(no caption)'}" (views: ${story.viewCount ?? 'N/A'})`);
    }
    return stories;
  } catch (err) {
    console.error("getMyStories failed:", err.message);
    return [];
  }
}

async function testCreateStory() {
  console.log("\n=== Testing createStory (text-only) ===");
  try {
    const story = await sdk.createStory({
      caption: `SDK test story - ${new Date().toISOString()}`,
      visibility: "followers",
    });
    console.log(`Created story: ${story.ulid}`);
    console.log(`  caption: ${story.caption}`);
    console.log(`  visibility: ${story.visibility}`);
    console.log(`  expiresAt: ${story.expiresAt}`);
    return story;
  } catch (err) {
    console.error("createStory failed:", err.message);
    return null;
  }
}

async function testGetStory(ulid) {
  console.log(`\n=== Testing getStory(${ulid}) ===`);
  try {
    const story = await sdk.getStory(ulid);
    console.log(`Got story: ${story.ulid}`);
    console.log(`  caption: ${story.caption}`);
    console.log(`  isOwn: ${story.isOwn}`);
    console.log(`  hasViewed: ${story.hasViewed}`);
    return story;
  } catch (err) {
    console.error("getStory failed:", err.message);
    return null;
  }
}

async function testGetStoryViewers(ulid) {
  console.log(`\n=== Testing getStoryViewers(${ulid}) ===`);
  try {
    const response = await sdk.getStoryViewers(ulid);
    const viewers = response.data;
    console.log(`Story has ${viewers.length} viewer(s)`);
    for (const viewer of viewers) {
      console.log(`  - ${viewer.user.username} at ${viewer.viewedAt}`);
    }
    return viewers;
  } catch (err) {
    console.error("getStoryViewers failed:", err.message);
    return [];
  }
}

async function testDeleteStory(ulid) {
  console.log(`\n=== Testing deleteStory(${ulid}) ===`);
  try {
    await sdk.deleteStory(ulid);
    console.log(`Deleted story: ${ulid}`);
    return true;
  } catch (err) {
    console.error("deleteStory failed:", err.message);
    return false;
  }
}

async function main() {
  console.log(`Testing Stories SDK against ${API_BASE}`);

  // Test feed
  await testStoriesFeed();

  // Test my stories
  const myStories = await testMyStories();

  // Create a new story
  const newStory = await testCreateStory();

  if (newStory) {
    // Get the story
    await testGetStory(newStory.ulid);

    // Get viewers (should be empty since we just created it)
    await testGetStoryViewers(newStory.ulid);

    // Verify it appears in feed
    console.log("\n=== Verifying story appears in feed ===");
    const feedAfter = await sdk.getStoryFeed();
    const foundInFeed = feedAfter.data.some(u =>
      u.stories.some(s => s.ulid === newStory.ulid)
    );
    console.log(`New story in feed: ${foundInFeed ? 'YES' : 'NO'}`);

    // Clean up - delete the test story
    await testDeleteStory(newStory.ulid);

    // Verify it's gone from feed
    console.log("\n=== Verifying story removed from feed ===");
    const feedFinal = await sdk.getStoryFeed();
    const stillInFeed = feedFinal.data.some(u =>
      u.stories.some(s => s.ulid === newStory.ulid)
    );
    console.log(`Story still in feed: ${stillInFeed ? 'YES (unexpected)' : 'NO (correct)'}`);
  }

  console.log("\n=== All tests complete ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
