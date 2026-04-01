/**
 * Auth SDK Unit Tests (mocked HTTP)
 *
 * These tests verify the SDK's authentication methods work correctly
 * by mocking the HTTP layer. For live API integration testing,
 * see integration/auth.integration.js.
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../src/platformSdk.ts";
import { HybridTokenProvider } from "../src/auth.ts";

const baseUrl = "https://api.example.com";

/**
 * Creates an in-memory storage mock for testing (localStorage replacement)
 */
function createMockStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
}

/**
 * Creates a mock fetch implementation that returns the provided response
 */
function createMockFetch(responseData, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responseData), { status });
  };
  return { fetchImpl, calls };
}

/**
 * Creates a CcPlatformSdk instance with mocked HTTP (no initial auth)
 */
function createMockSdk(responseData, status = 200) {
  const { fetchImpl, calls } = createMockFetch(responseData, status);
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
  });
  return { sdk, calls };
}

/**
 * Creates a CcPlatformSdk instance with mocked HTTP (with auth token)
 */
function createAuthenticatedMockSdk(responseData, status = 200) {
  const { fetchImpl, calls } = createMockFetch(responseData, status);
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
  });
  return { sdk, calls };
}

// ---------------------------------------------------------------------------
// login tests
// ---------------------------------------------------------------------------

test("login sends POST to /v1/auth/login with email and password", async () => {
  const { sdk, calls } = createMockSdk({
    data: {
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    },
  });

  const tokens = await sdk.login("user@example.com", "password123");

  // Verify the request
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/login`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.email, "user@example.com");
  assert.equal(body.password, "password123");

  // Verify the response
  assert.equal(tokens.accessToken, "test-access-token");
  assert.equal(tokens.refreshToken, "test-refresh-token");

  // Verify tokens were stored
  assert.ok(sdk.isAuthenticated());
  assert.equal(sdk.getTokens().accessToken, "test-access-token");
});

// ---------------------------------------------------------------------------
// loginWithOAuth tests
// ---------------------------------------------------------------------------

test("loginWithOAuth sends POST to /v1/auth/{provider}/callback", async () => {
  const { sdk, calls } = createMockSdk({
    access_token: "oauth-access-token",
    refresh_token: "oauth-refresh-token",
  });

  const tokens = await sdk.loginWithOAuth("google", "auth-code-123", "https://app.example.com/callback");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/google/callback`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.code, "auth-code-123");
  assert.equal(body.redirect_uri, "https://app.example.com/callback");

  assert.equal(tokens.accessToken, "oauth-access-token");
  assert.equal(tokens.refreshToken, "oauth-refresh-token");
});

