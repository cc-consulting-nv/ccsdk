import test from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../dist/httpClient.js";

const baseUrl = "https://api.example.com";
const MAX = 50 * 1024 * 1024;

function makeClient(fetchImpl) {
  return new HttpClient({ baseUrl, fetchImpl });
}

test("rejects JSON response when Content-Length declares >50MB", async () => {
  const fetchImpl = async () =>
    new Response("{}", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(MAX + 1),
      },
    });

  await assert.rejects(
    () => makeClient(fetchImpl).get("/big"),
    (err) => err instanceof TypeError && /declared/.test(err.message)
  );
});

test("rejects msgpack response when Content-Length declares >50MB", async () => {
  const fetchImpl = async () =>
    new Response(new Uint8Array([0x80]), {
      status: 200,
      headers: {
        "Content-Type": "application/msgpack",
        "Content-Length": String(MAX + 1),
      },
    });

  await assert.rejects(
    () => makeClient(fetchImpl).get("/big"),
    (err) => err instanceof TypeError && /declared/.test(err.message)
  );
});

test("rejects msgpack response when actual buffer >50MB despite missing Content-Length", async () => {
  const oversized = new Uint8Array(MAX + 1);
  oversized[0] = 0x80;

  const fetchImpl = async () =>
    new Response(oversized, {
      status: 200,
      headers: { "Content-Type": "application/msgpack" },
    });

  await assert.rejects(
    () => makeClient(fetchImpl).get("/chunked-big"),
    (err) => err instanceof TypeError && /MessagePack response too large/.test(err.message)
  );
});

test("rejects JSON response when actual text >50MB despite missing Content-Length", async () => {
  const oversized = "x".repeat(MAX + 1);

  const fetchImpl = async () =>
    new Response(oversized, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    () => makeClient(fetchImpl).get("/chunked-big-json"),
    (err) => err instanceof TypeError && /JSON response too large/.test(err.message)
  );
});

test("accepts response at the cap boundary (exactly 50MB)", async () => {
  const atCap = "x".repeat(MAX);

  const fetchImpl = async () =>
    new Response(JSON.stringify({ payload: atCap.slice(0, MAX - 20) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const result = await makeClient(fetchImpl).get("/at-cap");
  assert.ok(result, "response under cap should parse without throwing");
});

test("accepts small responses with Content-Length header", async () => {
  const body = JSON.stringify({ ok: true });
  const fetchImpl = async () =>
    new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(body.length),
      },
    });

  const result = await makeClient(fetchImpl).get("/small");
  assert.deepEqual(result, { ok: true });
});

test("ignores malformed Content-Length header and falls back to post-allocation check", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "not-a-number",
      },
    });

  const result = await makeClient(fetchImpl).get("/malformed-cl");
  assert.deepEqual(result, { ok: true });
});
