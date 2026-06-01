/**
 * Event Favorites SDK Integration Tests
 *
 * Run with:
 *   API_TOKEN=<token> npx tsx tests/integration/event-favorites.integration.js
 *
 * Environment variables:
 *   API_BASE    - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN   - Access token (required)
 *
 * Covers:
 *   - saveEventFavorite (idempotent save)
 *   - checkEventFavorite (true after save, false after remove)
 *   - removeEventFavorite (no-op on unsaved, removes on saved)
 *   - fetchMyEventFavorites (list includes/excludes correctly)
 */

import "fake-indexeddb/auto";
import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/event-favorites.integration.js\n\n" +
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
let testEventUlid = null;
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
// Setup
// ---------------------------------------------------------------------------

async function setup() {
  console.log("\n=== Setup: Creating Test Business + Event ===");

  const categories = await sdk.fetchBusinessCategories();
  if (!categories?.length) {
    fail("No business categories available");
    return false;
  }

  const business = await sdk.createBusiness({
    name: `Favorites Test - ${Date.now()}`,
    description: "Temporary business for event favorites integration tests.",
    categoryId: categories[0].id || categories[0].ulid,
    address: "1 Favorites Lane",
    city: "Port of Spain",
  });

  testBusinessUlid = business.ulid || business.id;
  if (!testBusinessUlid) {
    fail("createBusiness did not return a ULID");
    return false;
  }
  success(`Created test business: ${testBusinessUlid}`);

  const event = await sdk.createBusinessEvent({
    businessId: testBusinessUlid,
    title: "Favorites Integration Test Event",
    description: "An event used by the event favorites integration test suite.",
    category: "community",
    startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    isFree: true,
  });

  testEventUlid = event.ulid || event.id;
  if (!testEventUlid) {
    fail("createBusinessEvent did not return a ULID");
    return false;
  }
  success(`Created test event: ${testEventUlid}`);
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testCheckBeforeSaving() {
  console.log("\n=== checkEventFavorite (before saving) ===");
  try {
    const result = await sdk.checkEventFavorite(testEventUlid);
    if (result.favorited === false) {
      success("returns favorited: false before saving");
    } else {
      fail(`expected favorited: false, got: ${result.favorited}`);
    }
  } catch (error) {
    fail("checkEventFavorite threw an error", error);
  }
}

async function testSaveEventFavorite() {
  console.log("\n=== saveEventFavorite ===");
  try {
    const result = await sdk.saveEventFavorite(testEventUlid);
    if (result.favorited === true) {
      success("returns favorited: true after saving");
    } else {
      fail(`expected favorited: true, got: ${result.favorited}`);
    }
  } catch (error) {
    fail("saveEventFavorite threw an error", error);
  }
}

async function testCheckAfterSaving() {
  console.log("\n=== checkEventFavorite (after saving) ===");
  try {
    const result = await sdk.checkEventFavorite(testEventUlid);
    if (result.favorited === true) {
      success("returns favorited: true after saving");
    } else {
      fail(`expected favorited: true, got: ${result.favorited}`);
    }
  } catch (error) {
    fail("checkEventFavorite threw an error", error);
  }
}

async function testSaveIsIdempotent() {
  console.log("\n=== saveEventFavorite (idempotent) ===");
  try {
    await sdk.saveEventFavorite(testEventUlid);
    const result = await sdk.saveEventFavorite(testEventUlid);
    if (result.favorited === true) {
      success("second save still returns favorited: true");
    } else {
      fail(`expected favorited: true, got: ${result.favorited}`);
    }
  } catch (error) {
    fail("duplicate saveEventFavorite threw an error", error);
  }
}

async function testFetchMyEventFavorites() {
  console.log("\n=== fetchMyEventFavorites ===");
  try {
    const result = await sdk.fetchMyEventFavorites();

    if (!Array.isArray(result.eventIds)) {
      fail("response does not have an eventIds array");
      return;
    }
    success("response has eventIds array");

    const found = result.eventIds.some(
      (id) => id.toLowerCase() === testEventUlid.toLowerCase()
    );
    if (found) {
      success("saved event appears in fetchMyEventFavorites");
    } else {
      fail(`event ${testEventUlid} not found in eventIds: [${result.eventIds.join(", ")}]`);
    }
  } catch (error) {
    fail("fetchMyEventFavorites threw an error", error);
  }
}

async function testRemoveEventFavorite() {
  console.log("\n=== removeEventFavorite ===");
  try {
    await sdk.removeEventFavorite(testEventUlid);
    success("removeEventFavorite completed without error");

    const result = await sdk.checkEventFavorite(testEventUlid);
    if (result.favorited === false) {
      success("checkEventFavorite returns favorited: false after removal");
    } else {
      fail(`expected favorited: false after removal, got: ${result.favorited}`);
    }
  } catch (error) {
    fail("removeEventFavorite threw an error", error);
  }
}

async function testRemoveIsIdempotent() {
  console.log("\n=== removeEventFavorite (no-op when not saved) ===");
  try {
    // Event is already removed from the previous test
    await sdk.removeEventFavorite(testEventUlid);
    success("removeEventFavorite on an unsaved event is a no-op");
  } catch (error) {
    fail("removeEventFavorite on unsaved event threw an error", error);
  }
}

async function testFetchMyFavoritesAfterRemoval() {
  console.log("\n=== fetchMyEventFavorites (after removal) ===");
  try {
    const result = await sdk.fetchMyEventFavorites();
    const found = result.eventIds.some(
      (id) => id.toLowerCase() === testEventUlid.toLowerCase()
    );
    if (!found) {
      success("removed event no longer appears in fetchMyEventFavorites");
    } else {
      fail("removed event still appears in fetchMyEventFavorites");
    }
  } catch (error) {
    fail("fetchMyEventFavorites threw an error", error);
  }
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

async function teardown() {
  console.log("\n=== Teardown ===");

  if (testEventUlid) {
    try {
      await sdk.deleteBusinessEvent(testEventUlid);
      success(`Deleted test event: ${testEventUlid}`);
    } catch (error) {
      console.log(`  ⚠ Could not delete test event: ${error.message}`);
    }
  }

  if (testBusinessUlid) {
    try {
      await sdk.deleteBusiness(testBusinessUlid);
      success(`Deleted test business: ${testBusinessUlid}`);
    } catch (error) {
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

  await testCheckBeforeSaving();
  await testSaveEventFavorite();
  await testCheckAfterSaving();
  await testSaveIsIdempotent();
  await testFetchMyEventFavorites();
  await testRemoveEventFavorite();
  await testRemoveIsIdempotent();
  await testFetchMyFavoritesAfterRemoval();

  await teardown();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
}

main().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
