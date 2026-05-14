import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import Dexie from "dexie";
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

// ---- groups store ------------------------------------------------------

test("setGroup / getGroup roundtrip", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setGroup("01GROUP1", {
    ulid: "01GROUP1",
    name: "Group One",
    membersCount: 3,
  });

  const got = await cache.getGroup("01GROUP1");
  assert.ok(got);
  assert.equal(got.name, "Group One");
  assert.equal(got.membersCount, 3);
});

test("setGroups bulk write skips entries without a ULID", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setGroups([
    { ulid: "01GROUPB1", name: "B1" },
    { name: "no-id" },
    { ulid: "01GROUPB2", name: "B2" },
  ]);

  const b1 = await cache.getGroup("01GROUPB1");
  const b2 = await cache.getGroup("01GROUPB2");
  assert.ok(b1);
  assert.ok(b2);
  assert.equal(b1.name, "B1");
  assert.equal(b2.name, "B2");
});

test("deleteGroup removes the entry", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setGroup("01GROUPDEL", { ulid: "01GROUPDEL", name: "Doomed" });
  assert.ok(await cache.getGroup("01GROUPDEL"));

  await cache.deleteGroup("01GROUPDEL");
  assert.equal(await cache.getGroup("01GROUPDEL"), null);
});

test("clearAll wipes the groups store", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setGroup("01GROUPCLR", { ulid: "01GROUPCLR", name: "Bye" });
  await cache.clearAll();
  assert.equal(await cache.getGroup("01GROUPCLR"), null);
});

// ---- refresh TTL -------------------------------------------------------

test("isPastRefreshTTL is false right after write", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setUser("01TTLUSER", { ulid: "01TTLUSER", username: "fresh" });
  const entry = await cache.getUserEntry("01TTLUSER");
  assert.ok(entry);
  assert.equal(cache.isPastRefreshTTL(entry), false);
});

test("isPastRefreshTTL is true once lastCheckedAt is older than refresh TTL", async () => {
  // 1-second refresh TTL keeps the test fast.
  const cache = new CacheDB(HOUR, `test-cache-${++dbCounter}-${Date.now()}`, undefined, 1000);
  await cache.open();

  await cache.setUser("01TTLOLD", { ulid: "01TTLOLD", username: "old" });

  const inner = cache.db.users;
  const stored = await inner.get("01TTLOLD");
  stored.lastCheckedAt = Date.now() - 5000; // 5s ago
  await inner.put(stored);

  const entry = await cache.getUserEntry("01TTLOLD");
  assert.ok(entry);
  assert.equal(cache.isPastRefreshTTL(entry), true);
});

test("isPastRefreshTTL treats a missing entry as past TTL", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  assert.equal(cache.isPastRefreshTTL(null), true);
  assert.equal(cache.isPastRefreshTTL(undefined), true);
});

// ---- v4 → v5 migration ------------------------------------------------

test("v4 → v5 upgrade backfills lastCheckedAt from cachedAt and adds groups store", async () => {
  const dbName = `migrate-test-${++dbCounter}-${Date.now()}`;

  // Stand up a v4-shaped DB and seed a user row WITHOUT lastCheckedAt
  // (mirrors what shipped before this PR).
  const v4 = new Dexie(dbName);
  v4.version(4).stores({
    posts: "id, cachedAt, lastAccessed",
    feedResources: "route, cachedAt, lastAccessed",
    users: "id, cachedAt, lastAccessed",
    notifications: "id, cachedAt, lastAccessed",
    notificationFeeds: "route, userId, updatedAt",
    metadata: "key, updatedAt",
  });
  await v4.open();
  const oldCachedAt = Date.now() - 10_000;
  await v4.table("users").put({
    id: "01MIGRUSER",
    data: { ulid: "01MIGRUSER", username: "legacy" },
    cachedAt: oldCachedAt,
    lastAccessed: oldCachedAt,
    accessCount: 1,
    // no lastCheckedAt
  });
  await v4.table("posts").put({
    id: "01MIGRPOST",
    data: { ulid: "01MIGRPOST", title: "old" },
    cachedAt: oldCachedAt,
    lastAccessed: oldCachedAt,
    accessCount: 1,
  });
  v4.close();

  // Reopen at v5 via CacheDB — triggers .upgrade() backfill.
  const cache = new CacheDB(60 * 60 * 1000, dbName);
  await cache.open();

  const userEntry = await cache.getUserEntry("01MIGRUSER");
  assert.ok(userEntry, "user row preserved through upgrade");
  assert.equal(userEntry.lastCheckedAt, oldCachedAt, "lastCheckedAt backfilled from cachedAt");

  const postRow = await cache.db.posts.get("01MIGRPOST");
  assert.equal(postRow.lastCheckedAt, oldCachedAt, "post lastCheckedAt backfilled");

  // groups store now exists and is writable.
  await cache.setGroup("01MIGRGROUP", { ulid: "01MIGRGROUP", name: "Post-upgrade" });
  const g = await cache.getGroup("01MIGRGROUP");
  assert.equal(g.name, "Post-upgrade");
});

test("open() recovers when initial db.open() throws by deleting + recreating", async () => {
  const dbName = `recover-test-${++dbCounter}-${Date.now()}`;

  const cache = new CacheDB(60 * 60 * 1000, dbName);

  // Monkey-patch underlying db.open to throw once, then delegate.
  const realOpen = cache.db.open.bind(cache.db);
  let openCalls = 0;
  cache.db.open = async function patchedOpen() {
    openCalls += 1;
    if (openCalls === 1) {
      throw new Error("simulated upgrade failure");
    }
    return realOpen();
  };

  // Spy on db.delete to confirm recovery path runs.
  let deleteCalled = false;
  const realDelete = cache.db.delete.bind(cache.db);
  cache.db.delete = async function patchedDelete() {
    deleteCalled = true;
    return realDelete();
  };

  await cache.open();

  assert.equal(deleteCalled, true, "db.delete should have been called");
  // The recovery path constructs a fresh PlatformCacheDB; it should be open
  // and accept writes at the current schema (groups store available).
  await cache.setGroup("01RECOVER01", { ulid: "01RECOVER01", name: "Recovered" });
  const got = await cache.getGroup("01RECOVER01");
  assert.equal(got.name, "Recovered");
});

