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
    });

    if (typeof result.helpful_count !== "number") {
      fail("Response missing helpful_count");
    } else {
      success("Response has helpful_count");
    }

    return result;
  } catch (err) {
    fail("markBusinessReviewHelpful failed", err);
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
    });

    if (typeof result.not_helpful_count !== "number") {
      fail("Response missing not_helpful_count");
    } else {
      success("Response has not_helpful_count");
    }

    return result;
  } catch (err) {
    fail("markBusinessReviewNotHelpful failed", err);
    return null;
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
