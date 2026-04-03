/**
 * Auth SDK Integration Tests
 *
 * These tests verify authentication methods against a live API.
 * Unlike unit tests which mock HTTP, these hit the real endpoints.
 *
 * Run with:
 *   npx tsx tests/integration/auth.integration.js
 *
 * Environment variables:
 *   API_BASE        - Base URL (default: http://localhost:8089)
 *   TEST_EMAIL      - Email for loginWithMagicLink tests
 *   TEST_AUTH_CODE  - Auth code for loginWithMagicLink tests (see below)
 *
 * Note: The API uses magic link / auth code flow, not traditional login/register.
 *       - requestAuthCode() sends a 6-digit code to email
 *       - loginWithMagicLink() exchanges that code for tokens
 *
 * To run all tests:
 *   1. Request a login code via the UI or API for your test email
 *   2. Check your email for the 6-digit code
 *   3. Run the tests with TEST_AUTH_CODE set to that code (do NOT use it to log in first!)
 *   4. The test will consume the code, so you'll need a fresh one for each run
 *
 * Example:
 *   TEST_EMAIL=you@example.com TEST_AUTH_CODE=123456 npx tsx tests/integration/auth.integration.js
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";
import { MemoryTokenProvider } from "../../src/auth.ts";

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
// requestAuthCode / requestMagicLink Tests
// ---------------------------------------------------------------------------

async function testRequestAuthCodeSuccess() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });
  const testEmail = `test-${Date.now()}-ac@integration-test.local`;

  // This should succeed without throwing (sends email)
  await sdk.requestAuthCode(testEmail);

  // No return value to check - success means no error thrown
}

async function testRequestAuthCodeWithOptions() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });
  const testEmail = `test-${Date.now()}-opts@integration-test.local`;

  // Test with optional parameters
  await sdk.requestAuthCode(testEmail, {
    referralCode: "TEST123",
    redirect: "/dashboard",
    platform: "web",
  });
}

async function testRequestMagicLinkSuccess() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });
  const testEmail = `test-${Date.now()}-ml@integration-test.local`;

  // This should succeed without throwing (sends email)
  await sdk.requestMagicLink(testEmail);
}

async function testRequestMagicLinkWithOptions() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });
  const testEmail = `test-${Date.now()}-mlopts@integration-test.local`;

  await sdk.requestMagicLink(testEmail, {
    referralCode: "REF456",
    redirect: "/home",
    platform: "ios",
  });
}

// ---------------------------------------------------------------------------
// loginWithMagicLink Tests
// ---------------------------------------------------------------------------

async function testLoginWithMagicLinkSuccess() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  assert(!sdk.isAuthenticated(), "SDK should start unauthenticated");

  const tokens = await sdk.loginWithMagicLink(TEST_EMAIL, TEST_AUTH_CODE);

  assert(tokens.accessToken, "Should receive access token");
  assert(sdk.isAuthenticated(), "SDK should be authenticated after login");
  assertEqual(sdk.getTokens().accessToken, tokens.accessToken, "Stored token should match returned token");

  // Store authenticated SDK for subsequent tests
  authenticatedSdk = sdk;
}

async function testLoginWithMagicLinkInvalidCode() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  let threw = false;
  try {
    // Use a valid 6-digit code format (100000-999999) but wrong value
    await sdk.loginWithMagicLink("test@example.com", "999999");
  } catch (err) {
    threw = true;
    // API should return 401 for invalid/expired code or non-existent user
    assert(
      err.message.includes("401") ||
        err.message.includes("couldn't find"),
      `Expected 401 auth error, got: ${err.message}`
    );
  }

  assert(threw, "Should throw error for invalid auth code");
  assert(!sdk.isAuthenticated(), "SDK should remain unauthenticated after failed login");
}

async function testLoginWithMagicLinkStringCode() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  // Test that string auth codes are converted to integers
  // This will fail with invalid code, but we're testing the request format
  let threw = false;
  try {
    await sdk.loginWithMagicLink("test@example.com", "123456"); // String, not number
  } catch (err) {
    threw = true;
    // Expected to fail (invalid code), but should not fail due to type issues
    assert(
      !err.message.includes("type") && !err.message.includes("NaN"),
      `Should handle string codes, got: ${err.message}`
    );
  }

  assert(threw, "Should throw (invalid code), but not due to type conversion");
}

// ---------------------------------------------------------------------------
// Token Management Tests
// ---------------------------------------------------------------------------

async function testSetAndGetTokens() {
  // Use MemoryTokenProvider to avoid localStorage dependency in Node.js
  const tokenProvider = new MemoryTokenProvider();
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE, tokenProvider });

  assert(!sdk.isAuthenticated(), "SDK should start unauthenticated");
  assert(sdk.getTokens() === null, "getTokens() should return null initially");

  sdk.setTokens({ accessToken: "test-token-123", refreshToken: "refresh-456" });

  assert(sdk.isAuthenticated(), "SDK should be authenticated after setTokens");
  assertEqual(sdk.getTokens().accessToken, "test-token-123", "Access token should match");
  assertEqual(sdk.getTokens().refreshToken, "refresh-456", "Refresh token should match");
}

async function testClearTokens() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  sdk.setTokens({ accessToken: "test-token" });
  assert(sdk.isAuthenticated(), "Should be authenticated");

  sdk.setTokens(null);

  assert(!sdk.isAuthenticated(), "Should be unauthenticated after clearing");
  assert(sdk.getTokens() === null, "getTokens() should return null");
}

async function testIsAuthenticatedStates() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  // Initially unauthenticated
  assertEqual(sdk.isAuthenticated(), false, "Should start unauthenticated");

  // After setting tokens
  sdk.setTokens({ accessToken: "token" });
  assertEqual(sdk.isAuthenticated(), true, "Should be authenticated with token");

  // After clearing
  sdk.setTokens(null);
  assertEqual(sdk.isAuthenticated(), false, "Should be unauthenticated after clear");
}

// ---------------------------------------------------------------------------
// getCurrentUser Tests
// ---------------------------------------------------------------------------

async function testGetCurrentUserUnauthenticated() {
  const sdk = new CcPlatformSdk({ baseUrl: API_BASE });

  const user = await sdk.getCurrentUser();

  assertEqual(user, null, "getCurrentUser should return null when unauthenticated");
}

async function testGetCurrentUserAuthenticated() {
  const user = await authenticatedSdk.getCurrentUser();

  assert(user !== null, "getCurrentUser should return user object");
  assert(user.ulid, "User should have ulid");
  assert(user.username, "User should have username");
}

// ---------------------------------------------------------------------------
// Logout Tests
// ---------------------------------------------------------------------------

async function testLogoutClearsTokens() {
  assert(authenticatedSdk.isAuthenticated(), "Should start authenticated");

  await authenticatedSdk.logout();

  assert(!authenticatedSdk.isAuthenticated(), "Should be unauthenticated after logout");
  assertEqual(authenticatedSdk.getTokens(), null, "Tokens should be null after logout");
}

// ---------------------------------------------------------------------------
// Refresh Token Tests
// ---------------------------------------------------------------------------

async function testRefreshTokenWithoutRefreshToken() {
  const sdk = new CcPlatformSdk({
    baseUrl: API_BASE,
    tokens: { accessToken: "access-only" }, // No refresh token
  });

  const result = await sdk.refreshToken();

  assertEqual(result, null, "refreshToken should return null when no refresh token available");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n🧪 Auth Integration Tests`);
  console.log(`   API: ${API_BASE}\n`);

  const hasEmail = !!TEST_EMAIL;
  const hasAuthCode = !!TEST_AUTH_CODE;

  // Request auth code tests (use generated emails to avoid rate limiting)
  console.log("--- Request Auth Code Tests ---");
  await runTest("requestAuthCode sends code successfully", testRequestAuthCodeSuccess);
  await runTest("requestAuthCode with options", testRequestAuthCodeWithOptions);
  await runTest("requestMagicLink sends link successfully", testRequestMagicLinkSuccess);
  await runTest("requestMagicLink with options", testRequestMagicLinkWithOptions);

  // Login with magic link tests
  console.log("\n--- Login With Magic Link Tests ---");
  await runTest("loginWithMagicLink with valid code returns tokens", testLoginWithMagicLinkSuccess, {
    skip: !hasEmail || !hasAuthCode,
  });
  await runTest("loginWithMagicLink with invalid code throws error", testLoginWithMagicLinkInvalidCode);
  await runTest("loginWithMagicLink handles string auth codes", testLoginWithMagicLinkStringCode);

  // Token management tests (no API calls needed)
  console.log("\n--- Token Management Tests ---");
  await runTest("setTokens and getTokens work correctly", testSetAndGetTokens);
  await runTest("setTokens(null) clears tokens", testClearTokens);
  await runTest("isAuthenticated reflects token state", testIsAuthenticatedStates);

  // getCurrentUser tests
  console.log("\n--- getCurrentUser Tests ---");
  await runTest("getCurrentUser returns null when unauthenticated", testGetCurrentUserUnauthenticated);
  await runTest("getCurrentUser returns user when authenticated", testGetCurrentUserAuthenticated, {
    skip: !authenticatedSdk,
  });

  // Logout tests (run last since it invalidates the session)
  console.log("\n--- Logout Tests ---");
  await runTest("logout clears tokens", testLogoutClearsTokens, {
    skip: !authenticatedSdk,
  });

  // Refresh token tests
  console.log("\n--- Refresh Token Tests ---");
  await runTest("refreshToken returns null without refresh token", testRefreshTokenWithoutRefreshToken);

  // Summary
  console.log(`\n📊 Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);

  if (!hasEmail || !hasAuthCode) {
    console.log("\n💡 To run authenticated and magic link tests:");
    console.log("   1. Request a code via UI/API for your test email");
    console.log("   2. Run with: TEST_EMAIL=you@example.com TEST_AUTH_CODE=123456 npx tsx ...");
    console.log("   Note: Do NOT use the code to log in first - the test consumes it!");
  }

  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
