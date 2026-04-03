/**
 * Posts SDK Integration Tests - CRUD Operations
 *
 * Run with:
 *   API_TOKEN=<your-token> npx tsx tests/integration/posts.integration.js
 *
 * Get a token by logging in via the UI and grabbing the access_token from localStorage.
 *
 * Environment variables:
 *   API_BASE      - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN     - Access token for authentication (required)
 *   TEST_GROUP    - Group name to post to (default: "default")
 *   TEST_VIDEO_URL - URL to a video file for video post tests (optional)
 *
 * Covers: createPost, createVideoPost, getPostByUlid, fetchPostsBatch, updatePost, deletePost
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;
const TEST_GROUP = process.env.TEST_GROUP || "default";
const TEST_VIDEO_URL = process.env.TEST_VIDEO_URL;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/posts.integration.js\n\n" +
    "Get your token from localStorage after logging into the UI:\n" +
    "  1. Open browser DevTools\n" +
    "  2. Go to Application > Local Storage\n" +
    "  3. Copy the access_token value\n\n" +
    "Optional environment variables:\n" +
    "  API_BASE=http://localhost:8089  (default)\n" +
    "  TEST_GROUP=default              (group to post to)\n" +
    "  TEST_VIDEO_URL=https://...      (for video post tests)"
  );
  process.exit(0);
}

// Create SDK instance with writeReadDelay to handle API eventual consistency
const sdk = new CcPlatformSdk({
  baseUrl: API_BASE,
  tokens: { accessToken: API_TOKEN },
  writeReadDelay: 6000, // 6 second delay before read-after-write
});

// Track created posts for cleanup
const createdPostUlids = [];

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

function log(message, data = null) {
  console.log(`  ${message}`);
  if (data) {
    console.log(`    ${JSON.stringify(data, null, 2).split("\n").join("\n    ")}`);
  }
}

function success(message) {
  console.log(`  ✓ ${message}`);
}

function fail(message, error) {
  console.log(`  ✗ ${message}`);
  if (error) {
    console.log(`    Error: ${error.message || error}`);
  }
}

function generateUniqueContent() {
  return `Integration test post - ${Date.now()} - ${Math.random().toString(36).substring(7)}`;
}

// ---------------------------------------------------------------------------
// createPost Tests
// ---------------------------------------------------------------------------

async function testCreatePost() {
  console.log("\n=== Testing createPost ===");

  try {
    const content = generateUniqueContent();

    const post = await sdk.createPost({
      body: content,
      groupName: TEST_GROUP,
    });

    if (!post) {
      fail("createPost returned null");
      return null;
    }

    const postId = post.ulid || post.id;
    if (!postId) {
      fail("Post has no ulid or id", { postKeys: Object.keys(post) });
      return null;
    }

    createdPostUlids.push(postId);

    success(`Created post: ${postId}`);
    log("Post details:", {
      ulid: postId,
      content: (post.body || post.content || "").substring(0, 50),
      type: post.type || post.postType,
      createdAt: post.createdAt,
      groupName: post.groupName,
    });

    // Verify content matches
    const actualContent = post.body || post.content;
    if (actualContent !== content) {
      fail(`Content mismatch: expected "${content.substring(0, 30)}..." but got "${actualContent?.substring(0, 30)}..."`);
    } else {
      success("Content matches");
    }

    return post;
  } catch (err) {
    fail("createPost failed", err);
    console.error("Full error:", err);
    return null;
  }
}

async function testCreatePostWithOptions() {
  console.log("\n=== Testing createPost with options ===");

  try {
    const content = generateUniqueContent();

    const post = await sdk.createPost({
      body: content,
      groupName: TEST_GROUP,
      visibility: "public",
      commentsEnabled: true,
    });

    const postId = post.ulid || post.id;
    if (!postId) {
      fail("Post has no ulid");
      return null;
    }

    createdPostUlids.push(postId);

    success(`Created post with options: ${postId}`);
    log("Options applied:", {
      visibility: post.visibility,
      commentsEnabled: post.commentsEnabled,
    });

    if (post.visibility !== "public") {
      fail(`Expected visibility "public", got "${post.visibility}"`);
    } else {
      success("Visibility is correct");
    }

    return post;
  } catch (err) {
    fail("createPost with options failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// getPostByUlid Tests
// ---------------------------------------------------------------------------

async function testGetPostByUlid(existingPostUlid) {
  console.log("\n=== Testing getPostByUlid ===");

  if (!existingPostUlid) {
    console.log("  Skipping - no post ulid provided");
    return null;
  }

  try {
    // Test fetching with forceRefresh=true (bypass cache)
    const post = await sdk.getPostByUlid(existingPostUlid, true);

    if (!post) {
      fail(`Post ${existingPostUlid} not found`);
      return null;
    }

    const postId = post.ulid || post.id;
    success(`Fetched post: ${postId}`);
    log("Post details:", {
      ulid: postId,
      content: (post.body || post.content || "").substring(0, 50),
      type: post.type || post.postType,
      hasEngagement: !!post.postEngagement,
    });

    if (postId !== existingPostUlid) {
      fail(`ULID mismatch: requested ${existingPostUlid}, got ${postId}`);
    } else {
      success("ULID matches");
    }

    return post;
  } catch (err) {
    fail("getPostByUlid failed", err);
    return null;
  }
}

async function testGetPostByUlidCaching(existingPostUlid) {
  console.log("\n=== Testing getPostByUlid caching ===");

  if (!existingPostUlid) {
    console.log("  Skipping - no post ulid provided");
    return;
  }

  try {
    // First fetch (may hit API or cache)
    const startTime1 = Date.now();
    const post1 = await sdk.getPostByUlid(existingPostUlid);
    const time1 = Date.now() - startTime1;

    if (!post1) {
      fail("First fetch returned null");
      return;
    }

    success(`First fetch completed in ${time1}ms`);

    // Second fetch (should hit cache)
    const startTime2 = Date.now();
    const post2 = await sdk.getPostByUlid(existingPostUlid);
    const time2 = Date.now() - startTime2;

    if (!post2) {
      fail("Second fetch returned null");
      return;
    }

    success(`Second fetch completed in ${time2}ms`);

    // Cache should be faster (though not guaranteed due to async nature)
    if (time2 <= time1) {
      success("Cache appears to be working (second fetch faster or equal)");
    } else {
      log("Note: Second fetch was slower (may be due to timing variance)");
    }

    // Both should return the same post
    const id1 = post1.ulid || post1.id;
    const id2 = post2.ulid || post2.id;
    if (id1 === id2) {
      success("Both fetches returned the same post");
    } else {
      fail(`Post IDs don't match: ${id1} vs ${id2}`);
    }
  } catch (err) {
    fail("getPostByUlid caching test failed", err);
  }
}

async function testGetPostByUlidNotFound() {
  console.log("\n=== Testing getPostByUlid for non-existent post ===");

  try {
    // Use a valid ULID format but one that shouldn't exist
    const fakeUlid = "01hxzzzzzzzzzzzzzzzzz";

    const post = await sdk.getPostByUlid(fakeUlid, true);

    if (post === null) {
      success("Correctly returned null for non-existent post");
    } else {
      fail("Expected null for non-existent post, but got a post");
    }
  } catch (err) {
    // Some implementations may throw instead of returning null
    if (err.message.includes("404") || err.message.includes("not found")) {
      success("Correctly threw error for non-existent post");
    } else {
      fail("Unexpected error", err);
    }
  }
}

// ---------------------------------------------------------------------------
// fetchPostsBatch Tests
// ---------------------------------------------------------------------------

async function testFetchPostsBatch(postUlids) {
  console.log("\n=== Testing fetchPostsBatch ===");

  if (!postUlids || postUlids.length === 0) {
    console.log("  Skipping - no post ulids provided");
    return null;
  }

  try {
    const results = await sdk.fetchPostsBatch(postUlids);

    if (!results || typeof results !== "object") {
      fail("fetchPostsBatch did not return an object");
      return null;
    }

    const returnedCount = Object.keys(results).length;
    success(`Fetched ${returnedCount}/${postUlids.length} posts`);

    // Check each requested post
    for (const ulid of postUlids) {
      if (results[ulid]) {
        const post = results[ulid];
        const postId = post.ulid || post.id;
        success(`  Found: ${ulid} -> ${postId}`);
      } else {
        log(`  Missing: ${ulid}`);
      }
    }

    return results;
  } catch (err) {
    fail("fetchPostsBatch failed", err);
    return null;
  }
}

async function testFetchPostsBatchDeduplication() {
  console.log("\n=== Testing fetchPostsBatch deduplication ===");

  // Create a post to test with
  const content = generateUniqueContent();
  let testPost;

  try {
    testPost = await sdk.createPost({
      body: content,
      groupName: TEST_GROUP,
    });

    const postId = testPost.ulid || testPost.id;
    createdPostUlids.push(postId);

    // Fetch with duplicates
    const results = await sdk.fetchPostsBatch([
      postId,
      postId,
      postId,
    ]);

    const returnedCount = Object.keys(results).length;

    if (returnedCount === 1) {
      success("Correctly deduplicated - returned 1 unique post");
    } else {
      fail(`Expected 1 unique post, got ${returnedCount}`);
    }

    if (results[postId]) {
      success(`Post ${postId} found in results`);
    } else {
      fail(`Post ${postId} not found in results`);
    }
  } catch (err) {
    fail("fetchPostsBatch deduplication test failed", err);
  }
}

// ---------------------------------------------------------------------------
// updatePost Tests
// ---------------------------------------------------------------------------

async function testUpdatePost(existingPostUlid) {
  console.log("\n=== Testing updatePost ===");

  if (!existingPostUlid) {
    console.log("  Skipping - no post ulid provided");
    return null;
  }

  try {
    const newContent = `Updated content - ${Date.now()}`;

    log(`Attempting to update post ${existingPostUlid} with body: "${newContent.substring(0, 30)}..."`);

    const updatedPost = await sdk.updatePost(existingPostUlid, {
      body: newContent,
    });

    // Also verify by making a direct API fetch to see what the DB actually has
    const verifyResponse = await fetch(`${API_BASE}/v1/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({ ulids: [existingPostUlid] }),
    });
    const verifyData = await verifyResponse.json();
    log("Direct verify after SDK update:", {
      body: verifyData.data?.[0]?.body?.substring(0, 50),
      edited: verifyData.data?.[0]?.edited,
    });

    if (!updatedPost) {
      fail("updatePost returned null");
      return null;
    }

    const postId = updatedPost.ulid || updatedPost.id;
    success(`Updated post: ${postId}`);

    // Log the full response for debugging
    log("Response fields:", {
      hasBody: "body" in updatedPost,
      hasContent: "content" in updatedPost,
      body: updatedPost.body?.substring(0, 50),
      content: updatedPost.content?.substring(0, 50),
      edited: updatedPost.edited,
      updatedAt: updatedPost.updatedAt,
    });

    // Verify the content was updated
    const actualContent = updatedPost.body || updatedPost.content;
    if (actualContent === newContent) {
      success("Content was updated correctly");
    } else {
      fail(`Content mismatch: expected "${newContent.substring(0, 30)}..." but got "${actualContent?.substring(0, 30)}..."`);
    }

    log("Updated post:", {
      ulid: postId,
      content: actualContent?.substring(0, 50),
      updatedAt: updatedPost.updatedAt,
    });

    return updatedPost;
  } catch (err) {
    fail("updatePost failed", err);
    console.error("Update error details:", err);
    return null;
  }
}

async function testUpdatePostVerifyPersistence(existingPostUlid, expectedContent) {
  console.log("\n=== Testing updatePost persistence ===");

  if (!existingPostUlid || !expectedContent) {
    console.log("  Skipping - missing post ulid or expected content");
    return;
  }

  try {
    // Fetch the post fresh from the API
    const post = await sdk.getPostByUlid(existingPostUlid, true);

    if (!post) {
      fail("Could not fetch post to verify update");
      return;
    }

    const actualContent = post.body || post.content;

    if (actualContent === expectedContent) {
      success("Update persisted correctly - content matches");
    } else {
      fail(`Update not persisted: expected "${expectedContent.substring(0, 30)}..." but got "${actualContent?.substring(0, 30)}..."`);
    }
  } catch (err) {
    fail("Verify update persistence failed", err);
  }
}

// ---------------------------------------------------------------------------
// deletePost Tests
// ---------------------------------------------------------------------------

async function testDeletePost(postUlid) {
  console.log("\n=== Testing deletePost ===");

  if (!postUlid) {
    console.log("  Skipping - no post ulid provided");
    return false;
  }

  try {
    await sdk.deletePost(postUlid);

    success(`Deleted post: ${postUlid}`);

    // Remove from our tracking array
    const index = createdPostUlids.indexOf(postUlid);
    if (index > -1) {
      createdPostUlids.splice(index, 1);
    }

    return true;
  } catch (err) {
    fail("deletePost failed", err);
    return false;
  }
}

async function testDeletePostVerifyGone(postUlid) {
  console.log("\n=== Testing deletePost verification ===");

  if (!postUlid) {
    console.log("  Skipping - no post ulid provided");
    return;
  }

  try {
    // Direct API verify to see what the database actually has
    const directVerify = await fetch(`${API_BASE}/v1/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({ ulids: [postUlid] }),
    });
    const directData = await directVerify.json();
    const directPost = directData.data?.[0];

    if (!directPost) {
      success("Direct API confirms post is deleted (not returned in batch)");
      return;
    }

    log("Direct API response after delete:", {
      ulid: directPost.ulid,
      isDeleted: directPost.isDeleted,
      isHidden: directPost.isHidden,
    });

    // Try to fetch via SDK
    const post = await sdk.getPostByUlid(postUlid, true);

    if (post === null) {
      success("Correctly returned null for deleted post");
    } else {
      // Log what we got back
      log("SDK returned after deletion:", {
        ulid: post.ulid || post.id,
        isDeleted: post.isDeleted,
        isHidden: post.isHidden,
        body: post.body?.substring(0, 30),
      });

      // Check if post is marked as deleted
      if (post.isDeleted) {
        success("Post is marked as deleted");
      } else if (post.isHidden) {
        success("Post is marked as hidden (soft delete)");
      } else {
        fail("Post still exists after deletion");
      }
    }
  } catch (err) {
    // A 404 or similar error is also acceptable
    if (err.message.includes("404") || err.message.includes("not found") || err.message.includes("not returned")) {
      success("Correctly threw error for deleted post");
    } else {
      fail("Unexpected error when checking deleted post", err);
    }
  }
}

// ---------------------------------------------------------------------------
// createVideoPost Tests
// ---------------------------------------------------------------------------

async function testCreateVideoPost() {
  console.log("\n=== Testing createVideoPost ===");

  if (!TEST_VIDEO_URL) {
    console.log("  Skipping - no TEST_VIDEO_URL provided");
    console.log("  Set TEST_VIDEO_URL environment variable to test video posts");
    return null;
  }

  try {
    const post = await sdk.createVideoPost({
      videoUrl: TEST_VIDEO_URL,
      title: `Integration test video - ${Date.now()}`,
      body: "Video description for integration test",
      groupName: TEST_GROUP,
      type: "VIDEO",
    });

    if (!post) {
      fail("createVideoPost returned null");
      return null;
    }

    const postId = post.ulid || post.id;
    if (!postId) {
      fail("Video post has no ulid");
      return null;
    }

    createdPostUlids.push(postId);

    success(`Created video post: ${postId}`);
    log("Video post details:", {
      ulid: postId,
      title: post.title,
      type: post.type || post.postType,
      isProcessing: post.isProcessing,
      hasVideos: !!(post.videos && post.videos.length > 0),
      hasVideoProcessing: !!(post.videoProcessing && post.videoProcessing.length > 0),
    });

    return post;
  } catch (err) {
    fail("createVideoPost failed", err);
    console.error("Full error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Full CRUD Lifecycle Test
// ---------------------------------------------------------------------------

async function testFullCrudLifecycle() {
  console.log("\n=== Testing Full CRUD Lifecycle ===");

  let postUlid = null;

  try {
    // 1. CREATE
    console.log("\n  Step 1: Create post");
    const originalContent = generateUniqueContent();
    const createdPost = await sdk.createPost({
      body: originalContent,
      groupName: TEST_GROUP,
    });

    if (!createdPost) {
      fail("Create step failed - no post returned");
      return;
    }

    postUlid = createdPost.ulid || createdPost.id;
    createdPostUlids.push(postUlid);
    success(`Created: ${postUlid}`);

    // 2. READ
    console.log("\n  Step 2: Read post");
    const readPost = await sdk.getPostByUlid(postUlid, true);

    if (!readPost) {
      fail("Read step failed - post not found");
      return;
    }

    const readContent = readPost.body || readPost.content;
    if (readContent === originalContent) {
      success("Read content matches original");
    } else {
      fail("Read content does not match original");
    }

    // 3. UPDATE
    console.log("\n  Step 3: Update post");
    const updatedContent = `Updated: ${Date.now()}`;
    log(`Sending update with body: "${updatedContent}"`);

    const updatedPost = await sdk.updatePost(postUlid, {
      body: updatedContent,
    });

    if (!updatedPost) {
      fail("Update step failed - no post returned");
      return;
    }

    log("Update response:", {
      hasBody: "body" in updatedPost,
      body: updatedPost.body?.substring(0, 50),
      hasContent: "content" in updatedPost,
      content: updatedPost.content?.substring(0, 50),
      edited: updatedPost.edited,
    });

    const afterUpdateContent = updatedPost.body || updatedPost.content;
    if (afterUpdateContent === updatedContent) {
      success("Update content applied");
    } else {
      fail(`Update content not applied - expected "${updatedContent.substring(0, 30)}" got "${afterUpdateContent?.substring(0, 30)}"`);
    }

    // 4. VERIFY UPDATE
    console.log("\n  Step 4: Verify update persisted");
    const verifyPost = await sdk.getPostByUlid(postUlid, true);

    log("Verify response:", {
      hasBody: verifyPost && "body" in verifyPost,
      body: verifyPost?.body?.substring(0, 50),
      hasContent: verifyPost && "content" in verifyPost,
      content: verifyPost?.content?.substring(0, 50),
    });

    const verifyContent = verifyPost?.body || verifyPost?.content;

    if (verifyContent === updatedContent) {
      success("Update persisted correctly");
    } else {
      fail(`Update did not persist - expected "${updatedContent.substring(0, 30)}" got "${verifyContent?.substring(0, 30)}"`);
    }

    // 5. DELETE
    console.log("\n  Step 5: Delete post");
    await sdk.deletePost(postUlid);
    success("Delete completed");

    // Remove from tracking since we just deleted it
    const index = createdPostUlids.indexOf(postUlid);
    if (index > -1) {
      createdPostUlids.splice(index, 1);
    }

    // 6. VERIFY DELETE
    console.log("\n  Step 6: Verify deletion");
    try {
      const deletedPost = await sdk.getPostByUlid(postUlid, true);
      if (deletedPost === null) {
        success("Post correctly removed (returned null)");
      } else if (deletedPost.isDeleted) {
        success("Post correctly marked as deleted");
      } else if (deletedPost.isHidden) {
        success("Post correctly marked as hidden (soft delete)");
      } else {
        log("Post still present:", {
          ulid: deletedPost.ulid || deletedPost.id,
          isDeleted: deletedPost.isDeleted,
          isHidden: deletedPost.isHidden,
        });
        fail("Post still exists after deletion");
      }
    } catch (err) {
      if (err.message.includes("404") || err.message.includes("not found") || err.message.includes("not returned")) {
        success("Post correctly removed (threw not found error)");
      } else {
        throw err;
      }
    }

    console.log("\n  ✓ Full CRUD lifecycle completed successfully!");
  } catch (err) {
    fail("CRUD lifecycle test failed", err);
    console.error("Full error:", err);
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  console.log("\n=== Cleanup ===");

  if (createdPostUlids.length === 0) {
    console.log("  No posts to clean up");
    return;
  }

  console.log(`  Cleaning up ${createdPostUlids.length} test post(s)...`);

  for (const ulid of [...createdPostUlids]) {
    try {
      await sdk.deletePost(ulid);
      success(`Deleted: ${ulid}`);

      const index = createdPostUlids.indexOf(ulid);
      if (index > -1) {
        createdPostUlids.splice(index, 1);
      }
    } catch (err) {
      // Post may already be deleted
      if (err.message.includes("404") || err.message.includes("not found")) {
        log(`Already deleted: ${ulid}`);
      } else {
        fail(`Failed to delete ${ulid}`, err);
      }
    }
  }

  console.log("  Cleanup complete");
}

// ---------------------------------------------------------------------------
// Main Test Runner
// ---------------------------------------------------------------------------

// Delay between tests to avoid race conditions with cache/queue propagation
const TEST_DELAY_MS = 20000;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         Posts SDK Integration Tests - CRUD Operations       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\nAPI Base: ${API_BASE}`);
  console.log(`Test Group: ${TEST_GROUP}`);
  console.log(`Video URL: ${TEST_VIDEO_URL || "(not provided)"}`);
  console.log(`Test delay: ${TEST_DELAY_MS}ms between tests`);

  try {
    // Test createPost
    const createdPost = await testCreatePost();
    const createdPostUlid = createdPost?.ulid || createdPost?.id;
    await delay(TEST_DELAY_MS);

    await testCreatePostWithOptions();
    await delay(TEST_DELAY_MS);

    // Test getPostByUlid
    await testGetPostByUlid(createdPostUlid);
    await delay(TEST_DELAY_MS);

    await testGetPostByUlidCaching(createdPostUlid);
    await delay(TEST_DELAY_MS);

    await testGetPostByUlidNotFound();
    await delay(TEST_DELAY_MS);

    // Test fetchPostsBatch
    if (createdPostUlids.length > 0) {
      await testFetchPostsBatch(createdPostUlids.slice(0, 3));
      await delay(TEST_DELAY_MS);
    }
    await testFetchPostsBatchDeduplication();
    await delay(TEST_DELAY_MS);

    // Test updatePost
    if (createdPostUlid) {
      const updatedPost = await testUpdatePost(createdPostUlid);
      const updatedContent = updatedPost?.body || updatedPost?.content;
      await delay(TEST_DELAY_MS);

      await testUpdatePostVerifyPersistence(createdPostUlid, updatedContent);
      await delay(TEST_DELAY_MS);
    }

    // Test createVideoPost (if video URL provided)
    await testCreateVideoPost();
    await delay(TEST_DELAY_MS);

    // Test deletePost (create a new one specifically for deletion)
    const deleteTestPost = await sdk.createPost({
      body: generateUniqueContent(),
      groupName: TEST_GROUP,
    });
    const deleteTestUlid = deleteTestPost?.ulid || deleteTestPost?.id;
    if (deleteTestUlid) {
      createdPostUlids.push(deleteTestUlid);
      await delay(TEST_DELAY_MS);

      const deleted = await testDeletePost(deleteTestUlid);
      if (deleted) {
        await delay(TEST_DELAY_MS);
        await testDeletePostVerifyGone(deleteTestUlid);
      }
    }
    await delay(TEST_DELAY_MS);

    // Full lifecycle test
    await testFullCrudLifecycle();

  } catch (err) {
    console.error("\n=== Unexpected Error ===");
    console.error(err);
  } finally {
    // Always run cleanup
    await cleanup();
  }

  console.log("\n=== All tests complete ===");
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
