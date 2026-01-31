/**
 * IndexedDB (Dexie) persistence utilities for TanStack Query.
 *
 * This module provides a persister implementation that stores TanStack Query
 * client state in IndexedDB via the CacheDB class, enabling offline-first
 * applications to restore query cache across sessions.
 *
 * @example
 * ```typescript
 * import { createDexieQueryPersister } from '@social/cc-platform-sdk';
 * import { persistQueryClient } from '@tanstack/query-persist-client-core';
 *
 * const cache = new CacheDB();
 * const persister = createDexieQueryPersister(cache);
 *
 * persistQueryClient({
 *   queryClient,
 *   persister,
 * });
 * ```
 *
 * @module persister
 * @category Persistence
 */
import { CacheDB } from "./cache/cacheDB";

/** Default storage key for persisted query client state */
const DEFAULT_KEY = "queryClient";
/** Default max age for cached state (1 hour) */
const DEFAULT_MAX_AGE = 1000 * 60 * 60; // 1h

/**
 * Shape of a TanStack Query persister.
 *
 * Implements the interface expected by @tanstack/query-persist-client-core.
 *
 * @category Persistence
 */
export interface QueryPersisterShape {
  /** Persist the query client state to storage */
  persistClient: (client: any) => Promise<void>;
  /** Restore the query client state from storage */
  restoreClient: () => Promise<any | undefined>;
  /** Remove the persisted query client state */
  removeClient: () => Promise<void>;
}

/**
 * Create a Dexie-backed persister for TanStack Query.
 *
 * This persister stores serialized query client state in IndexedDB via CacheDB,
 * enabling offline-first applications to restore query cache across browser sessions.
 *
 * @param cache - The CacheDB instance to use for storage
 * @param options - Optional configuration
 * @param options.key - Storage key for the persisted state (default: 'queryClient')
 * @param options.maxAge - Maximum age in milliseconds before cache expires (default: 1 hour)
 * @returns A persister object compatible with TanStack Query persist plugins
 *
 * @example
 * ```typescript
 * import { createDexieQueryPersister, CacheDB } from '@social/cc-platform-sdk';
 * import { persistQueryClient } from '@tanstack/query-persist-client-core';
 *
 * const cache = new CacheDB();
 * const persister = createDexieQueryPersister(cache, {
 *   key: 'myApp-queryClient',
 *   maxAge: 24 * 60 * 60 * 1000, // 24 hours
 * });
 *
 * // Use with React Query
 * persistQueryClient({
 *   queryClient,
 *   persister,
 * });
 * ```
 *
 * @category Persistence
 */
export function createDexieQueryPersister(
  cache: CacheDB,
  options?: { key?: string; maxAge?: number },
): QueryPersisterShape {
  const key = options?.key ?? DEFAULT_KEY;
  const maxAge = options?.maxAge ?? DEFAULT_MAX_AGE;

  return {
    persistClient: async (client: any) => {
      await cache.setMetadata(key, {
        timestamp: Date.now(),
        client,
      });
    },
    restoreClient: async (): Promise<any | undefined> => {
      const stored = await cache.getMetadata<{ timestamp: number; client: any }>(key);
      if (!stored) return undefined;

      if (Date.now() - stored.timestamp > maxAge) {
        return undefined;
      }

      return stored.client;
    },
    removeClient: async () => {
      await cache.setMetadata(key, null);
    },
  };
}
