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
import { CcPlatformSdk } from "../dist/platformSdk.js";
import { HybridTokenProvider, MemoryTokenProvider } from "../dist/auth.js";
import { DEFAULT_DB_NAME } from "../dist/cache/cacheDB.js";

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

function createMockSessionStore(initialTokens = null) {
  let tokens = initialTokens;
  return {
    async loadTokens() {
      return tokens;
    },
    async saveTokens(nextTokens) {
      tokens = nextTokens;
    },
    async clearTokens() {
      tokens = null;
    },
    getSnapshot() {
      return tokens;
    },
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

test("loginWithOAuth includes credentials when refresh-cookie mode is enabled", async () => {
  const { fetchImpl, calls } = createMockFetch({
    access_token: "oauth-access-token",
    refresh_token: "oauth-refresh-token",
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    useRefreshCookie: true,
  });

  await sdk.loginWithOAuth("google", "auth-code-123");

  assert.equal(calls[0].init.credentials, "include");
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

test("loginWithOAuth supports enveloped auth token responses", async () => {
  const { sdk } = createMockSdk({
    data: {
      accessToken: "enveloped-access-token",
      refreshToken: "enveloped-refresh-token",
    },
  });

  const tokens = await sdk.loginWithOAuth("google", "code");

  assert.equal(tokens.accessToken, "enveloped-access-token");
  assert.equal(tokens.refreshToken, "enveloped-refresh-token");
});

test("loginWithOAuth rejects malformed auth responses", async () => {
  const { sdk } = createMockSdk({});

  await assert.rejects(
    () => sdk.loginWithOAuth("google", "code"),
    /Invalid auth token response from \/v1\/auth\/google\/callback/,
  );
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

test("loginWithMagicLink includes credentials when refresh-cookie mode is enabled", async () => {
  const { fetchImpl, calls } = createMockFetch({
    access_token: "magic-access-token",
    refresh_token: "magic-refresh-token",
    token_type: "Bearer",
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    useRefreshCookie: true,
  });

  await sdk.loginWithMagicLink("user@example.com", "123456");

  assert.equal(calls[0].init.credentials, "include");
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

test("logout includes credentials when refresh-cookie mode is enabled", async () => {
  const { fetchImpl, calls } = createMockFetch({});
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    useRefreshCookie: true,
  });

  await sdk.logout();

  assert.equal(calls[0].init.credentials, "include");
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

test("deleteAccount includes credentials when refresh-cookie mode is enabled", async () => {
  const { fetchImpl, calls } = createMockFetch({});
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    useRefreshCookie: true,
  });

  await sdk.deleteAccount();

  assert.equal(calls[0].init.credentials, "include");
});

// ---------------------------------------------------------------------------
// refreshToken tests
// ---------------------------------------------------------------------------

test("refreshToken sends POST to /auth/refresh (no /v1 prefix)", async () => {
  const { fetchImpl, calls } = createMockFetch({
    token_type: "Bearer",
    expires_in: 3600,
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
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
  assert.equal(calls[0].init.headers.Authorization, undefined);

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.refresh_token, "old-refresh-token");

  assert.equal(tokens.accessToken, "new-access-token");
  assert.equal(tokens.refreshToken, "new-refresh-token");
  assert.equal(sdk.getTokens().accessToken, "new-access-token");
});

test("refreshToken supports cookie-backed refresh without a persisted refresh token", async () => {
  const { fetchImpl, calls } = createMockFetch({
    token_type: "Bearer",
    expires_in: 3600,
    access_token: "cookie-access-token",
    refresh_token: "cookie-refresh-token",
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    useRefreshCookie: true,
  });

  const tokens = await sdk.refreshToken();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/auth/refresh`);
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(tokens.accessToken, "cookie-access-token");
  assert.equal(tokens.refreshToken, "cookie-refresh-token");
});

test("refreshToken sends refresh_token in body even when useRefreshCookie is enabled", async () => {
  // Multi-tenant API hosts (e.g. customer-owned parent domains) refuse the
  // cookie-only refresh path for cross-tenant safety. The SDK must send the
  // refresh_token in the body whenever it has one, regardless of cookie mode.
  const { fetchImpl, calls } = createMockFetch({
    token_type: "Bearer",
    expires_in: 3600,
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
  });

  const storage = createMockStorage();
  const tokenProvider = new HybridTokenProvider(
    storage,
    { accessToken: "old-token", refreshToken: "old-refresh-token" }
  );

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokenProvider,
    fetchImpl,
    useRefreshCookie: true,
  });

  const tokens = await sdk.refreshToken();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.credentials, "include");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.refresh_token, "old-refresh-token");

  assert.equal(tokens.accessToken, "new-access-token");
  assert.equal(tokens.refreshToken, "new-refresh-token");

  // After refresh, the new refresh token should still be available in storage
  // (no longer stripped under useRefreshCookie). This is what lets a subsequent
  // page reload restore the refresh token and call /auth/refresh again.
  assert.equal(sdk.getTokens().refreshToken, "new-refresh-token");
});

test("refreshToken dedupes concurrent refresh calls", async () => {
  let resolveRefresh;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return await new Promise((resolve) => {
      resolveRefresh = () =>
        resolve(
          new Response(
            JSON.stringify({
              access_token: "new-access-token",
              refresh_token: "new-refresh-token",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
    });
  };

  const storage = createMockStorage();
  const tokenProvider = new HybridTokenProvider(storage, {
    accessToken: "old-token",
    refreshToken: "old-refresh-token",
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    tokenProvider,
    fetchImpl,
  });

  const first = sdk.refreshToken();
  const second = sdk.refreshToken();

  await Promise.resolve();
  assert.equal(calls.length, 1);
  resolveRefresh();

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(firstResult, {
    accessToken: "new-access-token",
    refreshToken: "new-refresh-token",
  });
  assert.deepEqual(secondResult, firstResult);
  assert.equal(calls.length, 1);
});

test("refreshToken supports enveloped auth token responses", async () => {
  const { fetchImpl } = createMockFetch({
    data: {
      accessToken: "enveloped-access-token",
      refreshToken: "enveloped-refresh-token",
    },
  });
  const storage = createMockStorage();
  const tokenProvider = new HybridTokenProvider(
    storage,
    { accessToken: "old-token", refreshToken: "old-refresh-token" }
  );

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider,
  });

  const tokens = await sdk.refreshToken();

  assert.deepEqual(tokens, {
    accessToken: "enveloped-access-token",
    refreshToken: "enveloped-refresh-token",
  });
});

test("setSession persists tokens via async sessionStore", async () => {
  const { fetchImpl } = createMockFetch({});
  const sessionStore = createMockSessionStore();

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    sessionStore,
  });

  await sdk.setSession({
    accessToken: "session-access-token",
    refreshToken: "session-refresh-token",
  });

  assert.deepEqual(sessionStore.getSnapshot(), {
    accessToken: "session-access-token",
    refreshToken: "session-refresh-token",
  });
  assert.equal(sdk.getTokens().accessToken, "session-access-token");
});

test("restoreSession hydrates tokens from async sessionStore", async () => {
  const { fetchImpl } = createMockFetch({});
  const sessionStore = createMockSessionStore({
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    sessionStore,
  });

  const restored = await sdk.restoreSession();

  assert.deepEqual(restored, {
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
  });
  assert.equal(sdk.getTokens().accessToken, "stored-access-token");
});

test("restoreSession prefers newer persisted tokens over stale in-memory tokens", async () => {
  const { fetchImpl } = createMockFetch({});
  const sessionStore = createMockSessionStore({
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
  });
  const storage = createMockStorage();
  const tokenProvider = new HybridTokenProvider(storage, {
    accessToken: "stale-access-token",
    refreshToken: "stale-refresh-token",
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider,
    sessionStore,
  });

  const restored = await sdk.restoreSession();

  assert.deepEqual(restored, {
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
  });
  assert.deepEqual(sdk.getTokens(), {
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
  });
});

test("clearSession removes persisted tokens from async sessionStore", async () => {
  const { fetchImpl } = createMockFetch({});
  const sessionStore = createMockSessionStore({
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    sessionStore,
  });

  await sdk.restoreSession();
  await sdk.clearSession();

  assert.equal(sessionStore.getSnapshot(), null);
  assert.equal(sdk.getTokens(), null);
});

test("refreshToken returns null when no refresh token available", async () => {
  const { sdk } = createAuthenticatedMockSdk({});
  // createAuthenticatedMockSdk only sets accessToken, not refreshToken

  const result = await sdk.refreshToken();

  assert.equal(result, null);
});

test("refreshToken restores persisted session before refreshing", async () => {
  const { fetchImpl, calls } = createMockFetch({
    token_type: "Bearer",
    expires_in: 3600,
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
  });
  const sessionStore = createMockSessionStore({
    refreshToken: "stored-refresh-token",
  });

  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    sessionStore,
  });

  const result = await sdk.refreshToken();

  assert.equal(result.accessToken, "new-access-token");
  assert.equal(result.refreshToken, "new-refresh-token");
  // expires_in: 3600 is now captured as an absolute expiresAt.
  assert.ok(result.expiresAt, "expiresAt derived from expires_in");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/auth/refresh`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    refresh_token: "stored-refresh-token",
  });
  const snapshot = sessionStore.getSnapshot();
  assert.equal(snapshot.accessToken, "new-access-token");
  assert.equal(snapshot.refreshToken, "new-refresh-token");
  assert.ok(snapshot.expiresAt, "persisted session carries derived expiresAt");
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

test("refreshToken adopts a rotated refresh token instead of clearing on invalid_grant", async () => {
  // Another instance/tab won the refresh race: it rotated the token (persisting
  // the new one to the shared store) and Passport revoked ours.
  const sessionStore = createMockSessionStore({
    accessToken: "old-access-token",
    refreshToken: "old-refresh-token",
  });

  const fetchImpl = async () => {
    // The winner's rotation lands while our request is in flight.
    await sessionStore.saveTokens({
      accessToken: "rotated-access-token",
      refreshToken: "rotated-refresh-token",
    });
    return new Response(
      JSON.stringify({
        error: "invalid_grant",
        error_description: "The refresh token is invalid.",
        hint: "Token has been revoked",
      }),
      { status: 400 },
    );
  };

  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  const result = await sdk.refreshToken();

  assert.equal(result?.refreshToken, "rotated-refresh-token");
  assert.equal(sdk.getTokens().accessToken, "rotated-access-token");
  assert.ok(sdk.isAuthenticated(), "session survives losing the rotation race");
  assert.equal(sessionStore.getSnapshot().refreshToken, "rotated-refresh-token");
});

test("refreshToken still clears on invalid_grant when the stored token is unchanged", async () => {
  // Genuinely dead session: nobody rotated, so the store still holds our token.
  const sessionStore = createMockSessionStore({
    accessToken: "old-access-token",
    refreshToken: "old-refresh-token",
  });
  const { fetchImpl } = createMockFetch({ error: "invalid_grant" }, 400);

  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  const result = await sdk.refreshToken();

  assert.equal(result, null);
  assert.ok(!sdk.isAuthenticated());
  assert.equal(sessionStore.getSnapshot(), null, "dead session is cleared");
});

test("refreshToken still clears on a non-invalid_grant 401 even if the store changed", async () => {
  // Deliberate remote sign-out must log out, regardless of a rotated store.
  const sessionStore = createMockSessionStore({
    accessToken: "old-access-token",
    refreshToken: "old-refresh-token",
  });

  const fetchImpl = async () => {
    await sessionStore.saveTokens({
      accessToken: "rotated-access-token",
      refreshToken: "rotated-refresh-token",
    });
    return new Response(JSON.stringify({ message: "Unauthenticated." }), { status: 401 });
  };

  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  const result = await sdk.refreshToken();

  assert.equal(result, null);
  assert.ok(!sdk.isAuthenticated());
  assert.equal(sessionStore.getSnapshot(), null);
});

test("refreshToken returns null without clearing the session on malformed success payload", async () => {
  const { fetchImpl } = createMockFetch({});

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
  assert.deepEqual(sdk.getTokens(), {
    accessToken: "token",
    refreshToken: "refresh",
  });
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

// ---------------------------------------------------------------------------
// actingContext persistence via injected StorageLike (React Native support)
// ---------------------------------------------------------------------------

// Acting context is namespaced by dbName so sibling per-profile instances never
// share one entry. These SDKs pass no dbName, so they land on the default.
const ACTING_CONTEXT_KEY = `actingContext:${DEFAULT_DB_NAME}`;

/** In-memory StorageLike, standing in for MMKV/AsyncStorage on React Native. */
function makeMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

test("setActingContext persists to injected storage", async () => {
  const { fetchImpl } = createMockFetch({});
  const storage = makeMemoryStorage();
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, storage });

  sdk.setActingContext(sampleActingContext);

  const raw = storage.getItem(ACTING_CONTEXT_KEY);
  assert.ok(raw, "actingContext should be written to injected storage");
  assert.equal(JSON.parse(raw).managedUserUlid, sampleActingContext.managedUserUlid);
});

test("acting context survives a restart when storage is injected", async () => {
  const { fetchImpl } = createMockFetch({});
  const storage = makeMemoryStorage();

  const first = new CcPlatformSdk({ baseUrl, fetchImpl, storage });
  first.setActingContext(sampleActingContext);

  // Fresh instance sharing the same storage == an app restart. This is the
  // silent failure on React Native: without injection nothing throws, the
  // selection just vanishes.
  const second = new CcPlatformSdk({ baseUrl, fetchImpl, storage });
  const restored = second.getActingContext();

  assert.ok(restored, "acting context should be restored from storage");
  assert.equal(restored.managedUserUlid, sampleActingContext.managedUserUlid);
  assert.equal(restored.token, sampleActingContext.token);
});

test("clearActingContext removes the persisted copy", async () => {
  const { fetchImpl } = createMockFetch({});
  const storage = makeMemoryStorage();
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, storage });

  sdk.setActingContext(sampleActingContext);
  sdk.clearActingContext();

  assert.equal(storage.getItem(ACTING_CONTEXT_KEY), null);
  assert.equal(new CcPlatformSdk({ baseUrl, fetchImpl, storage }).getActingContext(), null);
});

test("setActingContext(null) removes the persisted copy", async () => {
  const { fetchImpl } = createMockFetch({});
  const storage = makeMemoryStorage();
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, storage });

  sdk.setActingContext(sampleActingContext);
  sdk.setActingContext(null);

  assert.equal(storage.getItem(ACTING_CONTEXT_KEY), null);
});

test("corrupt persisted acting context is discarded, not thrown", async () => {
  const { fetchImpl } = createMockFetch({});
  const storage = makeMemoryStorage({ [ACTING_CONTEXT_KEY]: "{not valid json" });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, storage });

  assert.equal(sdk.getActingContext(), null);
  assert.equal(storage.getItem(ACTING_CONTEXT_KEY), null, "bad entry should be cleared");
});

test("acting context does not persist without storage or localStorage", async () => {
  const { fetchImpl } = createMockFetch({});
  // No storage option and no localStorage in Node: the no-op fallback applies.
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl });

  sdk.setActingContext(sampleActingContext);

  // Still works in memory for the life of the instance...
  assert.equal(sdk.getActingContext().token, sampleActingContext.token);
  // ...but a fresh instance starts clean, and nothing throws.
  assert.equal(new CcPlatformSdk({ baseUrl, fetchImpl }).getActingContext(), null);
});

