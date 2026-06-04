/**
 * Geocode City + Geo-Search SDK Integration Tests
 *
 * Run with:
 *   API_TOKEN=<token> npx tsx tests/integration/geocode-city.integration.js
 *
 * Environment variables:
 *   API_BASE  - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN - Access token (required)
 *
 * Covers:
 *   - geocodeCityCoordinates (resolve city name → lat/lng)
 *   - searchBusinesses with lat/lng/radius geo params
 *
 * Requires the MAPBOX_TOKEN env var to be set on the API server.
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/geocode-city.integration.js\n\n" +
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

function success(message) {
  console.log(`  ✓ ${message}`);
}

function fail(message, error) {
  console.error(`  ✗ ${message}`);
  if (error) console.error(`    Error: ${error.message || error}`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testGeocodeCityCoordinates() {
  console.log("\n=== geocodeCityCoordinates ===");

  const result = await sdk.geocodeCityCoordinates("Port of Spain");

  if (!result) {
    fail("geocodeCityCoordinates returned null for 'Port of Spain'");
    return null;
  }

  if (typeof result.latitude !== "number" || typeof result.longitude !== "number") {
    fail(`Expected numeric lat/lng, got lat=${result.latitude} lng=${result.longitude}`);
    return null;
  }

  // Port of Spain is roughly 10.65°N, 61.51°W — sanity-check within 1°
  if (Math.abs(result.latitude - 10.65) > 1 || Math.abs(result.longitude - (-61.51)) > 1) {
    fail(`Coordinates seem wrong for Port of Spain: ${result.latitude}, ${result.longitude}`);
    return null;
  }

  success(`Resolved to ${result.latitude}, ${result.longitude}`);
  return result;
}

async function testGeocodeCityNotFound() {
  console.log("\n=== geocodeCityCoordinates (not found) ===");

  const result = await sdk.geocodeCityCoordinates("asdfjkl12345nonexistent");

  if (result !== null) {
    fail(`Expected null for nonsense query, got ${JSON.stringify(result)}`);
    return;
  }

  success("Returned null for unresolvable city");
}

async function testSearchWithGeoParams(coords) {
  console.log("\n=== searchBusinesses with lat/lng/radius ===");

  if (!coords) {
    console.log("  ⚠ Skipping — no coordinates from geocode step");
    return;
  }

  const result = await sdk.searchBusinesses("business", {
    lat: coords.latitude,
    lng: coords.longitude,
    radius: 50,
    perPage: 5,
  });

  if (!result || !Array.isArray(result.businesses)) {
    fail("searchBusinesses did not return expected shape");
    return;
  }

  success(`Returned ${result.businesses.length} businesses within 50km radius`);

  if (typeof result.hasMore !== "boolean") {
    fail(`hasMore should be boolean, got ${typeof result.hasMore}`);
    return;
  }

  success(`hasMore=${result.hasMore}, nextCursor=${result.nextCursor}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Geocode City + Geo-Search Integration Tests");
  console.log(`API: ${API_BASE}`);

  const coords = await testGeocodeCityCoordinates();
  await testGeocodeCityNotFound();
  await testSearchWithGeoParams(coords);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
