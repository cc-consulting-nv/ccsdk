/**
 * ULID (Universally Unique Lexicographically Sortable Identifier).
 *
 * Used as the primary identifier for most entities in the platform.
 * ULIDs are 26-character strings that are sortable by creation time.
 *
 * @example "01HX4GK3NH9ZB7EQ1X8Y2ZAMRT"
 */
export type Ulid = string;

/**
 * Authentication tokens returned from login/refresh operations.
 * @category Authentication
 */
export interface AuthTokens {
  /** JWT access token for API requests */
  accessToken?: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;
}

/**
 * Context for acting on behalf of a managed user (delegation).
 *
 * Used by managers/artists to perform actions as their managed users.
 *
 * @category Delegation
 */
export interface ActingContext {
  /** Delegation token for the acting context */
  token: string;
  /** ULID of the managed user being acted as */
  managedUserUlid: string;
  /** Display name of the managed user */
  managedUserName: string;
  /** Username of the managed user */
  managedUserUsername: string;
  /** Avatar URL of the managed user */
  managedUserAvatar?: string;
  /** When the delegation token expires */
  expiresAt: string;
  /** Scopes/permissions granted for this delegation */
  grantedScopes: string[];
}

/**
 * Engagement metrics and user interaction state for a post.
 * @category Posts
 */
export interface PostEngagement {
  /** Count of each reaction type (e.g., { "❤️": 5, "🔥": 3 }) */
  reactionCounts?: Record<string, number>;
  /** The current user's reaction, if any */
  userReaction?: string | null;
  /** Number of direct replies/comments to this post */
  replyCount?: number;
  /** Number of direct comments on this post */
  commentCount?: number;
  /** Total number of comments including nested replies */
  totalCommentCount?: number;
  /** Number of reposts */
  repostCount?: number;
  /** Number of shares */
  shareCount?: number;
  /** Number of views */
  viewCount?: number;
  /** Whether the current user has liked this post */
  liked?: boolean;
  /** Whether the current user has bookmarked this post */
  bookmarked?: boolean;
}

/**
 * A single option in a poll.
 * @category Posts
 */
export interface PollOption {
  /** Unique identifier for this option */
  id: number;
  /** The option text */
  text: string;
  /** Display position (0-indexed) */
  position: number;
  /** Number of votes for this option */
  voteCount: number;
  /** Percentage of total votes (0-100) */
  percentage: number;
}

/**
 * A poll attached to a post.
 * @category Posts
 */
export interface Poll {
  /** Unique identifier */
  id: number;
  /** The poll question */
  question: string;
  /** When the poll ends (null if no end date) */
  endsAt: string | null;
  /** Whether the poll has ended */
  hasEnded: boolean;
  /** Whether users can select multiple options */
  multipleChoice: boolean;
  /** Total number of votes */
  totalVotes: number;
  /** Available options */
  options: PollOption[];
  /** The current user's vote, if any */
  userVote: {
    optionId: number;
    votedAt: string;
  } | null;
  /** When the poll was created */
  createdAt: string;
}

/**
 * Video processing state returned while uploaded media is being finalized.
 * @category Posts
 */
export interface VideoProcessing {
  /** Processing status code from API (e.g. 1 while processing/available fallback) */
  status?: number | null;
  /** Fallback playable video URL that may exist before canonical videoUrls are ready */
  video?: string | null;
  /** Processing thumbnail URL if available */
  thumbnail?: string | null;
}

/**
 * A content post in the platform.
 *
 * Posts can be text, songs, videos, or other media types. Songs are represented
 * as posts with `type: 'SONG'`.
 *
 * @example
 * ```typescript
 * const post = await sdk.getPostByUlid('01HX...');
 * if (post?.type === 'SONG') {
 *   console.log(`Now playing: ${post.title} by ${post.artist}`);
 * }
 * ```
 *
 * @category Posts
 */
