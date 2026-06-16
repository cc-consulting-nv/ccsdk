/**
 * Business CRUD & Response Shape SDK Integration Tests
 *
 * Run with:
 *   API_TOKEN=<token> npx tsx tests/integration/business-crud.integration.js
 *
 * The token must belong to an authenticated user.
 * Generate one with: sail artisan cc:get-token <tenant-id> <username>
 *
 * Environment variables:
 *   API_BASE      - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN     - Access token (required)
 *
 * Covers:
 *   - createBusiness (with new flat social link & shortDescription fields)
 *   - fetchBusiness (single — response shape verification)
 *   - fetchBusinesses (list — response shape verification)
 *   - fetchBusinessesByCategory (snake_case → camelCase normalization)
 *   - updateBusiness (with new flat fields)
 *   - deleteBusiness
 *
 * Response shape assertions (issue #137):
 *   - category is an object { id, name, slug, icon? }, not a string
 *   - social links are flat top-level fields (facebookUrl, instagramUrl, etc.)
 *   - averageRating is present (not "rating")
 *   - photos is an array
 *   - shortDescription is camelCase
 *   - hours is a Record keyed by day name with is_open
 *   - formattedHours is a Record keyed by day name
 *   - whatsapp is a top-level field
 *   - owner, status, viewCount, attributes, metadata present
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/business-crud.integration.js\n\n" +
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
let testCategorySlug = null;
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

/**
 * Assert a condition. Returns true if passed, false if failed.
 */
function expect(condition, message) {
  if (condition) {
    success(message);
    return true;
  }
  fail(message);
  return false;
}

// ---------------------------------------------------------------------------
// Setup: Create a test business with all supported input fields
// ---------------------------------------------------------------------------