// ---------------------------------------------------------------------------
// Access-token validity helpers (Gap 1)
// ---------------------------------------------------------------------------

test("isAccessTokenValid true for a live token, false once expired", async () => {
  const { fetchImpl } = createMockFetch({});
  const future = new Date(Date.now() + 300_000).toISOString();
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokens: { accessToken: "t", expiresAt: future },
  });

  assert.equal(sdk.isAccessTokenValid(), true);
  assert.equal(sdk.isAccessTokenExpired(), false);

  const past = new Date(Date.now() - 1000).toISOString();
  sdk.setTokens({ accessToken: "t", expiresAt: past });
  assert.equal(sdk.isAccessTokenValid(), false);
  assert.equal(sdk.isAccessTokenExpired(), true);
});

test("isAccessTokenValid false when expiresAt is unknown", async () => {
  const { fetchImpl } = createMockFetch({});
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokens: { accessToken: "t" }, // no expiresAt
  });

  // Unknown expiry is not provably valid -> callers should refresh.
  assert.equal(sdk.isAccessTokenValid(), false);
  // ...but it isn't provably expired either.
  assert.equal(sdk.isAccessTokenExpired(), false);
  // Presence check still passes (back-compat).
  assert.equal(sdk.isAuthenticated(), true);
});

test("skewMs treats an about-to-expire token as expired", async () => {
  const { fetchImpl } = createMockFetch({});
  const soon = new Date(Date.now() + 10_000).toISOString(); // 10s out
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokens: { accessToken: "t", expiresAt: soon },
  });

  assert.equal(sdk.isAccessTokenValid(30_000), false); // 30s skew
  assert.equal(sdk.isAccessTokenValid(5_000), true); // 5s skew
});

