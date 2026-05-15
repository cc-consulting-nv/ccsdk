import test from "node:test";
import assert from "node:assert/strict";
import { StorageTokenProvider } from "../dist/auth.js";

function createMockStorage(initialData = {}) {
  const store = new Map(Object.entries(initialData));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    _store: store,
  };
}

test("StorageTokenProvider reads tokens from storage", async () => {
  const mock = createMockStorage({
    auth_tokens: JSON.stringify({ accessToken: "tok", refreshToken: "ref" }),
  });
  const provider = new StorageTokenProvider(mock);
  const tokens = provider.getTokens();
  assert.equal(tokens.accessToken, "tok");
  assert.equal(tokens.refreshToken, "ref");
});

test("StorageTokenProvider returns null when key missing", async () => {
  const mock = createMockStorage({});
  const provider = new StorageTokenProvider(mock);
  assert.equal(provider.getTokens(), null);
});

test("StorageTokenProvider returns null on malformed JSON", async () => {
  const mock = createMockStorage({ auth_tokens: "not json }{" });
  const provider = new StorageTokenProvider(mock);
  assert.equal(provider.getTokens(), null);
});

test("StorageTokenProvider.setTokens writes to storage", async () => {
  const mock = createMockStorage({});
  const provider = new StorageTokenProvider(mock);
  provider.setTokens({ accessToken: "new-tok", refreshToken: "new-ref" });
  const raw = mock.getItem("auth_tokens");
  const tokens = JSON.parse(raw);
  assert.equal(tokens.accessToken, "new-tok");
});

test("StorageTokenProvider.setTokens(null) removes key from storage", async () => {
  const mock = createMockStorage({
    auth_tokens: JSON.stringify({ accessToken: "tok" }),
  });
  const provider = new StorageTokenProvider(mock);
  provider.setTokens(null);
  assert.equal(mock.getItem("auth_tokens"), null);
});

test("StorageTokenProvider.clearTokens removes key", async () => {
  const mock = createMockStorage({
    auth_tokens: JSON.stringify({ accessToken: "tok" }),
  });
  const provider = new StorageTokenProvider(mock);
  provider.clearTokens();
  assert.equal(mock.getItem("auth_tokens"), null);
});

test("StorageTokenProvider uses custom key name", async () => {
  const mock = createMockStorage({
    my_tokens: JSON.stringify({ accessToken: "custom-tok" }),
  });
  const provider = new StorageTokenProvider(mock, "my_tokens");
  const tokens = provider.getTokens();
  assert.equal(tokens.accessToken, "custom-tok");
});