export interface Post {
  /** Unique identifier (ULID format) */
  id: Ulid;
  /** Alias for id (some API endpoints return this) */
  ulid?: Ulid;
  /** ULID of the user who created the post */
  userId?: Ulid;
  /** Normalized post type (SDK normalizes postType -> type) */
  type?: "POST" | "REPLY" | "REPOST" | "QUOTE" | "SONG" | "VIDEO" | "SHORT" | "PODCAST" | "BURST";
  /** Original API field name (API returns postType, SDK normalizes to type) */
  postType?: "POST" | "REPLY" | "REPOST" | "QUOTE" | "SONG" | "VIDEO" | "SHORT" | "PODCAST" | "BURST";
  /** Title (for songs/videos) */
  title?: string;
  /** Post body content */
  content?: string;
  /** Artist name (for songs) */
  artist?: string;
  /** Album name (for songs) */
  album?: string;
  /** Genre (for songs) */
  genre?: string;
  /** Audio stream URL */
  streamUrl?: string;
  /** Audio attachments */
  audio?: unknown[];
  /** Media attachments */
  media?: unknown[];
  /** Image attachments */
  images?: unknown[];
  /** Video URLs for different formats */
  videoUrls?: {
    /** HLS streaming URL */
    hls?: string;
    /** Direct MP4 URL */
    mp4?: string;
    /** Thumbnail image URL */
    thumbnail?: string;
  };
  /** Raw video processing payload from API while media is being finalized */
  videoProcessing?: VideoProcessing | null;
  /** Whether the post/media is currently processing */
  isProcessing?: boolean;
  /** Duration in seconds (for audio/video) */
  duration?: number;
  /** Engagement metrics and user interaction state */
  postEngagement?: PostEngagement;
  /** Internal: hash of engagement data for change detection */
  _engagementHash?: string;
  /** Last update timestamp */
  updatedAt?: string;
  /** Creation timestamp */
  createdAt?: string;
  /** ULID of the group this post belongs to */
  groupUlid?: Ulid;
  /** Name of the group this post belongs to */
  groupName?: string;
  /** Number of comments/replies */
  commentCount?: number;
  /** User's creation mode vote for this post */
  userCreationMode?: string | null;
  /** Post visibility setting */
  visibility?: "public" | "followers" | "private";
  /** Scheduled time for hidden post to become visible */
  unhideAt?: string | null;
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * A page of feed results with cursor-based pagination.
 *
 * @example
 * ```typescript
 * let cursor: string | undefined;
 * do {
 *   const page = await sdk.fetchTrendingFeed(cursor);
 *   for (const post of page.posts) {
 *     console.log(post.title);
 *   }
 *   cursor = page.nextCursor ?? undefined;
 * } while (cursor);
 * ```
 *
 * @category Feeds
 */
export interface FeedPage {
  /** ULIDs of posts in this page (for cache lookup) */
  ulids: Ulid[];
  /** Full post objects in this page */
  posts: Post[];
  /** Cursor for fetching the next page (null if no more pages) */
  nextCursor?: string | null;
  /** Affiliate products to display in the feed (injected by API) */
  affiliateProducts?: AffiliateProduct[];
  /** How often to show an affiliate product (every Nth item) */
  affiliateFrequency?: number;
}

/**
 * An affiliate product injected into feeds.
 *
 * @category Feeds
 */
export interface AffiliateProduct {
  ulid: string;
  feedItemType: "AFFILIATE_PRODUCT";
  productName: string;
  description: string | null;
  brand: string | null;
  merchantName: string;
  category: string | null;
  price: number;
  salePrice: number | null;
  currency: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  buyUrl: string;
  isOnSale: boolean;
}

/**
 * A media item (song) reference in a playlist.
 * @category Playlists
 */
export interface PlaylistMedia {
  /** ULID of the song/post */
  id: string;
  /** Position in the playlist (0-indexed) */
  order?: number;
  /** Last update timestamp */
  updatedAt?: string;
  /** Last update timestamp as epoch milliseconds */
  updatedAtEpoch?: number;
}

/**
 * A user-created playlist containing songs.
 *
 * @example
 * ```typescript
 * const playlists = await sdk.getPlaylists(userUlid);
 * for (const playlist of playlists) {
 *   console.log(`${playlist.name}: ${playlist.trackCount} tracks`);
 * }
 * ```
 *
 * @category Playlists
 */
export interface Playlist {
  /** Unique identifier */
  id: string;
  /** ULID (API returns this for public playlists) */
  ulid?: string;
  /** Playlist name */
  name: string;
  /** Optional description */
  description?: string;
  /** Owner's user ULID */
  userId?: string;
  /** Whether the playlist is publicly visible */
  isPublic?: boolean;
  /** Whether the playlist is private */
  isPrivate?: boolean;
  /** Cover image URL */
  coverImage?: string;
  /** Whether this is a featured playlist */
  isFeatured?: boolean;
  /** Number of media items */
  mediaCount?: number;
  /** Number of tracks */
  trackCount?: number;
  /** Alternative name for track/media count */
  songCount?: number;
  /** Media item references (for ordering) */
  media?: PlaylistMedia[];
  /** Full song objects (populated when fetching single playlist) */
  songs?: Post[];
  /** Creation timestamp */
  createdAt?: string;
  /** Last update timestamp */
  updatedAt?: string;
  /** User who created the playlist (from user playlists API) */
  user?: {
    userId?: string;
    id?: string;
    name?: string;
    username?: string;
    avatar?: string;
  };
  /** Creator info (from public playlists API) */
  creator?: {
    id?: string;
    name?: string;
    username?: string;
    avatar?: string;
  };
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * Engagement/relationship status between the current user and a target user.
 * @category Users
 */
export interface ProfileEngagement {
  /** Whether current user is following the target */
  isFollowing: boolean;
  /** Whether target is following the current user */
  isFollowingYou: boolean;
  /** Whether current user is subscribed to the target */
  isSubscribed: boolean;
  /** Whether current user has muted the target */
  isMuted: boolean;
  /** Whether there is any block relationship */
  isBlocked: boolean;
  /** Whether current user has blocked the target */
  isBlockedByYou: boolean;
  /** Whether target has blocked the current user */
  isBlockedByThem: boolean;
  /** Whether the target user is banned */
  isBanned: boolean;
}

/**
 * A user's public profile.
 *
 * @example
 * ```typescript
 * const profile = await sdk.getUserProfile('01HX...');
 * console.log(`${profile.displayName} (@${profile.username})`);
 * console.log(`${profile.followersCount} followers`);
 * ```
 *
 * @category Users
 */
/**
 * Image variant URLs for different sizes.
 * Each variant is available in both JPEG and WebP formats.
 * @category Users
 */
export interface ImageVariants {
  /** Thumbnail size (150px) */
  thumb?: string;
  /** Thumbnail size WebP format */
  thumbWebp?: string;
  /** Small size (500px) */
  small?: string;
  /** Small size WebP format */
  smallWebp?: string;
  /** Medium size (1024px) - typically for backgrounds */
  medium?: string;
  /** Medium size WebP format */
  mediumWebp?: string;
  /** Large size (1920px) - typically for backgrounds */
  large?: string;
  /** Large size WebP format */
  largeWebp?: string;
}

export interface UserProfile {
  /** Unique identifier (ULID format) */
  ulid: string;
  /** Unique username (handle) */
  username?: string;
  /** Display name - API may return as 'name' or 'displayName' */
  displayName?: string;
  /** Display name - API returns as 'name' for autocomplete */
  name?: string;
  /** Avatar URL - API may return as 'avatar' or 'avatarUrl' */
  avatarUrl?: string;
  /** Avatar URL - API returns as 'avatar' for autocomplete */
  avatar?: string;
  /** Avatar image variants at different sizes */
  avatarVariants?: ImageVariants | null;
  /** Background/cover image URL */
  background?: string;
  /** Background image variants at different sizes */
  backgroundVariants?: ImageVariants | null;
  /** Last update timestamp */
  updatedAt?: string | number;
  /** Last update timestamp as epoch milliseconds */
  updatedAtEpoch?: number;
  /** User's bio/description */
  bio?: string;
  /** Number of followers */
  followersCount?: number;
  /** Number of users being followed */
  followingCount?: number;
  /** Number of posts created */
  postsCount?: number;
  /** Profile engagement status (returned when authenticated) */
  ProfileEngagement?: ProfileEngagement;
  /** ULIDs of the user's pinned posts (songs) */
  pinnedPostUlids?: string[];
  /** ULIDs of the user's pinned regular posts (type='POST') */
  pinnedRegularPostUlids?: string[];
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * Enhanced current user profile with badges array.
 * Returned by `getCurrentUser()` for convenient badge access.
 * Use utility functions `isUserAdmin()` and `userHasBadge()` instead of methods.
 *
 * @example
 * ```typescript
 * const user = await sdk.getCurrentUser();
 * if (user && isUserAdmin(user)) {
 *   // Show admin controls
 * }
 * if (user && userHasBadge(user, 'Creator')) {
 *   // Show creator features
 * }
 * ```
 *
 * @category Users
 */
export interface CurrentUser extends UserProfile {
  /** User's badges as string array */
  badges: string[];
  /** User's roles (crm_user, crm_admin, etc.) - for role-based UI gating */
  roles?: string[];
}

/**
 * Check if a user has the administrator badge.
 * @param user - User profile with badges array
 * @returns true if user has "administrator" badge
 * @category Users
 */
export function isUserAdmin(user: CurrentUser | UserProfile | null | undefined): boolean {
  if (!user) return false;
  const badges = (user as CurrentUser).badges || (user as Record<string, unknown>).badges;
  if (!Array.isArray(badges)) return false;
  return badges.some((b) => String(b).toLowerCase() === "administrator");
}

/**
 * Check if a user has a specific badge (case-insensitive).
 * @param user - User profile with badges array
 * @param badgeName - Badge name to check (e.g., "Creator", "administrator")
 * @returns true if user has the specified badge
 * @category Users
 */
export function userHasBadge(
  user: CurrentUser | UserProfile | null | undefined,
  badgeName: string
): boolean {
  if (!user) return false;
  const badges = (user as CurrentUser).badges || (user as Record<string, unknown>).badges;
  if (!Array.isArray(badges)) return false;
  return badges.some((b) => String(b).toLowerCase() === badgeName.toLowerCase());
}

/**
 * Check if a user has a specific role or any role matching a prefix.
 * Use for gating features like CRM (e.g., userHasRole(user, 'crm') matches crm_user, crm_admin).
 *
 * @param user - User profile with roles array (from /v1/users/me)
 * @param roleOrPrefix - Exact role name (e.g., "crm_admin") or prefix (e.g., "crm" matches crm_user, crm_admin)
 * @returns true if user has the role or a role starting with the prefix
 * @category Users
 */
export function userHasRole(
  user: { roles?: readonly string[] | string[] } | null | undefined,
  roleOrPrefix: string
): boolean {
  if (!user) return false;
  const roles = user.roles;
  if (!roles || !Array.isArray(roles)) return false;
  return roles.some(
    (r) => typeof r === "string" && r.startsWith(roleOrPrefix)
  );
}

/**
 * A suggested user for the "Who to Follow" widget.
 * @category Users
 */
export interface SuggestedUser {
  /** Unique identifier (ULID format) */
  ulid: string;
  /** Unique username (handle) */
  username: string;
  /** Display name */
  name: string;
  /** Avatar URL */
  avatar?: string;
  /** User's bio */
  bio?: string;
  /** Number of followers */
  followerCount: number;
  /** Profile engagement status (returned when authenticated) */
  ProfileEngagement?: ProfileEngagement;
}

/**
 * Generic search result container with pagination.
 *
 * @typeParam T - The type of items in the search results
 *
 * @example
 * ```typescript
 * const results: SearchResult<Post> = await sdk.searchPosts('music');
 * console.log(`Found ${results.total} posts`);
 * for (const post of results.items) {
 *   console.log(post.title);
 * }
 * ```
 *
 * @category Search
 */
export interface SearchResult<T = unknown> {
  /** Array of matching items */
  items: T[];
  /** Cursor for fetching the next page */
  nextCursor?: string | null;
  /** Total number of matching items */
  total?: number;
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * A search result item for audio/song searches.
 * @category Search
 */
export interface AudioSearchResult {
  /** Unique identifier (ULID format) */
  ulid: string;
  /** Song title */
  title: string;
  /** Username of the creator */
  username: string;
  /** User ID of the creator */
  userId: string;
  /** Avatar URL of the creator */
  avatar?: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt?: string;
  /** Last update timestamp as epoch milliseconds */
  updatedAtEpoch?: number;
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * A badge that can be earned or assigned to users.
 *
 * Badges can be manual (assigned by admins), or automatic based on
 * listen counts or rating counts.
 *
 * @example
 * ```typescript
 * const badges = await sdk.getUserBadges(userUlid);
 * for (const badge of badges) {
 *   console.log(`${badge.name}: ${badge.description}`);
 * }
 * ```
 *
 * @category Badges
 */
export interface Badge {
  /** Unique identifier */
  id: string;
  /** Display name of the badge */
  name: string;
  /** Description of how to earn the badge */
  description?: string;
  /** URL to the badge icon image */
  iconUrl?: string;
  /** URL-friendly slug */
  slug?: string;
  /** How the badge is earned */
  type?: 'manual' | 'listenCount' | 'ratingCount';
  /** Threshold value for automatic badges */
  threshold?: number;
  /** Whether this badge is featured/highlighted */
  isFeatured?: boolean;
  /** When the user earned this badge (ISO 8601) */
  earnedAt?: string;
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * User's progress toward earning badges.
 * @category Badges
 */
export interface BadgeProgress {
  /** Total listen count for the user */
  listenCount: number;
  /** Total rating count for the user */
  ratingCount: number;
  /** Next badges the user can earn */
  nextBadges: {
    /** Next listen count badge (null if all earned) */
    listenCount: BadgeProgressNext | null;
    /** Next rating count badge (null if all earned) */
    ratingCount: BadgeProgressNext | null;
  };
}

/**
 * Progress toward earning a specific badge.
 * @category Badges
 */
export interface BadgeProgressNext {
  /** The badge being tracked */
  badge: Badge;
  /** Current progress value */
  current: number;
  /** Value needed to earn the badge */
  needed: number;
  /** Progress as a percentage (0-100) */
  progressPercentage: number;
}

/**
 * Status of a media upload job.
 *
 * Used for tracking progress of file uploads and transcoding.
 *
 * @category Uploads
 */
export interface UploadJob {
  /** Unique identifier for the upload job */
  id: string;
  /** Current processing status */
  status: "pending" | "processing" | "completed" | "failed";
  /** When the upload was initiated (ISO 8601) */
  createdAt?: string;
  /** Last status update time (ISO 8601) */
  updatedAt?: string;
  /** Upload/processing progress (0-100) */
  progress?: number;
  /** URL of the processed result (available when completed) */
  resultUrl?: string;
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * A music channel for organizing and featuring songs.
 * @category Songs
 */
export interface SongChannel {
  /** Unique identifier */
  id: string;
  /** Channel name */
  name: string;
  /** Channel description */
  description?: string;
  /** Cover image URL */
  coverUrl?: string;
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * A notification for the current user.
 *
 * Notifications alert users to activity like follows, likes, comments, etc.
 *
 * @example
 * ```typescript
 * const notifications = await sdk.getNotifications();
 * const unread = notifications.filter(n => !n.readAt);
 * console.log(`You have ${unread.length} unread notifications`);
 * ```
 *
 * @category Notifications
 */
export interface Notification {
  /** Unique identifier */
  id: string;
  /** Notification type (e.g., 'follow', 'like', 'comment') */
  type: string;
  /** When the notification was created (ISO 8601) */
  createdAt?: string;
  /** When the notification was read (null if unread) */
  readAt?: string | null;
  /** Type-specific notification data */
  data?: Record<string, unknown>;
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * A member of a chat group.
 * @category Chat
 */
export interface ChatGroupMember {
  /** User ULID */
  ulid: string;
  /** Username */
  username: string;
  /** Display name */
  name?: string;
  /** Avatar URL */
  avatar?: string;
}

/**
 * A chat group/conversation.
 *
 * Can be a direct message (2 participants) or group chat (multiple).
 *
 * @example
 * ```typescript
 * const groups = await sdk.getChatGroups();
 * for (const group of groups) {
 *   console.log(`${group.name}: ${group.unreadCount} unread`);
 * }
 * ```
 *
 * @category Chat
 */
export interface ChatGroup {
  /** Unique identifier */
  id: string;
  /** ULID identifier */
  ulid: string;
  /** Group name (or participant name for DMs) */
  name: string;
  /** Group description */
  description?: string;
  /** Member ULIDs or full member objects */
  members?: string[] | ChatGroupMember[];
  /** Full participant information */
  participants?: ChatGroupMember[];
  /** Number of unread messages */
  unreadCount?: number;
  /** Timestamp of the last message (ISO 8601) */
  lastMessageAt?: string;
  /** The most recent message in the group */
  lastMessage?: ChatMessage;
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * A message in a chat group.
 *
 * @example
 * ```typescript
 * const messages = await sdk.getChatMessages(groupUlid);
 * for (const msg of messages) {
 *   console.log(`${msg.sender?.username}: ${msg.body}`);
 * }
 * ```
 *
 * @category Chat
 */
export interface ChatMessage {
  /** Unique identifier */
  id: string;
  /** ULID identifier */
  ulid?: string;
  /** ULID of the chat group this message belongs to */
  groupUlid: string;
  /** User ID of the sender */
  senderId: string;
  /** ULID of the sender */
  senderUlid?: string;
  /** Full sender information */
  sender?: {
    ulid: string;
    username: string;
    name?: string;
    avatar?: string;
  };
  /** Message content */
  body: string;
  /** When the message was sent (ISO 8601) */
  createdAt?: string;
  /** When the message was read (null if unread) */
  readAt?: string | null;
  /** Additional properties from API */
  [key: string]: unknown;
}

/**
 * Pagination metadata from API responses.
 * @category API
 */
export interface PaginationMeta {
  /** Cursor for fetching the next page */
  nextCursor?: string | null;
  /** Cursor for fetching the previous page */
  prevCursor?: string | null;
  /** Additional pagination info */
  pagination?: {
    nextCursor?: string | null;
    page?: number;
    perPage?: number;
    total?: number;
  };
}

/**
 * Standard API response envelope.
 *
 * All API responses are wrapped in this structure with data and optional metadata.
 *
 * @typeParam T - The type of the response data
 *
 * @example
 * ```typescript
 * const response: ApiEnvelope<Post[]> = await sdk.fetchTrendingFeed();
 * const posts = response.data;
 * const nextCursor = response.nextCursor;
 * ```
 *
 * @category API
 */
export interface ApiEnvelope<T> {
  /** The response payload */
  data: T;
  /** Pagination metadata */
  meta?: PaginationMeta;
  /** Shorthand cursor for next page */
  nextCursor?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// App Settings Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UI theme configuration for the application.
 *
 * Contains color schemes, logos, and branding settings for light/dark modes.
 *
 * @category Settings
 */
export interface SiteSettingsUI {
  // Site config
  name?: string;
  siteType?: string;
  mode?: string;
  website?: string;
  wsomContest?: string;
  musicPlayerShowPlaybackSpeed?: string;
  playlistLabel?: string;

