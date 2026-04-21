/**
 * Business Directory Types
 *
 * Types for the Trinidad & Tobago Business Directory API.
 *
 * @module types/business
 * @category Business Directory
 */

import type { Ulid } from "../types";

/**
 * Business listing in the directory
 * @category Business Directory
 */
export interface Business {
  /** Unique identifier (ULID) */
  id: Ulid;
  /** ULID string */
  ulid: Ulid;
  /** Business name */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Business description */
  description?: string;
  /** Category name */
  category?: string;
  /** Category ULID */
  categoryId?: Ulid;
  /** Street address */
  address?: string;
  /** City */
  city?: string;
  /** Region/parish */
  region?: string;
  /** Postal code */
  postalCode?: string;
  /** Phone number */
  phone?: string;
  /** Email address */
  email?: string;
  /** Website URL */
  website?: string;
  /** Operating hours by day */
  hours?: Record<string, { open: string; close: string }>;
  /** List of amenities/features */
  amenities?: string[];
  /** Average rating (0-5) */
  rating?: number;
  /** Number of reviews */
  reviewCount?: number;
  /** Latitude for map */
  latitude?: number;
  /** Longitude for map */
  longitude?: number;
  /** Cover image URL */
  coverImage?: string;
  /** Logo image URL */
  logo?: string;
  /** Gallery image URLs */
  gallery?: string[];
  /** Social media links */
  socialLinks?: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    tiktok?: string;
    whatsapp?: string;
  };
  /** Whether business is verified */
  isVerified?: boolean;
  /** Whether business is featured */
  isFeatured?: boolean;
  /** Creation timestamp */
  createdAt?: string;
  /** Last update timestamp */
  updatedAt?: string;
}

/**
 * Business category
 * @category Business Directory
 */
export interface BusinessCategory {
  /** Unique identifier */
  id: Ulid;
  /** ULID string */
  ulid: Ulid;
  /** Category name */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Category description */
  description?: string;
  /** Icon name/class */
  icon?: string;
  /** Color code */
  color?: string;
  /** Parent category ULID */
  parentId?: Ulid;
  /** Display sort order */
  sortOrder?: number;
  /** Number of businesses in category */
  businessCount?: number;
  /** Child categories */
  children?: BusinessCategory[];
}

/**
 * Business event
 * @category Business Directory
 */
export interface BusinessEvent {
  /** Unique identifier */
  id: Ulid;
  /** ULID string */
  ulid: Ulid;
  /** Event name */
  name: string;
  /** Event description */
  description?: string;
  /** Host business ULID */
  businessId?: Ulid;
  /** Host business name */
  businessName?: string;
  /** Venue location */
  venue?: string;
  /** Start date/time (ISO 8601) */
  startDate: string;
  /** End date/time (ISO 8601) */
  endDate?: string;
  /** Whether it's an all-day event */
  isAllDay?: boolean;
  /** Ticket information */
  ticketInfo?: "free" | "paid" | "tba";
  /** Ticket purchase URL */
  ticketUrl?: string;
  /** Cover image URL */
  coverImage?: string;
  /** Number of interested users */
  interestedCount?: number;
  /** Number of going users */
  goingCount?: number;
}

/**
 * User info embedded in a review
 * @category Business Directory
 */
export interface BusinessReviewUser {
  /** User ULID */
  id: Ulid;
  /** Username */
  username: string;
  /** Display name */
  displayName: string;
  /** Avatar URL */
  avatar?: string | null;
}

/**
 * Business info embedded in a review
 * @category Business Directory
 */
export interface BusinessReviewBusiness {
  /** Business ULID */
  id: Ulid;
  /** Business name */
  name: string;
  /** Business slug */
  slug: string;
}

/**
 * Review verification methods
 * @category Business Directory
 */
export type BusinessReviewVerificationMethod = 'purchase' | 'visit' | 'owner_confirmed';

/**
 * Review status
 * @category Business Directory
 */
export type BusinessReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

/**
 * Business review
 * @category Business Directory
 */
