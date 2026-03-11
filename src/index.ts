/**
 * # CC Platform SDK
 *
 * A cache-aware SDK for the CC Platform API, built with Dexie (IndexedDB) and TanStack Query core.
 *
 * ## Features
 *
 * - **Offline-first caching** - All data cached in IndexedDB via Dexie
 * - **Smart cache invalidation** - Automatic cache management with configurable TTLs
 * - **TanStack Query integration** - Built-in query/mutation patterns
 * - **Type-safe** - Full TypeScript support with comprehensive type definitions
 * - **Authentication** - Multiple auth methods (OAuth, magic link, traditional login)
 *
 * ## Quick Start
 *
 * ```typescript
 * import { CcPlatformSdk, StorageTokenProvider } from '@cc-consulting-nv/ccsdk';
 *
 * const tokenProvider = new StorageTokenProvider(localStorage);
 * const sdk = new CcPlatformSdk({
 *   baseUrl: 'https://api.example.com',
 *   tokenProvider,
 * });
 *
 * // Fetch user profile
 * const profile = await sdk.getUserProfile('user-ulid');
 *
 * // Fetch feed
 * const feed = await sdk.fetchTrendingFeed();
 * ```
 *
 * @packageDocumentation
 * @module @social/cc-platform-sdk
 */

export * from "./types";
export * from "./types/crm";
export * from "./types/business";
export * from "./httpClient";
export * from "./cache/cacheDB";
export * from "./platformSdk";
export * from "./query";
export * from "./auth";
export * from "./persister";
export * from "./multipartUpload";
