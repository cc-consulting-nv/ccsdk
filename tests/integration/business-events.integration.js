/**
 * Business Event CRUD SDK Integration Tests
 *
 * Run with:
 *   API_TOKEN=<token> npx tsx tests/integration/business-events.integration.js
 *
 * The token must belong to a user who owns at least one business,
 * or who can create a business (any authenticated user).
 *
 * Environment variables:
 *   API_BASE      - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN     - Access token (required)
 *
 * Covers:
 *   - createBusinessEvent
 *   - fetchBusinessEvents (with businessId filter)
 *   - fetchBusinessEvent
 *   - updateBusinessEvent
 *   - deleteBusinessEvent
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/business-events.integration.js\n\n" +
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
// Setup: Create a test business so the user owns one
// ---------------------------------------------------------------------------

async function setup() {
  console.log("\n=== Setup: Creating Test Business ===");

  const categories = await sdk.fetchBusinessCategories();
  if (!categories?.length) {
    fail("No business categories available");
    return false;
  }

  const business = await sdk.createBusiness({
    name: `Event Test - ${Date.now()}`,
    description: "Temporary business for event CRUD integration tests.",
    categoryId: categories[0].id || categories[0].ulid,
    address: "1 Event Lane",
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
// Tests: createBusinessEvent
// ---------------------------------------------------------------------------

async function testCreateBusinessEvent() {
  console.log("\n=== createBusinessEvent ===");

  try {
    const event = await sdk.createBusinessEvent({
      businessId: testBusinessUlid,
      title: "Integration Test Event",
      description: "An event created by the integration test suite.",
      category: "community",
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString(),
      venueName: "Test Venue",
      address: "123 Test Street",
      city: "Port of Spain",
      isFree: true,
    });

    if (!event) {
      fail("createBusinessEvent returned null/undefined");
      return;
    }
    success("returned an event object");

    testEventUlid = event.ulid || event.id;
    if (!testEventUlid) {
      fail("event does not have an id/ulid");
      return;
    }
    success(`event has ULID: ${testEventUlid}`);

    if (event.title === "Integration Test Event") {
      success("title matches");
    } else {
      fail(`title mismatch: expected 'Integration Test Event', got '${event.title}'`);
    }

    if (event.category === "community") {
      success("category matches");
    } else {
      fail(`category mismatch: expected 'community', got '${event.category}'`);
    }

    if (event.businessId === testBusinessUlid) {
      success("businessId matches the owning business");
    } else {
      fail(`businessId mismatch: expected '${testBusinessUlid}', got '${event.businessId}'`);
    }
  } catch (error) {
    fail("createBusinessEvent threw an error", error);
  }
}

// ---------------------------------------------------------------------------
// Tests: fetchBusinessEvent (single)
// ---------------------------------------------------------------------------

async function testFetchBusinessEvent() {
  console.log("\n=== fetchBusinessEvent ===");

  if (!testEventUlid) {
    fail("no test event available — skipping");
    return;
  }

  try {
    const event = await sdk.fetchBusinessEvent(testEventUlid);

    if (!event) {
      fail("fetchBusinessEvent returned null");
      return;
    }
    success("returned an event");

    if (event.title === "Integration Test Event") {
      success("title matches created event");
    } else {
      fail(`title mismatch: got '${event.title}'`);
    }
  } catch (error) {
    fail("fetchBusinessEvent threw an error", error);
  }
}

// ---------------------------------------------------------------------------
// Tests: fetchBusinessEvents (with businessId filter)
// ---------------------------------------------------------------------------

async function testFetchBusinessEventsWithFilter() {
  console.log("\n=== fetchBusinessEvents (businessId filter) ===");

  if (!testBusinessUlid || !testEventUlid) {
    fail("no test business/event available — skipping");
    return;
  }

  try {
    const result = await sdk.fetchBusinessEvents({
      businessId: testBusinessUlid,
    });

    if (!result || !Array.isArray(result.events)) {
      fail("did not return { events: [...] } shape");
      return;
    }
    success("returns paginated event list");

    const found = result.events.some(
      (e) => (e.ulid || e.id) === testEventUlid
    );
    if (found) {
      success("includes the event we created");
    } else {
      fail(`test event ${testEventUlid} not found in ${result.events.length} results`);
    }

    if (typeof result.hasMore === "boolean") {
      success("hasMore is a boolean");
    } else {
      fail("hasMore is not a boolean");
    }
  } catch (error) {
    fail("fetchBusinessEvents threw an error", error);
  }
}

// ---------------------------------------------------------------------------
// Tests: updateBusinessEvent
// ---------------------------------------------------------------------------

async function testUpdateBusinessEvent() {
  console.log("\n=== updateBusinessEvent ===");

  if (!testEventUlid) {
    fail("no test event available — skipping");
    return;
  }

  try {
    const updated = await sdk.updateBusinessEvent(testEventUlid, {
      title: "Updated Integration Event",
      description: "Updated description from integration test.",
      venueName: "Updated Venue",
    });

    if (!updated) {
      fail("updateBusinessEvent returned null/undefined");
      return;
    }
    success("returned an event object");

    if (updated.title === "Updated Integration Event") {
      success("title updated correctly");
    } else {
      fail(`title not updated: got '${updated.title}'`);
    }

    // Verify via fetch
    const refetched = await sdk.fetchBusinessEvent(testEventUlid);
    if (refetched?.title === "Updated Integration Event") {
      success("refetch confirms title update persisted");
    } else {
      fail(`refetch shows different title: '${refetched?.title}'`);
    }
  } catch (error) {
    fail("updateBusinessEvent threw an error", error);
  }
}

// ---------------------------------------------------------------------------
// Tests: deleteBusinessEvent
// ---------------------------------------------------------------------------

async function testDeleteBusinessEvent() {
  console.log("\n=== deleteBusinessEvent ===");

  if (!testEventUlid) {
    fail("no test event available — skipping");
    return;
  }

  try {
    await sdk.deleteBusinessEvent(testEventUlid);
    success("deleteBusinessEvent completed without error");

    // Verify deletion
    try {
      await sdk.fetchBusinessEvent(testEventUlid);
      fail("event still accessible after deletion");
    } catch {
      success("event no longer accessible after deletion (expected)");
    }

    testEventUlid = null; // Clear so teardown doesn't try to delete again
  } catch (error) {
    fail("deleteBusinessEvent threw an error", error);
  }
}

// ---------------------------------------------------------------------------
// Teardown: Clean up test data
// ---------------------------------------------------------------------------

async function teardown() {
  console.log("\n=== Teardown ===");

  // Delete event if it wasn't deleted in tests
  if (testEventUlid) {
    try {
      await sdk.deleteBusinessEvent(testEventUlid);
      success(`Deleted test event: ${testEventUlid}`);
    } catch (error) {
      console.log(`  ⚠ Could not delete test event: ${error.message}`);
    }
  }

  // Delete test business
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

  await testCreateBusinessEvent();
  await testFetchBusinessEvent();
  await testFetchBusinessEventsWithFilter();
  await testUpdateBusinessEvent();
  await testDeleteBusinessEvent();

  await teardown();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
}

main().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
