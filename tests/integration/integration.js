// Polyfill IndexedDB for Node.js
import "fake-indexeddb/auto";

import { CcPlatformSdk } from "../../src/platformSdk.ts";

const API_BASE = process.env.API_BASE || "http://localhost:8089";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.log(
    "Usage: API_TOKEN=<token> npx tsx tests/integration/integration.js\n" +
    "Get your token from localStorage after logging into the UI."
  );
  process.exit(0);
}

const sdk = new CcPlatformSdk({
  baseUrl: API_BASE,
  tokens: { accessToken: API_TOKEN },
});

async function main() {

  console.log(`Hitting ${API_BASE} for /v1/songs/feed/all…`);
  const page = await sdk.fetchFeedPage(undefined, "/v1/songs/feed/all");
  console.log(`Fetched ${page.posts.length} posts from first page.`);

  if (!page.posts.length) {
    throw new Error("No posts returned from /v1/songs/feed/all");
  }

  const firstId = page.posts[0].ulid || page.posts[0].id;
  const detail = await sdk.getPostByUlid(firstId);
  if (!detail) {
    throw new Error(`Failed to hydrate post ${firstId}`);
  }

  console.log(`Hydrated post ${firstId}.`);
}

main().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
