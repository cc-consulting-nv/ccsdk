/**
 * Realtime client tests (fake Echo).
 *
 * Uses the `echoFactory` config seam to inject a fake Echo instance, so these
 * tests exercise channel naming, event wiring, dispatch, and unsubscribe
 * without a real WebSocket / pusher-js.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createRealtimeClient,
  realtimeChannels,
} from "../dist/realtime.js";

/** Build a fake Echo that records private channels + listeners. */
function makeFakeEcho() {
  const channels = new Map();
  const left = [];

  function makeChannel(name) {
    const listeners = new Map();
    const channel = {
      name,
      listen(event, handler) {
        listeners.set(event, handler);
        return channel;
      },
      // test helper: dispatch an event to its handler
      _emit(event, data) {
        const h = listeners.get(event);
        if (h) h(data);
      },
      _listeners: listeners,
    };
    return channel;
  }

  const echo = {
    private(name) {
      if (!channels.has(name)) channels.set(name, makeChannel(name));
      return channels.get(name);
    },
    channel(name) {
      if (!channels.has(name)) channels.set(name, makeChannel(name));
      return channels.get(name);
    },
    leave(name) {
      left.push(name);
      channels.delete(name);
    },
    disconnect() {
      this._disconnected = true;
    },
    _disconnected: false,
    _channels: channels,
    _left: left,
  };
  return echo;
}

function makeClient() {
  const echo = makeFakeEcho();
  const client = createRealtimeClient({
    apiBaseUrl: "https://api.example.com",
    appKey: "k",
    wsHost: "s.example.com",
    getToken: () => "token",
    echoFactory: () => echo,
  });
  return { client, echo };
}

// ---------------------------------------------------------------------------
// channel name helpers
// ---------------------------------------------------------------------------

test("realtimeChannels builds the backend channel names", () => {
  assert.equal(realtimeChannels.chat("G1"), "chat.G1");
  assert.equal(realtimeChannels.user("U1"), "user-U1");
});

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

test("connect builds the Echo instance via echoFactory", async () => {
  const { client } = makeClient();
  assert.equal(client.isConnected, false);
  await client.connect();
  assert.equal(client.isConnected, true);
});

test("connect is idempotent", async () => {
  let built = 0;
  const echo = makeFakeEcho();
  const client = createRealtimeClient({
    apiBaseUrl: "https://api.example.com",
    appKey: "k",
    wsHost: "s.example.com",
    getToken: () => "token",
    echoFactory: () => {
      built++;
      return echo;
    },
  });
  await client.connect();
  await client.connect();
  assert.equal(built, 1);
});

// ---------------------------------------------------------------------------
// subscribeToChat
// ---------------------------------------------------------------------------

test("subscribeToChat listens on chat.{ulid} and dispatches message.sent", async () => {
  const { client, echo } = makeClient();
  await client.connect();

  const received = [];
  client.subscribeToChat("G1", (evt) => received.push(evt));

  const channel = echo._channels.get("chat.G1");
  assert.ok(channel, "expected a chat.G1 channel");
  assert.ok(channel._listeners.has("message.sent"));
  assert.ok(channel._listeners.has(".message.sent"));

  const payload = {
    conversation_id: "G1",
    message: { ulid: "M1", body: "hi" },
  };
  channel._emit("message.sent", payload);

  assert.equal(received.length, 1);
  assert.equal(received[0].message.body, "hi");
});

// ---------------------------------------------------------------------------
// subscribeToUserChannel
// ---------------------------------------------------------------------------

test("subscribeToUserChannel listens on user-{ulid} for unread updates", async () => {
  const { client, echo } = makeClient();
  await client.connect();

  let last = null;
  client.subscribeToUserChannel("U1", (evt) => {
    last = evt;
  });

  const channel = echo._channels.get("user-U1");
  assert.ok(channel);
  channel._emit("chat.unread.updated", {
    conversationUlid: "G1",
    unreadCount: 2,
    totalUnreadCount: 9,
  });

  assert.equal(last.totalUnreadCount, 9);
});

// ---------------------------------------------------------------------------
// unsubscribe / disconnect
// ---------------------------------------------------------------------------

test("the returned unsubscribe leaves the channel", async () => {
  const { client, echo } = makeClient();
  await client.connect();

  const off = client.subscribeToChat("G1", () => {});
  assert.ok(echo._channels.has("chat.G1"));

  off();
  assert.deepEqual(echo._left, ["chat.G1"]);
  assert.equal(echo._channels.has("chat.G1"), false);
});

test("disconnect leaves all channels and tears down", async () => {
  const { client, echo } = makeClient();
  await client.connect();

  client.subscribeToChat("G1", () => {});
  client.subscribeToUserChannel("U1", () => {});

  client.disconnect();

  assert.equal(echo._disconnected, true);
  assert.equal(client.isConnected, false);
  assert.ok(echo._left.includes("chat.G1"));
  assert.ok(echo._left.includes("user-U1"));
});

test("subscribing before connect is a no-op that returns a safe unsubscribe", () => {
  const { client } = makeClient();
  // not connected
  const off = client.subscribeToChat("G1", () => {});
  assert.equal(typeof off, "function");
  off(); // must not throw
});
