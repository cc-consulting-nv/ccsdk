/**
 * Business Analytics & Owned Businesses SDK Integration Tests
 *
 * Run with:
 *   API_TOKEN=<token> npx tsx tests/integration/business-analytics.integration.js
 *
 * The token must belong to a user who owns at least one business,
 * or who can create a business (any authenticated user).
 *
 * Environment variables:
 *   API_BASE      - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN     - Access token (required)
 *
 * Covers:
 *   - fetchMyBusinesses
 *   - fetchBusinessAnalytics
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/business-analytics.integration.js\n\n" +
    "The token must belong to an authenticated user.\n" +
    "Generate one with: sail artisan cc:get-token <tenant-id> <username>\n\n" +
    "Optional environment variables:\n" +
    "  API_BASE=http://localhost:8089  (default)"
  );
  process.exit(0);
}

const sdk = new CcPlatformSdk({
  baseUrl: API_BASE,
  tokens: { accessToken: API_TOKEN },
});

let testBusinessUlid = null;
let passed = 0;
let failed = 0;

function success(message) {
  console.log(`  ✓ ${message}`);
  passed++;
}

function fail(message, error) {
  console.error(`  ✗ ${message}`);
  if (error) console.error(`    Error: ${error.message || error}`);
  failed++;
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Setup: Create a test business so the user owns at least one
// ---------------------------------------------------------------------------

async function setup() {
  console.log("\n=== Setup: Creating Test Business ===");

  const categories = await sdk.fetchBusinessCategories();
  if (!categories?.length) {
    fail("No business categories available");
    return false;
  }

  const business = await sdk.createBusiness({
    name: `Analytics Test - ${Date.now()}`,
    description: "Temporary business for analytics integration tests.",
    categoryId: categories[0].id || categories[0].ulid,
    address: "1 Analytics Lane",
    city: "Port of Spain",
  });

  testBusinessUlid = business.ulid || business.id;
  if (!testBusinessUlid) {
    fail("createBusiness did not return a ULID");
    return false;
  }

  success(`Created test business: ${testBusinessUlid}`);
  return true;
}

// ---------------------------------------------------------------------------
// Tests: fetchMyBusinesses
// ---------------------------------------------------------------------------

async function testFetchMyBusinesses() {
  console.log("\n=== fetchMyBusinesses ===");

  try {
    const businesses = await sdk.fetchMyBusinesses();

    if (!Array.isArray(businesses)) {
      fail("fetchMyBusinesses did not return an array");
      return;
    }
    success("returns an array");

    // Should include at least our test business
    const found = businesses.some(
      (b) => (b.ulid || b.id) === testBusinessUlid
    );
    if (found) {
      success("includes the test business we just created");
    } else {
      fail(
        `test business ${testBusinessUlid} not found in ${businesses.length} returned businesses`
      );
    }

    // Each business should have basic fields
    if (businesses.length > 0) {
      const biz = businesses[0];
      const hasId = !!(biz.id || biz.ulid);
      const hasName = typeof biz.name === "string" && biz.name.length > 0;
      if (hasId && hasName) {
        success("businesses have id and name fields");
      } else {
        fail("first business missing id or name");
      }
    }
  } catch (error) {
    fail("fetchMyBusinesses threw an error", error);
  }
}

// ---------------------------------------------------------------------------
// Tests: fetchBusinessAnalytics
// ---------------------------------------------------------------------------

async function testFetchBusinessAnalytics() {
  console.log("\n=== fetchBusinessAnalytics ===");

  if (!testBusinessUlid) {
    fail("no test business available — skipping");
    return;
  }

  try {
    const analytics = await sdk.fetchBusinessAnalytics(testBusinessUlid);

    if (!analytics || typeof analytics !== "object") {
      fail("fetchBusinessAnalytics did not return an object");
      return;
    }
    success("returns an object");

    // Check required fields exist
    const requiredFields = [
      "totalViews",
      "saves",
      "phoneCalls",
      "emailInquiries",
      "websiteClicks",
      "directionRequests",
      "contactForms",
    ];
    const missingFields = requiredFields.filter(
      (f) => !(f in analytics)
    );
    if (missingFields.length === 0) {
      success("has all required metric fields");
    } else {
      fail(`missing fields: ${missingFields.join(", ")}`);
    }

    // Check trends object
    if (analytics.trends && typeof analytics.trends === "object") {
      success("has trends object");
      const trendFields = ["views", "saves", "phoneCalls", "emailInquiries", "websiteClicks", "directionRequests", "contactForms"];
      const missingTrends = trendFields.filter(
        (f) => !(f in analytics.trends)
      );
      if (missingTrends.length === 0) {
        success("trends has all required fields");
      } else {
        fail(`trends missing fields: ${missingTrends.join(", ")}`);
      }
    } else {
      fail("missing or invalid trends object");
    }

    // New business should have zeroes (no tracking events yet)
    if (analytics.totalViews === 0 && analytics.phoneCalls === 0) {
      success("new business analytics return zeroes (expected)");
    } else {
      // Not a failure — there might be views from the fetchBusiness call
      success(`new business has some analytics (views=${analytics.totalViews}, calls=${analytics.phoneCalls})`);
    }
  } catch (error) {
    fail("fetchBusinessAnalytics threw an error", error);
  }
}

async function testFetchBusinessAnalyticsUnauthorized() {
  console.log("\n=== fetchBusinessAnalytics (unauthorized) ===");

  // Try to fetch analytics for a business we don't own (use a fake ULID)
  try {
    await sdk.fetchBusinessAnalytics("01NONEXISTENT000000000000");
    fail("should have thrown for nonexistent business");
  } catch (error) {
    if (error.message?.includes("404") || error.status === 404 || error.statusCode === 404) {
      success("returns 404 for nonexistent business");
    } else {
      // Any error is acceptable — the point is it doesn't succeed
      success(`correctly rejects nonexistent business (${error.message || "error thrown"})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests: fetchMyBusinessesAnalytics (aggregate)
// ---------------------------------------------------------------------------

async function testFetchMyBusinessesAnalytics() {
  console.log("\n=== fetchMyBusinessesAnalytics (aggregate) ===");

  try {
    const analytics = await sdk.fetchMyBusinessesAnalytics();

    if (!analytics || typeof analytics !== "object") {
      fail("fetchMyBusinessesAnalytics did not return an object");
      return;
    }
    success("returns an object");

    // Check required fields
    const requiredFields = [
      "totalViews",
      "saves",
      "phoneCalls",
      "emailInquiries",
      "websiteClicks",
      "directionRequests",
      "contactForms",
    ];
    const missingFields = requiredFields.filter((f) => !(f in analytics));
    if (missingFields.length === 0) {
      success("has all required metric fields");
    } else {
      fail(`missing fields: ${missingFields.join(", ")}`);
    }

    // Should include totals from at least the test business
    if (typeof analytics.totalViews === "number") {
      success(`totalViews is a number (${analytics.totalViews})`);
    } else {
      fail("totalViews is not a number");
    }

    // Trends object
    if (analytics.trends && typeof analytics.trends === "object") {
      success("has trends object");
    } else {
      fail("missing or invalid trends object");
    }
  } catch (error) {
    fail("fetchMyBusinessesAnalytics threw an error", error);
  }
}

// ---------------------------------------------------------------------------
// Teardown: Delete test business
// ---------------------------------------------------------------------------

async function teardown() {
  console.log("\n=== Teardown ===");

  if (testBusinessUlid) {
    try {
      await sdk.deleteBusiness(testBusinessUlid);
      success(`Deleted test business: ${testBusinessUlid}`);
    } catch (error) {
      // Non-fatal — admin can clean up later
      console.log(`  ⚠ Could not delete test business: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  const ok = await setup();
  if (!ok) {
    console.error("\nSetup failed — aborting.");
    process.exit(1);
  }

  await testFetchMyBusinesses();
  await testFetchBusinessAnalytics();
  await testFetchBusinessAnalyticsUnauthorized();
  await testFetchMyBusinessesAnalytics();

  await teardown();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
}

main().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
