import test from "node:test";
import assert from "node:assert/strict";
import { MultipartUpload } from "../dist/multipartUpload.js";

const makeFile = () => new File([new Uint8Array(1024)], "test.mp4", { type: "video/mp4" });

/**
 * Connectivity source under test control: starts offline, comes back when
 * goOnline() is called. Stands in for NetInfo on React Native.
 */
function makeControllableConnectivity(startOnline = true) {
  let online = startOnline;
  const subscribers = new Set();
  return {
    subscriberCount: () => subscribers.size,
    isOnline: () => online,
    onOnline(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    goOnline() {
      online = true;
      for (const cb of [...subscribers]) cb();
    },
  };
}

test("waitForOnline resolves once the injected source reports back online", async () => {
  const net = makeControllableConnectivity(false);
  const upload = new MultipartUpload({}, { file: makeFile(), connectivity: net });

  let resolved = false;
  const pending = upload.waitForOnline().then(() => { resolved = true; });

  // Offline: must not resolve, and must be subscribed rather than polling.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(resolved, false, "should still be waiting while offline");
  assert.equal(net.subscriberCount(), 1);

  net.goOnline();
  await pending;
  assert.equal(resolved, true);
  assert.equal(net.subscriberCount(), 0, "should unsubscribe after resolving");
});

test("waitForOnline resolves immediately when already online", async () => {
  const net = makeControllableConnectivity(true);
  const upload = new MultipartUpload({}, { file: makeFile(), connectivity: net });

  await upload.waitForOnline();
  assert.equal(net.subscriberCount(), 0, "no subscription needed when online");
});

test("waitForOnline resolves immediately when awaitOnline is disabled", async () => {
  const net = makeControllableConnectivity(false);
  const upload = new MultipartUpload({}, {
    file: makeFile(),
    connectivity: net,
    awaitOnline: false,
  });

  await upload.waitForOnline();
  assert.equal(net.subscriberCount(), 0);
});

test("waitForOnline does not hang on Node/React Native, where navigator is absent", async () => {
  // No connectivity option: the default web source reports online when
  // `navigator` is missing, so uploads proceed instead of stalling forever.
  const upload = new MultipartUpload({}, { file: makeFile() });

  await Promise.race([
    upload.waitForOnline(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("waitForOnline hung")), 500)),
  ]);
});

test("a source that fires synchronously still unsubscribes", async () => {
  // Guards the resolve-before-unsubscribe ordering in waitForOnline.
  let removed = false;
  const net = {
    isOnline: () => false,
    onOnline(cb) {
      cb();
      return () => { removed = true; };
    },
  };
  const upload = new MultipartUpload({}, { file: makeFile(), connectivity: net });

  await upload.waitForOnline();
  assert.equal(removed, true, "synchronous fire must not leak the subscription");
});