test("open() rethrows if both initial open AND delete fail", async () => {
  const dbName = `recover-fail-${++dbCounter}-${Date.now()}`;
  const cache = new CacheDB(60 * 60 * 1000, dbName);
  cache.db.open = async () => {
    throw new Error("open boom");
  };
  cache.db.delete = async () => {
    throw new Error("delete boom");
  };

  await assert.rejects(() => cache.open(), /delete boom/);
});

test("setUser stamps lastCheckedAt so refreshes reset the TTL clock", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setUser("01STAMP", { ulid: "01STAMP", username: "v1" });
  const before = await cache.getUserEntry("01STAMP");
  // Backdate.
  const inner = cache.db.users;
  const row = await inner.get("01STAMP");
  row.lastCheckedAt = 0;
  await inner.put(row);

  // Re-write should refresh the stamp to ~now.
  await cache.setUser("01STAMP", { ulid: "01STAMP", username: "v2" });
  const after = await cache.getUserEntry("01STAMP");
  assert.ok(after.lastCheckedAt > 0);
  assert.ok(after.lastCheckedAt >= before.lastCheckedAt);
});

// ---- v6: notifications store removed ----------------------------------

test("v6 upgrade drops the notifications store", async () => {
  const dbName = `v6-drop-${++dbCounter}-${Date.now()}`;

  // Stand up a v5-shaped DB with a notifications row.
  const v5 = new Dexie(dbName);
  v5.version(5).stores({
    posts: "id, cachedAt, lastAccessed, lastCheckedAt",
    feedResources: "route, cachedAt, lastAccessed",
    users: "id, cachedAt, lastAccessed, lastCheckedAt",
    groups: "id, cachedAt, lastAccessed, lastCheckedAt",
    notifications: "id, cachedAt, lastAccessed",
    notificationFeeds: "route, userId, updatedAt",
    metadata: "key, updatedAt",
  });
  await v5.open();
  await v5.table("notifications").put({
    id: "01NOTIF1",
    data: { message: "hi" },
    cachedAt: Date.now(),
    lastAccessed: Date.now(),
    accessCount: 1,
  });
  v5.close();

  // Reopen via CacheDB (which now declares v6) — store should be removed.
  const cache = new CacheDB(HOUR, dbName);
  await cache.open();

  const tableNames = cache.db.tables.map((t) => t.name);
  assert.equal(tableNames.includes("notifications"), false, "notifications store dropped in v6");
  assert.equal(tableNames.includes("notificationFeeds"), true, "notificationFeeds preserved");

  cache.stopTrimSchedule();
});

// ---- B: periodic trim scheduler ---------------------------------------

test("trim scheduler runs trimCache on the configured interval", async () => {
  // 50ms trim interval keeps the test fast.
  const dbName = `trim-${++dbCounter}-${Date.now()}`;
  const cache = new CacheDB(HOUR, dbName, undefined, undefined, 50);
  await cache.open();

  // Seed a stale post directly (cachedAt before the hard TTL window).
  const stale = Date.now() - HOUR - 1000;
  await cache.db.posts.put({
    id: "01TRIMPOST",
    data: { ulid: "01TRIMPOST" },
    cachedAt: stale,
    lastAccessed: stale,
    accessCount: 1,
    lastCheckedAt: stale,
  });

  // Wait for the scheduled trim to fire (give it ~150ms).
  await new Promise((r) => setTimeout(r, 150));

  const remaining = await cache.db.posts.toArray();
  assert.equal(remaining.length, 0, "stale post evicted by scheduled trim");

  cache.stopTrimSchedule();
});

test("trim scheduler is disabled when trimIntervalMs=0", async () => {
  const dbName = `trim-off-${++dbCounter}-${Date.now()}`;
  const cache = new CacheDB(HOUR, dbName, undefined, undefined, 0);
  await cache.open();

  // Seed a stale entry; without the scheduler it should survive.
  const stale = Date.now() - HOUR - 1000;
  await cache.db.posts.put({
    id: "01TRIMOFF",
    data: { ulid: "01TRIMOFF" },
    cachedAt: stale,
    lastAccessed: stale,
    accessCount: 1,
    lastCheckedAt: stale,
  });

  await new Promise((r) => setTimeout(r, 100));

  const remaining = await cache.db.posts.toArray();
  assert.equal(remaining.length, 1, "no auto-trim when interval is 0");
});

test("stopTrimSchedule prevents further auto-trims", async () => {
  const dbName = `trim-stop-${++dbCounter}-${Date.now()}`;
  const cache = new CacheDB(HOUR, dbName, undefined, undefined, 50);
  await cache.open();
  cache.stopTrimSchedule();

  const stale = Date.now() - HOUR - 1000;
  await cache.db.posts.put({
    id: "01TRIMSTOP",
    data: { ulid: "01TRIMSTOP" },
    cachedAt: stale,
    lastAccessed: stale,
    accessCount: 1,
    lastCheckedAt: stale,
  });

  await new Promise((r) => setTimeout(r, 150));
  const remaining = await cache.db.posts.toArray();
  assert.equal(remaining.length, 1, "stop kills the interval before it fires");
});
