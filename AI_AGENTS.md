# AI_AGENTS.md — Content Creation Guide for AI Agents

> This file helps AI agents create posts, comments, upload media, manage blogs, and moderate content using the CCSDK.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Creating Posts](#creating-posts)
3. [Comments](#comments)
4. [Uploading Media](#uploading-media)
5. [Blog Posts](#blog-posts)
6. [Moderation](#moderation)
7. [Engagement Actions](#engagement-actions)
8. [Common Patterns](#common-patterns)

---

## Quick Start

```typescript
import { CcPlatformSdk, HybridTokenProvider } from "@cc-consulting-nv/ccsdk";

const sdk = new CcPlatformSdk({
  baseUrl: "https://api.example.com",
  tokenProvider: new HybridTokenProvider(localStorage),
  onRefreshTokens: async () => { /* refresh logic */ },
  onUnauthorized: () => { /* redirect to login */ },
});

// Login first
await sdk.login("user@example.com", "password");
```

---

## Creating Posts

### Text Post

```typescript
const post = await sdk.createPost({
  content: "Hello, world! This is my first post.",
  visibility: "public", // "public" | "followers" | "private"
});
console.log("Created post:", post.ulid);
```

### Video Post

```typescript
// First upload the video file (see Uploading Media section)
const videoUrl = "https://s3.../uploaded-video.mp4";

const videoPost = await sdk.createVideoPost({
  videoUrl: videoUrl,
  title: "My Awesome Video",
  body: "Check out this video I made!",
  type: "VIDEO", // "VIDEO" | "BURST" for short-form
  groupName: "default", // Required, use "default" if unsure
  sensitive: false,
  commentsEnabled: true,
  downloadEnabled: false,
});
```

### Song Post

Songs are posts with `type: "SONG"`. Use the appropriate API endpoints for song creation (not shown here as they involve more complex audio processing).

### Update a Post

```typescript
const updated = await sdk.updatePost(postUlid, {
  content: "Updated content here",
  title: "New Title",
});
```

### Delete a Post

```typescript
await sdk.deletePost(postUlid);
```

---

## Comments

### Create a Comment

```typescript
const comment = await sdk.createComment({
  parentId: postUlid, // The post being commented on
  body: "Great post! Thanks for sharing.",
  // Optional: title, images
});
```

### Delete a Comment

```typescript
// Option 1: Provide parentId for immediate cache update
await sdk.deleteComment(commentUlid, parentPostUlid);

// Option 2: SDK will look up parent from cache if not provided
await sdk.deleteComment(commentUlid);
```

### Fetch Comments

```typescript
// Method 1: Using fetchComments
const result = await sdk.fetchComments({
  ulid: postUlid,
  perPage: 20,
  sortBy: "newest", // "newest" | "oldest" | "popular"
  cursor: null, // Use for pagination
});

// Method 2: Using getPostComments (convenience wrapper)
const { posts: comments, nextCursor } = await sdk.getPostComments(postUlid);
```

---

## Uploading Media

### Simple File Upload

For small files (< 100MB):

```typescript
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];

const response = await sdk.uploadFile("/v1/media/upload", file, {
  // Additional metadata
  type: "image",
  postId: postUlid,
});

const uploadedUrl = response.data?.url;
```

### Multipart Upload (Large Files)

For videos and large files (> 100MB), use multipart upload with resume support:

```typescript
import { MultipartUpload } from "@cc-consulting-nv/ccsdk";

const file = document.querySelector('input[type="file"]').files[0];

const upload = new MultipartUpload(sdk.client, {
  file: file,
  partSize: 10 * 1024 * 1024, // 10MB parts (optional)
  maxConcurrentUploads: 3,      // Upload 3 parts at once
  
  onProgress: (percent, uploadedParts, totalParts) => {
    console.log(`Progress: ${percent.toFixed(1)}% (${uploadedParts}/${totalParts})`);
  },
  
  onPartComplete: (partNumber, etag) => {
    console.log(`Part ${partNumber} uploaded`);
  },
  
  onComplete: (url) => {
    console.log("Upload complete:", url);
    // Now create the video post with this URL
    createVideoPost(url);
  },
  
  onError: (error) => {
    console.error("Upload failed:", error);
  },
});

// Start upload
await upload.start();

// Or pause/resume later
upload.pause();
// Save uploadId and key for resume
const savedState = {
  uploadId: upload.getUploadId(),
  key: upload.getKey(),
};
localStorage.setItem("pendingUpload", JSON.stringify(savedState));

// Resume later
const saved = JSON.parse(localStorage.getItem("pendingUpload"));
await upload.resume(saved.uploadId, saved.key);
```

### Image Upload for Posts

```typescript
// Upload image first
const imageFile = fileInput.files[0];
const uploadResponse = await sdk.uploadFile("/v1/media/upload", imageFile, {
  type: "image",
});

// Create post with image
const post = await sdk.createPost({
  content: "Post with an image",
  images: [uploadResponse.data?.url],
});
```

---

## Blog Posts

### Create a Blog Post

```typescript
import type { CreateBlogPostInput } from "@cc-consulting-nv/ccsdk";

// Content uses TipTap/ProseMirror JSON format
const blogContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Hello, this is my blog post!" }],
    },
  ],
};

const input: CreateBlogPostInput = {
  title: "My First Blog Post",
  content: blogContent,
  excerpt: "A brief summary of the post",
  status: "draft", // "draft" | "scheduled" | "published" | "archived"
  metaTitle: "SEO Title",
  metaDescription: "SEO Description for search engines",
  categoryId: 1,
  tags: ["tutorial", "guide"],
  isFeatured: false,
};

const blogPost = await sdk.createBlogPost(input);
console.log("Created blog:", blogPost.slug);
```

### Update a Blog Post

```typescript
import type { UpdateBlogPostInput } from "@cc-consulting-nv/ccsdk";

const update: UpdateBlogPostInput = {
  title: "Updated Title",
  content: updatedContent,
  excerpt: "Updated excerpt",
};

const updated = await sdk.updateBlogPost(blogUlid, update);
```

### Publish/Unpublish

```typescript
// Publish a draft
const published = await sdk.publishBlogPost(blogUlid);

// Schedule for later
const scheduled = await sdk.scheduleBlogPost(blogUlid, "2025-03-01T10:00:00Z");

// Unpublish (back to draft)
// Note: Use updateBlogPost with status: "draft" or specific unpublish endpoint
```

### Delete a Blog Post

```typescript
await sdk.deleteBlogPost(blogUlid);
```

### List Blog Posts

```typescript
// Get all published posts
const posts = await sdk.getBlogPosts({
  status: "published",
  perPage: 20,
  cursor: undefined,
});

// Get by category
const categoryPosts = await sdk.getBlogPosts({
  category: "tutorials",
});

// Search
const searchResults = await sdk.searchBlogPosts({
  q: "getting started",
  perPage: 10,
});
```

### Get Single Blog Post

```typescript
// By ULID
const post = await sdk.getBlogPost(blogUlid);

// By slug
const postBySlug = await sdk.getBlogPostBySlug("my-first-blog-post");
```

---

## Moderation

### Get Moderation Feed

```typescript
// Get pending moderation items
const feed = await sdk.getModerationFeed({
  status: "pending",
  content_type: "post", // "post" | "comment" | "profile" | "playlist"
  source: "all",        // "user" | "ai" | "all"
  limit: 20,
  cursor: undefined,
});

// Filter by violation type
const violations = await sdk.getModerationFeed({
  violation_type: "spam",
  priority: "high",
});
```

### Take Moderation Action

```typescript
// Available actions vary by platform configuration
// Common actions: "dismiss", "remove_content", "warn_user", "ban_user", "shadowban"

const result = await sdk.takeModerationAction(itemId, {
  action: "remove_content",
  reason: "Violates community guidelines",
  violation_type: "harassment",
  notify_creator: true,
});

console.log("Action taken:", result.success);
console.log("User status:", result.user_status);
```

### Get Moderation Item Details

```typescript
const item = await sdk.getModerationItem(itemId);
console.log("Content preview:", item.content_preview);
console.log("Report count:", item.report_count);
console.log("AI flags:", item.ai_flags);
```

### Get Content History

```typescript
// Get moderation history for a specific post/comment
const history = await sdk.getContentModerationHistory("post", postUlid);
console.log("Past actions:", history.actions);
```

### Get User Violation History

```typescript
const userHistory = await sdk.getUserViolationHistory(userUlid);
console.log("Total violation points:", userHistory.total_points);
console.log("Status:", userHistory.status); // 'good_standing' | 'warned' | 'timeout' | 'banned'
console.log("Violations:", userHistory.violations);
```

### Get Moderation Statistics

```typescript
const stats = await sdk.getModerationStats();
console.log("Pending items:", stats.pending_count);
console.log("High priority:", stats.high_priority_count);
```

---

## Engagement Actions

### Reactions

```typescript
// Add reaction (emoji)
await sdk.addReaction(postUlid, "❤️");
await sdk.addReaction(postUlid, "🔥");

// Remove reaction
await sdk.removeReaction(postUlid, "❤️");
```

### Bookmarks

```typescript
// Bookmark a post
await sdk.bookmarkPost(postUlid);

// Remove bookmark
await sdk.unbookmarkPost(postUlid);

// Check if bookmarked (in post.postEngagement.bookmarked)
const post = await sdk.getPostByUlid(postUlid);
console.log("Is bookmarked:", post?.postEngagement?.bookmarked);
```

### Share

```typescript
// Increment share count
await sdk.sharePost(postUlid);
```

### Ratings (for songs)

```typescript
// Rate a song (1-5)
await sdk.ratePost(songUlid, 5);

// Remove rating
await sdk.removeRating(songUlid);

// Get my rating
const myRating = await sdk.getMyRating(songUlid);

// Get all ratings for a song
const ratings = await sdk.getRatings(songUlid);
```

---

## Common Patterns

### Complete Workflow: Create Post with Image

```typescript
async function createPostWithImage(text: string, imageFile: File) {
  // Step 1: Upload image
  const uploadResponse = await sdk.uploadFile("/v1/media/upload", imageFile, {
    type: "image",
  });
  const imageUrl = uploadResponse.data?.url;

  if (!imageUrl) {
    throw new Error("Image upload failed");
  }

  // Step 2: Create post with image URL
  const post = await sdk.createPost({
    content: text,
    images: [imageUrl],
    visibility: "public",
  });

  return post;
}
```

### Complete Workflow: Create Video Post

```typescript
async function createVideoPost(videoFile: File, title: string, description: string) {
  // Step 1: Upload video using multipart (for large files)
  return new Promise((resolve, reject) => {
    const upload = new MultipartUpload(sdk.client, {
      file: videoFile,
      onProgress: (percent) => console.log(`${percent.toFixed(1)}% uploaded`),
      onComplete: async (videoUrl) => {
        try {
          // Step 2: Create video post
          const post = await sdk.createVideoPost({
            videoUrl: videoUrl,
            title: title,
            body: description,
            type: "VIDEO",
            groupName: "default",
          });
          resolve(post);
        } catch (error) {
          reject(error);
        }
      },
      onError: reject,
    });

    upload.start();
  });
}
```

### Error Handling Pattern

```typescript
async function safeCreatePost(content: string) {
  try {
    const post = await sdk.createPost({ content });
    return { success: true, post };
  } catch (error) {
    if (error.status === 401) {
      // Unauthorized - need to login
      return { success: false, error: "Please log in first" };
    }
    if (error.status === 429) {
      // Rate limited
      return { success: false, error: "Too many posts. Please wait a moment." };
    }
    if (error.status === 413) {
      // Content too large
      return { success: false, error: "Post content is too long" };
    }
    return { success: false, error: error.message };
  }
}
```

### Batch Operations

```typescript
// Delete multiple posts
async function deletePosts(postUlids: string[]) {
  const results = await Promise.allSettled(
    postUlids.map((ulid) => sdk.deletePost(ulid))
  );

  const failed = results
    .map((result, index) => ({ result, ulid: postUlids[index] }))
    .filter(({ result }) => result.status === "rejected");

  if (failed.length > 0) {
    console.warn("Failed to delete:", failed.map((f) => f.ulid));
  }

  return { deleted: postUlids.length - failed.length, failed: failed.length };
}
```

### Working with ULIDs

All content IDs are ULIDs (26-character strings). They are sortable by creation time.

```typescript
// Extract timestamp from ULID (first 10 chars are timestamp)
function getUlidTimestamp(ulid: string): Date {
  const timestamp = ulid.slice(0, 10);
  // Convert from Crockford's base32
  // Use a library like `ulid` for accurate conversion
  return new Date(/* converted timestamp */);
}

// Check if ULID format is valid
function isValidUlid(id: string): boolean {
  return /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/i.test(id);
}
```

---

## Important Notes

1. **Authentication Required**: All content creation operations require authentication. Call `sdk.login()` or set tokens before creating content.

2. **Rate Limiting**: The API may rate limit creation operations. Handle 429 status codes with exponential backoff.

3. **Content Validation**: 
   - Posts have maximum length limits
   - Videos must be in supported formats (MP4, MOV)
   - Images have size and dimension limits

4. **Caching**: The SDK automatically caches created content in IndexedDB. Fresh data is fetched after creation (read-after-write pattern).

5. **Acting Context**: For delegated accounts (managers posting on behalf of artists), use `sdk.setActingContext()` before creating content.

6. **Visibility**: Posts default to "public" if not specified. Use "private" for drafts or "followers" for limited visibility.

7. **Blog Content Format**: Blog posts use TipTap/ProseMirror JSON format, not plain HTML.
