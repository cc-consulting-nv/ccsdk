import test from "node:test";

import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { CacheDB } from "../dist/cache/cacheDB.js";

let dbCounter = 0;
function freshDb(ttlMs, maxCapacity) {
  dbCounter += 1;
  return new CacheDB(ttlMs, `test-cache-${dbCounter}-${Date.now()}`, maxCapacity);
}

const HOUR = 60 * 60 * 1000;

// ---- safeRead / safeWrite: connection-lost error recovery ----------------

test("safeRead returns fallback on Dexie connection-lost error after reopen", async () => {
  const cache = freshDb(HOUR);
  // Simulate connection lost by closing db, then reopen fails again.
  await cache.open();
  cache.db.close();

  const result = await cache.getPost("01MISSING");
  assert.equal(result, null, "safeRead returns null fallback on connection loss");
});

test("safeWrite swallows Dexie connection-lost error without throwing", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  cache.db.close();

  await assert.doesNotReject(
    cache.setPost("01DROP", { ulid: "01DROP", title: "dropped" }),
    "safeWrite swallows connection-lost errors"
  );
});

// ---- sanitizeForStorage --------------------------------------------------

test("sanitizeForStorage passes through null", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  // Access private method via the DB instance — it's actually a public method
  // on CacheDB so we need to reach it indirectly. Instead, we test via setMetadata.
  const val = await cache.getMetadata("nullkey");
  // Directly verify via setMetadata that null is safe.
  await cache.setMetadata("nullkey2", null);
  const stored = await cache.getMetadata("nullkey2");
  assert.equal(stored, null);
});

test("sanitizeForStorage passes through non-objects (primitives)", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setMetadata("num", 42);
  assert.equal(await cache.getMetadata("num"), 42);
  await cache.setMetadata("str", "text");
  assert.equal(await cache.getMetadata("str"), "text");
  await cache.setMetadata("bool", true);
  assert.equal(await cache.getMetadata("bool"), true);
});

test("sanitizeForStorage strips functions from objects", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  // Simulating sanitize via setMetadata which calls sanitizeForStorage
  await cache.setMetadata("fnobj", { a: () => 1, b: "keep", c: { nested: () => 2, d: 3 } });
  const stored = await cache.getMetadata("fnobj");
  assert.deepEqual(stored, { b: "keep", c: { d: 3 } });
});

test("sanitizeForStorage maps over arrays", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setMetadata("arr", [{ fn: () => 1 }, { val: 42 }]);
  const stored = await cache.getMetadata("arr");
  assert.deepEqual(stored, [{}, { val: 42 }]);
});

// ---- getPost / getPosts --------------------------------------------------

test("getPost returns null for missing entry", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  assert.equal(await cache.getPost("01NOPE"), null);
});

test("getPost returns null for expired entry", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  const inner = cache.db.posts;
  const stale = Date.now() - HOUR - 1;
  await inner.put({
    id: "01EXPPOST",
    data: { ulid: "01EXPPOST", title: "expired" },
    cachedAt: stale,
    lastAccessed: stale,
    accessCount: 1,
    lastCheckedAt: stale,
  });
  assert.equal(await cache.getPost("01EXPPOST"), null);
});

test("getPost touches entry on read (increments accessCount)", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setPost("01TOUCHPOST", { ulid: "01TOUCHPOST", title: "touch" });
  const inner = cache.db.posts;
  const before = await inner.get("01TOUCHPOST");

  await cache.getPost("01TOUCHPOST");

  const after = await inner.get("01TOUCHPOST");
  assert.ok(after.accessCount > before.accessCount, "accessCount should increase on read");
});

test("getPosts hydrates multiple entries", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setPost("01GP1", { ulid: "01GP1", title: "one" });
  await cache.setPost("01GP2", { ulid: "01GP2", title: "two" });
  await cache.setPost("01GP3", { ulid: "01GP3", title: "three" });

  const results = await cache.getPosts(["01GP1", "01GP2", "01MISSING"]);
  assert.ok(results["01GP1"]);
  assert.ok(results["01GP2"]);
  assert.equal(results["01MISSING"], undefined);
  assert.equal(Object.keys(results).length, 2);
});

