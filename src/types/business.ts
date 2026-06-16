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
  /** Cover image URL (alias kept for older consumers; the API field is `coverImageUrl`). */
  coverImage?: string;
  /** Logo image URL (alias kept for older consumers; the API field is `logoUrl`). */
  logo?: string;
  /** Cover image URL as returned by the API (`coverImageUrl`). */
  coverImageUrl?: string;
  /** Logo image URL as returned by the API (`logoUrl`). */
  logoUrl?: string;
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
  /** Whether business has been claimed by an owner */
  isClaimed?: boolean;
  /** When the business was claimed (ISO 8601) */
  claimedAt?: string;
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
 * Embedded category summary returned inside a Business response.
 *
 * This is a subset of {@link BusinessCategory} — the full category endpoints
 * return additional fields like `children`, `sortOrder`, and `businessCount`.
 *
 * @category Business Directory
 */
export interface BusinessCategoryEmbed {
  /** Category ULID */
  id: Ulid;
  /** Category display name */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Icon name/class */
  icon?: string;
}

/**
 * Embedded owner summary returned inside a Business response.
 * @category Business Directory
 */
export interface BusinessOwner {
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
 * Business event
 * @category Business Directory
 */
export interface BusinessEvent {
  /** Unique identifier */
  id: Ulid;
  /** ULID string */
  ulid: Ulid;
  /** Event title */
  title: string;
  /** Event description */
  description?: string;
  /** URL-friendly slug */
  slug?: string;
  /** Event category */
  category?: string;
  /** Tags */
  tags?: string[];
  /** Host business ULID */
  businessId?: Ulid;
  /** Host business (nested) */
  business?: { id: Ulid; name: string; slug: string };
  /** Venue name */
  venueName?: string;
  /** Street address */
  address?: string;
  /** City */
  city?: string;
  /** Latitude */
  latitude?: number;
  /** Longitude */
  longitude?: number;
  /** Whether the event is virtual */
  isVirtual?: boolean;
  /** Virtual event link */
  virtualLink?: string;
  /** Start date/time (ISO 8601) */
  startsAt: string;
  /** End date/time (ISO 8601) */
  endsAt?: string;
  /** Whether it's an all-day event */
  isAllDay?: boolean;
  /** Duration string */
  duration?: string;
  /** Whether the event is upcoming */
  isUpcoming?: boolean;
  /** Whether the event is ongoing */
  isOngoing?: boolean;
  /** Whether the event is past */
  isPast?: boolean;
  /** Cover image URL */
  imageUrl?: string;
  /** Gallery image URLs */
  gallery?: string[];
  /** Whether the event is free */
  isFree?: boolean;
  /** Ticket price */
  ticketPrice?: number;
  /** Ticket currency */
  ticketCurrency?: string;
  /** Formatted price string */
  formattedPrice?: string;
  /** Ticket purchase URL */
  ticketLink?: string;
  /** Event capacity */
  capacity?: number;
  /** Number of interested users */
  interestedCount?: number;
  /** Number of going users */
  goingCount?: number;
  /** Event creator (nested) */
  createdBy?: { id: Ulid; username: string; displayName: string; avatar?: string };
  /** Event status */
  status?: string;
  /** Whether the event is featured */
  isFeatured?: boolean;
  /** Creation timestamp */
  createdAt?: string;
  /** Last update timestamp */
  updatedAt?: string;
  /** Whether the authenticated user has saved this event (populated when authenticated) */
  isFavorited?: boolean;
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
 * A media item attached to a business review (image or video).
 * @category Business Directory
 */
export interface ReviewMediaItem {
  /** URL of the media file */
  url: string;
  /** Type of media */
  type: 'image' | 'video';
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
  /** Media items (images and videos) attached to this review */
  media: ReviewMediaItem[];
  /** @deprecated Use `media` — image-only URLs kept for backward compatibility */
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
  /** Whether this collection is visible to other users */
  isPublic?: boolean;
  /** Number of businesses in collection */
  businessCount?: number;
  /** Businesses in the collection */
  businesses?: Business[];
  /** Creation timestamp */
  createdAt?: string;
  /** Last update timestamp */
  updatedAt?: string;
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
  /** Saves / bookmarks */
  saves: number;
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
    saves: number;
    phoneCalls: number;
    emailInquiries: number;
    websiteClicks: number;
    directionRequests: number;
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
  /** Cover image URL as returned by the API (`coverImageUrl`). */
  coverImageUrl?: string;
  /** Logo image URL as returned by the API (`logoUrl`). */
  logoUrl?: string;
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
  /** Media items to attach (images and videos) */
  media?: ReviewMediaItem[];
  /** @deprecated Use `media`. Flat image URLs kept for backward compatibility. */
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
  /** Media items to attach (images and videos) */
  media?: ReviewMediaItem[];
  /** @deprecated Use `media`. Flat image URLs kept for backward compatibility. */
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
  /** Whether the collection is visible to other users (default true) */
  isPublic?: boolean;
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
 * Input for creating/updating a business event
 * @category Business Directory
 */
export interface BusinessEventInput {
  /** Host business ULID (required for creation) */
  businessId: string;
  /** Event title */
  title: string;
  /** Event description */
  description?: string;
  /** Event category */
  category?: string;
  /** Tags */
  tags?: string[];
  /** Venue name */
  venueName?: string;
  /** Street address */
  address?: string;
  /** City */
  city?: string;
  /** Latitude */
  latitude?: number;
  /** Longitude */
  longitude?: number;
  /** Whether the event is virtual */
  isVirtual?: boolean;
  /** Virtual event link */
  virtualLink?: string;
  /** Start date/time (ISO 8601) */
  startsAt: string;
  /** End date/time (ISO 8601) */
  endsAt?: string;
  /** Whether it's an all-day event */
  isAllDay?: boolean;
  /** Cover image URL */
  imageUrl?: string;
  /** Gallery image URLs */
  gallery?: string[];
  /** Whether the event is free */
  isFree?: boolean;
  /** Ticket price */
  ticketPrice?: number;
  /** Ticket purchase link */
  ticketLink?: string;
  /** Event capacity */
  capacity?: number;
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

/**
 * Response wrapper for paginated collection business lists
 * @category Business Directory
 */
export interface BusinessCollectionBusinessesResponse {
  businesses: Business[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Response wrapper for checking which collections contain a business
 * @category Business Directory
 */
export interface BusinessSavedCheckResponse {
  collectionIds: string[];
}

/**
 * Response for checking or toggling an authenticated user's event favorite
 * @category Business Directory
 */
export interface EventSavedCheckResponse {
  favorited: boolean;
}

/**
 * Response for listing an authenticated user's saved event IDs
 * @category Business Directory
 */
export interface EventFavoritesListResponse {
  eventIds: string[];
}

/**
 * Input for requesting a business claim (step 1: submit contact info + optional document)
 * @category Business Directory
 */
export interface BusinessClaimInput {
  name: string;
  email: string;
  phone?: string;
  position: string;
  message?: string;
}

/**
 * Response from requesting a business claim verification
 * @category Business Directory
 */
export interface BusinessClaimResponse {
  success: boolean;
  message: string;
  data?: { pending_id: string; requires_verification: boolean; email: string };
}

/**
 * Response from verifying a business claim with a code
 * @category Business Directory
 */
export interface BusinessClaimVerifyResponse {
  success: boolean;
  message: string;
}

/**
 * Input for contacting a business via the public contact form.
 * `website` is a honeypot field — leave empty; non-empty values are bot submissions.
 * @category Business Directory
 */
export interface BusinessContactInput {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  /** Honeypot — must stay empty for human submissions. */
  website?: string;
  /** reCAPTCHA v3 token (verified server-side). */
  recaptchaToken?: string;
}

/**
 * Response from submitting the business contact form. When `requires_verification`
 * is true, a 6-digit code was emailed and `pending_id` must be passed to verify.
 * @category Business Directory
 */
export interface BusinessContactResponse {
  success: boolean;
  message: string;
  requires_verification?: boolean;
  pending_id?: string;
  email?: string;
}

/**
 * Centroid coordinates for a geocoded city/place, or null when not found.
 * @category Business Directory
 */
export interface GeocodeCityResult {
  latitude: number;
  longitude: number;
}
