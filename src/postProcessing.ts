/**
 * Post-processing watcher.
 *
 * After a post is created, the API does background work (transcoding,
 * thumbnail extraction, OG fetch). The post object carries `isProcessing`
 * which flips to `false` when work finishes. This module provides a
 * `watchPostProcessing` helper that races two transports:
 *
 *  1. Backoff polling of `getPostByUlid(ulid, true)`.
 *  2. An external completion signal (e.g. a Pusher event the host app
 *     feeds in by calling `markComplete()` on the returned handle).
 *
 * Whichever fires first wins; the other path is cancelled. Idempotent —
 * `markComplete()` after `onDone` already fired is a no-op. AbortSignal
 * is honored at every await point.
 *
 * @module postProcessing
 * @category Posts
 */

import type { Post } from "./types";

/**
 * Per-call options for {@link watchPostProcessing}.
 *
 * @category Posts
 */
export interface WatchPostProcessingOptions {
  /** Backoff schedule in ms. Default `[5_000, 10_000, 20_000, 40_000, 60_000]`. */
  schedule?: number[];
  /** Steady poll interval after the schedule is exhausted. Default `60_000`. */
  steadyInterval?: number;
  /** Hard cap before giving up. Default 30 minutes. */
  maxTotalMs?: number;
  /** Cancels polling when aborted. */
  signal?: AbortSignal;
  /** Called once when processing finishes (or a final post snapshot is available). */
  onDone?: (post: Post | null) => void;
  /** Called for each non-fatal error during polling (network drops etc). */
  onError?: (err: Error) => void;
}

/**
 * Handle returned by {@link watchPostProcessing}. Use `markComplete` to
 * fast-resolve when an external signal (websocket event, push) confirms
 * processing is finished.
 *
 * @category Posts
 */
export interface PostProcessingWatcher {
  /** The ulid being watched. */
  readonly ulid: string;
  /** Resolves when the watcher has settled (done or aborted). */
  readonly settled: Promise<void>;
  /** Force-resolve from an external signal. Idempotent. */
  markComplete(post?: Post | null): void;
  /** Cancel the watch without firing onDone. */
  stop(): void;
  /** True once onDone fired or stop() was called. */
  readonly isSettled: boolean;
}

/**
 * Minimal post-fetcher contract. Lets watchPostProcessing be tested
 * without a full SDK and lets consumers swap the network layer.
 *
 * @category Posts
 */
export interface PostFetcher {
  getPostByUlid(ulid: string, forceRefresh?: boolean): Promise<Post | null>;
}

const DEFAULT_SCHEDULE = [5_000, 10_000, 20_000, 40_000, 60_000];
const DEFAULT_STEADY_INTERVAL = 60_000;
const DEFAULT_MAX_TOTAL_MS = 30 * 60 * 1000;

function delayForAttempt(
  attempts: number,
  schedule: number[],
  steady: number,
): number {
  return attempts < schedule.length ? schedule[attempts] : steady;
}

/**
 * Watch a post until it stops processing.
 *
 * Returns a {@link PostProcessingWatcher} handle. Call `markComplete()`
 * from your realtime layer (Pusher, push notification, etc.) to fast-clear
 * before the next poll tick.
 *
 * @category Posts
 *
 * @example
 * ```typescript
 * const watcher = watchPostProcessing(sdk, "01H...", {
 *   onDone: (post) => store.remove(watcher.ulid),
 * });
 *
 * pusher.on("PostProcessingComplete", (e) => {
 *   if (e.ulid === watcher.ulid) watcher.markComplete();
 * });
 * ```
 */
export function watchPostProcessing(
  fetcher: PostFetcher,
  ulid: string,
  options: WatchPostProcessingOptions = {},
): PostProcessingWatcher {
  const schedule = options.schedule ?? DEFAULT_SCHEDULE;
  const steady = options.steadyInterval ?? DEFAULT_STEADY_INTERVAL;
  const maxTotal = options.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;
  const signal = options.signal;

  const startedAt = Date.now();
  let attempts = 0;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveSettled!: () => void;
  const settledPromise = new Promise<void>((res) => {
    resolveSettled = res;
  });

  const finalize = (post: Post | null, fireOnDone: boolean): void => {
    if (settled) return;
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (fireOnDone) {
      try {
        options.onDone?.(post);
      } catch (err) {
        options.onError?.(err as Error);
      }
    }
    resolveSettled();
  };

  const onAbort = (): void => {
    finalize(null, false);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const handle: PostProcessingWatcher = {
    ulid,
    get settled() {
      return settledPromise;
    },
    get isSettled() {
      return settled;
    },
    markComplete(post: Post | null = null): void {
      finalize(post, true);
    },
    stop(): void {
      finalize(null, false);
    },
  };

  if (signal?.aborted) {
    finalize(null, false);
    return handle;
  }

  const tick = async (): Promise<void> => {
    if (settled) return;
    if (Date.now() - startedAt > maxTotal) {
      finalize(null, true);
      return;
    }
    try {
      const post = await fetcher.getPostByUlid(ulid, true);
      if (settled) return;
      if (post && post.isProcessing !== true) {
        finalize(post, true);
        return;
      }
    } catch (err) {
      if (settled) return;
      options.onError?.(err as Error);
    }
    if (settled) return;
    const delay = delayForAttempt(attempts, schedule, steady);
    attempts++;
    timer = setTimeout(() => {
      void tick();
    }, delay);
  };

  // First poll runs after the first scheduled delay (so a freshly created
  // post that's clearly still processing isn't hammered immediately).
  const firstDelay = delayForAttempt(attempts, schedule, steady);
  attempts++;
  timer = setTimeout(() => {
    void tick();
  }, firstDelay);

  return handle;
}
