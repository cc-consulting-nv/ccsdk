/**
 * Passkey SDK Integration Tests
 *
 * These tests verify passkey (WebAuthn) methods against a live API.
 *
 * Run with:
 *   npx tsx tests/integration/passkey.integration.js
 *
 * Environment variables:
 *   API_BASE        - Base URL (default: http://localhost:8089)
 *   TEST_EMAIL      - Email for login (required for authenticated tests)
 *   TEST_AUTH_CODE  - Auth code for login (required for authenticated tests)
 *
 * Note: Some passkey methods (passkeyAuthenticate, passkeyRegister) require
 * actual WebAuthn credentials from a browser/authenticator and cannot be
 * fully tested in Node.js. This file tests the API endpoints we can reach.
 *
 * To run all tests:
 *   1. Request a login code via the UI or API for your test email
 *   2. Run with: TEST_EMAIL=you@example.com TEST_AUTH_CODE=123456 npx tsx ...
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_AUTH_CODE = process.env.TEST_AUTH_CODE;

// Shared SDK instance for tests that need an authenticated session
let authenticatedSdk = null;

/**
 * Simple test runner with pass/fail tracking
 */
const results = { passed: 0, failed: 0, skipped: 0 };

async function runTest(name, fn, { skip = false } = {}) {
  if (skip) {
    console.log(`⏭️  SKIP: ${name}`);
    results.skipped++;
    return;
  }
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    results.passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   Error: ${err.message}`);
    if (err.response) {
      console.error(`   Response: ${JSON.stringify(err.response, null, 2)}`);
    }
    results.failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// ---------------------------------------------------------------------------
// Setup: Login to get authenticated SDK
// ---------------------------------------------------------------------------

async function setupAuthenticatedSdk() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });
  const tokens = await sdk.loginWithMagicLink(TEST_EMAIL, TEST_AUTH_CODE);
  assert(tokens.accessToken, "Login should return access token");
  authenticatedSdk = sdk;
  console.log("   ✓ Authenticated successfully\n");
}

// ---------------------------------------------------------------------------
// passkeyGetAuthenticateOptions Tests (unauthenticated)
// ---------------------------------------------------------------------------

async function testPasskeyGetAuthenticateOptionsWithoutEmail() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  const result = await sdk.passkeyGetAuthenticateOptions();

  assert(result.sessionId, "Should return sessionId");
  assert(result.options, "Should return options");
  assert(result.options.challenge, "options should have challenge");
  assert(result.options.rpId, "options should have rpId");
}

async function testPasskeyGetAuthenticateOptionsWithEmail() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  const result = await sdk.passkeyGetAuthenticateOptions(TEST_EMAIL);

  assert(result.sessionId, "Should return sessionId");
  assert(result.options, "Should return options");
}

// ---------------------------------------------------------------------------
// passkeyGetRegisterOptions Tests (authenticated)
// ---------------------------------------------------------------------------

async function testPasskeyGetRegisterOptions() {
  const result = await authenticatedSdk.passkeyGetRegisterOptions("Integration Test Key");

  assert(result.options, "Should return options");
  assert(result.options.challenge, "options should have challenge");
  assert(result.options.rp, "options should have rp (relying party)");
  assert(result.options.user, "options should have user info");
}

async function testPasskeyGetRegisterOptionsRequiresAuth() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  let threw = false;
  try {
    await sdk.passkeyGetRegisterOptions("Test Key");
  } catch (err) {
    threw = true;
    assert(
      err.message.includes("401") || err.message.includes("Unauthenticated"),
      `Expected 401 error, got: ${err.message}`
    );
  }

  assert(threw, "Should throw when not authenticated");
}

// ---------------------------------------------------------------------------
// passkeyList Tests (authenticated)
// ---------------------------------------------------------------------------

async function testPasskeyListReturnsArray() {
  const passkeys = await authenticatedSdk.passkeyList();

  assert(Array.isArray(passkeys), "Should return an array");
  // User may or may not have passkeys, so we just check the structure
  if (passkeys.length > 0) {
    assert(passkeys[0].id, "Passkey should have id");
    assert(passkeys[0].name, "Passkey should have name");
    console.log(`   (Found ${passkeys.length} existing passkey(s))`);
  } else {
    console.log("   (No passkeys registered for this user)");
  }
}

async function testPasskeyListRequiresAuth() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  let threw = false;
  try {
    await sdk.passkeyList();
  } catch (err) {
    threw = true;
    assert(
      err.message.includes("401") || err.message.includes("Unauthenticated"),
      `Expected 401 error, got: ${err.message}`
    );
  }

  assert(threw, "Should throw when not authenticated");
}

// ---------------------------------------------------------------------------
// passkeyRename Tests (authenticated, requires existing passkey)
// ---------------------------------------------------------------------------

async function testPasskeyRenameNonExistent() {
  // Try to rename a non-existent passkey
  let threw = false;
  try {
    await authenticatedSdk.passkeyRename("non-existent-id", "New Name");
  } catch (err) {
    threw = true;
    assert(
      err.message.includes("404") || err.message.includes("Not Found") || err.message.includes("not found"),
      `Expected 404 error, got: ${err.message}`
    );
  }

  assert(threw, "Should throw for non-existent passkey");
}

// ---------------------------------------------------------------------------
// passkeyDelete Tests (authenticated, requires existing passkey)
// ---------------------------------------------------------------------------

async function testPasskeyDeleteNonExistent() {
  // Try to delete a non-existent passkey
  let threw = false;
  try {
    await authenticatedSdk.passkeyDelete("non-existent-id");
  } catch (err) {
    threw = true;
    assert(
      err.message.includes("404") || err.message.includes("Not Found") || err.message.includes("not found"),
      `Expected 404 error, got: ${err.message}`
    );
  }

  assert(threw, "Should throw for non-existent passkey");
}

// ---------------------------------------------------------------------------
// passkeyAuthenticate Tests (unauthenticated, but needs real WebAuthn credential)
// ---------------------------------------------------------------------------

async function testPasskeyAuthenticateInvalidCredential() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  // First get auth options to get a valid session
  const options = await sdk.passkeyGetAuthenticateOptions();

  // Try to authenticate with a fake credential
  const fakeCredential = {
    id: "fake-credential-id",
    rawId: "fake-raw-id",
    response: {
      authenticatorData: "fake-auth-data",
      clientDataJSON: "fake-client-data",
      signature: "fake-signature",
    },
    type: "public-key",
  };

  let threw = false;
  try {
    await sdk.passkeyAuthenticate(options.sessionId, fakeCredential);
  } catch (err) {
    threw = true;
    // Should fail validation
  }

  assert(threw, "Should throw for invalid credential");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n🔐 Passkey Integration Tests`);
  console.log(`   API: ${API_BASE}\n`);

  const hasCredentials = TEST_EMAIL && TEST_AUTH_CODE;

  // Setup: Login if credentials provided
  if (hasCredentials) {
    console.log("--- Setup ---");
    try {
      await setupAuthenticatedSdk();
    } catch (err) {
      console.error(`❌ Setup failed: ${err.message}`);
      console.error("   Cannot run authenticated tests without valid login.");
      authenticatedSdk = null;
    }
  }

  // Unauthenticated passkey tests
  console.log("--- passkeyGetAuthenticateOptions (unauthenticated) ---");
  await runTest("passkeyGetAuthenticateOptions returns challenge without email", testPasskeyGetAuthenticateOptionsWithoutEmail);
  await runTest("passkeyGetAuthenticateOptions returns challenge with email", testPasskeyGetAuthenticateOptionsWithEmail, {
    skip: !TEST_EMAIL,
  });

  // Authenticated passkey tests
  console.log("\n--- passkeyGetRegisterOptions (authenticated) ---");
  await runTest("passkeyGetRegisterOptions returns registration options", testPasskeyGetRegisterOptions, {
    skip: !authenticatedSdk,
  });
  await runTest("passkeyGetRegisterOptions requires authentication", testPasskeyGetRegisterOptionsRequiresAuth);

  console.log("\n--- passkeyList (authenticated) ---");
  await runTest("passkeyList returns array of passkeys", testPasskeyListReturnsArray, {
    skip: !authenticatedSdk,
  });
  await runTest("passkeyList requires authentication", testPasskeyListRequiresAuth);

  console.log("\n--- passkeyRename (authenticated) ---");
  await runTest("passkeyRename returns 404 for non-existent passkey", testPasskeyRenameNonExistent, {
    skip: !authenticatedSdk,
  });

  console.log("\n--- passkeyDelete (authenticated) ---");
  await runTest("passkeyDelete returns 404 for non-existent passkey", testPasskeyDeleteNonExistent, {
    skip: !authenticatedSdk,
  });

  console.log("\n--- passkeyAuthenticate (credential validation) ---");
  await runTest("passkeyAuthenticate rejects invalid credential", testPasskeyAuthenticateInvalidCredential);

  // Summary
  console.log(`\n📊 Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);

  if (!hasCredentials) {
    console.log("\n💡 To run authenticated passkey tests:");
    console.log("   1. Request a code via UI/API for your test email");
    console.log("   2. Run with: TEST_EMAIL=you@example.com TEST_AUTH_CODE=123456 npx tsx ...");
  }

  console.log("\n📝 Note: passkeyRegister and full passkeyAuthenticate flows require");
  console.log("   actual WebAuthn credentials from a browser/authenticator.");

  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
