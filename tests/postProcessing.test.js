import test from "node:test";
import assert from "node:assert/strict";
import { watchPostProcessing } from "../dist/postProcessing.js";

function makeFetcher(responses) {
  let i = 0;
  const calls = [];
  return {
    calls,
    async getPostByUlid(ulid, force) {
      calls.push({ ulid, force });
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

const fastSchedule = { schedule: [10, 20], steadyInterval: 30, maxTotalMs: 1000 };

test("watchPostProcessing fires onDone when poll returns isProcessing=false", async () => {
  const fetcher = makeFetcher([
    { ulid: "a", isProcessing: true },
    { ulid: "a", isProcessing: false, body: "done" },
  ]);
  const onDone = [];
  const w = watchPostProcessing(fetcher, "a", {
    ...fastSchedule,
    onDone: (p) => onDone.push(p),
  });
  await w.settled;
  assert.equal(onDone.length, 1);
  assert.equal(onDone[0].body, "done");
  assert.equal(w.isSettled, true);
});

test("markComplete races and wins over polling", async () => {
  // Fetcher always says still processing; only markComplete can settle this.
  const fetcher = makeFetcher([{ ulid: "a", isProcessing: true }]);
  const onDone = [];
  const w = watchPostProcessing(fetcher, "a", {
    schedule: [50],
    steadyInterval: 50,
    maxTotalMs: 5000,
    onDone: (p) => onDone.push(p),
  });
  // Resolve via external signal before any poll tick.
  setTimeout(() => w.markComplete({ ulid: "a", isProcessing: false, body: "from-pusher" }), 5);
  await w.settled;
  assert.equal(onDone.length, 1);
  assert.equal(onDone[0].body, "from-pusher");
});

test("markComplete is idempotent", async () => {
  const fetcher = makeFetcher([{ ulid: "a", isProcessing: false }]);
  const onDone = [];
  const w = watchPostProcessing(fetcher, "a", {
    ...fastSchedule,
    onDone: (p) => onDone.push(p),
  });
  w.markComplete();
  w.markComplete();
  w.markComplete();
  await w.settled;
  assert.equal(onDone.length, 1);
});

test("AbortSignal cancels without firing onDone", async () => {
  const fetcher = makeFetcher([{ ulid: "a", isProcessing: true }]);
  const onDone = [];
  const ctrl = new AbortController();
  const w = watchPostProcessing(fetcher, "a", {
    ...fastSchedule,
    signal: ctrl.signal,
    onDone: (p) => onDone.push(p),
  });
  ctrl.abort();
  await w.settled;
  assert.equal(onDone.length, 0);
  assert.equal(w.isSettled, true);
});

test("stop() cancels without firing onDone", async () => {
  const fetcher = makeFetcher([{ ulid: "a", isProcessing: true }]);
  const onDone = [];
  const w = watchPostProcessing(fetcher, "a", {
    ...fastSchedule,
    onDone: (p) => onDone.push(p),
  });
  w.stop();
  await w.settled;
  assert.equal(onDone.length, 0);
});

test("transient fetch error keeps polling and reports via onError", async () => {
  const fetcher = makeFetcher([
    new Error("network drop"),
    { ulid: "a", isProcessing: false },
  ]);
  const onDone = [];
  const onError = [];
  const w = watchPostProcessing(fetcher, "a", {
    ...fastSchedule,
    onDone: (p) => onDone.push(p),
    onError: (e) => onError.push(e),
  });
  await w.settled;
  assert.equal(onError.length, 1);
  assert.equal(onError[0].message, "network drop");
  assert.equal(onDone.length, 1);
});

test("maxTotalMs ceiling fires onDone with null after timeout", async () => {
  const fetcher = makeFetcher([{ ulid: "a", isProcessing: true }]);
  const onDone = [];
  const w = watchPostProcessing(fetcher, "a", {
    schedule: [10, 10, 10],
    steadyInterval: 10,
    maxTotalMs: 30,
    onDone: (p) => onDone.push(p),
  });
  await w.settled;
  assert.equal(onDone.length, 1);
  assert.equal(onDone[0], null);
});