test("loginWithOAuth handles Apple extraData (id_token, user)", async () => {
  const { sdk, calls } = createMockSdk({
    access_token: "apple-access-token",
  });

  await sdk.loginWithOAuth("apple", "apple-code", "https://app.example.com/callback", {
    id_token: "apple-id-token",
    user: '{"name":"John"}',
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.code, "apple-code");
  assert.equal(body.redirect_uri, "https://app.example.com/callback");
  assert.equal(body.id_token, "apple-id-token");
  assert.equal(body.user, '{"name":"John"}');
});

test("loginWithOAuth normalizes camelCase response to AuthTokens", async () => {
  const { sdk } = createMockSdk({
    accessToken: "camel-access-token",
    refreshToken: "camel-refresh-token",
  });

  const tokens = await sdk.loginWithOAuth("google", "code");

  assert.equal(tokens.accessToken, "camel-access-token");
  assert.equal(tokens.refreshToken, "camel-refresh-token");
});

// ---------------------------------------------------------------------------
// loginWithMagicLink tests
// ---------------------------------------------------------------------------

test("loginWithMagicLink sends POST to /authCodeLogin (no /v1 prefix)", async () => {
  const { sdk, calls } = createMockSdk({
    access_token: "magic-access-token",
    refresh_token: "magic-refresh-token",
    token_type: "Bearer",
  });

  const tokens = await sdk.loginWithMagicLink("user@example.com", "123456");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/authCodeLogin`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.identifier, "user@example.com");
  assert.equal(body.authCode, 123456);

  assert.equal(tokens.accessToken, "magic-access-token");
  assert.equal(tokens.refreshToken, "magic-refresh-token");
});

test("loginWithMagicLink converts string authCode to integer", async () => {
  const { sdk, calls } = createMockSdk({
    access_token: "token",
    token_type: "Bearer",
  });

  await sdk.loginWithMagicLink("user@example.com", "654321");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.authCode, 654321);
  assert.equal(typeof body.authCode, "number");
});

test("loginWithMagicLink accepts number authCode directly", async () => {
  const { sdk, calls } = createMockSdk({
    access_token: "token",
    token_type: "Bearer",
  });

  await sdk.loginWithMagicLink("user@example.com", 999999);

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.authCode, 999999);
});

// ---------------------------------------------------------------------------
// register tests
// ---------------------------------------------------------------------------

test("register sends POST to /v1/auth/register with payload", async () => {
  const { sdk, calls } = createMockSdk({
    data: {
      accessToken: "new-user-token",
      refreshToken: "new-refresh-token",
    },
  });

  const tokens = await sdk.register({
    email: "newuser@example.com",
    password: "securePass123",
    username: "newuser",
    displayName: "New User",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/register`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.email, "newuser@example.com");
  assert.equal(body.password, "securePass123");
  assert.equal(body.username, "newuser");
  assert.equal(body.displayName, "New User");

  assert.equal(tokens.accessToken, "new-user-token");
  assert.equal(tokens.refreshToken, "new-refresh-token");
  assert.ok(sdk.isAuthenticated());
});

test("register works without optional displayName", async () => {
  const { sdk, calls } = createMockSdk({
    data: { accessToken: "token" },
  });

  await sdk.register({
    email: "user@example.com",
    password: "pass",
    username: "user",
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.displayName, undefined);
});

// ---------------------------------------------------------------------------
// requestMagicLink tests
// ---------------------------------------------------------------------------

test("requestMagicLink sends POST to /sendMagicLink", async () => {
  const { sdk, calls } = createMockSdk({});

  await sdk.requestMagicLink("user@example.com");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/sendMagicLink`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.email, "user@example.com");
});

test("requestMagicLink includes optional parameters (ref, redirect, platform)", async () => {
  const { sdk, calls } = createMockSdk({});

  await sdk.requestMagicLink("user@example.com", {
    referralCode: "REF123",
    redirect: "/dashboard",
    platform: "ios",
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.email, "user@example.com");
  assert.equal(body.ref, "REF123");
  assert.equal(body.redirect, "/dashboard");
  assert.equal(body.platform, "ios");
});

// ---------------------------------------------------------------------------
// requestAuthCode tests
// ---------------------------------------------------------------------------

test("requestAuthCode sends POST to /sendAuthCode", async () => {
  const { sdk, calls } = createMockSdk({});

  await sdk.requestAuthCode("user@example.com");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/sendAuthCode`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.email, "user@example.com");
});

test("requestAuthCode includes optional parameters (ref, redirect, platform)", async () => {
  const { sdk, calls } = createMockSdk({});

  await sdk.requestAuthCode("user@example.com", {
    referralCode: "CODE456",
    redirect: "/home",
    platform: "android",
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.ref, "CODE456");
  assert.equal(body.redirect, "/home");
  assert.equal(body.platform, "android");
});

// ---------------------------------------------------------------------------
// logout tests
// ---------------------------------------------------------------------------

test("logout sends POST to /v1/auth/logout and clears tokens", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({});

  assert.ok(sdk.isAuthenticated());

  await sdk.logout();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/logout`);
  assert.equal(calls[0].init.method, "POST");

  assert.ok(!sdk.isAuthenticated());
  assert.equal(sdk.getTokens(), null);
});

test("logout clears tokens even if API call fails (finally block)", async () => {
  const { fetchImpl } = createMockFetch({}, 500);
  const storage = createMockStorage();
  const tokenProvider = new HybridTokenProvider(storage, { accessToken: "test-token" });

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokenProvider,
    fetchImpl,
  });

  assert.ok(sdk.isAuthenticated());

  // logout() uses try/finally - error is thrown but tokens are still cleared
  try {
    await sdk.logout();
  } catch {
    // Expected to throw due to 500 error
  }

  assert.ok(!sdk.isAuthenticated());
});

// ---------------------------------------------------------------------------
// deleteAccount tests
// ---------------------------------------------------------------------------

test("deleteAccount sends DELETE to /v1/users/me and clears tokens", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({});

  assert.ok(sdk.isAuthenticated());

  await sdk.deleteAccount();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/users/me`);
  assert.equal(calls[0].init.method, "DELETE");

  assert.ok(!sdk.isAuthenticated());
});