  // Logo variants
  siteLogoUrl?: string;
  siteLogo180?: string;
  siteLogo192?: string;
  siteLogo512?: string;
  siteLogoMaskable192?: string;
  siteLogoMaskable512?: string;

  // Primary colors
  primaryColorLight?: string;
  primaryColorDark?: string;
  primaryAccentLight?: string;
  primaryAccentDark?: string;
  onPrimaryLight?: string;
  onPrimaryDark?: string;

  // Secondary colors
  secondaryColorLight?: string;
  secondaryColorDark?: string;
  secondaryAccentLight?: string;
  secondaryAccentDark?: string;
  onSecondaryLight?: string;
  onSecondaryDark?: string;

  // Tertiary/accent colors
  tertiaryColorLight?: string;
  tertiaryColorDark?: string;
  tertiaryAccentLight?: string;
  tertiaryAccentDark?: string;
  onTertiaryLight?: string;
  onTertiaryDark?: string;

  // Background colors
  backgroundColorLight?: string;
  backgroundColorDark?: string;
  backgroundSecondaryLight?: string;
  backgroundSecondaryDark?: string;
  onBackgroundLight?: string;
  onBackgroundDark?: string;

  // Surface colors
  surfaceVariantLight?: string;
  surfaceVariantDark?: string;
  onSurfaceLight?: string;
  onSurfaceDark?: string;