// ---------------------------------------------------------------------------
// ready() + restore-when-expired (Gap 2)
// ---------------------------------------------------------------------------

test("extractAuthTokens derives expiresAt from expires_in", async () => {
  const { fetchImpl } = createMockFetch({
    access_token: "a",
    refresh_token: "r",
    expires_in: 3600,
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl });

  const tokens = await sdk.login("u@e.com", "pw");
  assert.ok(tokens.expiresAt);
  const skew = new Date(tokens.expiresAt).getTime() - Date.now();
  // ~1h out, allow generous slack for test timing.
  assert.ok(skew > 3_500_000 && skew < 3_700_000, `expiresAt ~1h: ${skew}ms`);
});

test("restoreSession refreshes a stored-but-expired token", async () => {
  const { fetchImpl, calls } = createMockFetch({
    access_token: "fresh-access",
    refresh_token: "fresh-refresh",
    expires_in: 3600,
  });
  const sessionStore = createMockSessionStore({
    accessToken: "stale-access",
    refreshToken: "stored-refresh",
    expiresAt: new Date(Date.now() - 1000).toISOString(), // expired
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  const result = await sdk.restoreSession();

  assert.equal(result.accessToken, "fresh-access");
  assert.equal(calls.length, 1, "hit /auth/refresh once");
  assert.equal(calls[0].url, `${baseUrl}/auth/refresh`);
});

test("restoreSession does not refresh a live stored token", async () => {
  const { fetchImpl, calls } = createMockFetch({});
  const sessionStore = createMockSessionStore({
    accessToken: "live-access",
    refreshToken: "stored-refresh",
    expiresAt: new Date(Date.now() + 300_000).toISOString(), // live
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  const result = await sdk.restoreSession();

  assert.equal(result.accessToken, "live-access");
  assert.equal(calls.length, 0, "no network round-trip for a live token");
});

test("restoreSession mints access when only a refresh token is stored", async () => {
  // Cookie-mode / hard-reload: session store keeps refresh_token only; access
  // lives in MemoryTokenProvider and is gone. ready()/restoreSession must mint
  // a bearer so consumers do not need ensureSessionReady glue.
  const { fetchImpl, calls } = createMockFetch({
    access_token: "minted-access",
    refresh_token: "rotated-refresh",
    expires_in: 3600,
  });
  const sessionStore = createMockSessionStore({
    refreshToken: "stored-refresh",
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  const result = await sdk.restoreSession();

  assert.equal(result.accessToken, "minted-access");
  assert.equal(sdk.getTokens()?.accessToken, "minted-access");
  assert.equal(calls.length, 1, "hit /auth/refresh once");
  assert.equal(calls[0].url, `${baseUrl}/auth/refresh`);
});

test("restoreSession keeps a live in-memory bearer when the store holds refresh only", async () => {
  // Refresh-cookie hosts (and any "persist refresh only" policy) produce a
  // snapshot with no access token by design, not because the session ended.
  // Overwriting memory with it destroyed a perfectly good bearer, forced a
  // network refresh on every restore, and left nothing at all when that refresh
  // could not run — which is how a multi-profile switch produced a dead session.
  const { fetchImpl, calls } = createMockFetch({});
  const sessionStore = createMockSessionStore({ refreshToken: "stored-refresh" });
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    sessionStore,
    tokenProvider: new MemoryTokenProvider({
      accessToken: "live-access",
      refreshToken: "memory-refresh",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  });

  const result = await sdk.restoreSession();

  assert.equal(result.accessToken, "live-access", "kept the live bearer");
  assert.equal(sdk.getTokens()?.accessToken, "live-access");
  assert.equal(
    result.refreshToken,
    "stored-refresh",
    "adopted the persisted refresh token, which may have rotated",
  );
  assert.equal(calls.length, 0, "no refresh round-trip was needed");
});

test("a stored access token still wins over the in-memory one", async () => {
  // The inverse guard: another tab may have refreshed and persisted a newer
  // bearer, so preserving memory must not shadow it.
  const { fetchImpl } = createMockFetch({});
  const sessionStore = createMockSessionStore({
    accessToken: "newer-access",
    refreshToken: "newer-refresh",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  });
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    sessionStore,
    tokenProvider: new MemoryTokenProvider({
      accessToken: "older-access",
      refreshToken: "older-refresh",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  });

  const result = await sdk.restoreSession();

  assert.equal(result.accessToken, "newer-access");
  assert.equal(sdk.getTokens()?.accessToken, "newer-access");
});

test("ensureLiveSession revives a session after ready() already settled", async () => {
  // ready() answers "did the first restore settle?" exactly once. A session
  // whose bearer is cleared afterwards must still be revivable — this is what
  // switching back to a background profile depends on.
  const { fetchImpl, calls } = createMockFetch({
    access_token: "minted-access",
    refresh_token: "rotated-refresh",
    expires_in: 3600,
  });
  // Refresh-only persistence, so reviving genuinely requires a network mint
  // rather than reading a bearer back out of the store.
  let storedRefresh = "stored-refresh";
  const sessionStore = {
    async loadTokens() {
      return storedRefresh ? { refreshToken: storedRefresh } : null;
    },
    async saveTokens(tokens) {
      storedRefresh = tokens?.refreshToken;
    },
    async clearTokens() {
      storedRefresh = undefined;
    },
  };
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  await sdk.ready();
  assert.equal(sdk.getTokens()?.accessToken, "minted-access");

  sdk.setTokens(null);
  await sdk.ready();
  assert.equal(sdk.getTokens()?.accessToken, undefined, "the settled promise does nothing");

  const revived = await sdk.ensureLiveSession();

  assert.equal(revived?.accessToken, "minted-access");
  assert.equal(calls.length, 2, "minted again instead of trusting ready()");
});

test("ensureLiveSession short-circuits on an already-live token", async () => {
  const { fetchImpl, calls } = createMockFetch({});
  const sdk = new CcPlatformSdk({
    baseUrl,
    fetchImpl,
    tokenProvider: new MemoryTokenProvider({
      accessToken: "live-access",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  });

  const result = await sdk.ensureLiveSession();

  assert.equal(result?.accessToken, "live-access");
  assert.equal(calls.length, 0);
});

test("ensureLiveSession returns null when there is nothing to restore", async () => {
  const { fetchImpl } = createMockFetch({});
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl });

  assert.equal(await sdk.ensureLiveSession(), null);
});

test("ensureLiveSession returns null when the refresh fails and the bearer is expired", async () => {
  // restoreSession() falls through to the stored tokens when a refresh fails
  // transiently (5xx), so an expired access token is still *present* afterwards.
  // ensureLiveSession promises a live bearer or null — presence is not liveness,
  // and handing this one back sends the caller straight into a 401.
  const { fetchImpl, calls } = createMockFetch({ message: "Bad gateway" }, 502);
  const sessionStore = createMockSessionStore({
    accessToken: "STALE-ACCESS",
    refreshToken: "stored-refresh",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  assert.equal(await sdk.ensureLiveSession(), null);
  assert.ok(calls.length > 0, "it did try to refresh");
  assert.equal(sdk.isAccessTokenValid(), false);
  // A 5xx does not revoke anything, so the persisted refresh token must survive
  // for the next attempt. (The in-memory copy is separately dropped by
  // mergeStoredSession — tracked apart from this fix.)
  assert.equal(sessionStore.getSnapshot()?.refreshToken, "stored-refresh");
});

test("ready() mints access for a refresh-only stored session", async () => {
  const { fetchImpl, calls } = createMockFetch({
    access_token: "minted-access",
    refresh_token: "rotated-refresh",
    expires_in: 3600,
  });
  const sessionStore = createMockSessionStore({
    refreshToken: "stored-refresh",
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  await sdk.ready();

  assert.equal(sdk.getTokens()?.accessToken, "minted-access");
  assert.equal(calls.length, 1);
});

test("restoreSession refreshes when the provider holds the same token but no expiresAt", async () => {
  // Divergence case: in-memory provider already has the stored access token but
  // without its expiresAt (legacy token pre-dating the field, or a seeded
  // Memory/Storage provider). restoreStoredSession's tokensChanged check skips
  // reinstall, so the gate must read the RETURNED object's expiresAt, not the
  // in-memory provider — else it hands back a dead bearer without refreshing.
  const { fetchImpl, calls } = createMockFetch({
    access_token: "fresh-access",
    refresh_token: "fresh-refresh",
    expires_in: 3600,
  });
  const expiredAt = new Date(Date.now() - 1000).toISOString();
  let provider = {
    accessToken: "stale-access",
    refreshToken: "stored-refresh",
    expiresAt: null, // no expiry known in memory
  };
  const tokenProvider = {
    getTokens: () =>
      provider.accessToken || provider.refreshToken ? { ...provider } : null,
    setTokens: (t) => {
      provider = t
        ? { accessToken: t.accessToken ?? null, refreshToken: t.refreshToken ?? null, expiresAt: t.expiresAt ?? null }
        : { accessToken: null, refreshToken: null, expiresAt: null };
    },
    clearTokens: () => {
      provider = { accessToken: null, refreshToken: null, expiresAt: null };
    },
  };
  const sessionStore = createMockSessionStore({
    accessToken: "stale-access", // same access token as in memory
    refreshToken: "stored-refresh",
    expiresAt: expiredAt, // but store knows it is expired
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, tokenProvider, sessionStore });

  const result = await sdk.restoreSession();

  assert.equal(result.accessToken, "fresh-access", "returned a refreshed, live token");
  assert.equal(calls.length, 1, "refreshed instead of returning the stale token");
});

test("ready() runs the first restore once and is idempotent", async () => {
  const { fetchImpl, calls } = createMockFetch({
    access_token: "fresh-access",
    refresh_token: "fresh-refresh",
    expires_in: 3600,
  });
  const sessionStore = createMockSessionStore({
    accessToken: "stale-access",
    refreshToken: "stored-refresh",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  await sdk.ready();
  await sdk.ready(); // second await must not trigger another restore/refresh

  assert.equal(calls.length, 1, "restore/refresh ran exactly once");
  assert.equal(sdk.getTokens().accessToken, "fresh-access");
});

test("ready() resolves for a guest (no stored session)", async () => {
  const { fetchImpl, calls } = createMockFetch({});
  const sessionStore = createMockSessionStore(null);
  const sdk = new CcPlatformSdk({ baseUrl, fetchImpl, sessionStore });

  await sdk.ready(); // must not hang or throw
  assert.equal(calls.length, 0);
  assert.equal(sdk.isAuthenticated(), false);
});