// ---------------------------------------------------------------------------
// refreshToken tests
// ---------------------------------------------------------------------------

test("refreshToken sends POST to /auth/refresh (no /v1 prefix)", async () => {
  const { fetchImpl, calls } = createMockFetch({
    data: {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    },
  });

  // Use HybridTokenProvider with mock storage to properly store refresh token
  const storage = createMockStorage();
  const tokenProvider = new HybridTokenProvider(
    storage,
    { accessToken: "old-token", refreshToken: "old-refresh-token" }
  );

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokenProvider,
    fetchImpl,
  });

  const tokens = await sdk.refreshToken();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/auth/refresh`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.refresh_token, "old-refresh-token");

  assert.equal(tokens.accessToken, "new-access-token");
  assert.equal(tokens.refreshToken, "new-refresh-token");
  assert.equal(sdk.getTokens().accessToken, "new-access-token");
});

test("refreshToken returns null when no refresh token available", async () => {
  const { sdk } = createAuthenticatedMockSdk({});
  // createAuthenticatedMockSdk only sets accessToken, not refreshToken

  const result = await sdk.refreshToken();

  assert.equal(result, null);
});

test("refreshToken clears tokens and returns null on failure", async () => {
  const { fetchImpl } = createMockFetch({}, 401);

  // Use HybridTokenProvider with mock storage to properly store refresh token
  const storage = createMockStorage();
  const tokenProvider = new HybridTokenProvider(
    storage,
    { accessToken: "token", refreshToken: "refresh" }
  );

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokenProvider,
    fetchImpl,
  });

  const result = await sdk.refreshToken();

  assert.equal(result, null);
  assert.ok(!sdk.isAuthenticated());
});

// ---------------------------------------------------------------------------
// requestPasswordReset tests
// ---------------------------------------------------------------------------

test("requestPasswordReset sends POST to /v1/auth/password/forgot", async () => {
  const { sdk, calls } = createMockSdk({});

  await sdk.requestPasswordReset("user@example.com");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/password/forgot`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.email, "user@example.com");
});

// ---------------------------------------------------------------------------
// resetPassword tests
// ---------------------------------------------------------------------------

test("resetPassword sends POST to /v1/auth/password/reset", async () => {
  const { sdk, calls } = createMockSdk({});

  await sdk.resetPassword("reset-token-123", "newPassword", "newPassword");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/password/reset`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.token, "reset-token-123");
  assert.equal(body.password, "newPassword");
  assert.equal(body.password_confirmation, "newPassword");
});

// ---------------------------------------------------------------------------
// changePassword tests
// ---------------------------------------------------------------------------

test("changePassword sends POST to /v1/auth/password/change", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({});

  await sdk.changePassword("currentPass", "newPass", "newPass");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/password/change`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.current_password, "currentPass");
  assert.equal(body.password, "newPass");
  assert.equal(body.password_confirmation, "newPass");
});