  // Inverse surface
  inverseSurfaceLight?: string;
  inverseSurfaceDark?: string;
  onInverseSurfaceLight?: string;
  onInverseSurfaceDark?: string;

  // Outline colors
  outlineLight?: string;
  outlineDark?: string;
  outlineVariantLight?: string;
  outlineVariantDark?: string;

  // Semantic colors
  errorColor?: string;
  errorColorLight?: string;
  errorColorDark?: string;
  onError?: string;
  warningColor?: string;
  warningColorLight?: string;
  warningColorDark?: string;
  onWarning?: string;
  successColor?: string;
  successColorLight?: string;
  successColorDark?: string;
  onSuccess?: string;
  infoColor?: string;
  infoColorLight?: string;
  infoColorDark?: string;
  onInfo?: string;

  // Gradient colors
  gradientStartLight?: string;
  gradientEndLight?: string;
  gradientStartDark?: string;
  gradientEndDark?: string;

  // Interactive states
  selectionLight?: string;
  selectionDark?: string;
  disabledLight?: string;
  disabledDark?: string;
  disabledBackgroundLight?: string;
  disabledBackgroundDark?: string;
  focusOutlineLight?: string;
  focusOutlineDark?: string;
  hoverOverlayLight?: string;
  hoverOverlayDark?: string;
  pressedOverlayLight?: string;
  pressedOverlayDark?: string;

  // Other
  scrimColor?: string;
  backdropLight?: string;
  backdropDark?: string;
  shadowLight?: string;
  shadowDark?: string;

  // Legacy/text colors
  textColorLight?: string;
  textColorDark?: string;

