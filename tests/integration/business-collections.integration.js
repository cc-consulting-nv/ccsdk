/**
 * Business Collections (Favorites) SDK Integration Tests
 *
 * Run with:
 *   API_TOKEN=<your-token> npx tsx tests/integration/business-collections.integration.js
 *
 * Get a token by logging in via the UI and grabbing the access_token from localStorage.
 *
 * Environment variables:
 *   API_BASE      - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN     - Access token for authentication (required)
 *
 * Covers:
 *   - fetchBusinessCollections (auto-seeds default Favorites)
 *   - createBusinessCollection (custom + isPublic flag)
 *   - updateBusinessCollection (rename, toggle isPublic)
 *   - addBusinessToCollection / removeBusinessFromCollection (idempotent re-add)
 *   - fetchUserBusinessCollections (public read of own ULID)
 *   - deleteBusinessCollection (refuses default, allows custom)
 *   - createBusiness / deleteBusiness (setup + cleanup)
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/business-collections.integration.js\n\n" +
    "Get your token from localStorage after logging into the UI:\n" +
    "  1. Open browser DevTools\n" +
    "  2. Go to Application > Local Storage\n" +
    "  3. Copy the access_token value\n\n" +
    "Optional environment variables:\n" +
    "  API_BASE=http://localhost:8089  (default)"
  );
  process.exit(0);
}

const sdk = new CcPlatformSdk({
  baseUrl: API_BASE,
  tokens: { accessToken: API_TOKEN },
  writeReadDelay: 2000,
});

// Track resources for cleanup
let testBusinessUlid = null;
const createdCollectionIds = [];

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TEST_DELAY_MS = 2000;

function uniqueLabel(prefix) {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function setupTestBusiness() {
  console.log("\n=== Setup: Creating test business ===");

  try {
    const categories = await sdk.fetchBusinessCategories();
    if (!categories?.length) {
      fail("No business categories available");
      return null;
    }

    const business = await sdk.createBusiness({
      name: uniqueLabel("Test Collection Biz"),
      description: "Test business for collection integration tests.",
      categoryId: categories[0].id || categories[0].ulid,
      address: "1 Test Lane",
      city: "Port of Spain",
      region: "Port of Spain",
    });

    testBusinessUlid = business?.id || business?.ulid;
    if (!testBusinessUlid) {
      fail("Created business has no id/ulid", { keys: business && Object.keys(business) });
      return null;
    }
    success(`Created test business: ${testBusinessUlid}`);
    return business;
  } catch (err) {
    fail("Failed to create test business", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// fetchBusinessCollections
// ---------------------------------------------------------------------------

async function testFetchSeedsDefault() {
  console.log("\n=== Testing fetchBusinessCollections seeds default Favorites ===");

  try {
    const collections = await sdk.fetchBusinessCollections();
    if (!Array.isArray(collections)) {
      fail("fetchBusinessCollections did not return an array", { collections });
      return null;
    }

    const defaults = collections.filter((c) => c.isDefault);
    if (defaults.length === 1) {
      success(`Default collection present: "${defaults[0].name}"`);
    } else if (defaults.length === 0) {
      fail("No default collection — expected lazy seed to create one");
    } else {
      fail(`Expected exactly 1 default collection, got ${defaults.length}`);
    }

    log("Returned collections:", collections.map((c) => ({
      id: c.id,
      name: c.name,
      isDefault: c.isDefault,
      isPublic: c.isPublic,
      businessCount: c.businessCount,
    })));

    return collections;
  } catch (err) {
    fail("fetchBusinessCollections failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// createBusinessCollection
// ---------------------------------------------------------------------------

async function testCreatePublicCollection() {
  console.log("\n=== Testing createBusinessCollection (public) ===");

  try {
    const collection = await sdk.createBusinessCollection({
      name: uniqueLabel("Public Picks"),
      description: "Public collection for integration test",
      icon: "folder",
      color: "text-blue-500",
      isPublic: true,
    });

    if (!collection?.id) {
      fail("createBusinessCollection returned no id", { collection });
      return null;
    }
    createdCollectionIds.push(collection.id);

    if (collection.isPublic !== true) {
      fail(`Expected isPublic=true, got ${collection.isPublic}`);
    } else {
      success(`Created public collection: ${collection.id}`);
    }
    if (collection.isDefault !== false) {
      fail(`New collection should not be default, got isDefault=${collection.isDefault}`);
    }

    return collection;
  } catch (err) {
    fail("createBusinessCollection (public) failed", err);
    return null;
  }
}

async function testCreatePrivateCollection() {
  console.log("\n=== Testing createBusinessCollection (private) ===");

  try {
    const collection = await sdk.createBusinessCollection({
      name: uniqueLabel("Private Stash"),
      isPublic: false,
    });

    if (!collection?.id) {
      fail("createBusinessCollection returned no id", { collection });
      return null;
    }
    createdCollectionIds.push(collection.id);

    if (collection.isPublic !== false) {
      fail(`Expected isPublic=false, got ${collection.isPublic}`);
    } else {
      success(`Created private collection: ${collection.id}`);
    }

    return collection;
  } catch (err) {
    fail("createBusinessCollection (private) failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// updateBusinessCollection
// ---------------------------------------------------------------------------

async function testUpdateCollection(collectionId) {
  console.log("\n=== Testing updateBusinessCollection ===");

  if (!collectionId) {
    console.log("  Skipping - no collection available");
    return null;
  }

  try {
    const newName = uniqueLabel("Renamed");
    const updated = await sdk.updateBusinessCollection(collectionId, {
      name: newName,
      isPublic: false,
    });

    if (updated?.name !== newName) {
      fail(`Expected name="${newName}", got "${updated?.name}"`);
    } else {
      success("Renamed collection successfully");
    }
    if (updated?.isPublic !== false) {
      fail(`Expected isPublic=false after update, got ${updated?.isPublic}`);
    } else {
      success("Toggled isPublic=false successfully");
    }
    return updated;
  } catch (err) {
    fail("updateBusinessCollection failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// add/remove business in collection
// ---------------------------------------------------------------------------

async function testAddRemoveBusiness(collectionId) {
  console.log("\n=== Testing addBusinessToCollection / removeBusinessFromCollection ===");

  if (!collectionId || !testBusinessUlid) {
    console.log("  Skipping - missing collection or business");
    return;
  }

  try {
    await sdk.addBusinessToCollection(collectionId, testBusinessUlid);
    success("Added business to collection");

    await delay(TEST_DELAY_MS);

    // Re-add should be idempotent
    await sdk.addBusinessToCollection(collectionId, testBusinessUlid);
    success("Re-add did not throw (idempotent)");

    await delay(TEST_DELAY_MS);

    // Verify via fetch
    const collections = await sdk.fetchBusinessCollections();
    const target = collections.find((c) => c.id === collectionId);
    if (!target) {
      fail("Collection missing from /me list after add");
    } else if (target.businessCount !== 1) {
      fail(`Expected businessCount=1 after idempotent re-add, got ${target.businessCount}`);
    } else {
      success("businessCount=1 after idempotent re-add");
    }

    await delay(TEST_DELAY_MS);

    await sdk.removeBusinessFromCollection(collectionId, testBusinessUlid);
    success("Removed business from collection");

    await delay(TEST_DELAY_MS);

    const after = await sdk.fetchBusinessCollections();
    const targetAfter = after.find((c) => c.id === collectionId);
    if (targetAfter && targetAfter.businessCount !== 0) {
      fail(`Expected businessCount=0 after remove, got ${targetAfter.businessCount}`);
    } else {
      success("businessCount=0 after remove");
    }
  } catch (err) {
    fail("add/remove business workflow failed", err);
  }
}

// ---------------------------------------------------------------------------
// fetchUserBusinessCollections (public view)
// ---------------------------------------------------------------------------

async function testFetchUserBusinessCollections(privateCollectionId) {
  console.log("\n=== Testing fetchUserBusinessCollections (public view) ===");

  try {
    const me = await sdk.getCurrentUser();
    const userUlid = me?.ulid || me?.id;
    if (!userUlid) {
      fail("Could not resolve current user ULID", { me });
      return;
    }

    const publicCollections = await sdk.fetchUserBusinessCollections(userUlid);
    if (!Array.isArray(publicCollections)) {
      fail("fetchUserBusinessCollections did not return an array");
      return;
    }
    success(`Fetched ${publicCollections.length} public collection(s) for self via public route`);

    // Every returned collection should be public
    const leaked = publicCollections.find((c) => c.isPublic === false);
    if (leaked) {
      fail(`Public route leaked a private collection: ${leaked.id} "${leaked.name}"`);
    } else {
      success("Public route returns only public collections");
    }

    // The private one we created (or updated to private) must NOT appear
    if (privateCollectionId) {
      const found = publicCollections.find((c) => c.id === privateCollectionId);
      if (found) {
        fail(`Private collection ${privateCollectionId} was visible via public route`);
      } else {
        success("Private collection correctly hidden from public route");
      }
    }
  } catch (err) {
    fail("fetchUserBusinessCollections failed", err);
  }
}

async function testFetchUserBusinessCollectionsBogus() {
  console.log("\n=== Testing fetchUserBusinessCollections with bogus ULID (404) ===");

  try {
    await sdk.fetchUserBusinessCollections("01H000000000000000000NOPE00");
    fail("Expected 404 but call succeeded");
  } catch (err) {
    const msg = (err.message || "").toLowerCase();
    if (msg.includes("404") || msg.includes("not found")) {
      success("Correctly returned 404 for unknown user");
    } else {
      fail("Unexpected error for bogus user ULID", err);
    }
  }
}

// ---------------------------------------------------------------------------
// deleteBusinessCollection
// ---------------------------------------------------------------------------

async function testDeleteDefaultRefused() {
  console.log("\n=== Testing deleteBusinessCollection refuses default ===");

  try {
    const collections = await sdk.fetchBusinessCollections();
    const def = collections.find((c) => c.isDefault);
    if (!def) {
      fail("No default collection found to test against");
      return;
    }

    try {
      await sdk.deleteBusinessCollection(def.id);
      fail("Default collection was deleted — should have been refused");
    } catch (err) {
      const msg = (err.message || "").toLowerCase();
      if (msg.includes("403") || msg.includes("forbidden") || msg.includes("default")) {
        success("Default collection correctly protected from deletion");
      } else {
        fail("Unexpected error when deleting default", err);
      }
    }

    // Verify still present
    const after = await sdk.fetchBusinessCollections();
    const stillThere = after.find((c) => c.id === def.id);
    if (stillThere) {
      success("Default collection still present after refused delete");
    } else {
      fail("Default collection disappeared!");
    }
  } catch (err) {
    fail("Default-deletion test setup failed", err);
  }
}

async function testDeleteCustomCollection(collectionId) {
  console.log("\n=== Testing deleteBusinessCollection (custom) ===");

  if (!collectionId) {
    console.log("  Skipping - no collection available");
    return;
  }

  try {
    await sdk.deleteBusinessCollection(collectionId);
    success(`Deleted custom collection: ${collectionId}`);

    const idx = createdCollectionIds.indexOf(collectionId);
    if (idx > -1) createdCollectionIds.splice(idx, 1);

    const after = await sdk.fetchBusinessCollections();
    const stillThere = after.find((c) => c.id === collectionId);
    if (stillThere) {
      fail("Deleted collection still present in listing");
    } else {
      success("Deleted collection removed from listing");
    }
  } catch (err) {
    fail("deleteBusinessCollection failed", err);
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  console.log("\n=== Cleanup ===");

  for (const id of [...createdCollectionIds]) {
    try {
      await sdk.deleteBusinessCollection(id);
      success(`Deleted collection: ${id}`);
    } catch (err) {
      if (err.message?.includes("404")) {
        log(`Already deleted: ${id}`);
      } else {
        fail(`Failed to delete collection ${id}`, err);
      }
    }
  }

  if (testBusinessUlid) {
    try {
      await sdk.deleteBusiness(testBusinessUlid);
      success(`Deleted test business: ${testBusinessUlid}`);
    } catch (err) {
      if (err.message?.includes("404")) {
        log("Test business already deleted");
      } else {
        fail(`Failed to delete test business`, err);
      }
    }
  }

  console.log("  Cleanup complete");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║      Business Collections SDK Integration Tests            ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\nAPI Base: ${API_BASE}`);

  try {
    const business = await setupTestBusiness();
    if (!business) {
      console.log("\n=== Setup failed - cannot continue tests ===");
      return;
    }

    await delay(TEST_DELAY_MS);
    await testFetchSeedsDefault();

    await delay(TEST_DELAY_MS);
    const publicCol = await testCreatePublicCollection();

    await delay(TEST_DELAY_MS);
    const privateCol = await testCreatePrivateCollection();

    await delay(TEST_DELAY_MS);
    // Rename publicCol and flip it to private to exercise update
    if (publicCol) await testUpdateCollection(publicCol.id);

    await delay(TEST_DELAY_MS);
    if (privateCol) await testAddRemoveBusiness(privateCol.id);

    await delay(TEST_DELAY_MS);
    await testFetchUserBusinessCollections(privateCol?.id);

    await delay(TEST_DELAY_MS);
    await testFetchUserBusinessCollectionsBogus();

    await delay(TEST_DELAY_MS);
    await testDeleteDefaultRefused();

    await delay(TEST_DELAY_MS);
    if (privateCol) await testDeleteCustomCollection(privateCol.id);
  } catch (err) {
    console.error("\n=== Unexpected Error ===");
    console.error(err);
  } finally {
    await cleanup();
  }

  console.log("\n=== All tests complete ===");
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  cleanup().finally(() => process.exit(1));
});
