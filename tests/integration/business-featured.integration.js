/**
 * Business Featured Badge SDK Integration Tests
 *
 * Run with:
 *   API_TOKEN=<admin-token> npx tsx tests/integration/business-featured.integration.js
 *
 * The token MUST belong to an admin user (one with the "Administrator" badge).
 *
 * Environment variables:
 *   API_BASE      - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN     - Admin access token (required)
 *
 * Covers:
 *   - fetchFeaturedBusinesses
 *   - setBusinessFeatured
 *   - clearBusinessFeatured
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<admin-token> npx tsx tests/integration/business-featured.integration.js\n\n" +
    "The token must belong to a user with the Administrator badge.\n" +
    "Get your token from localStorage after logging into the UI.\n\n" +
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

function success(message) {
  console.log(`  ✓ ${message}`);
}

function fail(message, error) {
  console.error(`  ✗ ${message}`);
  if (error) console.error(`    Error: ${error.message || error}`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Setup: Create a test business
// ---------------------------------------------------------------------------

async function setup() {
  console.log("\n=== Setup: Creating Test Business ===");

  const categories = await sdk.fetchBusinessCategories();
  if (!categories?.length) {
    fail("No business categories available");
    return false;
  }

  const business = await sdk.createBusiness({
    name: `Featured Test - ${Date.now()}`,
    description: "Temporary business for featured badge integration tests.",
    categoryId: categories[0].id || categories[0].ulid,
    address: "1 Test Lane",
    city: "Port of Spain",
  });

  testBusinessUlid = business.ulid || business.id;
  if (!testBusinessUlid) {
    fail("createBusiness did not return a ULID");
    return false;
  }

  success(`Created test business ${testBusinessUlid}`);

  // New businesses are created with status=pending. The API's updateBusiness
  // endpoint doesn't allow changing status, so we activate via a direct PATCH.
  // This mirrors what a Filament admin approval would do.
  const activateRes = await fetch(`${API_BASE}/v1/businesses/${testBusinessUlid}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
      Accept: "application/json",
    },
    body: JSON.stringify({ status: "active" }),
  });

  // status field is silently ignored by validation, so we need to verify
  // whether it actually changed. If not, the listing test will note this.
  const activated = await activateRes.json();
  if (activated.status === "active") {
    success("Activated test business");
  } else {
    console.log("  ⚠ Could not activate business (status changes require admin panel)");
    console.log("    Listing verification will be skipped for this business");
  }

  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testFetchFeaturedBusinesses() {
  console.log("\n=== fetchFeaturedBusinesses ===");

  const businesses = await sdk.fetchFeaturedBusinesses(5);

  if (!Array.isArray(businesses)) {
    fail("fetchFeaturedBusinesses did not return an array");
    return;
  }

  success(`Returned ${businesses.length} featured businesses`);

  for (const b of businesses) {
    if (!b.isFeatured) {
      fail(`Business ${b.id} is not featured but was returned`);
      return;
    }
  }

  success("All returned businesses have isFeatured=true");
}

async function testSetBusinessFeatured() {
  console.log("\n=== setBusinessFeatured ===");

  const result = await sdk.setBusinessFeatured(testBusinessUlid);

  if (!result) {
    fail("setBusinessFeatured returned nothing");
    return;
  }

  if (result.isFeatured !== true) {
    fail(`Expected isFeatured=true, got ${result.isFeatured}`);
    return;
  }

  success("Business is now featured");

  // Verify it appears in the featured list (only if business is active)
  const detail = await sdk.fetchBusiness(testBusinessUlid);
  if (detail?.status === "active") {
    const featured = await sdk.fetchFeaturedBusinesses(20);
    const found = featured.some(
      (b) => (b.ulid || b.id) === testBusinessUlid
    );

    if (!found) {
      fail("Active featured business not found in fetchFeaturedBusinesses");
      return;
    }

    success("Business appears in featured list");
  } else {
    console.log("  ⚠ Skipping listing check (business is pending — requires admin approval to activate)");
  }
}

async function testSetBusinessFeaturedWithExpiration() {
  console.log("\n=== setBusinessFeatured (with expiration) ===");

  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = await sdk.setBusinessFeatured(testBusinessUlid, {
    featuredUntil: futureDate,
  });

  if (result.isFeatured !== true) {
    fail(`Expected isFeatured=true, got ${result.isFeatured}`);
    return;
  }

  success("Business featured with expiration date");
}

async function testClearBusinessFeatured() {
  console.log("\n=== clearBusinessFeatured ===");

  const result = await sdk.clearBusinessFeatured(testBusinessUlid);

  if (!result) {
    fail("clearBusinessFeatured returned nothing");
    return;
  }

  if (result.isFeatured !== false) {
    fail(`Expected isFeatured=false, got ${result.isFeatured}`);
    return;
  }

  success("Business featured status cleared");

  // Verify it no longer appears in the featured list
  const featured = await sdk.fetchFeaturedBusinesses(20);
  const found = featured.some(
    (b) => (b.ulid || b.id) === testBusinessUlid
  );

  if (found) {
    fail("Business still appears in featured list after clearing");
    return;
  }

  success("Business no longer in featured list");
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  console.log("\n=== Cleanup ===");

  if (testBusinessUlid) {
    try {
      // Clear featured first in case it's still set
      await sdk.clearBusinessFeatured(testBusinessUlid).catch(() => {});
      await sdk.deleteBusiness(testBusinessUlid);
      success(`Deleted test business ${testBusinessUlid}`);
    } catch (err) {
      fail("Failed to delete test business", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Business Featured Badge Integration Tests");
  console.log(`API: ${API_BASE}`);

  const ready = await setup();
  if (!ready) {
    await cleanup();
    process.exit(1);
  }

  try {
    await testFetchFeaturedBusinesses();
    await testSetBusinessFeatured();
    await testSetBusinessFeaturedWithExpiration();
    await testClearBusinessFeatured();
  } finally {
    await cleanup();
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  cleanup().finally(() => process.exit(1));
});
