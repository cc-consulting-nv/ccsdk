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
 * @module @cc-consulting-nv/ccsdk
 */

export * from "./types.js";
export * from "./types/business.js";
export * from "./httpClient.js";
export * from "./cache/cacheDB.js";
export * from "./cache/cacheAdapter.js";
export * from "./platformSdk.js";
export * from "./sessionManager.js";
export * from "./query.js";
export * from "./realtime.js";
export * from "./auth.js";
export * from "./persister.js";
export * from "./multipartUpload.js";
export * from "./blobStore.js";
export * from "./postProcessing.js";
export * from "./media.js";
export * from "./platform/connectivity.js";
