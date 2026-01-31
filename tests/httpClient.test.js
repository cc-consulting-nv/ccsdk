import test from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../dist/httpClient.js";

const baseUrl = "https://api.example.com";

test("HttpClient injects bearer token and baseUrl", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new HttpClient({
    baseUrl,
    fetchImpl,
    getAuthTokens: () => ({ accessToken: "abc123" }),
  });

  await client.get("/ping");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/ping`);
  assert.equal(calls[0].init.headers.Authorization, "Bearer abc123");
});

test("HttpClient POST serializes JSON bodies", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new HttpClient({
    baseUrl,
    fetchImpl,
  });

  await client.post("/echo", { body: { foo: "bar" } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/echo`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ foo: "bar" }));
});