export interface BusinessReview {
  /** Unique identifier */
  id: Ulid;
  /** ULID string */
  ulid: Ulid;
  /** Business ULID */
  businessId: Ulid;
  /** Business details (when loaded) */
  business?: BusinessReviewBusiness;
  /** Reviewer user ULID */
  userId: Ulid;
  /** Reviewer details (when loaded) */
  user?: BusinessReviewUser;
  /** Rating (1-5) */
  rating: number;
  /** Review title */
  title?: string | null;
  /** Review content */
  content: string;
  /** Photo URLs */
  photos: string[];
  /** Whether the review is verified */
  isVerified: boolean;
  /** How the review was verified */
  verificationMethod?: BusinessReviewVerificationMethod | null;
  /** Number of helpful votes */
  helpfulCount: number;
  /** Number of not helpful votes */
  notHelpfulCount: number;
  /** Percentage of helpful votes (0-100) */
  helpfulPercentage: number;
  /** Current user's vote on this review ('helpful', 'not_helpful', or null if not voted) */
  userVote?: 'helpful' | 'not_helpful' | null;
  /** Business owner response */
  businessResponse?: string | null;
  /** When the business responded */
  businessRespondedAt?: string | null;
  /** Who responded on behalf of the business */
  respondedBy?: BusinessReviewUser | null;
  /** Review status */
  status: BusinessReviewStatus;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * User's business collection (favorites/bookmarks)
 * @category Business Directory
 */
export interface BusinessCollection {
  /** Unique identifier */
  id: Ulid;
  /** Collection name */
  name: string;
  /** Collection description */
  description?: string;
  /** Icon name/class */
  icon?: string;
  /** Color code */
  color?: string;
  /** Whether this is the default collection */
  isDefault?: boolean;
  /** Number of businesses in collection */
  businessCount?: number;
  /** Businesses in the collection */
  businesses?: Business[];
}

/**
 * Recently viewed business entry
 * @category Business Directory
 */
export interface RecentlyViewedBusiness {
  /** The business */
  business: Business;
  /** When it was viewed */
  viewedAt: string;
}

/**
 * Business analytics dashboard data
 * @category Business Directory
 */
export interface BusinessAnalytics {
  /** Total profile views */
  totalViews: number;
  /** Profile detail clicks */
  profileClicks: number;
  /** Phone number clicks */
  phoneCalls: number;
  /** Email clicks */
  emailInquiries: number;
  /** Website clicks */
  websiteClicks: number;
  /** Direction request clicks */
  directionRequests: number;
  /** Week-over-week trends */
  trends: {
    views: number;
    profileClicks: number;
    phoneCalls: number;
    emailInquiries: number;
  };
}

/**
 * Input for creating/updating a business
 * @category Business Directory
 */
export interface BusinessInput {
  name?: string;
  description?: string;
  categoryId?: Ulid;
  address?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  website?: string;
  hours?: Record<string, { open: string; close: string }>;
  amenities?: string[];
  latitude?: number;
  longitude?: number;
  coverImage?: string;
  logo?: string;
  gallery?: string[];
  socialLinks?: Business["socialLinks"];
}

/**
 * Input for submitting a review
 * @category Business Directory
 */
export interface BusinessReviewInput {
  /** Rating (1-5) */
  rating: number;
  /** Review title (optional) */
  title?: string;
  /** Review content (min 10, max 5000 chars) */
  content: string;
  /** Photo URLs (optional) */
  photos?: string[];
}

/**
 * Input for updating a review
 * @category Business Directory
 */
export interface BusinessReviewUpdateInput {
  /** Rating (1-5) */
  rating?: number;
  /** Review title */
  title?: string | null;
  /** Review content (min 10, max 5000 chars) */
  content?: string;
  /** Photo URLs */
  photos?: string[];
}

/**
 * Response from helpful/not-helpful actions
 * @category Business Directory
 */
export interface BusinessReviewHelpfulResponse {
  /** Updated helpful count */
  helpful_count: number;
  /** Updated not helpful count */
  not_helpful_count: number;
  /** Current user's vote after the action */
  user_vote: 'helpful' | 'not_helpful' | null;
}

/**
 * Input for creating a collection
 * @category Business Directory
 */
export interface BusinessCollectionInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
}

/**
 * Response wrapper for paginated business lists
 * @category Business Directory
 */
export interface BusinessListResponse {
  businesses: Business[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Response wrapper for paginated event lists
 * @category Business Directory
 */
export interface BusinessEventListResponse {
  events: BusinessEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Response wrapper for paginated review lists
 * @category Business Directory
 */
export interface BusinessReviewListResponse {
  reviews: BusinessReview[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Aggregate average rating. Only returned for per-business listings; omitted for per-user lists where it is not meaningful. */
  averageRating?: number;
}
