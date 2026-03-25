/**
 * TanStack Query integration helpers for the CC Platform SDK.
 *
 * This module provides query key factories, query options creators, and
 * prefetch utilities for integrating the SDK with TanStack Query (React Query,
 * Vue Query, Svelte Query, etc.).
 *
 * @example
 * ```typescript
 * import { createPostQueryOptions, createMusicFeedInfiniteQueryOptions, queryKeys } from '@social/cc-platform-sdk';
 *
 * // In React:
 * const { data: post } = useQuery(createPostQueryOptions(sdk, postUlid));
 * const { data: feed } = useInfiniteQuery(createMusicFeedInfiniteQueryOptions(sdk));
 * ```
 *
 * @module query
 * @category Query Helpers
 */
import type {
  FetchInfiniteQueryOptions,
  FetchQueryOptions,
  InfiniteData,
  QueryClient,
} from "@tanstack/query-core";
import type { CcPlatformSdk } from "./platformSdk";
import type { FeedPage, Post, Story, StoryFeedResponse, Ulid } from "./types";

/**
 * Query key factories for posts and feeds.
 *
 * Use these to ensure consistent cache keys across your application.
 *
 * @example
 * ```typescript
 * // Invalidate all posts
 * queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
 *
 * // Invalidate a specific post
 * queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail('01HX...') });
 *
 * // Invalidate all feeds
 * queryClient.invalidateQueries({ queryKey: queryKeys.feed.all });
 * ```
 *
 * @category Query Helpers
 */
export const queryKeys = {
  posts: {
    all: ["posts"] as const,
    detail: (id: Ulid) => ["posts", "detail", id] as const,
  },
  feed: {
    all: ["feed"] as const,
    music: () => ["feed", "music"] as const,
  },
  stories: {
    all: ["stories"] as const,
    feed: () => ["stories", "feed"] as const,
    mine: () => ["stories", "mine"] as const,
    user: (username: string) => ["stories", "user", username] as const,
    detail: (ulid: string) => ["stories", "detail", ulid] as const,
    viewers: (ulid: string) => ["stories", "viewers", ulid] as const,
  },
} as const;

/**
 * Create query options for fetching a single post by ULID.
 *
 * Returns TanStack Query options with proper typing, caching, and stale time configuration.
 *
 * @param sdk - The CC Platform SDK instance
 * @param ulid - The ULID of the post to fetch
 * @param opts - Optional overrides for query options
 * @returns Query options object for use with useQuery or prefetchQuery
 *
 * @example
 * ```typescript
 * // In React component
 * const { data: post, isLoading } = useQuery(createPostQueryOptions(sdk, '01HX...'));
 *
 * // Force refresh from server
 * const options = createPostQueryOptions(sdk, ulid, { meta: { forceRefresh: true } });
 * ```
 *
 * @category Query Helpers
 */
export function createPostQueryOptions(
  sdk: CcPlatformSdk,
  ulid: Ulid,
  opts?: Partial<
    FetchQueryOptions<Post | null, Error, Post | null, ReturnType<typeof queryKeys.posts.detail>>
  >,
): FetchQueryOptions<Post | null, Error, Post | null, ReturnType<typeof queryKeys.posts.detail>> {
  return {
    queryKey: queryKeys.posts.detail(ulid),
    queryFn: () => sdk.getPostByUlid(ulid, Boolean(opts?.meta?.forceRefresh)),
    staleTime: 30_000,
    gcTime: 10 * 60 * 1000,
    ...opts,
  };
}

/**
 * Create infinite query options for the music feed.
 *
 * Returns TanStack Query infinite query options configured for the default
 * music feed endpoint (/v1/songs/feed/all) with cursor-based pagination.
 *
 * @param sdk - The CC Platform SDK instance
 * @param opts - Optional overrides for infinite query options
 * @returns Infinite query options for use with useInfiniteQuery
 *
 * @example
 * ```typescript
 * // In React component
 * const {
 *   data,
 *   fetchNextPage,
 *   hasNextPage,
 *   isFetchingNextPage
 * } = useInfiniteQuery(createMusicFeedInfiniteQueryOptions(sdk));
 *
 * // Access flattened posts
 * const posts = data?.pages.flatMap(page => page.posts) ?? [];
 * ```
 *
 * @category Query Helpers
 */
export function createMusicFeedInfiniteQueryOptions(
  sdk: CcPlatformSdk,
  opts?: Partial<
    FetchInfiniteQueryOptions<
      FeedPage,
      Error,
      FeedPage,
      ReturnType<typeof queryKeys.feed.music>,
      string
    >
  >,
): FetchInfiniteQueryOptions<
  FeedPage,
  Error,
  FeedPage,
  ReturnType<typeof queryKeys.feed.music>,
  string
