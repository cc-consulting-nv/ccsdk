import test from "node:test";
import assert from "node:assert/strict";

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

// Import the cache so persister.ts imports resolve
import { CacheDB } from "../dist/cache/cacheDB.js";
import { createDexieQueryPersister } from "../dist/persister.js";

test("createDexieQueryPersister returns object with persistClient, restoreClient, removeClient", async () => {
  const cache = new CacheDB("ccsdk-test-persister-q1");
  const persister = createDexieQueryPersister(cache);
  assert.equal(typeof persister.persistClient, "function");
  assert.equal(typeof persister.restoreClient, "function");
  assert.equal(typeof persister.removeClient, "function");
});

test("persister.persistClient writes timestamped client to metadata", async () => {
  const cache = new CacheDB("ccsdk-test-persister-q2");
  await cache.open();
  const persister = createDexieQueryPersister(cache);

  const mockClient = { key1: "val1", key2: 42 };
  await persister.persistClient(mockClient);

  const raw = await cache.getMetadata("queryClient");
  assert.ok(raw);
  assert.ok(typeof raw.timestamp === "number");
  assert.equal(raw.client.key1, "val1");
  assert.equal(raw.client.key2, 42);
});

test("persister.restoreClient returns client when within maxAge", async () => {
  const cache = new CacheDB("ccsdk-test-persister-q3");
  await cache.open();
  const persister = createDexieQueryPersister(cache, { maxAge: 10000 });

  const mockClient = { key1: "val1", key2: 42 };
  await persister.persistClient(mockClient);

  const restored = await persister.restoreClient();
  assert.equal(restored.key1, "val1");
  assert.equal(restored.key2, 42);
});

test("persister.restoreClient returns undefined when maxAge exceeded", async () => {
  const cache = new CacheDB("ccsdk-test-persister-q4");
  await cache.open();
  // Manually store an old timestamp so maxAge is exceeded
  await cache.setMetadata("queryClient", {
    timestamp: Date.now() - 100000, // 100s old
    client: { key1: "val1" },
  });

  const persister = createDexieQueryPersister(cache, { maxAge: 50, key: "queryClient" });
  const restored = await persister.restoreClient();
  assert.equal(restored, undefined);
});

test("persister.removeClient clears persisted state", async () => {
  const cache = new CacheDB("ccsdk-test-persister-q5");
  await cache.open();
  const persister = createDexieQueryPersister(cache, { maxAge: 10000 });

  const mockClient = { key1: "val1" };
  await persister.persistClient(mockClient);

  await persister.removeClient();
  const restored = await persister.restoreClient();
  assert.equal(restored, undefined);
});

test("persister uses custom key from options", async () => {
  const cache = new CacheDB("ccsdk-test-persister-q6");
  await cache.open();
  const persister = createDexieQueryPersister(cache, { key: "my-custom-query-client" });

  const mockClient = { key1: "val1" };
  await persister.persistClient(mockClient);

  const restored = await persister.restoreClient();
  assert.equal(restored.key1, "val1");
});
