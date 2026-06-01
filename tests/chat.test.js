/**
 * Chat SDK Tests (mocked HTTP)
 *
 * Covers getChatGroups, getDmConversations, createChatGroup, findOrCreateDm,
 * getChatMessages (pagination + normalization), sendChatMessage,
 * markChatGroupRead, deleteChatMessage, and getChatUnreadCount — verifying
 * endpoints, payloads, and that the backend envelope/post shapes are
 * normalized into the flat ChatMessage type.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { CcPlatformSdk } from "../dist/platformSdk.js";

const baseUrl = "https://api.example.com";

function createMockSdk(responder) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const { body, status = 200 } = responder(url, init, calls.length);
    return new Response(body == null ? "" : JSON.stringify(body), { status });
  };
  const sdk = new CcPlatformSdk({
    baseUrl,
    tokens: { accessToken: "test-token" },
    fetchImpl,
    cache: {},
  });
  return { sdk, calls };
}

// A CHAT-type post as the API actually returns it.
const samplePost = (overrides = {}) => ({
  id: "01hxmsg0000000000000000001",
  ulid: "01hxmsg0000000000000000001",
  body: "hello there",
  createdAt: "2026-06-01T10:00:00+00:00",
  username: "alice",
  userId: "01hxusr0000000000000000001",
  user: {
    userId: "01hxusr0000000000000000001",
    avatar: "https://example.com/a.png",
    name: "Alice",
  },
  images: [],
  groupUlid: "01hxgrp0000000000000000001",
  readAt: null,
  ...overrides,
});

const sampleGroup = (overrides = {}) => ({
  ulid: "01hxgrp0000000000000000001",
  id: "01hxgrp0000000000000000001",
  name: "Crew",
  isDm: false,
  isGroup: true,
  unreadCount: 2,
  ...overrides,
});

// ---------------------------------------------------------------------------
// getChatGroups / getDmConversations
// ---------------------------------------------------------------------------

test("getChatGroups GETs /v1/chat/groups and returns data", async () => {
  const { sdk, calls } = createMockSdk(() => ({
    body: { data: [sampleGroup()] },
  }));

  const res = await sdk.getChatGroups();
  const url = new URL(calls[0].url);

  assert.equal(url.pathname, "/v1/chat/groups");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(res.data.length, 1);
  assert.equal(res.data[0].ulid, "01hxgrp0000000000000000001");
});

test("getDmConversations adds type=dm query", async () => {
  const { sdk, calls } = createMockSdk(() => ({
    body: { data: [sampleGroup({ isDm: true, isGroup: false })] },
  }));

  await sdk.getDmConversations();
  const url = new URL(calls[0].url);

  assert.equal(url.pathname, "/v1/chat/groups");
  assert.equal(url.searchParams.get("type"), "dm");
});

// ---------------------------------------------------------------------------
// createChatGroup / findOrCreateDm
// ---------------------------------------------------------------------------

test("createChatGroup POSTs participants to /v1/chat/groups", async () => {
  const { sdk, calls } = createMockSdk(() => ({
    body: { data: sampleGroup() },
    status: 201,
  }));

  const res = await sdk.createChatGroup({
    name: "Crew",
    participants: ["01hxusr0000000000000000002", "01hxusr0000000000000000003"],
  });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/chat/groups");
  assert.equal(calls[0].init.method, "POST");
  const sentBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(sentBody.participants, [
    "01hxusr0000000000000000002",
    "01hxusr0000000000000000003",
  ]);
  assert.equal(res.data.name, "Crew");
});

test("findOrCreateDm POSTs to /v1/chat/dm/{userUlid}", async () => {
  const { sdk, calls } = createMockSdk(() => ({
    body: { data: sampleGroup({ isDm: true }) },
    status: 201,
  }));

  const res = await sdk.findOrCreateDm("01hxusr0000000000000000009");
  const url = new URL(calls[0].url);

  assert.equal(url.pathname, "/v1/chat/dm/01hxusr0000000000000000009");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(res.data.isDm, true);
});

// ---------------------------------------------------------------------------
// getChatMessages — normalization + pagination
// ---------------------------------------------------------------------------

test("getChatMessages normalizes {data,next_cursor,has_more} into a page", async () => {
  const { sdk, calls } = createMockSdk(() => ({
    body: {
      data: [samplePost()],
      messages: [samplePost()],
      next_cursor: "CURSOR123",
      nextCursor: "CURSOR123",
      has_more: true,
      hasMore: true,
    },
  }));

  const page = await sdk.getChatMessages("01hxgrp0000000000000000001");
  const url = new URL(calls[0].url);

  assert.equal(
    url.pathname,
    "/v1/chat/groups/01hxgrp0000000000000000001/messages",
  );
  assert.equal(page.data.length, 1);
  assert.equal(page.nextCursor, "CURSOR123");
  assert.equal(page.hasMore, true);

  // Sender flattened from the `user` object / top-level username
  const msg = page.data[0];
  assert.equal(msg.body, "hello there");
  assert.equal(msg.userId, "01hxusr0000000000000000001");
  assert.equal(msg.senderId, "01hxusr0000000000000000001");
  assert.equal(msg.sender.username, "alice");
  assert.equal(msg.sender.avatar, "https://example.com/a.png");
});

test("getChatMessages passes cursor as a query param", async () => {
  const { sdk, calls } = createMockSdk(() => ({
    body: { data: [], next_cursor: null, has_more: false },
  }));

  await sdk.getChatMessages("01hxgrp0000000000000000001", {
    cursor: "ABC",
    limit: 25,
  });
  const url = new URL(calls[0].url);

  assert.equal(url.searchParams.get("cursor"), "ABC");
  assert.equal(url.searchParams.get("limit"), "25");
});

test("getChatMessages tolerates a bare array response", async () => {
  const { sdk } = createMockSdk(() => ({ body: [samplePost()] }));

  const page = await sdk.getChatMessages("01hxgrp0000000000000000001");
  assert.equal(page.data.length, 1);
  assert.equal(page.nextCursor, null);
});

test("getChatMessages normalizes image attachments", async () => {
  const attachment = { url: "https://example.com/pic.jpg", type: "image" };
  const { sdk } = createMockSdk(() => ({
    body: { data: [samplePost({ images: [attachment] })] },
  }));

  const page = await sdk.getChatMessages("01hxgrp0000000000000000001");
  assert.deepEqual(page.data[0].attachments, [attachment]);
  assert.deepEqual(page.data[0].images, [attachment]);
});

// ---------------------------------------------------------------------------
// sendChatMessage
// ---------------------------------------------------------------------------

test("sendChatMessage POSTs body and returns normalized message under data", async () => {
  const { sdk, calls } = createMockSdk(() => ({
    body: { data: samplePost({ body: "yo" }) },
    status: 201,
  }));

  const res = await sdk.sendChatMessage("01hxgrp0000000000000000001", {
    body: "yo",
  });

  const url = new URL(calls[0].url);
  assert.equal(
    url.pathname,
    "/v1/chat/groups/01hxgrp0000000000000000001/messages",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).body, "yo");
  assert.equal(res.data.body, "yo");
  assert.equal(res.data.senderId, "01hxusr0000000000000000001");
});

test("sendChatMessage forwards attachments", async () => {
  const { sdk, calls } = createMockSdk(() => ({
    body: { data: samplePost() },
    status: 201,
  }));

  await sdk.sendChatMessage("01hxgrp0000000000000000001", {
    body: "pic",
    attachments: [{ url: "https://example.com/p.jpg", type: "image" }],
  });

  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.attachments.length, 1);
  assert.equal(sent.attachments[0].type, "image");
});

test("sendChatMessage tolerates a flat (unwrapped) message response", async () => {
  const { sdk } = createMockSdk(() => ({
    body: samplePost({ body: "flat" }),
    status: 201,
  }));

  const res = await sdk.sendChatMessage("01hxgrp0000000000000000001", {
    body: "flat",
  });
  assert.equal(res.data.body, "flat");
});

// ---------------------------------------------------------------------------
// markChatGroupRead / deleteChatMessage
// ---------------------------------------------------------------------------

test("markChatGroupRead POSTs to the read endpoint", async () => {
  const { sdk, calls } = createMockSdk(() => ({
    body: { message: "Chat marked as read", messages_marked: 3 },
  }));

  await sdk.markChatGroupRead("01hxgrp0000000000000000001");
  const url = new URL(calls[0].url);

  assert.equal(
    url.pathname,
    "/v1/chat/groups/01hxgrp0000000000000000001/read",
  );
  assert.equal(calls[0].init.method, "POST");
});

test("deleteChatMessage DELETEs the message endpoint", async () => {
  const { sdk, calls } = createMockSdk(() => ({ body: { message: "Message deleted" } }));

  await sdk.deleteChatMessage(
    "01hxgrp0000000000000000001",
    "01hxmsg0000000000000000001",
  );
  const url = new URL(calls[0].url);

  assert.equal(
    url.pathname,
    "/v1/chat/groups/01hxgrp0000000000000000001/messages/01hxmsg0000000000000000001",
  );
  assert.equal(calls[0].init.method, "DELETE");
});

// ---------------------------------------------------------------------------
// getChatUnreadCount
// ---------------------------------------------------------------------------

test("getChatUnreadCount reads unread_count from the response", async () => {
  const { sdk, calls } = createMockSdk(() => ({ body: { unread_count: 15 } }));

  const res = await sdk.getChatUnreadCount();
  const url = new URL(calls[0].url);

  assert.equal(url.pathname, "/v1/chat/unread-count");
  assert.equal(res.unreadCount, 15);
});

test("getChatUnreadCount tolerates a {data:{unread_count}} envelope", async () => {
  const { sdk } = createMockSdk(() => ({ body: { data: { unread_count: 7 } } }));

  const res = await sdk.getChatUnreadCount();
  assert.equal(res.unreadCount, 7);
});

test("getChatUnreadCount defaults to 0 when absent", async () => {
  const { sdk } = createMockSdk(() => ({ body: {} }));

  const res = await sdk.getChatUnreadCount();
  assert.equal(res.unreadCount, 0);
});
