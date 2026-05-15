import test from "node:test";
import assert from "node:assert/strict";
import { RefreshCoordinator } from "../dist/auth.js";

test("RefreshCoordinator runs the refresh function", async () => {
  const coord = new RefreshCoordinator();
  const result = await coord.run(async () => ({ accessToken: "tok", refreshToken: "ref" }));
  assert.equal(result.accessToken, "tok");
  assert.equal(result.refreshToken, "ref");
});

test("RefreshCoordinator dedupes concurrent calls", async () => {
  const coord = new RefreshCoordinator();
  let resolveRefresh;
  const refreshFn = async () =>
    await new Promise((resolve) => {
      resolveRefresh = () => resolve({ accessToken: "tok", refreshToken: "ref" });
    });

  const first = coord.run(refreshFn);
  await Promise.resolve(); // let second call get queued
  const second = coord.run(refreshFn);
  resolveRefresh();
  const r1 = await first;
  const r2 = await second;
  assert.deepEqual(r1, r2);
});

test("RefreshCoordinator rejects all waiters on error", async () => {
  const coord = new RefreshCoordinator();
  const err = new Error("refresh failed");
  const refreshFn = () => { throw err; };

  const first = coord.run(refreshFn);
  const second = coord.run(refreshFn);

  await assert.rejects(first, /refresh failed/);
  await assert.rejects(second, /refresh failed/);
});

test("RefreshCoordinator allows subsequent runs after success", async () => {
  const coord = new RefreshCoordinator();
  let counter = 0;
  const refreshFn = async () => {
    counter++;
    return { accessToken: `tok-${counter}` };
  };

  const first = coord.run(refreshFn);
  const second = coord.run(refreshFn);
  const r1 = await first;
  const r2 = await second;
  assert.equal(r1.accessToken, "tok-1");
  assert.equal(r2.accessToken, "tok-1"); // same result

  // After first batch completes, running again calls the function again
  const third = await coord.run(refreshFn);
  assert.equal(third.accessToken, "tok-2");
});