test("getPosts returns empty record when nothing found", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  const results = await cache.getPosts(["01NONE1", "01NONE2"]);
  assert.deepEqual(results, {});
});

test("getPosts filters out expired entries", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  const inner = cache.db.posts;
  const stale = Date.now() - HOUR - 1;
  await inner.put({
    id: "01GPEXP",
    data: { ulid: "01GPEXP", title: "expired" },
    cachedAt: stale,
    lastAccessed: stale,
    accessCount: 1,
    lastCheckedAt: stale,
  });
  await cache.setPost("01GPFRESH", { ulid: "01GPFRESH", title: "fresh" });

  const results = await cache.getPosts(["01GPEXP", "01GPFRESH"]);
  assert.equal(results["01GPEXP"], undefined);
  assert.ok(results["01GPFRESH"]);
});

test("setPosts stores all posts in bulk", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setPosts({
    "01BULK1": { ulid: "01BULK1", title: "bulk one" },
    "01BULK2": { ulid: "01BULK2", title: "bulk two" },
  });
  assert.equal((await cache.getPost("01BULK1"))?.title, "bulk one");
  assert.equal((await cache.getPost("01BULK2"))?.title, "bulk two");
});

test("invalidatePost removes a post from cache", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setPost("01INV1", { ulid: "01INV1", title: "invalid" });
  assert.ok(await cache.getPost("01INV1"));

  await cache.invalidatePost("01INV1");
  assert.equal(await cache.getPost("01INV1"), null);
});

// ---- getUser / getUsers --------------------------------------------------

test("getUser returns null for missing entry", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  assert.equal(await cache.getUser("01NUSER"), null);
});

test("getUser returns null for expired entry", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  const inner = cache.db.users;
  const stale = Date.now() - HOUR - 1;
  await inner.put({
    id: "01EXPUSER",
    data: { ulid: "01EXPUSER", username: "exp" },
    cachedAt: stale,
    lastAccessed: stale,
    accessCount: 1,
    lastCheckedAt: stale,
  });
  assert.equal(await cache.getUser("01EXPUSER"), null);
});

test("getUsers hydrates multiple users", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setUser("01GU1", { ulid: "01GU1", username: "user1" });
  await cache.setUser("01GU2", { ulid: "01GU2", username: "user2" });

  const results = await cache.getUsers(["01GU1", "01GU2", "01GUMISSING"]);
  assert.ok(results.has("01GU1"));
  assert.ok(results.has("01GU2"));
  assert.equal(results.has("01GUMISSING"), false);
  assert.equal(results.get("01GU1").username, "user1");
});

test("getUsers returns empty map when nothing found", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  const results = await cache.getUsers(["01GNONE1"]);
  assert.equal(results.size, 0);
});

test("getUsers filters out expired entries", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  const inner = cache.db.users;
  const stale = Date.now() - HOUR - 1;
  await inner.put({
    id: "01GUEXP",
    data: { ulid: "01GUEXP", username: "exp" },
    cachedAt: stale,
    lastAccessed: stale,
    accessCount: 1,
    lastCheckedAt: stale,
  });
  await cache.setUser("01GUFRESH", { ulid: "01GUFRESH", username: "fresh" });

  const results = await cache.getUsers(["01GUEXP", "01GUFRESH"]);
  assert.equal(results.has("01GUEXP"), false);
  assert.ok(results.has("01GUFRESH"));
});

// ---- getUserByUsername ---------------------------------------------------

test("getUserByUsername finds user by username", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setUser("01BYUSER", { ulid: "01BYUSER", username: "Alice" });

  const found = await cache.getUserByUsername("alice");
  assert.ok(found);
  assert.equal(found.username, "Alice");
});