test("changePassword includes authorization header", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({});

  await sdk.changePassword("current", "new", "new");

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// Token Management tests (setTokens, getTokens, isAuthenticated, getCurrentUser)
// ---------------------------------------------------------------------------

test("setTokens stores tokens via TokenProvider", async () => {
  const { sdk } = createMockSdk({});

  assert.ok(!sdk.isAuthenticated());

  sdk.setTokens({ accessToken: "new-token", refreshToken: "new-refresh" });

  assert.ok(sdk.isAuthenticated());
  assert.equal(sdk.getTokens().accessToken, "new-token");
});

test("setTokens(null) clears tokens", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  assert.ok(sdk.isAuthenticated());

  sdk.setTokens(null);

  assert.ok(!sdk.isAuthenticated());
  assert.equal(sdk.getTokens(), null);
});

test("getTokens returns current tokens from TokenProvider", async () => {
  const { fetchImpl } = createMockFetch({});
  const storage = createMockStorage();
  const tokenProvider = new HybridTokenProvider(
    storage,
    { accessToken: "access-123", refreshToken: "refresh-456" }
  );

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokenProvider,
    fetchImpl,
  });

  const tokens = sdk.getTokens();

  assert.equal(tokens.accessToken, "access-123");
  assert.equal(tokens.refreshToken, "refresh-456");
});

test("getTokens returns null when no tokens set", async () => {
  const { sdk } = createMockSdk({});

  const tokens = sdk.getTokens();

  assert.equal(tokens, null);
});

test("isAuthenticated returns true when accessToken exists", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  assert.equal(sdk.isAuthenticated(), true);
});

test("isAuthenticated returns false when no accessToken", async () => {
  const { sdk } = createMockSdk({});

  assert.equal(sdk.isAuthenticated(), false);
});

test("isAuthenticated returns false after tokens cleared", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  assert.equal(sdk.isAuthenticated(), true);

  sdk.setTokens(null);

  assert.equal(sdk.isAuthenticated(), false);
});

// ---------------------------------------------------------------------------
// getCurrentUser tests
// ---------------------------------------------------------------------------

test("getCurrentUser returns null immediately if not authenticated", async () => {
  const { sdk, calls } = createMockSdk({});

  const user = await sdk.getCurrentUser();

  // Should not make any API calls
  assert.equal(calls.length, 0);
  assert.equal(user, null);
});

test("getCurrentUser sends GET to /v1/users/me", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    data: {
      ulid: "01hx1234567890abcdef",
      username: "testuser",
      displayName: "Test User",
      email: "test@example.com",
      avatar: "avatars/test.jpg",
      bio: "Hello world",
      followersCount: 100,
      followingCount: 50,
    },
  });

  const user = await sdk.getCurrentUser();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/users/me`);
  assert.equal(calls[0].init.method, "GET");

  assert.equal(user.ulid, "01hx1234567890abcdef");
  assert.equal(user.username, "testuser");
  assert.equal(user.displayName, "Test User");
  assert.equal(user.email, "test@example.com");
});

test("getCurrentUser extracts badges array", async () => {
  const { sdk } = createAuthenticatedMockSdk({
    data: {
      ulid: "01hx1234567890abcdef",
      username: "testuser",
      badges: ["verified", "creator", { name: "early_adopter" }],
    },
  });

  const user = await sdk.getCurrentUser();

  assert.ok(Array.isArray(user.badges));
  assert.equal(user.badges.length, 3);
  assert.ok(user.badges.includes("verified"));
  assert.ok(user.badges.includes("creator"));
  assert.ok(user.badges.includes("early_adopter"));
});

test("getCurrentUser extracts roles array", async () => {
  const { sdk } = createAuthenticatedMockSdk({
    data: {
      ulid: "01hx1234567890abcdef",
      username: "testuser",
      roles: ["admin", "moderator"],
    },
  });

  const user = await sdk.getCurrentUser();

  assert.ok(Array.isArray(user.roles));
  assert.equal(user.roles.length, 2);
  assert.ok(user.roles.includes("admin"));
  assert.ok(user.roles.includes("moderator"));
});

test("getCurrentUser returns null on API error", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({}, 401);

  const user = await sdk.getCurrentUser();

  assert.equal(calls.length, 1);
  assert.equal(user, null);
});

test("getCurrentUser includes authorization header", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    data: { ulid: "test", username: "user" },
  });

  await sdk.getCurrentUser();

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// Passkey tests (passkeyGetAuthenticateOptions, passkeyAuthenticate,
// passkeyGetRegisterOptions, passkeyRegister, passkeyList, passkeyRename, passkeyDelete)
// ---------------------------------------------------------------------------

test("passkeyGetAuthenticateOptions sends POST to /v1/auth/passkey/authenticate-options", async () => {
  const { sdk, calls } = createMockSdk({
    data: {
      session_id: "session-123",
      options: {
        challenge: "base64-challenge",
        timeout: 60000,
        rpId: "example.com",
        allowCredentials: [],
      },
    },
  });

  const result = await sdk.passkeyGetAuthenticateOptions();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/passkey/authenticate-options`);
  assert.equal(calls[0].init.method, "POST");

  // Should not include Authorization header (skipAuth: true)
  assert.equal(calls[0].init.headers.Authorization, undefined);

  assert.equal(result.sessionId, "session-123");
  assert.ok(result.options);
});

