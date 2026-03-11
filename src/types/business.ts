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
  /** Reviewer user ULID */
  userId: Ulid;
  /** Reviewer name */
  userName?: string;
  /** Reviewer avatar URL */
  userAvatar?: string;
  /** Rating (1-5) */
  rating: number;
  /** Review title */
  title?: string;
  /** Review content */
  content: string;
  /** Number of helpful votes */
  helpfulCount?: number;
  /** Whether current user marked as helpful */
  isHelpful?: boolean;
  /** Business owner response */
  businessResponse?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt?: string;
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
  rating: number;
  title?: string;
  content: string;
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
  averageRating: number;
}
