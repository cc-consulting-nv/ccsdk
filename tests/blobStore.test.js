import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { IndexedDBBlobStore, MemoryBlobStore } from "../dist/blobStore.js";

// ── IndexedDBBlobStore ─────────────────────────────────────────────────

test("IndexedDBBlobStore.put and get round-trips a File", async () => {
  const store = new IndexedDBBlobStore({ dbName: "test-idb-blobstore-1" });

  const file = new File(["hello"], "test.txt", { type: "text/plain" });
  await store.put("key1", file);

  const retrieved = await store.get("key1");
  assert.ok(retrieved);
  assert.equal(retrieved.name, "test.txt");
  assert.equal(retrieved.type, "text/plain");
  assert.equal(retrieved.size, 5);
  const text = await retrieved.text();
  assert.equal(text, "hello");
});

test("IndexedDBBlobStore.get returns null for missing key", async () => {
  const store = new IndexedDBBlobStore({ dbName: "test-idb-blobstore-2" });
  const result = await store.get("nonexistent");
  assert.equal(result, null);
});

test("IndexedDBBlobStore.delete removes entry", async () => {
  const store = new IndexedDBBlobStore({ dbName: "test-idb-blobstore-3" });

  const file = new File(["data"], "file.bin", { type: "application/octet-stream" });
  await store.put("key1", file);

  let retrieved = await store.get("key1");
  assert.ok(retrieved);

  await store.delete("key1");
  retrieved = await store.get("key1");
  assert.equal(retrieved, null);
});

test("IndexedDBBlobStore.list returns stored keys", async () => {
  const store = new IndexedDBBlobStore({ dbName: "test-idb-blobstore-4" });

  await store.put("a", new File(["1"], "a.txt"));
  await store.put("b", new File(["2"], "b.txt"));
  await store.put("c", new File(["3"], "c.txt"));

  const keys = await store.list();
  assert.ok(keys.includes("a"));
  assert.ok(keys.includes("b"));
  assert.ok(keys.includes("c"));
  assert.equal(keys.length, 3);
});

test("IndexedDBBlobStore.list returns empty for empty store", async () => {
  const store = new IndexedDBBlobStore({ dbName: "test-idb-blobstore-5" });
  const keys = await store.list();
  assert.ok(Array.isArray(keys));
  assert.equal(keys.length, 0);
});

test("IndexedDBBlobStore.put overwrites existing entry", async () => {
  const store = new IndexedDBBlobStore({ dbName: "test-idb-blobstore-6" });

  await store.put("key1", new File(["v1"], "file.txt"));
  await store.put("key1", new File(["v2"], "file2.txt", { type: "text/plain" }));

  const retrieved = await store.get("key1");
  assert.ok(retrieved);
  assert.equal(retrieved.name, "file2.txt");
  const text = await retrieved.text();
  assert.equal(text, "v2");
});

test("IndexedDBBlobStore handles multiple entries with same id across instances", async () => {
  const store1 = new IndexedDBBlobStore({ dbName: "test-idb-blobstore-7" });

  await store1.put("shared", new File(["data"], "shared.txt"));

  const store2 = new IndexedDBBlobStore({ dbName: "test-idb-blobstore-7" });
  const retrieved = await store2.get("shared");
  assert.ok(retrieved);
  assert.equal(retrieved.name, "shared.txt");
});

// ── MemoryBlobStore ────────────────────────────────────────────────────

test("MemoryBlobStore.put and get round-trips a File", async () => {
  const store = new MemoryBlobStore();

  const file = new File(["hello"], "test.txt", { type: "text/plain" });
  await store.put("key1", file);

  const retrieved = await store.get("key1");
  assert.ok(retrieved);
  assert.equal(retrieved.name, "test.txt");
  assert.equal(retrieved.type, "text/plain");
  assert.equal(retrieved.size, 5);
});

test("MemoryBlobStore.get returns null for missing key", async () => {
  const store = new MemoryBlobStore();
  const result = await store.get("nonexistent");
  assert.equal(result, null);
});

test("MemoryBlobStore.delete removes entry", async () => {
  const store = new MemoryBlobStore();
  await store.put("key1", new File(["data"], "file.txt"));

  let retrieved = await store.get("key1");
  assert.ok(retrieved);

  await store.delete("key1");
  retrieved = await store.get("key1");
  assert.equal(retrieved, null);
});

test("MemoryBlobStore.list returns stored keys", async () => {
  const store = new MemoryBlobStore();
  await store.put("a", new File(["1"], "a.txt"));
  await store.put("b", new File(["2"], "b.txt"));
  await store.put("c", new File(["3"], "c.txt"));

  const keys = await store.list();
  const expected = ["a", "b", "c"];
  assert.equal(keys.length, 3);
  for (const k of expected) assert.ok(keys.includes(k));
});

test("MemoryBlobStore.list returns empty for empty store", async () => {
  const store = new MemoryBlobStore();
  const keys = await store.list();
  assert.ok(Array.isArray(keys));
  assert.equal(keys.length, 0);
});

test("MemoryBlobStore handles blob types", async () => {
  const store = new MemoryBlobStore();
  const blob = new Blob(["binary data"]);
  const file = new File([blob], "image.png", { type: "image/png" });

  await store.put("img", file);
  const retrieved = await store.get("img");
  assert.ok(retrieved);
  assert.equal(retrieved.type, "image/png");
  assert.equal(retrieved.name, "image.png");
});