test("passkeyGetAuthenticateOptions includes email when provided", async () => {
  const { sdk, calls } = createMockSdk({
    data: { session_id: "session-123", options: {} },
  });

  await sdk.passkeyGetAuthenticateOptions("user@example.com");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.email, "user@example.com");
});

test("passkeyAuthenticate sends POST to /v1/auth/passkey/authenticate", async () => {
  const { sdk, calls } = createMockSdk({
    data: {
      token_type: "Bearer",
      expires_in: 31536000,
      access_token: "passkey-access-token",
      refresh_token: "passkey-refresh-token",
    },
  });

  const mockCredential = {
    id: "credential-id",
    rawId: "raw-id",
    response: {
      authenticatorData: "auth-data",
      clientDataJSON: "client-data",
      signature: "signature",
    },
    type: "public-key",
  };

  const result = await sdk.passkeyAuthenticate("session-123", mockCredential);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/passkey/authenticate`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.session_id, "session-123");
  assert.deepEqual(body.credential, mockCredential);

  // Should not include Authorization header (skipAuth: true)
  assert.equal(calls[0].init.headers.Authorization, undefined);

  assert.equal(result.tokenType, "Bearer");
  assert.equal(result.expiresIn, 31536000);
  assert.equal(result.accessToken, "passkey-access-token");
  assert.equal(result.refreshToken, "passkey-refresh-token");
});

test("passkeyGetRegisterOptions sends POST to /v1/auth/passkey/register-options", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    data: {
      options: {
        challenge: "base64-challenge",
        rp: { name: "Example", id: "example.com" },
        user: { id: "user-id", name: "user@example.com", displayName: "User" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      },
    },
  });

  const result = await sdk.passkeyGetRegisterOptions("My Passkey");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/passkey/register-options`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.name, "My Passkey");

  // Requires authentication
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");

  assert.ok(result.options);
});

test("passkeyRegister sends POST to /v1/auth/passkey/register", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    data: {
      message: "Passkey registered successfully",
      passkey: {
        id: "passkey-id-123",
        name: "My Passkey",
        device_type: "platform",
        backed_up: true,
        last_used_at: null,
        created_at: "2024-01-15T10:00:00Z",
      },
    },
  });

  const mockCredential = {
    id: "credential-id",
    rawId: "raw-id",
    response: {
      attestationObject: "attestation",
      clientDataJSON: "client-data",
    },
    type: "public-key",
  };

  const result = await sdk.passkeyRegister(mockCredential);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/passkey/register`);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.credential, mockCredential);

  // Requires authentication
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");

  assert.ok(result.passkey);
});

test("passkeyList sends GET to /v1/auth/passkeys", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    data: {
      passkeys: [
        { id: "pk-1", name: "MacBook", device_type: "platform", backed_up: true, last_used_at: null, created_at: "2024-01-10T10:00:00Z" },
        { id: "pk-2", name: "iPhone", device_type: "platform", backed_up: false, last_used_at: "2024-01-11T10:00:00Z", created_at: "2024-01-12T10:00:00Z" },
      ],
    },
  });

  const passkeys = await sdk.passkeyList();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/passkeys`);
  assert.equal(calls[0].init.method, "GET");

  // Requires authentication
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");

  assert.ok(Array.isArray(passkeys));
  assert.equal(passkeys.length, 2);
  assert.equal(passkeys[0].name, "MacBook");
  assert.equal(passkeys[0].deviceType, "platform");
  assert.equal(passkeys[0].backedUp, true);
  assert.equal(passkeys[1].name, "iPhone");
  assert.equal(passkeys[1].lastUsedAt, "2024-01-11T10:00:00Z");
});

