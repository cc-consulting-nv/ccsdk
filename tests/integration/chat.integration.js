/**
 * Chat SDK Integration Tests
 *
 * Run with:
 *   API_TOKEN=<token> npx tsx tests/integration/chat.integration.js
 *
 * The token must belong to an authenticated user on a tenant with messaging
 * enabled. To exercise DM + 2-party group flows, also provide a second user's
 * ULID via TARGET_USER_ULID (otherwise those steps are skipped).
 *
 * Environment variables:
 *   API_BASE          - Base URL for the API (default: http://localhost:8089)
 *   API_TOKEN         - Access token (required)
 *   TARGET_USER_ULID  - Another user's ULID for DM/group tests (optional)
 *
 * Covers:
 *   - createChatGroup / findOrCreateDm
 *   - getChatGroups / getDmConversations
 *   - sendChatMessage (text)
 *   - getChatMessages (pagination shape + normalization)
 *   - markChatGroupRead
 *   - getChatUnreadCount
 *   - deleteChatMessage
 */

// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;
const TARGET_USER_ULID = process.env.TARGET_USER_ULID || null;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/chat.integration.js\n\n" +
      "The token must belong to an authenticated user on a messaging-enabled tenant.\n" +
      "Generate one with: sail artisan cc:get-token <tenant-id> <username>\n\n" +
      "Optional environment variables:\n" +
      "  API_BASE=http://localhost:8089  (default)\n" +
      "  TARGET_USER_ULID=<ulid>         (enables DM/group tests)",
  );
  process.exit(0);
}

const sdk = new CcPlatformSdk({
  baseUrl: API_BASE,
  tokens: { accessToken: API_TOKEN },
});

let groupUlid = null;
let messageUlid = null;
let passed = 0;
let failed = 0;

function success(message) {
  console.log(`  ✓ ${message}`);
  passed++;
}

function fail(message, error) {
  console.error(`  ✗ ${message}`);
  if (error) console.error(`    Error: ${error.message || error}`);
  failed++;
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// listChatGroups
// ---------------------------------------------------------------------------

async function testListGroups() {
  console.log("\n=== getChatGroups ===");
  try {
    const res = await sdk.getChatGroups();
    if (Array.isArray(res?.data)) {
      success(`returned ${res.data.length} groups under data`);
    } else {
      fail("getChatGroups did not return { data: [...] }");
    }
  } catch (error) {
    fail("getChatGroups threw", error);
  }
}

// ---------------------------------------------------------------------------
// findOrCreateDm (needs a target user)
// ---------------------------------------------------------------------------

async function testFindOrCreateDm() {
  console.log("\n=== findOrCreateDm ===");
  if (!TARGET_USER_ULID) {
    console.log("  ⚠ TARGET_USER_ULID not set — skipping DM tests");
    return;
  }
  try {
    const res = await sdk.findOrCreateDm(TARGET_USER_ULID);
    const dm = res?.data;
    if (dm?.ulid) {
      groupUlid = dm.ulid;
      success(`DM ready: ${groupUlid} (isDm=${dm.isDm})`);
    } else {
      fail("findOrCreateDm did not return a group under data");
    }
  } catch (error) {
    fail("findOrCreateDm threw", error);
  }
}

// ---------------------------------------------------------------------------
// createChatGroup (fallback when no DM target)
// ---------------------------------------------------------------------------

async function testCreateGroup() {
  console.log("\n=== createChatGroup ===");
  if (groupUlid) {
    console.log("  ⚠ already have a group from DM — skipping create");
    return;
  }
  if (!TARGET_USER_ULID) {
    console.log(
      "  ⚠ TARGET_USER_ULID not set — cannot create a group (needs a participant)",
    );
    return;
  }
  try {
    const res = await sdk.createChatGroup({
      name: `SDK Integration ${Date.now()}`,
      participants: [TARGET_USER_ULID],
    });
    const group = res?.data;
    if (group?.ulid) {
      groupUlid = group.ulid;
      success(`created group: ${groupUlid}`);
    } else {
      fail("createChatGroup did not return a group under data");
    }
  } catch (error) {
    fail("createChatGroup threw", error);
  }
}

// ---------------------------------------------------------------------------
// sendChatMessage
// ---------------------------------------------------------------------------

async function testSendMessage() {
  console.log("\n=== sendChatMessage ===");
  if (!groupUlid) {
    console.log("  ⚠ no group available — skipping send");
    return;
  }
  try {
    const res = await sdk.sendChatMessage(groupUlid, {
      body: `Hello from the SDK integration suite at ${new Date().toISOString()}`,
    });
    const msg = res?.data;
    if (msg?.id || msg?.ulid) {
      messageUlid = msg.ulid || msg.id;
      success(`sent message: ${messageUlid}`);
      if (msg.senderId) success("message has a normalized senderId");
    } else {
      fail("sendChatMessage did not return a message under data");
    }
  } catch (error) {
    fail("sendChatMessage threw", error);
  }
}

// ---------------------------------------------------------------------------
// getChatMessages
// ---------------------------------------------------------------------------

async function testGetMessages() {
  console.log("\n=== getChatMessages ===");
  if (!groupUlid) {
    console.log("  ⚠ no group available — skipping fetch");
    return;
  }
  try {
    const page = await sdk.getChatMessages(groupUlid, { limit: 10 });
    if (Array.isArray(page?.data)) {
      success(`returned ${page.data.length} messages`);
    } else {
      fail("getChatMessages did not return a { data: [...] } page");
      return;
    }
    if ("nextCursor" in page) success("page exposes nextCursor");
    const found = page.data.find(
      (m) => (m.ulid || m.id) === messageUlid,
    );
    if (found) {
      success("the message we just sent is present");
      if (found.sender || found.username) success("sender info normalized");
    }
  } catch (error) {
    fail("getChatMessages threw", error);
  }
}

// ---------------------------------------------------------------------------
// markChatGroupRead + unread count
// ---------------------------------------------------------------------------

async function testReadAndUnread() {
  console.log("\n=== markChatGroupRead + getChatUnreadCount ===");
  if (!groupUlid) {
    console.log("  ⚠ no group available — skipping");
    return;
  }
  try {
    await sdk.markChatGroupRead(groupUlid);
    success("markChatGroupRead succeeded");
  } catch (error) {
    fail("markChatGroupRead threw", error);
  }
  try {
    const { unreadCount } = await sdk.getChatUnreadCount();
    if (typeof unreadCount === "number") {
      success(`unread count: ${unreadCount}`);
    } else {
      fail("getChatUnreadCount did not return a numeric unreadCount");
    }
  } catch (error) {
    fail("getChatUnreadCount threw", error);
  }
}

// ---------------------------------------------------------------------------
// deleteChatMessage
// ---------------------------------------------------------------------------

async function testDeleteMessage() {
  console.log("\n=== deleteChatMessage ===");
  if (!groupUlid || !messageUlid) {
    console.log("  ⚠ no message to delete — skipping");
    return;
  }
  try {
    await sdk.deleteChatMessage(groupUlid, messageUlid);
    success(`deleted message: ${messageUlid}`);
  } catch (error) {
    fail("deleteChatMessage threw", error);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  await testListGroups();
  await testFindOrCreateDm();
  await testCreateGroup();
  await testSendMessage();
  await testGetMessages();
  await testReadAndUnread();
  await testDeleteMessage();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
}

main().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