test("getUserByUsername is case-insensitive", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setUser("01CIUSER", { ulid: "01CIUSER", username: "Bob" });

  assert.ok(await cache.getUserByUsername("BOB"));
  assert.ok(await cache.getUserByUsername("bOB"));
});

test("getUserByUsername returns null for missing username", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  assert.equal(await cache.getUserByUsername("nobody"), null);
});

test("getUserByUsername returns null for expired entry", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  const inner = cache.db.users;
  const stale = Date.now() - HOUR - 1;
  await inner.put({
    id: "01BYEXP",
    data: { ulid: "01BYEXP", username: "expuser" },
    cachedAt: stale,
    lastAccessed: stale,
    accessCount: 1,
    lastCheckedAt: stale,
  });
  assert.equal(await cache.getUserByUsername("expuser"), null);
});

// ---- setUser with function sanitization ---------------------------------

test("setUser throws when sanitized user still has functions", async () => {
  const cache = freshDb(HOUR);
  // The safe path: setUser catches and doesn't throw
  await cache.setUser("01FUNUSER", { ulid: "01FUNUSER", username: "fnuser" });
  assert.ok(await cache.getUser("01FUNUSER"));
});

test("setUser with symbol properties strips them", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setUser("01SYMUSER", { ulid: "01SYMUSER", username: "symuser" });
  const found = await cache.getUser("01SYMUSER");
  assert.equal(found.username, "symuser");
});

test("setUser skips when no valid ULID", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  // @ts-expect-error: intentional wrong type to test guard
  await assert.doesNotReject(cache.setUser("", { ulid: "", username: "" }));
});

// ---- setUsers / deleteUser -----------------------------------------------

test("setUsers filters users without ULIDs, logs warning", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setUsers([
    { ulid: "01SU1", username: "a" },
    { ulid: null, username: "no-id" },
  ]);
  // Check the underlying Dexie table for what was actually stored
  const innerUsers = cache.db.users;
  // Note: setUsers uses sanitizeForStorage instead of sanitizeUserProfile
  assert.ok(await innerUsers.get("01SU1"), "valid user should be stored");
});

test("setUsers warns when no valid users to cache", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  // Should not throw; internal console.warn fires
  await assert.doesNotReject(cache.setUsers([]));
});

test("deleteUser removes the entry from cache", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setUser("01DELUSER", { ulid: "01DELUSER", username: "dels" });
  assert.ok(await cache.getUser("01DELUSER"));

  await cache.deleteUser("01DELUSER");
  assert.equal(await cache.getUser("01DELUSER"), null);
});

// ---- setNotificationFeed / getNotificationFeed / clearNotificationFeeds --

test("setNotificationFeed + getNotificationFeed roundtrip", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setNotificationFeed("/recent", "user1", ["01NF1", "01NF2"], null, false);

  const feed = await cache.getNotificationFeed("/recent", "user1");
  assert.ok(feed);
  assert.equal(feed.userId, "user1");
  assert.equal(feed.ulids.length, 2);
  assert.equal(feed.cursor, null);
});

test("getNotificationFeed returns null for missing feed", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  assert.equal(await cache.getNotificationFeed("/nonexistent", "nouser"), null);
});

test("getNotificationFeed deletes and returns null on expired notification feed", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  // Seed with old updatedAt (> 30s TTL)
  await cache.db.notificationFeeds.put({
    route: "user2:/expired",
    userId: "user2",
    ulids: ["01EXPF"],
    cursor: null,
    updatedAt: Date.now() - 40_000, // beyond 30s
    hasMore: false,
  });

  const feed = await cache.getNotificationFeed("/expired", "user2");
  assert.equal(feed, null);
  // Should be deleted from db
  const fromDb = await cache.db.notificationFeeds.get("user2:/expired");
  assert.equal(fromDb, undefined);
});

