import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { CacheDB, DexieCacheAdapter, createCache } from "../dist/cache/cacheDB.js";

let dbCounter = 0;
const freshName = () => `adapter-test-${++dbCounter}-${Date.now()}`;

/**
 * Every method the SDK relies on. A second implementation (SQLite on React
 * Native) must provide all of these — this list is the contract, and the
 * assertion below is what catches a partial port.
 */
const CACHE_ADAPTER_METHODS = [
  // lifecycle
  "open", "reopen", "startTrimSchedule", "stopTrimSchedule", "trimCache", "clearAll",
  // write fencing
  "fenceWrites", "unfenceWrites",
  // ttl
  "getRefreshTtlMs", "isPastRefreshTTL",
  // posts
  "getPost", "getPosts", "setPost", "setPosts", "invalidatePost", "deletePost",
  // users
  "getUser", "getUsers", "getUserByUsername", "getUserEntry",
  "setUser", "setUsers", "deleteUser", "observeUser",
  // groups
  "getGroup", "getGroupEntry", "setGroup", "setGroups", "deleteGroup", "observeGroup",
  // feeds
  "getFeedResource", "setFeedResource", "appendToFeedResource",
  // notification feeds
  "setNotificationFeed", "getNotificationFeed", "clearNotificationFeeds",
  // metadata
  "setMetadata", "getMetadata", "deleteMetadata",
];

test("DexieCacheAdapter implements the full CacheAdapter surface", () => {
  const cache = new DexieCacheAdapter(undefined, freshName());
  const missing = CACHE_ADAPTER_METHODS.filter((m) => typeof cache[m] !== "function");
  assert.deepEqual(missing, [], `missing CacheAdapter methods: ${missing.join(", ")}`);
});

// ---- back-compat: ~/gunclub-ui still does `new CacheDB(...)` ---------------

test("CacheDB is retained as an alias of DexieCacheAdapter", () => {
  assert.equal(CacheDB, DexieCacheAdapter);
});

test("the CacheDB alias still constructs and round-trips data", async () => {
  const cache = new CacheDB(undefined, freshName());
  await cache.open();

  assert.ok(cache instanceof DexieCacheAdapter);

  const ulid = "01hx000000000000000000000a";
  await cache.setPost(ulid, { ulid, body: "hello" });
  assert.equal((await cache.getPost(ulid))?.body, "hello");

  await cache.clearAll();
});

test("createCache returns an opened adapter", async () => {
  const cache = await createCache(undefined, freshName());
  // Already open: a read works without an explicit open() call.
  assert.equal(await cache.getPost("01hx00000000000000000000zz"), null);
  await cache.clearAll();
});

test("createCache uses an injected adapter instead of building a Dexie one", async () => {
  let opened = false;
  const stub = {
    open: async () => { opened = true; },
    getPost: async () => ({ ulid: "x", body: "from-stub" }),
  };

  const cache = await createCache(undefined, undefined, undefined, undefined, undefined, stub);

  assert.equal(cache, stub, "injected adapter should be returned as-is");
  assert.equal(opened, true, "createCache should open the injected adapter");
  assert.equal((await cache.getPost("x")).body, "from-stub");
});