  // Allow additional fields
  [key: string]: string | undefined;
}

/**
 * Site-level configuration settings.
 * @category Settings
 */
/**
 * Branded logo URLs for different sizes/purposes.
 * @category Settings
 */
export interface SiteLogos {
  /** Main logo */
  logo?: string;
  /** 192x192 icon */
  logo192?: string;
  /** 512x512 icon */
  logo512?: string;
  /** 180x180 Apple touch icon */
  logo180?: string;
  /** 192x192 PWA maskable icon */
  logoMaskable192?: string;
  /** 512x512 PWA maskable icon */
  logoMaskable512?: string;
  /** Favicon URL (tenant-specific) */
  favicon?: string;
}

export interface SiteSettings {
  /** UI theme configuration */
  ui?: SiteSettingsUI;
  /** Main site logo URL (legacy) */
  siteLogo?: string;
  /** Branded logo URLs for different sizes */
  logos?: SiteLogos;
}

/**
 * A reaction emoji/type that users can add to posts.
 * @category Settings
 */
export interface AppReaction {
  /** Reaction name/identifier */
  name?: string;
  /** Human-readable description */
  description?: string;
  /** Grouping category */
  category?: string;
  /** Emoji or icon value */
  value?: string;
  /** Display order */
  orderColumn?: number;
}

/**
 * Badge configuration from app settings.
 * @category Settings
 */
export interface AppBadge {
  /** Unique identifier */
  id?: number;
  /** Badge name */
  name?: string;
  /** Badge description */
  description?: string;
  /** Icon URL */
  iconUrl?: string | null;
  /** Whether the badge is inactive */
  inactive?: boolean;
  /** Display order */
  order?: number | null;
}

/**
 * A moderation violation type.
 * @category Settings
 */
export interface AppViolation {
  /** Violation name */
  name?: string;
  /** Description of the violation */
  description?: string;
  /** Point penalty */
  points?: number;
  /** Whether this results in a timeout */
  timeout?: boolean;
  /** Whether this results in a ban */
  ban?: boolean;
}

/**
 * A music genre category.
 * @category Settings
 */
export interface AppGenre {
  /** Unique identifier */
  id?: number;
  /** Genre name */
  name?: string;
  /** URL-friendly slug */
  slug?: string;
  /** Full path slug including parent genres */
  slugPath?: string;
  /** Parent genre ID (null for root genres) */
  parentId?: number | null;
  /** Nesting depth (0 for root genres) */
  depth?: number;
}

/**
 * Definition of a notification type.
 * @category Notifications
 */
export interface NotificationType {
  /** Type name identifier */
  name: string;
  /** Human-readable description */
  description: string;
}

/**
 * Application-wide settings and configuration.
 *
 * Contains all configurable options including themes, reactions, badges, etc.
 *
 * @example
 * ```typescript
 * const settings = await sdk.getAppSettings();
 * const reactions = settings.reactions ?? [];
 * const genres = settings.genres ?? [];
 * ```
 *
 * @category Settings
 */
export interface AppSettings {
  /** Site configuration */
  siteSettings?: SiteSettings;
  /** Available reactions */
  reactions?: AppReaction[];
  /** Available badges */
  badges?: AppBadge[];
  /** Moderation violation types */
  violations?: AppViolation[];
  /** Music genres */
  genres?: AppGenre[];
  /** Ad status options */
  adStatuses?: string[];
  /** Ad payment status options */
  adPaymentStatuses?: string[];
  /** Ad approval status options */
  adApprovalStatuses?: string[];
  /** User notification types */
  userNotificationTypes?: NotificationType[];
  /** Feature flags for tenant-level features */
  features?: {
    messaging?: boolean;
  };
}

/** User genre preference with enabled status */
export interface GenrePreference {
  id?: number;
  genreId: number;
  genreName: string;
  genreSlug: string;
  isEnabled: boolean;
  sortOrder: number;
  isTenantEnabled: boolean;
}

/** Response from genre preferences endpoint */
export interface GenrePreferencesResponse {
  preferences: GenrePreference[];
  total: number;
  enabledCount: number;
}

/** Input for updating genre preference */
export interface GenrePreferenceUpdate {
  genreId: number;
  isEnabled: boolean;
  sortOrder?: number;
}

/** Trending genre from /v1/songs/trending/genres */
export interface TrendingGenre {
  name: string;
  slug: string;
  trendingScore: number;
  percentage: number;
  audioCount: number;
}

export interface TrendingMusicUser {
  userId: number;
  username: string;
  name: string;
  ulid: string;
  avatar?: string;
  trendingScore: number;
  percentage: number;
  postCount: number;
  songCount: number;
  recentViews: number;
  periodDays: number; 
}

/** Trending hashtag from /v1/trending/hashtags */
export interface TrendingHashtag {
  hashtag: string;
  count: number;
}

/** Trending song for sidebar display */
export interface TrendingSong {
  ulid: string;
  title: string;
  artist: string;
  username: string;
  coverImage?: string;
  playCount: number;
}

// ============================================
// Signup / Demographics Types
// ============================================

/** Option for a demographic question */
export interface DemographicQuestionOption {
  id: number;
  label: string;
  value: string;
  description?: string | null;
  displayOrder: number;
}

/** User's response to a demographic question */
export interface DemographicQuestionResponse {
  optionIds: number[];
  value?: string | null;
}

/** A demographic question from the signup config */
export interface DemographicQuestion {
  id: number;
  slug: string;
  prompt: string;
  description?: string | null;
  questionType: "singleSelect" | "multiSelect" | "text" | string;
  version: number;
  isRequired: boolean;
  allowMultiple: boolean;
  allowFreeText: boolean;
  displayOrder: number;
  metadata?: Record<string, unknown> | null;
  options: DemographicQuestionOption[];
  responses?: DemographicQuestionResponse;
}

/** Legal document for agreement acceptance */
export interface SignupDocument {
  id: number;
  slug: string;
  title: string;
  version: number;
  contentUrl?: string;
  isRequired: boolean;
  acceptedAt?: string | null;
}

/** Requirements status from signup config */
export interface SignupRequirements {
  agreementsPending: boolean;
  demographicsPending: boolean;
}

/** Response from GET /v1/signup/config */
export interface SignupConfig {
  documents: SignupDocument[];
  questions: DemographicQuestion[];
  requirements: SignupRequirements;
}

/** Input for saving a demographic response */
export interface DemographicResponseInput {
  questionId: number;
  optionIds?: number[];
  value?: string | null;
}

/** Input for accepting agreement documents */
export interface AgreementAcceptanceInput {
  id: number;
  acceptedAt: string;
}

// ============================================================================
// User Management / Delegation Types
// ============================================================================

/** Available delegation scopes that can be granted to managers */
export type DelegationScope = 'edit_profile' | 'publish_posts' | 'publish_audio' | 'manage_settings';

/** Extended type that includes "all" for requesting all granted scopes at once */
export type DelegationScopeOrAll = DelegationScope | 'all';

/** Assignment status filter options */
export type AssignmentStatus = 'active' | 'expired' | 'revoked' | 'all';

/** Scopes object mapping scope names to boolean values */
export interface ScopesMap {
  editProfile: boolean;
  publishPosts: boolean;
  publishAudio: boolean;
  manageSettings: boolean;
}

/** Basic user info for display in assignments */
export interface ManagedUserInfo {
  ulid: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** A managed user assignment - links a manager to a managed user with specific scopes */
export interface ManagedUserAssignment {
  id: string; // ULID
  managedUser: ManagedUserInfo;
  scopes: ScopesMap;
  startsAt: string; // ISO 8601
  endsAt: string | null; // ISO 8601
  createdAt: string; // ISO 8601
  revokedAt?: string | null;
  revokedBy?: ManagedUserInfo | null;
  notes?: string | null;
}

/** Response from listing assignments */
export interface AssignmentListResponse {
  assignments: ManagedUserAssignment[];
  cursor?: string | null;
  hasMore?: boolean;
  totalActive?: number;
}

/** Request to issue an acting context token */
export interface IssueTokenRequest {
  intendedAction: DelegationScopeOrAll;
  ttlSeconds?: number; // 60-600, default 300
}

/** Response from issuing an acting context token */
export interface IssueTokenResponse {
  actingContextToken: string;
  expiresAt: string; // ISO 8601
  managedUserUlid: string;
  grantedScopes: DelegationScope[];
}

/** Response from checking managed user limit status */
export interface LimitStatus {
  canCreate: boolean;
  currentCount: number;
  limit: number | null; // null = unlimited (Administrator badge)
  remaining: number | null; // null = unlimited
  message: string | null;
}

/** Request to create a new managed user */
export interface CreateManagedUserRequest {
  username: string;
  email: string;
  name: string;
  password: string;
  bio?: string;
  scopes: ScopesMap;
  startsAt?: string; // ISO 8601
  endsAt?: string; // ISO 8601
  notes?: string;
}

/** Response from creating a managed user */
export interface CreateManagedUserResponse {
  user: {
    ulid: string;
    username: string;
    email: string;
    name: string;
  };
  assignment: ManagedUserAssignment;
}

/** Profile update request via user management endpoint */
export interface ManagedProfileUpdateRequest {
  displayName?: string;
  username?: string;
  email?: string;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  websiteName?: string | null;
  avatarUrl?: string | null;
  backgroundUrl?: string | null;
}

/** User data in profile update response */
export interface ManagedProfileUserData {
  ulid: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  location: string | null;
  website: string | null;
  websiteName: string | null;
  updatedAt: string;
}

/** Audit log entry for actions taken on behalf of managed users */
export interface ManagedUserAuditEntry {
  id: string; // ULID
  action: DelegationScope;
  performedBy: ManagedUserInfo;
  performedAt: string; // ISO 8601
  ip: string;
  payloadBefore: Record<string, unknown> | null;
  payloadAfter: Record<string, unknown> | null;
}

/** Response data from updating managed user profile */
export interface ManagedProfileUpdateData {
  user: ManagedProfileUserData;
  audit: ManagedUserAuditEntry;
}

/** Response data from revoking an assignment */
export interface RevokeAssignmentData {
  id: string;
  revokedAt: string;
  revokedBy: ManagedUserInfo;
}

// ---------------------------------------------------------------------------
// CEO Dashboard Types
// ---------------------------------------------------------------------------

/** Key metrics for CEO Dashboard */
export interface DashboardKeyMetrics {
  dau: number;
  avgDau: number;
  mau: number;
  dauMauRatio: number;
  newUsers: number;
  returningUsers: number;
  avgListeningMinutes: number;
}

/** Social metrics summary */
export interface DashboardSocialMetrics {
  newPosts: number;
  comments: number;
  reactionsMade: number;
  reactionsReceived: number;
  shares: number;
  saves: number;
  profileViews: number;
}

/** Music metrics summary */
export interface DashboardMusicMetrics {
  playsAuth: number;
  playsAnon: number;
  uniqueListenersAuth: number;
  uniqueListenersAnon: number;
  minutes: number;
  playsPerSession: number;
  avgPlaysPerAuthUser: number;
}

/** Device metrics summary */
export interface DashboardDeviceMetrics {
  uniqueDevices: number;
  playsIphone: number;
  playsAndroid: number;
  playsWindows: number;
  playsMac: number;
  playsOtherDevice: number;
  multiDeviceUsers: number;
}

/** Listener engagement metrics */
export interface DashboardListenerEngagement {
  uniqueSongsPlayed: number;
  avgSongsPerListener: number;
  newListeners: number;
  returningListeners: number;
}

/** Audio ads metrics */
export interface DashboardAdsMetrics {
  playsAuth: number;
  playsAnon: number;
  uniqueListenersAuth: number;
  uniqueListenersAnon: number;
  minutes: number;
}

/** Audience metrics */
export interface DashboardAudienceMetrics {
  followersGained: number;
  followersLost: number;
  sessions: number;
  avgSessionMinutes: number;
}

/** Rating metrics */
export interface DashboardRatingMetrics {
  count: number;
  uniqueRaters: number;
  average: number;
}

/** CEO Dashboard summary data */
export interface DashboardSummary {
  keyMetrics: DashboardKeyMetrics;
  summary: {
    social: DashboardSocialMetrics;
    music: DashboardMusicMetrics;
    devices: DashboardDeviceMetrics;
    listenerEngagement: DashboardListenerEngagement;
    ads: DashboardAdsMetrics;
    ratings: DashboardRatingMetrics;
    audience: DashboardAudienceMetrics;
  };
  dateRange: {
    start: string;
    end: string;
  };
  lastAggregatedAt: string;
}

/** Time series data point */
export interface TimeseriesDataPoint {
  date: string;
  value: number;
}

/** Timeseries response */
export interface DashboardTimeseries {
  metric: string;
  data: TimeseriesDataPoint[];
  dateRange: {
    start: string;
    end: string;
  };
}

/** Listening distribution bucket */
export interface ListeningDistributionBucket {
  bucket: string;
  count: number;
  percentage: number;
}

/** Listening distribution response */
export interface DashboardListeningDistribution {
  distribution: ListeningDistributionBucket[];
  totalUsers: number;
  dateRange: {
    start: string;
    end: string;
  };
}

/** Hourly active users data point */
export interface HourlyActiveUsersDataPoint {
  hour: string;
  activeUsers: number;
}

/** Hourly active users response */
export interface DashboardHourlyActiveUsers {
  data: HourlyActiveUsersDataPoint[];
  dateRange: {
    start: string;
    end: string;
  };
}

// ---------------------------------------------------------------------------
// Group Moderation
// ---------------------------------------------------------------------------

/** Group moderation status for posts in MODERATED visibility groups */
export type GroupModerationStatus = 'pending' | 'approved' | 'rejected';

/** Post in moderation queue awaiting approval/rejection */
export interface ModerationQueuePost {
  ulid: string;
  body?: string;
  createdAt: string;
  groupModerationStatus: GroupModerationStatus;
  user?: {
    ulid: string;
    username: string;
    name?: string;
    avatar?: string;
  };
  [key: string]: unknown;
}

/** Response from moderation queue endpoint */
export interface ModerationQueueResponse {
  posts: ModerationQueuePost[];
  nextCursor?: string | null;
  total?: number;
}

/** Response from approve/reject moderation actions */
export interface ModerationActionResponse {
  message: string;
  post?: ModerationQueuePost;
}

// ---------------------------------------------------------------------------
// Audio Ads
// ---------------------------------------------------------------------------

/** Audio ad data from the API for playback between songs */
export interface AudioAd {
  /** The ad's post ULID - used for audio view tracking */
  id: string;
  /** Ad title/name */
  title: string;
  /** URL to the audio file */
  mediaUrl: string;
  /** Media type (always 'audio' for audio ads) */
  mediaType: 'audio' | 'video' | 'banner';
  /** Duration in seconds (if available) */
  duration?: number | null;
}

// ---------------------------------------------------------------------------
// WSOM (World Series of Music) Types
// ---------------------------------------------------------------------------

/** WSOM contest information */
export interface WsomContest {
  ulid: string;
  name: string;
  description: string | null;
  genre: {
    id: number;
    name: string;
    slug: string;
  } | null;
  startDate: string;
  endDate: string;
  maxEntriesPerUser: number;
  status: "upcoming" | "active" | "completed" | "cancelled";
  entryCount: number;
  createdAt: string;
}

/** WSOM entry post data */
export interface WsomPost {
  ulid: string | null;
  title: string;
  artist: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  coverArtUrl: string | null;
  userCreationMode?: string | null;
}

/** WSOM rating statistics */
export interface WsomRatingStats {
  average: number | null;
  count: number;
  distribution: Record<string, number>;
}

/** WSOM contest entry */
export interface WsomEntry {
  ulid: string;
  displayName: string;
  post: WsomPost;
  ratingStats: WsomRatingStats | null;
  userRating: number | null;
  isOwnEntry: boolean;
  createdAt: string | null;
  contest?: WsomContest;
}

/** WSOM contest ranking */
export interface WsomRanking {
  rank: number;
  entry: WsomEntry;
  revealedTitle: string;
  revealedArtist: string;
  userId: string | null;
}

/** WSOM feed metadata */
export interface WsomFeedMeta {
  nextCursor: string | null;
  prevCursor: string | null;
  perPage: number;
  contest: WsomContest;
  unratedCount: number;
}

/** WSOM feed response */
export interface WsomFeedResponse {
  data: WsomEntry[];
  meta: WsomFeedMeta;
}

/** WSOM contest list response */
export interface WsomContestListResponse {
  data: WsomContest[];
  meta: {
    nextCursor: string | null;
    prevCursor: string | null;
    perPage: number;
  };
}

/** WSOM entry list response */
export interface WsomEntryListResponse {
  data: WsomEntry[];
  meta: {
    nextCursor: string | null;
    prevCursor: string | null;
    perPage: number;
  };
}

/** WSOM contest results response */
export interface WsomContestResultsResponse {
  contest: WsomContest;
  rankings: WsomRanking[];
}

/** Request to create a WSOM entry */
export interface WsomCreateEntryRequest {
  postUlid: string;
}

/** Request to rate a WSOM entry */
export interface WsomRateEntryRequest {
  rating: number;
}

/** Response from rating a WSOM entry */
export interface WsomRateEntryResponse {
  rating: number;
  entryStats: WsomRatingStats;
}

/** Request to create a WSOM contest (admin) */
export interface WsomCreateContestRequest {
  name: string;
  description?: string;
  genreId?: number | null;
  startDate: string;
  endDate: string;
  maxEntriesPerUser?: number;
}

/** Request to update a WSOM contest (admin) */
export interface WsomUpdateContestRequest {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  maxEntriesPerUser?: number;
  status?: "upcoming" | "active" | "completed" | "cancelled";
}

// WSOM v3 Types (Event-based contest system)
// ---------------------------------------------------------------------------

/** Classification type for WSOM entries */
export type WsomClassificationType = "AI" | "Human" | "Hybrid" | "CouldNotDetermine";

/** Response from listening time tracking */
export interface WsomListeningResponse {
  secondsListened: number;
  ratingEnabled: boolean;
  secondsRemaining: number;
}

/** Classification data returned from API */
export interface WsomClassificationData {
  id: number;
  classification: WsomClassificationType;
  editWindowExpiresAt: string | null;
}

/** Response from classification submit/update */
export interface WsomClassificationResponse {
  classification: WsomClassificationData;
}

/** Single leaderboard user entry */
export interface WsomLeaderboardUser {
  userId: number;
  accuracy: number;
}

/** Leaderboard data grouped by classification type */
export interface WsomLeaderboards {
  human: WsomLeaderboardUser[];
  ai: WsomLeaderboardUser[];
  hybrid: WsomLeaderboardUser[];
}

/** Response from leaderboards endpoint */
export interface WsomLeaderboardResponse {
  leaderboards: WsomLeaderboards;
}

/** WSOM event (v3 equivalent of contest) */
export interface WsomEvent {
  id: number;
  genre: string;
  status: "upcoming" | "entry_window" | "active" | "ended";
  entryWindowOpensAt: string;
  votingStartsAt: string;
  endsAt: string;
  resultsRevealed: boolean;
  resultsRevealedAt: string | null;
  maxEntries: number;
  entryCount: number;
  isFull: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Response from events list endpoint */
export interface WsomEventListResponse {
  events: WsomEvent[];
}

/** Entry eligibility status for a WSOM event or contest */
export interface WsomEntryStatus {
  canEnter: boolean;
  needsBirthday?: boolean;
  dailyEntriesUsed: number;
  dailyEntriesMax: number;
  totalEntries: number;
  totalEntriesMax: number;
  nextResetAt: string | null;
  secondsUntilReset: number | null;
  eventId?: number;
  eventStatus?: string;
}

// ---------------------------------------------------------------------------
// Passkey (WebAuthn) Types
// ---------------------------------------------------------------------------

/** Passkey data returned from API */
export interface Passkey {
  id: string;
  name: string;
  deviceType: string | null;
  backedUp: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** WebAuthn registration options response from API */
export interface PasskeyRegisterOptionsResponse {
  options: PublicKeyCredentialCreationOptionsJSON;
}

/** WebAuthn authentication options response from API */
export interface PasskeyAuthenticateOptionsResponse {
  options: PublicKeyCredentialRequestOptionsJSON;
  sessionId: string;
}

/** WebAuthn authentication response with tokens */
export interface PasskeyAuthenticateResponse {
  tokenType: string;
  expiresIn: number;
  accessToken: string;
  refreshToken?: string;
}

/** Check passkeys response */
export interface PasskeyCheckResponse {
  hasPasskeys: boolean;
}

/** Passkey list response */
export interface PasskeyListResponse {
  passkeys: Passkey[];
}

/** Passkey registration result */
export interface PasskeyRegisterResponse {
  message: string;
  passkey: Passkey;
}

/** Passkey rename/update result */
export interface PasskeyUpdateResponse {
  message: string;
  passkey: Passkey;
}

// WebAuthn types from @simplewebauthn/types (reexported for convenience)
export interface PublicKeyCredentialCreationOptionsJSON {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
  timeout?: number;
  attestation?: string;
  excludeCredentials?: Array<{
    id: string;
    type: "public-key";
    transports?: string[];
  }>;
  authenticatorSelection?: {
    authenticatorAttachment?: string;
    residentKey?: string;
    requireResidentKey?: boolean;
    userVerification?: string;
  };
  extensions?: Record<string, unknown>;
}

export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: Array<{
    id: string;
    type: "public-key";
    transports?: string[];
  }>;
  userVerification?: string;
  extensions?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Poll Types
// ---------------------------------------------------------------------------

/** User's vote on a poll */
export interface PollUserVote {
  pollOptionId: number;
  optionText: string;
  votedAt: string;
}

/** Batch polls response */
export interface BatchPollsResponse {
  polls: Record<string, Poll | null>;
}

// ---------------------------------------------------------------------------
// Trending Types
// ---------------------------------------------------------------------------

/** Trending feed response with posts */
export interface TrendingFeedResponse {
  data: Post[];
  nextCursor?: string | null;
}

// ---------------------------------------------------------------------------
// Push Notification Types
// ---------------------------------------------------------------------------

/** Push notification registration request */
export interface PushNotificationRegisterRequest {
  token: string;
  platform: "ios" | "android" | "web";
}

/** Push notification registration response */
export interface PushNotificationRegisterResponse {
  success: boolean;
  message?: string;
}

// ---------------------------------------------------------------------------
// Branding Types
// ---------------------------------------------------------------------------

/** Branding icon URLs for different sizes */
export interface BrandingIcons {
  "192": string;
  "512": string;
  appleTouchIcon: string;
}

/** Site branding configuration */
export interface Branding {
  name: string;
  shortName: string;
  description: string;
  themeColor: string;
  themeColorDark: string;
  backgroundColor: string;
  backgroundColorDark: string;
  icons: BrandingIcons;
}

// ---------------------------------------------------------------------------
// Creation Mode Types
// ---------------------------------------------------------------------------

/** Creation mode types for voting on AI/Human content */
export type CreationModeType = "AI" | "HUMAN" | "HYBRID" | "CANT_TELL";

/** Creation mode vote response */
export interface CreationModeVoteResponse {
  vote: {
    mode: CreationModeType;
  };
  stats: Record<string, number>;
}

/** Creation mode delete response */
export interface CreationModeDeleteResponse {
  message: string;
  stats: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Group Types
// ---------------------------------------------------------------------------

/** Group visibility options */
export type GroupVisibility = "PUBLIC" | "MODERATED" | "PRIVATE";

/** Group member role */
export type GroupMemberRole = "member" | "moderator" | "admin" | "owner";

/** A group/community in the platform */
export interface Group {
  /** Unique identifier (ULID) */
  ulid?: string;
  /** Legacy ID */
  id?: string;
  /** Group name */
  name: string;
  /** Group description or bio */
  description?: string;
  bio?: string;
  /** Avatar/icon URL */
  avatar?: string;
  /** Cover/background image URL */
  background?: string;
  /** Group visibility setting */
  visibility?: GroupVisibility;
  /** Number of members */
  membersCount?: number;
  /** Whether current user has joined */
  isJoined?: boolean;
  /** Whether current user has favorited */
  isFavorite?: boolean;
  /** User's role in the group */
  memberRole?: GroupMemberRole;
  /** Group owner info */
  owner?: {
    ulid: string;
    username: string;
    avatar?: string;
  };
  /** When the group was created (ISO 8601) */
  createdAt?: string;
  /** Additional properties from API */
  [key: string]: unknown;
}

/** Response when listing groups */
export interface GroupListResponse {
  data: Group[];
  nextCursor?: string;
}

/** Request to create a new group */
export interface CreateGroupRequest {
  name: string;
  description?: string;
  visibility?: GroupVisibility;
}

/** Request to join a group */
export interface JoinGroupRequest {
  groupId: string;
}

/** Group post for group feeds */
export interface GroupPost {
  ulid: string;
  body?: string;
  createdAt?: string;
  isPinned?: boolean;
  username?: string;
  userId?: string;
  postEngagement?: {
    commentCount?: number;
    totalCommentCount?: number;
    repostCount?: number;
    views?: number;
    reactions?: unknown[];
    userReaction?: string | null;
    reactionCounts?: Record<string, number>;
  };
  user?: {
    ulid?: string;
    userId?: string;
    username?: string;
    avatar?: string;
  };
  userReaction?: string | null;
  groupModerationStatus?: "pending" | "approved" | "rejected" | null;
}

/** A member of a group */
export interface GroupMember {
  /** User ULID */
  ulid: string;
  /** User ULID (Ban/Unban Users) */
  id: string;
  /** Username */
  username: string;
  /** Display name */
  name?: string;
  /** Avatar URL */
  avatar?: string;
  /** Role in the group */
  role?: GroupMemberRole;
  /** Whether the member is muted */
  isMuted?: boolean;
  /** When the member was muted (ISO 8601) */
  mutedAt?: string;
  /** When the member was banned (ISO 8601) */
  bannedAt?: string;
  /** When the member joined (ISO 8601) */
  joinedAt?: string;
}

/** Moderation log entry for a group */
export interface GroupModerationLogEntry {
  /** The action taken */
  action: string;
  /** Human-readable action label */
  actionLabel: string;
  /** Moderator who performed the action */
  moderator?: {
    ulid: string;
    username: string;
  };
  /** Target user of the action */
  targetUser?: {
    ulid: string;
    username: string;
  };
  /** Reason for the action */
  reason?: string;
  /** When the action was taken (ISO 8601) */
  createdAt: string;
}

/** Request to update a group's settings */
export interface UpdateGroupRequest {
  /** Group ULID */
  groupId: string;
  /** New avatar URL (or null to remove) */
  avatar?: string | null;
  /** New background/banner URL (or null to remove) */
  background?: string | null;
  /** New group name */
  name?: string;
  /** New description */
  description?: string;
  /** New visibility setting */
  visibility?: GroupVisibility;
}

// ---------------------------------------------------------------------------
// Story Types
// ---------------------------------------------------------------------------

/** Story visibility options */
export type StoryVisibility = "public" | "followers";

/** Media item attached to a story */
export interface StoryMedia {
  /** Full URL to the media file */
  url: string;
  /** MIME type (e.g., "image/jpeg", "video/mp4") */
  mimeType: string | null;
  /** Width in pixels */
  width: number | null;
  /** Height in pixels */
  height: number | null;
}

/** User info embedded in a story */
export interface StoryUser {
  /** User ULID */
  ulid: string;
  /** Username */
  username: string;
  /** Display name */
  name: string;
  /** Avatar URL (fully resolved) */
  avatar: string | null;
}

/**
 * A story (ephemeral post that expires after 24 hours).
 *
 * Stories can contain a single image or short video plus optional caption.
 *
 * @example
 * ```typescript
 * const story = await sdk.getStory('01HX...');
 * if (!story.isExpired) {
 *   console.log(`Story by ${story.user.username}`);
 * }
 * ```
 *
 * @category Stories
 */
export interface Story {
  /** Unique identifier (ULID format, lowercase) */
  ulid: string;
  /** Story caption/text */
  caption: string | null;
  /** Visibility setting */
  visibility: StoryVisibility;
  /** Media attachments (max 1 for stories) */
  media: StoryMedia[];
  /** View count (only present for story owner) */
  viewCount?: number;
  /** Whether the current user has viewed this story */
  hasViewed: boolean;
  /** Whether this story belongs to the current user */
  isOwn: boolean;
  /** Whether the story has expired (past 24 hours) */
  isExpired: boolean;
  /** When the story was created (ISO 8601) */
  createdAt: string;
  /** When the story expires (ISO 8601) */
  expiresAt: string;
  /** User who created the story */
  user: StoryUser;
}

/**
 * A user's story group in the feed (grouped stories from a single user).
 *
 * Stories are grouped by user in the feed, sorted by most recent.
 *
 * @category Stories
 */
export interface StoryFeedUser {
  /** User who owns these stories */
  user: StoryUser;
  /** User's active stories */
  stories: Story[];
  /** Whether any stories are unviewed by the current user */
  hasUnviewed: boolean;
  /** Total number of active stories */
  storyCount: number;
  /** Timestamp of most recent story (ISO 8601) */
  latestAt: string;
}

/**
 * Response from the story feed endpoint.
 *
 * @category Stories
 */
export interface StoryFeedResponse {
  /** Story groups by user */
  data: StoryFeedUser[];
}

/**
 * Input for creating a new story.
 *
 * @category Stories
 */
export interface CreateStoryInput {
  /** Image IDs from prior upload (max 1) */
  imageIds?: number[];
  /** Image URLs/S3 keys from upload (max 1) - alternative to imageIds */
  imageUrls?: string[];
  /** Story caption (max 500 characters) */
  caption?: string;
  /** Visibility setting (defaults to "public") */
  visibility?: StoryVisibility;
  /** Group ID if posting to a group */
  groupId?: number;
}

/**
 * A user who has viewed a story.
 *
 * Only accessible by the story owner.
 * Note: The user avatar is a raw database path, not a fully resolved URL.
 * Use the media URL config to resolve it.
 *
 * @category Stories
 */
export interface StoryViewer {
  /** Viewer user info (avatar is raw path, needs URL resolution) */
  user: {
    id: number;
    ulid: string;
    username: string;
    name: string;
    avatar: string | null;
  };
  /** When they viewed the story (ISO 8601) */
  viewedAt: string;
}

/**
 * Response from the story viewers endpoint.
 *
 * @category Stories
 */
export interface StoryViewersResponse {
  /** List of users who viewed the story */
  data: StoryViewer[];
}

// Export blog types
export * from "./types/blog";