> {
  return createFeedInfiniteQueryOptions(sdk, {
    endpoint: "/v1/songs/feed/all",
    cacheKey: queryKeys.feed.music(),
    ...opts,
  });
}

/**
 * Create infinite query options for any feed endpoint.
 *
 * Generic version that allows specifying custom endpoints and cache keys
 * for different feed types (trending, following, genre feeds, etc.).
 *
 * @typeParam TKey - The query key type (must be readonly array)
 * @param sdk - The CC Platform SDK instance
 * @param config - Configuration including endpoint URL and cache key
 * @param config.endpoint - The API endpoint for the feed (e.g., '/v1/songs/feed/trending')
 * @param config.cacheKey - The query key for caching
 * @returns Infinite query options for use with useInfiniteQuery
 *
 * @example
 * ```typescript
 * // Create options for a custom feed
 * const trendingOptions = createFeedInfiniteQueryOptions(sdk, {
 *   endpoint: '/v1/songs/feed/trending',
 *   cacheKey: ['feed', 'trending'] as const,
 * });
 *
 * // Genre feed
 * const genreOptions = createFeedInfiniteQueryOptions(sdk, {
 *   endpoint: '/v1/songs/feed/genre/hip-hop',
 *   cacheKey: ['feed', 'genre', 'hip-hop'] as const,
 * });
 * ```
 *
 * @category Query Helpers
 */
export function createFeedInfiniteQueryOptions<TKey extends readonly unknown[]>(
  sdk: CcPlatformSdk,
  config: {
    endpoint: string;
    cacheKey: TKey;
  } & Partial<
    FetchInfiniteQueryOptions<FeedPage, Error, FeedPage, TKey, string>
  >,
): FetchInfiniteQueryOptions<
  FeedPage,
  Error,
  FeedPage,
  TKey,
  string