async function setup() {
  console.log("\n=== Setup: Creating Test Business ===");

  const categories = await sdk.fetchBusinessCategories();
  if (!categories?.length) {
    fail("No business categories available");
    return false;
  }

  testCategorySlug = categories[0].slug;
  const categoryId = categories[0].id || categories[0].ulid;

  const business = await sdk.createBusiness({
    name: `CRUD Test - ${Date.now()}`,
    description: "Business created by the CRUD integration test suite.",
    shortDescription: "Integration test short desc",
    categoryId,
    phone: "+1-555-000-1111",
    phoneSecondary: "+1-555-000-2222",
    email: "crud-test@example.test",
    website: "https://crud-test.example.test",
    whatsapp: "+1-555-000-3333",
    address: "1 CRUD Lane",
    addressLine2: "Unit 42",
    city: "Port of Spain",
    region: "North",
    postalCode: "10001",
    latitude: 10.6549,
    longitude: -61.5019,
    facebookUrl: "https://facebook.com/crud-test",
    instagramUrl: "https://instagram.com/crud-test",
    tiktokUrl: "https://tiktok.com/@crud-test",
    twitterUrl: "https://twitter.com/crud-test",
    coverImageUrl: "https://placehold.co/600x400",
    logoUrl: "https://placehold.co/100x100",
    hours: {
      monday: { is_open: true, open: "09:00", close: "17:00" },
      tuesday: { is_open: true, open: "09:00", close: "17:00" },
      wednesday: { is_open: true, open: "09:00", close: "17:00" },
      thursday: { is_open: true, open: "09:00", close: "17:00" },
      friday: { is_open: true, open: "09:00", close: "17:00" },
      saturday: { is_open: false },
      sunday: { is_open: false },
    },
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
// Tests: createBusiness response shape
// ---------------------------------------------------------------------------

async function testCreateResponseShape() {
  console.log("\n=== createBusiness — response shape ===");

  const biz = await sdk.fetchBusiness(testBusinessUlid);
  if (!biz) {
    fail("fetchBusiness returned null for just-created business");
    return;
  }

  // Core identity
  expect(typeof biz.id === "string" && biz.id.length > 0, "id is a non-empty string");
  expect(typeof biz.ulid === "string", "ulid is a string");
  expect(biz.name?.startsWith("CRUD Test"), "name matches what was submitted");
  expect(typeof biz.slug === "string" && biz.slug.length > 0, "slug was auto-generated");

  // shortDescription (issue #137 — was missing)
  expect(biz.shortDescription === "Integration test short desc", "shortDescription is camelCase and matches input");

  // Category is an object, not a string (issue #137 — was typed as string)
  expect(typeof biz.category === "object" && biz.category !== null, "category is an object (not a string)");
  if (typeof biz.category === "object" && biz.category !== null) {
    expect(typeof biz.category.id === "string", "category.id is a string");
    expect(typeof biz.category.name === "string", "category.name is a string");
    expect(typeof biz.category.slug === "string", "category.slug is a string");
    // icon is optional
  }
  expect(typeof biz.categoryId === "string", "categoryId is present");

  // Contact fields
  expect(biz.phone === "+1-555-000-1111", "phone matches input");
  expect(biz.phoneSecondary === "+1-555-000-2222", "phoneSecondary is present (was missing)");
  expect(biz.email === "crud-test@example.test", "email matches input");
  expect(biz.website === "https://crud-test.example.test", "website matches input");
  expect(biz.whatsapp === "+1-555-000-3333", "whatsapp is a top-level field (not nested in socialLinks)");

  // Location
  expect(biz.address === "1 CRUD Lane", "address matches input");
  expect(biz.addressLine2 === "Unit 42", "addressLine2 is present (was missing)");
  expect(biz.city === "Port of Spain", "city matches input");

  // Social links are flat, not nested (issue #137 — was nested socialLinks object)
  expect(biz.facebookUrl === "https://facebook.com/crud-test", "facebookUrl is a flat top-level field");
  expect(biz.instagramUrl === "https://instagram.com/crud-test", "instagramUrl is a flat top-level field");
  expect(biz.tiktokUrl === "https://tiktok.com/@crud-test", "tiktokUrl is a flat top-level field");
  expect(biz.twitterUrl === "https://twitter.com/crud-test", "twitterUrl is a flat top-level field");

  // Media
  expect(typeof biz.coverImageUrl === "string" || biz.coverImageUrl === null, "coverImageUrl is present");
  expect(typeof biz.logoUrl === "string" || biz.logoUrl === null, "logoUrl is present");
  expect(Array.isArray(biz.photos), "photos is an array (was missing)");

  // Hours — Record keyed by day name with is_open
  if (expect(typeof biz.hours === "object" && biz.hours !== null, "hours is an object")) {
    const monday = biz.hours.monday || biz.hours.Monday;
    if (monday) {
      expect(typeof monday.is_open === "boolean", "hours[day].is_open is a boolean");
      if (monday.is_open) {
        expect(typeof monday.open === "string", "hours[day].open is a string when open");
        expect(typeof monday.close === "string", "hours[day].close is a string when open");
      }
    }
  }

  // formattedHours — Record keyed by day name
  if (biz.formattedHours != null) {
    if (expect(typeof biz.formattedHours === "object", "formattedHours is an object")) {
      const firstKey = Object.keys(biz.formattedHours)[0];
      if (firstKey) {
        const entry = biz.formattedHours[firstKey];
        expect(typeof entry.day === "string", "formattedHours[day].day is a string");
        expect(typeof entry.is_open === "boolean", "formattedHours[day].is_open is a boolean");
        expect(typeof entry.hours === "string", "formattedHours[day].hours is a string");
      }
    }
  }

  // Ratings & engagement (issue #137 — averageRating was missing, only had "rating")
  expect("averageRating" in biz, "averageRating field is present (not just 'rating')");
  expect("reviewCount" in biz, "reviewCount is present");
  expect("viewCount" in biz, "viewCount is present (was missing)");

  // Ownership & verification
  expect("isVerified" in biz, "isVerified is present");
  expect("isClaimed" in biz, "isClaimed is present");
  expect("claimedAt" in biz, "claimedAt is present");

  // Status & featuring (issue #137 — status was missing)
  expect(typeof biz.status === "string", "status is present (was missing)");
  expect("isFeatured" in biz, "isFeatured is present");

  // isOpen
  expect("isOpen" in biz, "isOpen is present (was missing)");

  // Timestamps
  expect(typeof biz.createdAt === "string", "createdAt is present");
  expect(typeof biz.updatedAt === "string", "updatedAt is present");

  // Verify deprecated/old fields are NOT in the API response
  expect(!("socialLinks" in biz), "socialLinks nested object is NOT in API response");
  expect(!("rating" in biz), "'rating' field is NOT in API response (use averageRating)");
  expect(!("gallery" in biz), "'gallery' field is NOT in API response (use photos)");
  expect(!("coverImage" in biz), "'coverImage' field is NOT in API response (use coverImageUrl)");
  expect(!("logo" in biz), "'logo' field is NOT in API response (use logoUrl)");
}

// ---------------------------------------------------------------------------
// Tests: fetchBusinesses (list)
// ---------------------------------------------------------------------------

async function testFetchBusinesses() {
  console.log("\n=== fetchBusinesses — list ===");

  const result = await sdk.fetchBusinesses({ perPage: 3 });

  expect(Array.isArray(result.businesses), "businesses is an array");
  expect(typeof result.hasMore === "boolean", "hasMore is a boolean");
  expect("nextCursor" in result, "nextCursor is present");

  if (result.businesses.length > 0) {
    const biz = result.businesses[0];
    expect(typeof biz.id === "string", "list item has id");
    expect(typeof biz.name === "string", "list item has name");

    // Category shape in list response matches single response
    if (biz.category != null) {
      expect(
        typeof biz.category === "object" && typeof biz.category.name === "string",
        "list item category is an object with name"
      );
    }

    // Flat social links in list response too
    expect(!("socialLinks" in biz), "list item does not have nested socialLinks");
    expect("averageRating" in biz, "list item has averageRating");
  }
}

// ---------------------------------------------------------------------------
// Tests: fetchBusinessesByCategory (snake_case normalization)
// ---------------------------------------------------------------------------

async function testFetchBusinessesByCategory() {
  console.log("\n=== fetchBusinessesByCategory — snake_case normalization ===");

  if (!testCategorySlug) {
    console.log("  ⚠ Skipping — no category slug available");
    return;
  }

  const result = await sdk.fetchBusinessesByCategory(testCategorySlug, { perPage: 3 });

  expect(Array.isArray(result.businesses), "businesses is an array");
  expect(typeof result.hasMore === "boolean", "hasMore is a boolean");

  if (result.businesses.length > 0) {
    const biz = result.businesses[0];

    // These fields come back as snake_case from this endpoint and should be normalized
    expect(typeof biz.id === "string", "id is present after normalization");

    // Verify camelCase normalization happened
    const raw = biz;
    expect(!("created_at" in raw), "created_at was normalized to createdAt");
    expect(!("updated_at" in raw), "updated_at was normalized to updatedAt");
    expect(!("cover_image_url" in raw), "cover_image_url was normalized to coverImageUrl");
    expect(!("category_id" in raw), "category_id was normalized to categoryId");
    expect(!("average_rating" in raw), "average_rating was normalized to averageRating");
    expect(!("review_count" in raw), "review_count was normalized to reviewCount");
    expect(!("is_verified" in raw), "is_verified was normalized to isVerified");
  } else {
    console.log("  ⚠ No businesses in this category — normalization assertions skipped");
  }
}

// ---------------------------------------------------------------------------
// Tests: updateBusiness
// ---------------------------------------------------------------------------

async function testUpdateBusiness() {
  console.log("\n=== updateBusiness ===");

  const updated = await sdk.updateBusiness(testBusinessUlid, {
    shortDescription: "Updated short desc",
    facebookUrl: "https://facebook.com/updated",
    instagramUrl: null,
    phoneSecondary: "+1-555-999-8888",
    addressLine2: "Unit 99",
  });

  if (!updated) {
    fail("updateBusiness returned null/undefined");
    return;
  }

  expect(
    (updated.ulid || updated.id) === testBusinessUlid,
    "returned business matches the updated ULID"
  );

  // Re-fetch to verify persistence
  const refetched = await sdk.fetchBusiness(testBusinessUlid);
  if (!refetched) {
    fail("fetchBusiness returned null after update");
    return;
  }

  expect(refetched.shortDescription === "Updated short desc", "shortDescription was updated");
  expect(refetched.facebookUrl === "https://facebook.com/updated", "facebookUrl was updated");
  expect(refetched.phoneSecondary === "+1-555-999-8888", "phoneSecondary was updated");
  expect(refetched.addressLine2 === "Unit 99", "addressLine2 was updated");

  // Category should still be an object after update
  expect(
    typeof refetched.category === "object" && refetched.category !== null,
    "category is still an object after update"
  );
}

// ---------------------------------------------------------------------------
// Tests: deleteBusiness
// ---------------------------------------------------------------------------

async function testDeleteBusiness() {
  console.log("\n=== deleteBusiness ===");

  await sdk.deleteBusiness(testBusinessUlid);
  success("deleteBusiness did not throw");

  const refetched = await sdk.fetchBusiness(testBusinessUlid).catch(() => null);
  expect(refetched === null, "fetchBusiness returns null after deletion");

  // Mark as deleted so cleanup doesn't try again
  testBusinessUlid = null;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  console.log("\n=== Cleanup ===");

  if (testBusinessUlid) {
    try {
      await sdk.deleteBusiness(testBusinessUlid);
      success(`Deleted test business ${testBusinessUlid}`);
    } catch (err) {
      fail("Failed to delete test business", err);
    }
  } else {
    success("Nothing to clean up");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Business CRUD & Response Shape Integration Tests");
  console.log(`API: ${API_BASE}`);

  const ready = await setup();
  if (!ready) {
    await cleanup();
    process.exit(1);
  }

  try {
    await testCreateResponseShape();
    await testFetchBusinesses();
    await testFetchBusinessesByCategory();
    await testUpdateBusiness();
    await testDeleteBusiness();
  } finally {
    await cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  cleanup().finally(() => process.exit(1));
});
