/**
 * Business Claim SDK Tests (mocked HTTP)
 *
 * Verifies requestBusinessClaim (step 1, multipart) and verifyBusinessClaim
 * (step 2, JSON) — correct endpoints, FormData/JSON body shape, and auth headers.
 *
 * Endpoint note: step 1 (request) posts to /claim/verify and step 2 (verify)
 * posts to /claim. This matches the API routes — see cc-api
 * routes/api/v1/business-directory.php: claim/verify -> sendClaimEmailVerification,
 * claim -> submitClaimRequest.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

const baseUrl = "https://api.example.com";

function createMockSdk(responseData, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responseData), { status });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });
  return { sdk, calls };
}

const claimRequestResponse = {
  success: true,
  message: "Please check your email for a verification code.",
  data: {
    pending_id: "01hxpend000000000000000001",
    requires_verification: true,
    email: "j***@example.com",
  },
};

const claimVerifyResponse = {
  success: true,
  message: "Claim submitted.",
};

const sampleInput = {
  name: "Jane Owner",
  email: "jane@example.com",
  phone: "+18681234567",
  position: "Owner",
  message: "I run this business.",
};

// ---------------------------------------------------------------------------
// requestBusinessClaim (step 1)
// ---------------------------------------------------------------------------

test("requestBusinessClaim posts multipart to /claim/verify", async () => {
  const { sdk, calls } = createMockSdk(claimRequestResponse, 201);

  await sdk.requestBusinessClaim("01hxbiz0000000000000000001", sampleInput);

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/businesses/01hxbiz0000000000000000001/claim/verify");
  assert.equal(calls[0].init.method, "POST");
  // FormData body must not carry a JSON Content-Type (boundary is auto-set)
  assert.ok(calls[0].init.body instanceof FormData);
  assert.equal(calls[0].init.headers["Content-Type"], undefined);
});

test("requestBusinessClaim sends name/email/phone/position/message in FormData", async () => {
  const { sdk, calls } = createMockSdk(claimRequestResponse, 201);

  await sdk.requestBusinessClaim("01hxbiz0000000000000000001", sampleInput);

  const body = calls[0].init.body;
  assert.equal(body.get("name"), "Jane Owner");
  assert.equal(body.get("email"), "jane@example.com");
  assert.equal(body.get("phone"), "+18681234567");
  assert.equal(body.get("position"), "Owner");
  assert.equal(body.get("message"), "I run this business.");
});

test("requestBusinessClaim omits optional phone/message when not provided", async () => {
  const { sdk, calls } = createMockSdk(claimRequestResponse, 201);

  await sdk.requestBusinessClaim("01hxbiz0000000000000000001", {
    name: "Jane Owner",
    email: "jane@example.com",
    position: "Owner",
  });

  const body = calls[0].init.body;
  assert.equal(body.has("phone"), false);
  assert.equal(body.has("message"), false);
  assert.equal(body.has("document"), false);
});

test("requestBusinessClaim attaches document when provided", async () => {
  const { sdk, calls } = createMockSdk(claimRequestResponse, 201);

  const doc = new File(["pdf-bytes"], "proof.pdf", { type: "application/pdf" });
  await sdk.requestBusinessClaim("01hxbiz0000000000000000001", sampleInput, doc);

  const body = calls[0].init.body;
  const sent = body.get("document");
  assert.ok(sent instanceof File);
  assert.equal(sent.name, "proof.pdf");
});

test("requestBusinessClaim includes authorization header", async () => {
  const { sdk, calls } = createMockSdk(claimRequestResponse, 201);

  await sdk.requestBusinessClaim("01hxbiz0000000000000000001", sampleInput);

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

test("requestBusinessClaim returns pending_id from response data", async () => {
  const { sdk } = createMockSdk(claimRequestResponse, 201);

  const result = await sdk.requestBusinessClaim("01hxbiz0000000000000000001", sampleInput);

  assert.equal(result.success, true);
  assert.equal(result.data?.pending_id, "01hxpend000000000000000001");
});

// ---------------------------------------------------------------------------
// verifyBusinessClaim (step 2)
// ---------------------------------------------------------------------------

test("verifyBusinessClaim posts JSON to /claim", async () => {
  const { sdk, calls } = createMockSdk(claimVerifyResponse, 200);

  await sdk.verifyBusinessClaim(
    "01hxbiz0000000000000000001",
    "01hxpend000000000000000001",
    "123456",
  );

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/businesses/01hxbiz0000000000000000001/claim");
  assert.equal(calls[0].init.method, "POST");
});

test("verifyBusinessClaim sends pending_id and verification_code in JSON body", async () => {
  const { sdk, calls } = createMockSdk(claimVerifyResponse, 200);

  await sdk.verifyBusinessClaim(
    "01hxbiz0000000000000000001",
    "01hxpend000000000000000001",
    "123456",
  );

  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.pending_id, "01hxpend000000000000000001");
  assert.equal(body.verification_code, "123456");
});

test("verifyBusinessClaim includes authorization header", async () => {
  const { sdk, calls } = createMockSdk(claimVerifyResponse, 200);

  await sdk.verifyBusinessClaim(
    "01hxbiz0000000000000000001",
    "01hxpend000000000000000001",
    "123456",
  );

  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});
