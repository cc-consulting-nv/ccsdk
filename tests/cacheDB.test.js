import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { CacheDB } from "../dist/cache/cacheDB.js";

let dbCounter = 0;
function freshDb(ttlMs, maxCapacity) {
  // Unique DB name per test prevents Dexie cross-contamination.
  dbCounter += 1;
  return new CacheDB(ttlMs, `test-cache-${dbCounter}-${Date.now()}`, maxCapacity);
}

const HOUR = 60 * 60 * 1000;

// ---- clearAll ----------------------------------------------------------

test("clearAll wipes the users store", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setUser("01ABC", { ulid: "01ABC", username: "alice" });
  const before = await cache.getUser("01ABC");
  assert.ok(before, "user should be cached before clearAll");

  await cache.clearAll();

  const after = await cache.getUser("01ABC");
  assert.equal(after, null, "users store should be empty after clearAll");
});

test("clearAll wipes posts store", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setPost("01POST", { ulid: "01POST", title: "Hello" });
  await cache.clearAll();

  const after = await cache.getPost("01POST");
  assert.equal(after, null);
});

// ---- setMetadata sanitization -----------------------------------------

test("setMetadata stores plain serializable values", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setMetadata("greeting", "hello");
  const value = await cache.getMetadata("greeting");
  assert.equal(value, "hello");
});

test("setMetadata sanitizes function values without throwing", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  // Functions are not structured-cloneable. Without sanitize, this would
  // throw DataCloneError. With the wrap, it should swallow + warn.
  await assert.doesNotReject(() =>
    cache.setMetadata("withFn", { fn: () => 1, ok: true })
  );

  // After sanitize, the function key is dropped but the rest persists.
  const value = await cache.getMetadata("withFn");
  assert.deepEqual(value, { ok: true });
});

// ---- trimCache: TTL-based removal --------------------------------------

test("trimCache removes posts whose cachedAt is past TTL", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  // Insert a post, then directly age its cachedAt past TTL via Dexie put.
  await cache.setPost("01STALE", { ulid: "01STALE", title: "old" });
  // Use the underlying Dexie table to backdate cachedAt.
  const inner = cache.db.posts;
  const entry = await inner.get("01STALE");
  await inner.put({ ...entry, cachedAt: Date.now() - HOUR - 1000 });

  await cache.setPost("01FRESH", { ulid: "01FRESH", title: "new" });

  const removed = await cache.trimCache();
  assert.ok(removed >= 1, `expected to trim at least 1 stale entry, got ${removed}`);

  // Stale entry gone.
  assert.equal(await inner.get("01STALE"), undefined);
  // Fresh entry preserved.
  assert.ok(await inner.get("01FRESH"));
});

test("trimCache uses cachedAt, not lastAccessed (frequently-read stale data still expires)", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setPost("01HOT", { ulid: "01HOT", title: "hot but old" });

  // Backdate cachedAt past TTL but keep lastAccessed fresh (simulating
  // an entry that gets read often but whose underlying data is stale).
  const inner = cache.db.posts;
  const entry = await inner.get("01HOT");
  await inner.put({
    ...entry,
    cachedAt: Date.now() - HOUR - 10_000,
    lastAccessed: Date.now(),
    accessCount: 999,
  });

  const removed = await cache.trimCache();
  assert.ok(removed >= 1, "frequently-accessed but data-stale entry must be trimmed");
  assert.equal(await inner.get("01HOT"), undefined);
});

// ---- trimCache: capacity-based LRU eviction ---------------------------

test("trimCache evicts lowest-accessCount entries when over maxCapacity", async () => {
  const cache = freshDb(HOUR, 2); // capacity = 2 per store
  await cache.open();

  await cache.setPost("01A", { ulid: "01A", title: "A" });
  await cache.setPost("01B", { ulid: "01B", title: "B" });
  await cache.setPost("01C", { ulid: "01C", title: "C" });

  // Bump accessCount on A and C; B stays at lowest.
  const inner = cache.db.posts;
  const a = await inner.get("01A");
  const c = await inner.get("01C");
  await inner.put({ ...a, accessCount: 10 });
  await inner.put({ ...c, accessCount: 10 });

  const removed = await cache.trimCache();
  assert.equal(removed, 1, "exactly one entry should be evicted (3 - 2 capacity)");
  assert.equal(await inner.get("01B"), undefined, "lowest-access entry B should be evicted");
  assert.ok(await inner.get("01A"));
  assert.ok(await inner.get("01C"));
});

test("trimCache returns 0 when nothing needs removing", async () => {
  const cache = freshDb(HOUR, 100);
  await cache.open();

  await cache.setPost("01OK", { ulid: "01OK", title: "fresh" });

  const removed = await cache.trimCache();
  assert.equal(removed, 0);
});

// ---- trimCache: feedResources TTL-only --------------------------------

test("trimCache removes feedResources whose cachedAt is past TTL", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  // Seed a feed via direct Dexie put with stale cachedAt.
  await cache.db.feedResources.put({
    route: "/v1/feed/stale",
    ulids: ["01X"],
    cursor: null,
    cachedAt: Date.now() - HOUR - 1000,
    lastAccessed: Date.now() - HOUR - 1000,
  });
  await cache.db.feedResources.put({
    route: "/v1/feed/fresh",
    ulids: ["01Y"],
    cursor: null,
    cachedAt: Date.now(),
    lastAccessed: Date.now(),
  });

  const removed = await cache.trimCache();
  assert.ok(removed >= 1);

  assert.equal(await cache.db.feedResources.get("/v1/feed/stale"), undefined);
  assert.ok(await cache.db.feedResources.get("/v1/feed/fresh"));
});

// ---- trimCache: bulk delete behavior ---------------------------------

test("trimCache handles many stale entries without per-row overhead errors", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  const inner = cache.db.posts;
  const stale = Date.now() - HOUR - 1000;
  const batch = [];
  for (let i = 0; i < 50; i++) {
    batch.push({
      id: `01STALE${i}`,
      data: { ulid: `01STALE${i}`, title: `t${i}` },
      cachedAt: stale,
      lastAccessed: stale,
      accessCount: 1,
    });
  }
  await inner.bulkPut(batch);

  const removed = await cache.trimCache();
  assert.equal(removed, 50);
  const remaining = await inner.toArray();
  assert.equal(remaining.length, 0);
});