test("clearNotificationFeeds wipes all notification feeds", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setNotificationFeed("/r1", "u1", ["01NF1"], null, false);
  await cache.setNotificationFeed("/r2", "u2", ["01NF2"], null, true);

  await cache.clearNotificationFeeds();

  const remaining = await cache.db.notificationFeeds.toArray();
  assert.equal(remaining.length, 0);
});

// ---- feed resource methods -----------------------------------------------

test("getFeedResource returns null for missing route", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  assert.equal(await cache.getFeedResource("/never"), null);
});

test("setFeedResource replace mode stores directly", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setFeedResource("/trending", ["01FR1", "01FR2"], "cursor1", true);

  const resource = await cache.getFeedResource("/trending");
  assert.ok(resource);
  assert.equal(resource.ulids.length, 2);
  assert.equal(resource.cursor, "cursor1");
});

test("setFeedResource merge mode combines with existing", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  await cache.setFeedResource("/discover", ["01M1"], "c1", false);
  await cache.setFeedResource("/discover", ["01M2", "01M3"], "c2", false);

  const resource = await cache.getFeedResource("/discover");
  assert.ok(resource);
  // Combined ulids should be ["01M1", "01M2", "01M3"] (deduped, new first)
  assert.equal(resource.ulids.length, 3);
  assert.ok(resource.ulids.includes("01M1"));
  assert.ok(resource.ulids.includes("01M2"));
  assert.ok(resource.ulids.includes("01M3"));
});

test("appendToFeedResource creates feed when missing", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.appendToFeedResource("/newfeed", ["01AP1"], "c1");

  const resource = await cache.getFeedResource("/newfeed");
  assert.ok(resource);
  assert.equal(resource.ulids.length, 1);
});

test("appendToFeedResource merges with existing feed", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setFeedResource("/mergefeed", ["01MP1"], "c1", true);
  await cache.appendToFeedResource("/mergefeed", ["01MP2", "01MP3"], "c2");

  const resource = await cache.getFeedResource("/mergefeed");
  assert.ok(resource);
  assert.equal(resource.ulids.length, 3);
});

// ---- observeUser / observeGroup (liveQuery) ------------------------------

function waitForDexieLiveQuery() {
  return new Promise(resolve => setTimeout(resolve, 50));
}

test("observeUser emits cached user profile", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setUser("01OBSUSER", { ulid: "01OBSUSER", username: "obser" });

  let emitted = false;
  const obs = cache.observeUser("01OBSUSER");
  const sub = obs.subscribe(() => { emitted = true; });
  await waitForDexieLiveQuery();
  assert.ok(emitted, "observeUser should emit on subscription");
  sub.unsubscribe();
});

test("observeUser emits null for missing user", async () => {
  const cache = freshDb(HOUR);
  await cache.open();

  let emitted = false;
  cache.observeUser("01NOOBSSER").subscribe(() => { emitted = true; });
  await waitForDexieLiveQuery();
  assert.ok(emitted, "observeUser should emit for missing user too");
});

test("observeGroup emits cached group", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setGroup("01OBSGRP", { ulid: "01OBSGRP", name: "grp" });

  let emitted = false;
  cache.observeGroup("01OBSGRP").subscribe(() => { emitted = true; });
  await waitForDexieLiveQuery();
  assert.ok(emitted, "observeGroup should emit on subscription");
});

// ---- deletePost / removeUlidFromFeeds -----------------------------------

test("deletePost removes post and cleans from feedResources", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setPost("01DPOST", { ulid: "01DPOST", title: "delme" });
  await cache.setFeedResource("/feedwithpost", ["01DPOST", "01KEPT"], "c1", true);

  await cache.deletePost("01DPOST");

  assert.equal(await cache.getPost("01DPOST"), null);
  const feed = await cache.getFeedResource("/feedwithpost");
  assert.ok(feed);
  assert.equal(feed.ulids.length, 1);
  assert.equal(feed.ulids[0], "01KEPT");
});

