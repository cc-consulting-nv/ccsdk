import { ccPlatformSdk } from "../../dist/index.js";

const API_BASE = process.env.API_BASE;
const API_TOKEN = process.env.API_TOKEN;

if (!API_BASE || !API_TOKEN) {
  console.log(
    "Skipping integration test: set API_BASE and API_TOKEN env vars to run live API checks.",
  );
  process.exit(0);
}

async function main() {
  const sdk = ccPlatformSdk;
  sdk.setTokens({ accessToken: API_TOKEN });

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
