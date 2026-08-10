import test from "node:test";
import assert from "node:assert/strict";
import { WebConnectivitySource, defaultConnectivitySource } from "../dist/platform/connectivity.js";

/**
 * Swap in fake globals for the duration of fn, then restore. Node has no
 * `navigator.onLine`, so these tests install one.
 */
async function withGlobals({ navigator, listeners }, fn) {
  const hadNav = "navigator" in globalThis;
  const prevNav = globalThis.navigator;
  const prevAdd = globalThis.addEventListener;
  const prevRemove = globalThis.removeEventListener;

  if (navigator === null) {
    delete globalThis.navigator;
  } else if (navigator !== undefined) {
    Object.defineProperty(globalThis, "navigator", {
      value: navigator,
      configurable: true,
      writable: true,
    });
  }
  if (listeners) {
    globalThis.addEventListener = listeners.add;
    globalThis.removeEventListener = listeners.remove;
  } else if (listeners === null) {
    delete globalThis.addEventListener;
    delete globalThis.removeEventListener;
  }

  try {
    return await fn();
  } finally {
    if (hadNav) {
      Object.defineProperty(globalThis, "navigator", {
        value: prevNav,
        configurable: true,
        writable: true,
      });
    } else {
      delete globalThis.navigator;
    }
    globalThis.addEventListener = prevAdd;
    globalThis.removeEventListener = prevRemove;
  }
}

test("isOnline treats a missing navigator as online (Node/React Native)", async () => {
  await withGlobals({ navigator: null }, () => {
    assert.equal(new WebConnectivitySource().isOnline(), true);
  });
});

test("isOnline reports offline only on an explicit navigator.onLine === false", async () => {
  await withGlobals({ navigator: { onLine: false } }, () => {
    assert.equal(new WebConnectivitySource().isOnline(), false);
  });
  await withGlobals({ navigator: { onLine: true } }, () => {
    assert.equal(new WebConnectivitySource().isOnline(), true);
  });
  // Unknown state must read as online, not offline — a false negative stalls uploads.
  await withGlobals({ navigator: {} }, () => {
    assert.equal(new WebConnectivitySource().isOnline(), true);
  });
});

test("onOnline subscribes to the online event and unsubscribes exactly once", async () => {
  const added = [];
  const removed = [];
  await withGlobals(
    {
      listeners: {
        add: (evt, cb) => added.push([evt, cb]),
        remove: (evt, cb) => removed.push([evt, cb]),
      },
    },
    () => {
      const cb = () => { };
      const unsubscribe = new WebConnectivitySource().onOnline(cb);

      assert.equal(added.length, 1);
      assert.deepEqual(added[0], ["online", cb]);

      unsubscribe();
      assert.equal(removed.length, 1);
      assert.deepEqual(removed[0], ["online", cb]);

      // Idempotent: a second call must not double-remove.
      unsubscribe();
      assert.equal(removed.length, 1);
    },
  );
});

test("onOnline is inert without addEventListener, and its unsubscribe is safe", async () => {
  await withGlobals({ listeners: null }, () => {
    const unsubscribe = new WebConnectivitySource().onOnline(() => { });
    assert.equal(typeof unsubscribe, "function");
    unsubscribe();
  });
});

test("defaultConnectivitySource satisfies the ConnectivitySource shape", () => {
  assert.equal(typeof defaultConnectivitySource.isOnline, "function");
  assert.equal(typeof defaultConnectivitySource.onOnline, "function");
});