> {
  const options = {
    queryKey: config.cacheKey,
    initialPageParam: undefined as unknown as string,
    queryFn: ({ pageParam }) =>
      sdk.fetchFeedPage((pageParam as string | null) ?? null, config.endpoint),
    getNextPageParam: (lastPage: FeedPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
    gcTime: 10 * 60 * 1000,
    ...config,
  } as FetchInfiniteQueryOptions<
    FeedPage,
    Error,
    FeedPage,
    TKey,
    string
  >;

  return options;
}

/**
 * Prefetch a single post into the query cache.
 *
 * Useful for prefetching posts on hover or during navigation transitions.
 *
 * @param sdk - The CC Platform SDK instance
 * @param queryClient - The TanStack QueryClient instance
 * @param ulid - The ULID of the post to prefetch
 * @returns Promise that resolves when prefetch is complete
 *
 * @example
 * ```typescript
 * // Prefetch on link hover
 * const handleMouseEnter = async (postUlid: string) => {
 *   await prefetchPost(sdk, queryClient, postUlid);
 * };
 * ```
 *
 * @category Query Helpers
 */
export async function prefetchPost(
  sdk: CcPlatformSdk,
  queryClient: QueryClient,
  ulid: Ulid,
): Promise<void> {
  await queryClient.prefetchQuery(createPostQueryOptions(sdk, ulid));
}

/**
 * Prefetch the first page of the music feed.
 *
 * Useful for SSR or prefetching the feed before navigation.
 *
 * @param sdk - The CC Platform SDK instance
 * @param queryClient - The TanStack QueryClient instance
 * @returns Promise that resolves when prefetch is complete
 *
 * @example
 * ```typescript
 * // Prefetch feed on app initialization
 * await prefetchMusicFeedFirstPage(sdk, queryClient);
 * ```
 *
 * @category Query Helpers
 */
export async function prefetchMusicFeedFirstPage(
  sdk: CcPlatformSdk,
  queryClient: QueryClient,
): Promise<void> {
  const options = createMusicFeedInfiniteQueryOptions(sdk);
  await queryClient.prefetchInfiniteQuery(options);
}

/**
 * Hydrate the feed cache from IndexedDB-cached data.
 *
 * Used to populate the query cache from offline-first cached data
 * when the app initializes or regains connectivity.
 *
 * @param queryClient - The TanStack QueryClient instance
 * @param cacheKey - The query key for the feed
 * @param cached - The cached FeedPage data from IndexedDB
 *
 * @example
 * ```typescript
 * // Restore feed from IndexedDB on startup
 * const cached = await sdk.readCachedFeed(['feed', 'music']);
 * if (cached) {
 *   hydrateFeedFromCache(queryClient, queryKeys.feed.music(), cached);
 * }
 * ```
 *
 * @category Query Helpers
 */
export function hydrateFeedFromCache(
  queryClient: QueryClient,
  cacheKey: ReturnType<typeof queryKeys.feed.music>,
  cached: FeedPage,
) {
  const data: InfiniteData<FeedPage, string | undefined> = {
    pageParams: [undefined],
    pages: [cached],
  };
  queryClient.setQueryData(cacheKey, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Story Query Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create query options for fetching the story feed.
 *
 * Returns stories grouped by user from followed users and the current user.
 *
 * @param sdk - The CC Platform SDK instance
 * @param opts - Optional overrides for query options
 * @returns Query options object for use with useQuery
 *
 * @example
 * ```typescript
 * const { data: feed } = useQuery(createStoryFeedQueryOptions(sdk));
 * for (const userStories of feed?.data ?? []) {
 *   if (userStories.hasUnviewed) {
 *     console.log(`${userStories.user.username} has new stories!`);
 *   }
 * }
 * ```
 *
 * @category Query Helpers
 */
export function createStoryFeedQueryOptions(
  sdk: CcPlatformSdk,
  opts?: Partial<
    FetchQueryOptions<
      StoryFeedResponse,
      Error,
      StoryFeedResponse,
      ReturnType<typeof queryKeys.stories.feed>
    >
  >,
): FetchQueryOptions<
  StoryFeedResponse,
  Error,
  StoryFeedResponse,
  ReturnType<typeof queryKeys.stories.feed>
> {
  return {
    queryKey: queryKeys.stories.feed(),
    queryFn: () => sdk.getStoryFeed(),
    staleTime: 30_000, // Stories change frequently, keep stale time short
    gcTime: 5 * 60 * 1000,
    ...opts,
  };
}

/**
 * Create query options for fetching the current user's own stories.
 *
 * Includes both active and expired/archived stories.
 *
 * @param sdk - The CC Platform SDK instance
 * @param opts - Optional overrides for query options
 * @returns Query options object for use with useQuery
 *
 * @category Query Helpers
 */
export function createMyStoriesQueryOptions(
  sdk: CcPlatformSdk,
  opts?: Partial<
    FetchQueryOptions<Story[], Error, Story[], ReturnType<typeof queryKeys.stories.mine>>
  >,
): FetchQueryOptions<Story[], Error, Story[], ReturnType<typeof queryKeys.stories.mine>> {
  return {
    queryKey: queryKeys.stories.mine(),
    queryFn: () => sdk.getMyStories(),
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    ...opts,
  };
}

/**
 * Create query options for fetching a specific user's active stories.
 *
 * Only returns non-expired stories visible to others.
 *
 * @param sdk - The CC Platform SDK instance
 * @param username - The username of the user
 * @param opts - Optional overrides for query options
 * @returns Query options object for use with useQuery
 *
 * @category Query Helpers
 */
export function createUserStoriesQueryOptions(
  sdk: CcPlatformSdk,
  username: string,
  opts?: Partial<
    FetchQueryOptions<Story[], Error, Story[], ReturnType<typeof queryKeys.stories.user>>
  >,
): FetchQueryOptions<Story[], Error, Story[], ReturnType<typeof queryKeys.stories.user>> {
  return {
    queryKey: queryKeys.stories.user(username),
    queryFn: () => sdk.getUserStories(username),
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    ...opts,
  };
}

/**
 * Create query options for fetching a single story by ULID.
 *
 * @param sdk - The CC Platform SDK instance
 * @param ulid - The story ULID
 * @param opts - Optional overrides for query options
 * @returns Query options object for use with useQuery
 *
 * @category Query Helpers
 */
export function createStoryQueryOptions(
  sdk: CcPlatformSdk,
  ulid: string,
  opts?: Partial<
    FetchQueryOptions<Story, Error, Story, ReturnType<typeof queryKeys.stories.detail>>
  >,
): FetchQueryOptions<Story, Error, Story, ReturnType<typeof queryKeys.stories.detail>> {
  return {
    queryKey: queryKeys.stories.detail(ulid),
    queryFn: () => sdk.getStory(ulid),
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    ...opts,
  };
}

/**
 * Prefetch the story feed into the query cache.
 *
 * Useful for prefetching stories when navigating to the home feed.
 *
 * @param sdk - The CC Platform SDK instance
 * @param queryClient - The TanStack QueryClient instance
 * @returns Promise that resolves when prefetch is complete
 *
 * @category Query Helpers
 */
export async function prefetchStoryFeed(
  sdk: CcPlatformSdk,
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.prefetchQuery(createStoryFeedQueryOptions(sdk));
}

/**
 * Prefetch a user's stories into the query cache.
 *
 * Useful for prefetching when hovering over a user's avatar in the story bar.
 *
 * @param sdk - The CC Platform SDK instance
 * @param queryClient - The TanStack QueryClient instance
 * @param username - The username of the user
 * @returns Promise that resolves when prefetch is complete
 *
 * @category Query Helpers
 */
export async function prefetchUserStories(
  sdk: CcPlatformSdk,
  queryClient: QueryClient,
  username: string,
): Promise<void> {
  await queryClient.prefetchQuery(createUserStoriesQueryOptions(sdk, username));
}
