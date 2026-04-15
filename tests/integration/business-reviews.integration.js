/**
 * Business Reviews SDK Integration Tests
 *
 * Run with:
 *   API_TOKEN=<your-token> npx tsx tests/integration/business-reviews.integration.js
 *
 * Get a token by logging in via the UI and grabbing the access_token from localStorage.
 *
 * Environment variables:
 *   API_BASE      - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN     - Access token for authentication (required)
 *
 * Covers:
 *   - createBusiness (setup)
 *   - submitBusinessReview
 *   - fetchBusinessReviews (with filters/sorting)
 *   - fetchUserReviews / fetchMyReviews
 *   - updateBusinessReview
 *   - markBusinessReviewHelpful
 *   - markBusinessReviewNotHelpful
 *   - respondToBusinessReview
 *   - deleteBusinessReview
 *   - deleteBusiness (cleanup)
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/business-reviews.integration.js\n\n" +
    "Get your token from localStorage after logging into the UI:\n" +
    "  1. Open browser DevTools\n" +
    "  2. Go to Application > Local Storage\n" +
    "  3. Copy the access_token value\n\n" +
    "Optional environment variables:\n" +
    "  API_BASE=http://localhost:8089  (default)"
  );
  process.exit(0);
}

// Create SDK instance
const sdk = new CcPlatformSdk({
  baseUrl: API_BASE,
  tokens: { accessToken: API_TOKEN },
  writeReadDelay: 2000, // 2 second delay before read-after-write
});

// Track created resources for cleanup
let testBusinessUlid = null;
const createdReviewUlids = [];

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

function generateUniqueName() {
  return `Test Business - ${Date.now()} - ${Math.random().toString(36).substring(7)}`;
}

function generateReviewContent() {
  return `This is an integration test review with enough content to pass validation. Created at ${Date.now()}.`;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const TEST_DELAY_MS = 3000;

// ---------------------------------------------------------------------------
// Setup: Create Test Business
// ---------------------------------------------------------------------------

async function setupTestBusiness() {
  console.log("\n=== Setup: Creating Test Business ===");

  try {
    // First, fetch a category to use
    console.log("  Fetching business categories...");
    const categories = await sdk.fetchBusinessCategories();

    if (!categories || categories.length === 0) {
      fail("No business categories available");
      return null;
    }

    const categoryId = categories[0].id || categories[0].ulid;
    log(`Using category: ${categories[0].name} (${categoryId})`);

    const businessName = generateUniqueName();

    let business;
    try {
      business = await sdk.createBusiness({
        name: businessName,
        description: "A test business created for SDK integration testing. This will be deleted after tests complete.",
        categoryId: categoryId,
        address: "123 Test Street",
        city: "Port of Spain",
        region: "Port of Spain",
        phone: "+1-868-555-0100",
        email: "test@example.com",
      });
    } catch (createErr) {
      fail("createBusiness threw error", createErr);
      console.error("Create error:", createErr);
      return null;
    }

    log("createBusiness returned:", business);

    if (!business) {
      fail("createBusiness returned null/undefined");
      return null;
    }

    testBusinessUlid = business.id || business.ulid;

    if (!testBusinessUlid) {
      fail("Business has no id or ulid", { businessKeys: Object.keys(business) });
      return null;
    }

    success(`Created test business: ${testBusinessUlid}`);
    log("Business details:", {
      id: testBusinessUlid,
      name: business.name,
      city: business.city,
      averageRating: business.averageRating,
      reviewCount: business.reviewCount,
    });

    return business;
  } catch (err) {
    fail("Failed to create test business", err);
    console.error("Full error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// submitBusinessReview Tests
// ---------------------------------------------------------------------------

async function testSubmitReview() {
  console.log("\n=== Testing submitBusinessReview ===");

  if (!testBusinessUlid) {
    console.log("  Skipping - no test business available");
    return null;
  }

  try {
    const content = generateReviewContent();

    const review = await sdk.submitBusinessReview(testBusinessUlid, {
      rating: 4,
      title: "Great test business!",
      content: content,
    });

    if (!review) {
      fail("submitBusinessReview returned null");
      return null;
    }

    const reviewId = review.id || review.ulid;
    if (!reviewId) {
      fail("Review has no id or ulid", { reviewKeys: Object.keys(review) });
      return null;
    }

    createdReviewUlids.push(reviewId);

    success(`Created review: ${reviewId}`);
    log("Review details:", {
      id: reviewId,
      rating: review.rating,
      title: review.title,
      content: review.content?.substring(0, 50) + "...",
      status: review.status,
      helpfulCount: review.helpfulCount,
      notHelpfulCount: review.notHelpfulCount,
    });

    // Verify fields
    if (review.rating !== 4) {
      fail(`Expected rating 4, got ${review.rating}`);
    } else {
      success("Rating is correct");
    }

    if (review.title !== "Great test business!") {
      fail(`Expected title "Great test business!", got "${review.title}"`);
    } else {
      success("Title is correct");
    }

    return review;
  } catch (err) {
    fail("submitBusinessReview failed", err);
    console.error("Full error:", err);
    return null;
  }
}

async function testSubmitReviewWithPhotos() {
  console.log("\n=== Testing submitBusinessReview with photos ===");

  if (!testBusinessUlid) {
    console.log("  Skipping - no test business available");
    return null;
  }

  // Note: This test will likely fail since the same user can only submit one review
  // But we test the payload structure
  try {
    const content = generateReviewContent();

    const review = await sdk.submitBusinessReview(testBusinessUlid, {
      rating: 5,
      title: "With photos!",
      content: content,
      photos: [
        "https://example.com/photo1.jpg",
        "https://example.com/photo2.jpg",
      ],
    });

    if (review) {
      const reviewId = review.id || review.ulid;
      createdReviewUlids.push(reviewId);
      success(`Created review with photos: ${reviewId}`);
      log("Photos:", review.photos);
    }

    return review;
  } catch (err) {
    // Expected to fail if user already reviewed
    if (err.message?.includes("already reviewed")) {
      success("Correctly prevented duplicate review");
    } else {
      fail("submitBusinessReview with photos failed", err);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// fetchBusinessReviews Tests
// ---------------------------------------------------------------------------

async function testFetchReviews() {
  console.log("\n=== Testing fetchBusinessReviews ===");

  if (!testBusinessUlid) {
    console.log("  Skipping - no test business available");
    return null;
  }

  try {
    const response = await sdk.fetchBusinessReviews(testBusinessUlid);

    if (!response) {
      fail("fetchBusinessReviews returned null");
      return null;
    }

    success(`Fetched ${response.reviews?.length || 0} reviews`);
    log("Response:", {
      reviewCount: response.reviews?.length,
      hasMore: response.hasMore,
      nextCursor: response.nextCursor ? "(present)" : null,
    });

    if (response.reviews?.length > 0) {
      const firstReview = response.reviews[0];
      log("First review:", {
        id: firstReview.id || firstReview.ulid,
        rating: firstReview.rating,
        title: firstReview.title,
        helpfulCount: firstReview.helpfulCount,
        notHelpfulCount: firstReview.notHelpfulCount,
        isVerified: firstReview.isVerified,
        status: firstReview.status,
      });
    }

    return response;
  } catch (err) {
    fail("fetchBusinessReviews failed", err);
    return null;
  }
}

async function testFetchReviewsWithFilters() {
  console.log("\n=== Testing fetchBusinessReviews with filters ===");

  if (!testBusinessUlid) {
    console.log("  Skipping - no test business available");
    return null;
  }

  // Test different sort options
  const sortOptions = ["newest", "highest", "lowest", "helpful"];

  for (const sort of sortOptions) {
    try {
      const response = await sdk.fetchBusinessReviews(testBusinessUlid, {
        sort: sort,
        perPage: 5,
      });

      success(`Sort by "${sort}": ${response.reviews?.length || 0} reviews`);
    } catch (err) {
      fail(`Sort by "${sort}" failed`, err);
    }
  }

  // Test rating filter
  try {
    const response = await sdk.fetchBusinessReviews(testBusinessUlid, {
      rating: 4,
    });

    success(`Filter by rating=4: ${response.reviews?.length || 0} reviews`);
  } catch (err) {
    fail("Filter by rating failed", err);
  }

  // Test verified only
  try {
    const response = await sdk.fetchBusinessReviews(testBusinessUlid, {
      verifiedOnly: true,
    });

    success(`Filter verifiedOnly: ${response.reviews?.length || 0} reviews`);
  } catch (err) {
    fail("Filter verifiedOnly failed", err);
  }
}

// ---------------------------------------------------------------------------
// fetchMyReviews / fetchUserReviews Tests
// ---------------------------------------------------------------------------

async function testFetchMyReviews(expectedReviewUlid) {
  console.log("\n=== Testing fetchMyReviews ===");

  try {
    const response = await sdk.fetchMyReviews({ perPage: 25 });

    if (!response) {
      fail("fetchMyReviews returned null");
      return null;
    }

    success(`Fetched ${response.reviews?.length || 0} of my reviews`);
    log("Response shape:", {
      reviewCount: response.reviews?.length,
      hasMore: response.hasMore,
      nextCursor: response.nextCursor ? "(present)" : null,
    });

    if (expectedReviewUlid) {
      const found = response.reviews?.find(
        (r) => (r.id || r.ulid) === expectedReviewUlid
      );
      if (found) {
        success("Newly created review appears in /me/reviews");
      } else {
        fail(`Expected review ${expectedReviewUlid} not present in /me/reviews`);
      }
    }

    // Confirm business is eager-loaded for profile-card rendering
    const sample = response.reviews?.[0];
    if (sample && (sample.business?.name || sample.business?.id)) {
      success("Reviews include eager-loaded business payload");
    } else if (sample) {
      fail("Review missing business payload (expected for profile cards)", {
        keys: Object.keys(sample),
      });
    }

    return response;
  } catch (err) {
    fail("fetchMyReviews failed", err);
    return null;
  }
}

async function testFetchUserReviews(expectedReviewUlid) {
  console.log("\n=== Testing fetchUserReviews (own ULID) ===");

  try {
    // Resolve current user's ULID
    const me = await sdk.getCurrentUser();
    const userUlid = me?.ulid || me?.id;

    if (!userUlid) {
      fail("Could not resolve current user ULID for fetchUserReviews test", { me });
      return null;
    }

    log(`Fetching reviews for user: ${userUlid}`);
    const response = await sdk.fetchUserReviews(userUlid, { perPage: 25 });

    if (!response) {
      fail("fetchUserReviews returned null");
      return null;
    }

    success(`Fetched ${response.reviews?.length || 0} reviews for user`);

    if (expectedReviewUlid) {
      const found = response.reviews?.find(
        (r) => (r.id || r.ulid) === expectedReviewUlid
      );
      if (found) {
        success("Created review visible via fetchUserReviews");
      } else {
        fail(`Expected review ${expectedReviewUlid} not present in fetchUserReviews`);
      }
    }

    return response;
  } catch (err) {
    fail("fetchUserReviews failed", err);
    return null;
  }
}

async function testFetchUserReviewsUnknownUlid() {
  console.log("\n=== Testing fetchUserReviews with non-existent user (should 404) ===");

  try {
    await sdk.fetchUserReviews("01H000000000000000000NOPE00");
    fail("Expected 404 but call succeeded");
  } catch (err) {
    const msg = (err.message || "").toLowerCase();
    if (msg.includes("404") || msg.includes("not found")) {
      success("Correctly returned 404 for unknown user");
    } else {
      fail("Unexpected error for invalid user ULID", err);
    }
  }
}

// ---------------------------------------------------------------------------
// updateBusinessReview Tests
// ---------------------------------------------------------------------------

async function testUpdateReview(reviewUlid) {
  console.log("\n=== Testing updateBusinessReview ===");

  if (!testBusinessUlid || !reviewUlid) {
    console.log("  Skipping - no test business or review available");
    return null;
  }

  try {
    const newContent = `Updated review content - ${Date.now()}. This content has been modified by the integration test.`;

    const updatedReview = await sdk.updateBusinessReview(
      testBusinessUlid,
      reviewUlid,
      {
        rating: 5,
        title: "Updated title!",
        content: newContent,
      }
    );

    if (!updatedReview) {
      fail("updateBusinessReview returned null");
      return null;
    }

    success(`Updated review: ${reviewUlid}`);
    log("Updated fields:", {
      rating: updatedReview.rating,
      title: updatedReview.title,
      content: updatedReview.content?.substring(0, 50) + "...",
    });

    // Verify updates
    if (updatedReview.rating !== 5) {
      fail(`Expected rating 5, got ${updatedReview.rating}`);
    } else {
      success("Rating updated correctly");
    }

    if (updatedReview.title !== "Updated title!") {
      fail(`Expected title "Updated title!", got "${updatedReview.title}"`);
    } else {
      success("Title updated correctly");
    }

    return updatedReview;
  } catch (err) {
    fail("updateBusinessReview failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// markBusinessReviewHelpful / NotHelpful Tests
// ---------------------------------------------------------------------------

async function testMarkReviewHelpful(reviewUlid) {
  console.log("\n=== Testing markBusinessReviewHelpful ===");

  if (!testBusinessUlid || !reviewUlid) {
    console.log("  Skipping - no test business or review available");
    return null;
  }

  try {
    const result = await sdk.markBusinessReviewHelpful(testBusinessUlid, reviewUlid);

    if (!result) {
      fail("markBusinessReviewHelpful returned null");
      return null;
    }

    success("Marked review as helpful");
    log("Updated counts:", {
      helpful_count: result.helpful_count,
      not_helpful_count: result.not_helpful_count,
      user_vote: result.user_vote,
    });

    if (typeof result.helpful_count !== "number") {
      fail("Response missing helpful_count");
    } else {
      success("Response has helpful_count");
    }

    if (result.user_vote !== "helpful") {
      fail(`Expected user_vote to be "helpful", got "${result.user_vote}"`);
    } else {
      success("user_vote is correctly set to helpful");
    }

    return result;
  } catch (err) {
    fail("markBusinessReviewHelpful failed", err);
    return null;
  }
}

async function testRemoveReviewHelpful(reviewUlid) {
  console.log("\n=== Testing removeBusinessReviewHelpful ===");

  if (!testBusinessUlid || !reviewUlid) {
    console.log("  Skipping - no test business or review available");
    return null;
  }

  try {
    const result = await sdk.removeBusinessReviewHelpful(testBusinessUlid, reviewUlid);

    if (!result) {
      fail("removeBusinessReviewHelpful returned null");
      return null;
    }

    success("Removed helpful vote from review");
    log("Updated counts:", {
      helpful_count: result.helpful_count,
      not_helpful_count: result.not_helpful_count,
      user_vote: result.user_vote,
    });

    if (result.user_vote !== null) {
      fail(`Expected user_vote to be null, got "${result.user_vote}"`);
    } else {
      success("user_vote is correctly null after removal");
    }

    return result;
  } catch (err) {
    fail("removeBusinessReviewHelpful failed", err);
    return null;
  }
}

async function testMarkReviewNotHelpful(reviewUlid) {
  console.log("\n=== Testing markBusinessReviewNotHelpful ===");

  if (!testBusinessUlid || !reviewUlid) {
    console.log("  Skipping - no test business or review available");
    return null;
  }

  try {
    const result = await sdk.markBusinessReviewNotHelpful(testBusinessUlid, reviewUlid);

    if (!result) {
      fail("markBusinessReviewNotHelpful returned null");
      return null;
    }

    success("Marked review as not helpful");
    log("Updated counts:", {
      helpful_count: result.helpful_count,
      not_helpful_count: result.not_helpful_count,
      user_vote: result.user_vote,
    });

    if (typeof result.not_helpful_count !== "number") {
      fail("Response missing not_helpful_count");
    } else {
      success("Response has not_helpful_count");
    }

    if (result.user_vote !== "not_helpful") {
      fail(`Expected user_vote to be "not_helpful", got "${result.user_vote}"`);
    } else {
      success("user_vote is correctly set to not_helpful");
    }

    return result;
  } catch (err) {
    fail("markBusinessReviewNotHelpful failed", err);
    return null;
  }
}

async function testRemoveReviewNotHelpful(reviewUlid) {
  console.log("\n=== Testing removeBusinessReviewNotHelpful ===");

  if (!testBusinessUlid || !reviewUlid) {
    console.log("  Skipping - no test business or review available");
    return null;
  }

  try {
    const result = await sdk.removeBusinessReviewNotHelpful(testBusinessUlid, reviewUlid);

    if (!result) {
      fail("removeBusinessReviewNotHelpful returned null");
      return null;
    }

    success("Removed not helpful vote from review");
    log("Updated counts:", {
      helpful_count: result.helpful_count,
      not_helpful_count: result.not_helpful_count,
      user_vote: result.user_vote,
    });

    if (result.user_vote !== null) {
      fail(`Expected user_vote to be null, got "${result.user_vote}"`);
    } else {
      success("user_vote is correctly null after removal");
    }

    return result;
  } catch (err) {
    fail("removeBusinessReviewNotHelpful failed", err);
    return null;
  }
}

async function testHelpfulVoteToggleWorkflow(reviewUlid) {
  console.log("\n=== Testing Helpful Vote Toggle Workflow ===");

  if (!testBusinessUlid || !reviewUlid) {
    console.log("  Skipping - no test business or review available");
    return;
  }

  try {
    // 1. Mark as helpful
    console.log("\n  Step 1: Mark as helpful");
    let result = await sdk.markBusinessReviewHelpful(testBusinessUlid, reviewUlid);
    if (result.user_vote !== "helpful") {
      fail("Failed to mark as helpful");
      return;
    }
    success(`Marked helpful - count: ${result.helpful_count}`);

    await delay(TEST_DELAY_MS);

    // 2. Try to mark as helpful again (should fail with 409)
    console.log("\n  Step 2: Try duplicate helpful vote");
    try {
      await sdk.markBusinessReviewHelpful(testBusinessUlid, reviewUlid);
      fail("Should have rejected duplicate helpful vote");
    } catch (err) {
      if (err.message?.includes("409") || err.message?.includes("already")) {
        success("Correctly rejected duplicate helpful vote");
      } else {
        fail("Unexpected error on duplicate vote", err);
      }
    }

    await delay(TEST_DELAY_MS);

    // 3. Switch to not helpful (should work)
    console.log("\n  Step 3: Switch to not helpful");
    result = await sdk.markBusinessReviewNotHelpful(testBusinessUlid, reviewUlid);
    if (result.user_vote !== "not_helpful") {
      fail("Failed to switch to not helpful");
      return;
    }
    success(`Switched to not helpful - helpful: ${result.helpful_count}, not_helpful: ${result.not_helpful_count}`);

    await delay(TEST_DELAY_MS);

    // 4. Remove not helpful vote
    console.log("\n  Step 4: Remove not helpful vote");
    result = await sdk.removeBusinessReviewNotHelpful(testBusinessUlid, reviewUlid);
    if (result.user_vote !== null) {
      fail("Failed to remove vote");
      return;
    }
    success(`Removed vote - helpful: ${result.helpful_count}, not_helpful: ${result.not_helpful_count}`);

    await delay(TEST_DELAY_MS);

    // 5. Verify userVote in review listing
    console.log("\n  Step 5: Verify userVote is null in listing");
    const reviews = await sdk.fetchBusinessReviews(testBusinessUlid);
    const review = reviews.reviews?.find(r => (r.id || r.ulid) === reviewUlid);
    if (review) {
      if (review.userVote === null || review.userVote === undefined) {
        success("userVote is correctly null/undefined in listing");
      } else {
        fail(`Expected userVote null, got "${review.userVote}"`);
      }
    }

    console.log("\n  ✓ Helpful vote toggle workflow completed!");
  } catch (err) {
    fail("Helpful vote toggle workflow failed", err);
    console.error("Full error:", err);
  }
}

// ---------------------------------------------------------------------------
// respondToBusinessReview Tests
// ---------------------------------------------------------------------------

async function testRespondToReview(reviewUlid) {
  console.log("\n=== Testing respondToBusinessReview ===");

  if (!testBusinessUlid || !reviewUlid) {
    console.log("  Skipping - no test business or review available");
    return null;
  }

  try {
    const responseText = `Thank you for your review! We appreciate your feedback. Response sent at ${Date.now()}.`;

    const updatedReview = await sdk.respondToBusinessReview(
      testBusinessUlid,
      reviewUlid,
      responseText
    );

    if (!updatedReview) {
      fail("respondToBusinessReview returned null");
      return null;
    }

    success("Added business response to review");
    log("Response details:", {
      businessResponse: updatedReview.businessResponse?.substring(0, 50) + "...",
      businessRespondedAt: updatedReview.businessRespondedAt,
      respondedBy: updatedReview.respondedBy,
    });

    if (!updatedReview.businessResponse) {
      fail("Response not saved to review");
    } else {
      success("Business response saved correctly");
    }

    return updatedReview;
  } catch (err) {
    // This may fail if the test user is not the business owner
    if (err.message?.includes("Unauthorized") || err.message?.includes("403")) {
      log("Note: respondToBusinessReview requires business owner permission");
      success("Correctly enforced owner-only access");
    } else {
      fail("respondToBusinessReview failed", err);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// deleteBusinessReview Tests
// ---------------------------------------------------------------------------

async function testDeleteReview(reviewUlid) {
  console.log("\n=== Testing deleteBusinessReview ===");

  if (!testBusinessUlid || !reviewUlid) {
    console.log("  Skipping - no test business or review available");
    return false;
  }

  try {
    await sdk.deleteBusinessReview(testBusinessUlid, reviewUlid);

    success(`Deleted review: ${reviewUlid}`);

    // Remove from tracking array
    const index = createdReviewUlids.indexOf(reviewUlid);
    if (index > -1) {
      createdReviewUlids.splice(index, 1);
    }

    return true;
  } catch (err) {
    fail("deleteBusinessReview failed", err);
    return false;
  }
}

async function testDeleteReviewVerifyGone(reviewUlid) {
  console.log("\n=== Testing deleteBusinessReview verification ===");

  if (!testBusinessUlid || !reviewUlid) {
    console.log("  Skipping - no test business or review available");
    return;
  }

  try {
    // Fetch all reviews and check if the deleted one is gone
    const response = await sdk.fetchBusinessReviews(testBusinessUlid);

    const found = response.reviews?.find(r => (r.id || r.ulid) === reviewUlid);

    if (!found) {
      success("Review correctly removed from list");
    } else {
      fail("Review still present after deletion");
    }
  } catch (err) {
    fail("Verification failed", err);
  }
}

// ---------------------------------------------------------------------------
// Full Review Lifecycle Test
// ---------------------------------------------------------------------------

async function testFullReviewLifecycle() {
  console.log("\n=== Testing Full Review Lifecycle ===");

  if (!testBusinessUlid) {
    console.log("  Skipping - no test business available");
    return;
  }

  let reviewUlid = null;

  try {
    // 1. CREATE
    console.log("\n  Step 1: Create review");
    const content = generateReviewContent();
    const review = await sdk.submitBusinessReview(testBusinessUlid, {
      rating: 3,
      title: "Lifecycle test review",
      content: content,
    });

    if (!review) {
      fail("Create step failed");
      return;
    }

    reviewUlid = review.id || review.ulid;
    createdReviewUlids.push(reviewUlid);
    success(`Created: ${reviewUlid}`);

    await delay(TEST_DELAY_MS);

    // 2. READ
    console.log("\n  Step 2: Read reviews");
    const readResponse = await sdk.fetchBusinessReviews(testBusinessUlid);
    const foundReview = readResponse.reviews?.find(r => (r.id || r.ulid) === reviewUlid);

    if (foundReview) {
      success("Found created review in list");
    } else {
      fail("Created review not found in list");
    }

    await delay(TEST_DELAY_MS);

    // 3. UPDATE
    console.log("\n  Step 3: Update review");
    const updatedReview = await sdk.updateBusinessReview(
      testBusinessUlid,
      reviewUlid,
      {
        rating: 4,
        title: "Updated lifecycle review",
      }
    );

    if (updatedReview && updatedReview.rating === 4) {
      success("Updated rating to 4");
    } else {
      fail("Update not applied");
    }

    await delay(TEST_DELAY_MS);

    // 4. HELPFUL VOTE
    console.log("\n  Step 4: Mark as helpful");
    const helpfulResult = await sdk.markBusinessReviewHelpful(testBusinessUlid, reviewUlid);

    if (helpfulResult && typeof helpfulResult.helpful_count === "number") {
      success(`Helpful count: ${helpfulResult.helpful_count}`);
    } else {
      fail("Helpful vote failed");
    }

    await delay(TEST_DELAY_MS);

    // 5. DELETE
    console.log("\n  Step 5: Delete review");
    await sdk.deleteBusinessReview(testBusinessUlid, reviewUlid);
    success("Deleted review");

    // Remove from tracking
    const index = createdReviewUlids.indexOf(reviewUlid);
    if (index > -1) {
      createdReviewUlids.splice(index, 1);
    }

    await delay(TEST_DELAY_MS);

    // 6. VERIFY DELETE
    console.log("\n  Step 6: Verify deletion");
    const verifyResponse = await sdk.fetchBusinessReviews(testBusinessUlid);
    const stillExists = verifyResponse.reviews?.find(r => (r.id || r.ulid) === reviewUlid);

    if (!stillExists) {
      success("Review correctly removed");
    } else {
      fail("Review still exists after deletion");
    }

    console.log("\n  ✓ Full review lifecycle completed successfully!");
  } catch (err) {
    // If we hit the duplicate review error, that's expected
    if (err.message?.includes("already reviewed")) {
      log("Note: User has already reviewed this business - lifecycle test skipped");
      success("Duplicate review prevention is working");
    } else {
      fail("Review lifecycle test failed", err);
      console.error("Full error:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  console.log("\n=== Cleanup ===");

  // Clean up any remaining reviews
  if (createdReviewUlids.length > 0 && testBusinessUlid) {
    console.log(`  Cleaning up ${createdReviewUlids.length} review(s)...`);

    for (const reviewUlid of [...createdReviewUlids]) {
      try {
        await sdk.deleteBusinessReview(testBusinessUlid, reviewUlid);
        success(`Deleted review: ${reviewUlid}`);
      } catch (err) {
        if (err.message?.includes("404") || err.message?.includes("not found")) {
          log(`Already deleted: ${reviewUlid}`);
        } else {
          fail(`Failed to delete review ${reviewUlid}`, err);
        }
      }
    }
  }

  // Clean up the test business
  if (testBusinessUlid) {
    console.log(`  Deleting test business: ${testBusinessUlid}...`);

    try {
      await sdk.deleteBusiness(testBusinessUlid);
      success(`Deleted business: ${testBusinessUlid}`);
    } catch (err) {
      if (err.message?.includes("404") || err.message?.includes("not found")) {
        log("Business already deleted");
      } else {
        fail(`Failed to delete business ${testBusinessUlid}`, err);
      }
    }
  }

  console.log("  Cleanup complete");
}

// ---------------------------------------------------------------------------
// Main Test Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║        Business Reviews SDK Integration Tests              ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\nAPI Base: ${API_BASE}`);
  console.log(`Test delay: ${TEST_DELAY_MS}ms between tests`);

  try {
    // Setup: Create test business
    const business = await setupTestBusiness();
    if (!business) {
      console.log("\n=== Setup failed - cannot continue tests ===");
      return;
    }
    await delay(TEST_DELAY_MS);

    // Test submitBusinessReview
    const createdReview = await testSubmitReview();
    const reviewUlid = createdReview?.id || createdReview?.ulid;
    await delay(TEST_DELAY_MS);

    // Test submitBusinessReview with photos (expect duplicate error)
    await testSubmitReviewWithPhotos();
    await delay(TEST_DELAY_MS);

    // Test fetchBusinessReviews
    await testFetchReviews();
    await delay(TEST_DELAY_MS);

    // Test fetchBusinessReviews with filters
    await testFetchReviewsWithFilters();
    await delay(TEST_DELAY_MS);

    // Test fetchMyReviews / fetchUserReviews — used by directory profile pages
    await testFetchMyReviews(reviewUlid);
    await delay(TEST_DELAY_MS);

    await testFetchUserReviews(reviewUlid);
    await delay(TEST_DELAY_MS);

    await testFetchUserReviewsUnknownUlid();
    await delay(TEST_DELAY_MS);

    // Test updateBusinessReview
    if (reviewUlid) {
      await testUpdateReview(reviewUlid);
      await delay(TEST_DELAY_MS);
    }

    // Test markBusinessReviewHelpful
    if (reviewUlid) {
      await testMarkReviewHelpful(reviewUlid);
      await delay(TEST_DELAY_MS);
    }

    // Test markBusinessReviewNotHelpful
    if (reviewUlid) {
      await testMarkReviewNotHelpful(reviewUlid);
      await delay(TEST_DELAY_MS);
    }

    // Test respondToBusinessReview (may fail if not owner)
    if (reviewUlid) {
      await testRespondToReview(reviewUlid);
      await delay(TEST_DELAY_MS);
    }

    // Test deleteBusinessReview
    if (reviewUlid) {
      const deleted = await testDeleteReview(reviewUlid);
      if (deleted) {
        await delay(TEST_DELAY_MS);
        await testDeleteReviewVerifyGone(reviewUlid);
      }
    }
    await delay(TEST_DELAY_MS);

    // Full lifecycle test (will create a new review if user hasn't reviewed yet)
    // Note: This may be skipped if user already has a review on this business
    await testFullReviewLifecycle();

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
  cleanup().finally(() => process.exit(1));
});
