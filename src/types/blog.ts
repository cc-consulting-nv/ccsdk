import type { Ulid } from "../types";

/**
 * Blog post status
 */
export type BlogPostStatus = "draft" | "scheduled" | "published" | "archived";

/**
 * Blog post author information
 */
export interface BlogPostAuthor {
  userId: string;
  username: string;
  name: string;
  avatar: string | null;
  isPrimary: boolean;
}

/**
 * Blog category information
 */
export interface BlogCategory {
  id: string;
  ulid: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  parent?: {
    id: string;
    slug: string;
    name: string;
  } | null;
  children?: BlogCategory[];
  postCount: number;
  displayOrder: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Blog post engagement metrics
 */
export interface BlogPostEngagement {
  viewCount: number;
  reactionCount: number;
  commentCount: number;
  ratingAverage: number | null;
  ratingCount: number;
}

/**
 * Blog post image
 */
export interface BlogPostImage {
  url: string;
  widthPx: number | null;
  heightPx: number | null;
  mimeType: string | null;
}

/**
 * Full blog post with all details
 */
export interface BlogPost {
  id: string;
  ulid: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: object; // TipTap/ProseMirror JSON document
  contentHtml: string; // Server-rendered HTML
  status: BlogPostStatus;
  publishedAt: string | null;
  scheduledFor: string | null;
  readingTimeMinutes: number | null;
  isFeatured: boolean;
  featureOrder: number | null;

  // SEO
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  ogImage: string | null;

  // Authors (supports co-authors)
  authors: BlogPostAuthor[];

  // Category
  category: BlogCategory | null;

  // Tags
  tags: string[];

  // Engagement
  engagement: BlogPostEngagement;

  // Images
  images: BlogPostImage[];

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

/**
 * Abbreviated blog post for listings
 */
export interface BlogPostListItem {
  id: string;
  ulid: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: BlogPostStatus;
  publishedAt: string | null;
  readingTimeMinutes: number | null;
  isFeatured: boolean;

  // SEO
  metaTitle: string | null;
  metaDescription: string | null;
  ogImage: string | null;

  // Author (primary only for list)
  author: BlogPostAuthor | null;

  // Category
  category: {
    id: string;
    slug: string;
    name: string;
  } | null;

  // Tags
  tags: string[];

  // Engagement (abbreviated)
  engagement: {
    viewCount: number;
    reactionCount: number;
    commentCount: number;
  };

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating a blog post
 */
export interface CreateBlogPostInput {
  title: string;
  content: object; // TipTap/ProseMirror JSON
  slug?: string;
  excerpt?: string;
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  status?: BlogPostStatus;
  scheduledFor?: string; // ISO 8601
  categoryId?: number;
  isFeatured?: boolean;
  featureOrder?: number;
  authorIds?: number[]; // Co-authors (excluding primary)
  imageIds?: number[];
  tagIds?: number[];
  groupId?: number;
}

/**
 * Input for updating a blog post
 */
export interface UpdateBlogPostInput {
  title?: string;
  content?: object; // TipTap/ProseMirror JSON
  slug?: string;
  excerpt?: string;
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  categoryId?: number;
  isFeatured?: boolean;
  featureOrder?: number;
  authorIds?: number[]; // Co-authors (excluding primary)
  imageIds?: number[];
  tagIds?: number[];
}

/**
 * Options for listing blog posts
 */
export interface BlogListOptions {
  category?: string;
  tag?: string;
  author?: string;
  status?: "draft" | "published" | "archived";
  cursor?: string;
  perPage?: number;
}

/**
 * Paginated response for blog posts
 */
export interface BlogListResponse {
  data: BlogPostListItem[];
  nextCursor?: string | null;
  prevCursor?: string | null;
  perPage: number;
}

/**
 * Options for searching blog posts
 */
export interface BlogSearchOptions {
  q: string;
  category?: string;
  cursor?: string;
  perPage?: number;
}