test("passkeyList returns empty array when no passkeys", async () => {
  const { sdk } = createAuthenticatedMockSdk({
    data: { passkeys: [] },
  });

  const passkeys = await sdk.passkeyList();

  assert.ok(Array.isArray(passkeys));
  assert.equal(passkeys.length, 0);
});

test("passkeyRename sends PATCH to /v1/auth/passkeys/{id}", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({
    data: {
      message: "Passkey updated successfully",
      passkey: {
        id: "pk-123",
        name: "New Name",
        device_type: "platform",
        backed_up: true,
        last_used_at: null,
        created_at: "2024-01-10T10:00:00Z",
      },
    },
  });

  const result = await sdk.passkeyRename("pk-123", "New Name");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/passkeys/pk-123`);
  assert.equal(calls[0].init.method, "PATCH");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.name, "New Name");

  // Requires authentication
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");

  assert.ok(result.passkey);
  assert.equal(result.passkey.name, "New Name");
});

test("passkeyDelete sends DELETE to /v1/auth/passkeys/{id}", async () => {
  const { sdk, calls } = createAuthenticatedMockSdk({});

  await sdk.passkeyDelete("pk-456");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/v1/auth/passkeys/pk-456`);
  assert.equal(calls[0].init.method, "DELETE");

  // Requires authentication
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

// ---------------------------------------------------------------------------
// Acting Context tests (setActingContext, getActingContext, clearActingContext, isActing)
// ---------------------------------------------------------------------------

// Sample acting context for tests
const sampleActingContext = {
  token: "acting-token-123",
  managedUserUlid: "01hx9876543210fedcba",
  managedUserName: "Managed User",
  managedUserUsername: "manageduser",
  managedUserAvatar: "avatars/managed.jpg",
  expiresAt: new Date(Date.now() + 300000).toISOString(), // 5 minutes from now
  grantedScopes: ["edit_profile", "view_content"],
};

test("setActingContext stores context in memory", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  assert.equal(sdk.getActingContext(), null);

  sdk.setActingContext(sampleActingContext);

  const context = sdk.getActingContext();
  assert.equal(context.token, "acting-token-123");
  assert.equal(context.managedUserUlid, "01hx9876543210fedcba");
  assert.equal(context.managedUserName, "Managed User");
});

test("setActingContext(null) clears context", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  sdk.setActingContext(sampleActingContext);
  assert.ok(sdk.getActingContext());

  sdk.setActingContext(null);

  assert.equal(sdk.getActingContext(), null);
});

test("getActingContext returns null when no context set", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  const context = sdk.getActingContext();

  assert.equal(context, null);
});

test("clearActingContext removes context", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  sdk.setActingContext(sampleActingContext);
  assert.ok(sdk.getActingContext());

  sdk.clearActingContext();

  assert.equal(sdk.getActingContext(), null);
});

test("isActing returns true with valid non-expired context", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  sdk.setActingContext(sampleActingContext);

  assert.equal(sdk.isActing(), true);
});

test("isActing returns false when no context set", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  assert.equal(sdk.isActing(), false);
});

test("isActing returns false and clears expired context", async () => {
  const { sdk } = createAuthenticatedMockSdk({});

  // Set context that has already expired
  const expiredContext = {
    ...sampleActingContext,
    expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
  };

  sdk.setActingContext(expiredContext);

  // isActing should detect expiration and return false
  assert.equal(sdk.isActing(), false);

  // Context should be auto-cleared
  assert.equal(sdk.getActingContext(), null);
});
