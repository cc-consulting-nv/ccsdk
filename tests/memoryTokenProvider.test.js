import test from "node:test";
import assert from "node:assert/strict";
import { MemoryTokenProvider } from "../dist/auth.js";

test("MemoryTokenProvider defaults to null tokens", async () => {
  const provider = new MemoryTokenProvider();
  assert.equal(provider.getTokens(), null);
});

test("MemoryTokenProvider stores and retrieves tokens", async () => {
  const provider = new MemoryTokenProvider({ accessToken: "tok", refreshToken: "ref" });
  const tokens = provider.getTokens();
  assert.equal(tokens.accessToken, "tok");
  assert.equal(tokens.refreshToken, "ref");
});

test("MemoryTokenProvider constructor accepts null", async () => {
  const provider = new MemoryTokenProvider(null);
  assert.equal(provider.getTokens(), null);
});

test("MemoryTokenProvider.setTokens stores tokens", async () => {
  const provider = new MemoryTokenProvider();
  provider.setTokens({ accessToken: "new-tok", refreshToken: "new-ref" });
  assert.equal(provider.getTokens().accessToken, "new-tok");
});

test("MemoryTokenProvider.setTokens(null) clears tokens", async () => {
  const provider = new MemoryTokenProvider({ accessToken: "tok" });
  provider.setTokens(null);
  assert.equal(provider.getTokens(), null);
});

test("MemoryTokenProvider.clearTokens removes tokens", async () => {
  const provider = new MemoryTokenProvider({ accessToken: "tok", refreshToken: "ref" });
  provider.clearTokens();
  assert.equal(provider.getTokens(), null);
});