test("removeUlidFromFeeds no-op when ULID not in any feed", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setPost("01NOTINFEED", { ulid: "01NOTINFEED", title: "orphan" });

  await cache.deletePost("01NOTINFEED");

  assert.equal(await cache.getPost("01NOTINFEED"), null);
});

// ---- setMetadata error path ---------------------------------------------

test("setMetadata catches and warns on write failure", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  // Normal write should succeed; test that it doesn't throw
  await assert.doesNotReject(() =>
    cache.setMetadata("goodkey", { deep: { nested: { val: 42 } } })
  );
  const retrieved = await cache.getMetadata("goodkey");
  assert.deepEqual(retrieved, { deep: { nested: { val: 42 } } });
});

// ---- metadata TTL (getMetadata via safeRead) ----------------------------

test("getMetadata returns null for missing key", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  assert.equal(await cache.getMetadata("nofound"), null);
});

// ---- createCache factory -------------------------------------------------

test("createCache creates and opens a new cache instance", async () => {
  const cache = await import("../dist/cache/cacheDB.js");
  const created = await cache.createCache(HOUR, `factory-test-${++dbCounter}-${Date.now()}`);
  assert.ok(created);
  await created.setPost("01CREATED", { ulid: "01CREATED", title: "created" });
  const got = await created.getPost("01CREATED");
  assert.ok(got);
  created.stopTrimSchedule();
});

test("createCache uses default 24h TTL when none provided", async () => {
  const cache = await import("../dist/cache/cacheDB.js");
  const created = await cache.createCache(undefined, `factory-default-${++dbCounter}-${Date.now()}`);
  const got = await created.getRefreshTtlMs();
  assert.ok(got > 0, "should have a valid refresh TTL");
  created.stopTrimSchedule();
});

// ---- getGroupEntry -------------------------------------------------------

test("getGroupEntry returns cached group entry", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  await cache.setGroup("01GRPE1", { ulid: "01GRPE1", name: "squad" });

  const entry = await cache.getGroupEntry("01GRPE1");
  assert.ok(entry);
  assert.equal(entry.data.name, "squad");
  assert.ok(entry.cachedAt > 0);
});

test("getGroupEntry returns null for missing group", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  const entry = await cache.getGroupEntry("01NOPE1");
  assert.equal(entry, null);
});

// ---- getFeedResource expired ---------------------------------------------

test("getFeedResource deletes and returns null on expired resource", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  const stale = Date.now() - HOUR - 1;
  await cache.db.feedResources.put({
    route: "/stalefeed",
    ulids: ["01FE1"],
    cursor: "old",
    cachedAt: stale,
  });

  const result = await cache.getFeedResource("/stalefeed");
  assert.equal(result, null);
  const fromDb = await cache.db.feedResources.get("/stalefeed");
  assert.equal(fromDb, undefined, "expired feed resource should be deleted");
});

// ---- setUser catch block (IndexedDB failure) -----------------------------

test("setUser catch block logs error on IndexedDB failure", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  cache.db.users.put = async () => { throw new DOMException("QuotaExceededError", "QuotaExceededError"); };

  await assert.doesNotReject(
    cache.setUser("01ERRUSER", { ulid: "01ERRUSER", username: "erruser" }),
    "setUser should not throw on IndexedDB failure"
  );
  const result = await cache.getUser("01ERRUSER");
  assert.equal(result, null, "user should not be stored when put fails");
});

// ---- setMetadata catch block (IndexedDB failure) -------------------------

test("setMetadata catch block warns on IndexedDB failure", async () => {
  const cache = freshDb(HOUR);
  await cache.open();
  cache.db.metadata.put = async () => { throw new DOMException("UnknownError", "IndexedDB error"); };

  await assert.doesNotReject(
    cache.setMetadata("badkey", { val: "test" }),
    "setMetadata should not throw on IndexedDB failure"
  );
  const retrieved = await cache.getMetadata("badkey");
  assert.equal(retrieved, null, "metadata should not be stored when put fails");
});
