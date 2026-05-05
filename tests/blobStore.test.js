import test from "node:test";
import assert from "node:assert/strict";
import { MemoryBlobStore } from "../dist/blobStore.js";

function makeFile(name = "video.mp4", size = 1024) {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type: "video/mp4" });
}

test("MemoryBlobStore put + get round-trips file metadata", async () => {
  const store = new MemoryBlobStore();
  const file = makeFile("v.mp4", 512);
  await store.put("job1", file);
  const got = await store.get("job1");
  assert.ok(got, "expected to retrieve stored file");
  assert.equal(got.name, "v.mp4");
  assert.equal(got.size, 512);
  assert.equal(got.type, "video/mp4");
});

test("MemoryBlobStore get returns null for unknown id", async () => {
  const store = new MemoryBlobStore();
  assert.equal(await store.get("missing"), null);
});

test("MemoryBlobStore delete removes entry", async () => {
  const store = new MemoryBlobStore();
  await store.put("job1", makeFile());
  await store.delete("job1");
  assert.equal(await store.get("job1"), null);
});

test("MemoryBlobStore list returns all known ids", async () => {
  const store = new MemoryBlobStore();
  await store.put("a", makeFile("a.mp4"));
  await store.put("b", makeFile("b.mp4"));
  const ids = await store.list();
  assert.deepEqual(ids.sort(), ["a", "b"]);
});
