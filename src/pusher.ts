/**
 * Pusher real-time integration for the CC Platform SDK.
 *
 * Handles subscribing to Pusher channels and processing incoming
 * PostResource events to keep the SDK cache up-to-date in real time.
 *
 * @module pusher
 * @category Real-time
 */
import Pusher, { type Channel } from "pusher-js";
import type { Post, Ulid } from "./types";

/**
 * Configuration for the Pusher real-time connection.
 * @category Real-time
 */
export interface PusherConfig {
  /** Pusher application key */
  appKey: string;
  /** Pusher cluster (e.g., "us2", "eu", "ap1") */
  cluster: string;
  /**
   * Auth endpoint for private/presence channels.
   * The SDK will append the access token as a Bearer header.
   */
  authEndpoint?: string;
  /** Whether to use encrypted (WSS) connection. Defaults to true. */
  forceTLS?: boolean;
  /** Additional Pusher options passed through to the Pusher constructor */
  pusherOptions?: Record<string, unknown>;
}

/**
 * The Pusher event name used when the server broadcasts a PostResource.
 * In Laravel this corresponds to the broadcastAs() value of the event.
 */
export type PusherEventName = string;

/**
 * Payload shape for a PostResource Pusher event.
 * The server wraps the PostResource in a `post` key (or sends it at the top level).
 */
export interface PostResourceEvent {
  /** The full post data, matching the v1/posts API response shape */
  post?: Post;
  /** Some servers send the data at top level (without a `post` wrapper) */
  [key: string]: unknown;
}

/**
 * Callback type for post events received via Pusher.
 * @category Real-time
 */
export type PostEventCallback = (post: Post) => void;

/**
 * Callback type for post deletion events.
 * @category Real-time
 */
export type PostDeletedCallback = (postUlid: Ulid) => void;

/**
 * Callback type for raw Pusher events (before processing).
 * @category Real-time
 */
export type RawEventCallback = (eventName: string, data: unknown) => void;

/**
 * Manages a Pusher connection and routes incoming PostResource events
 * to the SDK for cache updates.
 *
 * @example
 * ```typescript
 * const pusherManager = new PusherManager({
 *   appKey: 'your-pusher-key',
 *   cluster: 'us2',
 *   authEndpoint: 'https://api.example.com/broadcasting/auth',
 * });
 *
 * pusherManager.onPostReceived((post) => {
 *   console.log('New/updated post:', post.ulid, post.title);
 * });
 *
 * pusherManager.subscribe('posts');
 * ```
 *
 * @category Real-time
 */
export class PusherManager {
  private pusher: Pusher;
  private channels: Map<string, Channel> = new Map();
  private postReceivedCallbacks: PostEventCallback[] = [];
  private postDeletedCallbacks: PostDeletedCallback[] = [];
  private rawEventCallbacks: RawEventCallback[] = [];
  private getAuthToken: (() => string | null) | null = null;
  private enableLogging: boolean;

  /**
   * Default event names that the manager binds to on subscribed channels.
   * These match standard Laravel broadcast event names.
   */
  static readonly DEFAULT_POST_EVENTS = [
    "PostCreated",
    "PostUpdated",
    "PostResourceSent",
    ".PostCreated",
    ".PostUpdated",
    ".PostResourceSent",
  ];

  static readonly DEFAULT_DELETE_EVENTS = [
    "PostDeleted",
    ".PostDeleted",
  ];

  constructor(config: PusherConfig, options?: { enableLogging?: boolean }) {
    this.enableLogging = options?.enableLogging ?? false;

    const pusherOptions: Record<string, unknown> = {
      cluster: config.cluster,
      forceTLS: config.forceTLS ?? true,
      ...(config.pusherOptions ?? {}),
    };

    // If an auth endpoint is provided, configure channel authorization
    if (config.authEndpoint) {
      pusherOptions.channelAuthorization = {
        endpoint: config.authEndpoint,
        transport: "ajax" as const,
        headers: {},
      };
    }

    this.pusher = new Pusher(config.appKey, pusherOptions as any);

    this.pusher.connection.bind("connected", () => {
      this.log("[Pusher] Connected, socket ID:", this.pusher.connection.socket_id);
    });

    this.pusher.connection.bind("error", (err: unknown) => {
      this.log("[Pusher] Connection error:", err);
    });
  }

  /**
   * Set a function that provides the current auth token.
   * Used to inject Bearer tokens into private channel auth requests.
   */
  setAuthTokenProvider(getToken: () => string | null): void {
    this.getAuthToken = getToken;

    // Update the Pusher channel authorization headers dynamically
    const token = getToken();
    if (token && (this.pusher as any).config?.channelAuthorization) {
      (this.pusher as any).config.channelAuthorization.headers = {
        Authorization: `Bearer ${token}`,
      };
    }
  }

  /**
   * Subscribe to a Pusher channel and automatically bind PostResource event handlers.
   *
   * @param channelName - The channel to subscribe to (e.g., "posts", "private-user.{ulid}")
   * @param postEvents - Event names to bind for post create/update. Defaults to {@link DEFAULT_POST_EVENTS}.
   * @param deleteEvents - Event names to bind for post deletion. Defaults to {@link DEFAULT_DELETE_EVENTS}.
   * @returns The Pusher Channel instance
   */
  subscribe(
    channelName: string,
    postEvents?: string[],
    deleteEvents?: string[],
  ): Channel {
    // Re-inject auth token before subscribing (in case it was refreshed)
    if (this.getAuthToken) {
      const token = this.getAuthToken();
      if (token && (this.pusher as any).config?.channelAuthorization) {
        (this.pusher as any).config.channelAuthorization.headers = {
          Authorization: `Bearer ${token}`,
        };
      }
    }

    const existing = this.channels.get(channelName);
    if (existing) {
      this.log("[Pusher] Already subscribed to", channelName);
      return existing;
    }

    const channel = this.pusher.subscribe(channelName);
    this.channels.set(channelName, channel);

    // Bind post create/update events
    const events = postEvents ?? PusherManager.DEFAULT_POST_EVENTS;
    for (const eventName of events) {
      channel.bind(eventName, (data: unknown) => {
        this.log("[Pusher] Received event", eventName, "on", channelName);
        this.handlePostEvent(eventName, data);
      });
    }

    // Bind post deletion events
    const delEvents = deleteEvents ?? PusherManager.DEFAULT_DELETE_EVENTS;
    for (const eventName of delEvents) {
      channel.bind(eventName, (data: unknown) => {
        this.log("[Pusher] Received delete event", eventName, "on", channelName);
        this.handleDeleteEvent(eventName, data);
      });
    }

    this.log("[Pusher] Subscribed to", channelName, "with events:", [...events, ...delEvents]);
    return channel;
  }

  /**
   * Unsubscribe from a Pusher channel.
   *
   * @param channelName - The channel to unsubscribe from
   */
  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      this.pusher.unsubscribe(channelName);
      this.channels.delete(channelName);
      this.log("[Pusher] Unsubscribed from", channelName);
    }
  }

  /**
   * Unsubscribe from all channels.
   */
  unsubscribeAll(): void {
    for (const channelName of this.channels.keys()) {
      this.pusher.unsubscribe(channelName);
    }
    this.channels.clear();
  }

  /**
   * Register a callback for when a PostResource is received (created or updated).
   *
   * @param callback - Called with the normalized Post data
   * @returns Unsubscribe function
   */
  onPostReceived(callback: PostEventCallback): () => void {
    this.postReceivedCallbacks.push(callback);
    return () => {
      this.postReceivedCallbacks = this.postReceivedCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Register a callback for when a post deletion event is received.
   *
   * @param callback - Called with the deleted post's ULID
   * @returns Unsubscribe function
   */
  onPostDeleted(callback: PostDeletedCallback): () => void {
    this.postDeletedCallbacks.push(callback);
    return () => {
      this.postDeletedCallbacks = this.postDeletedCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Register a callback for all raw Pusher events (before SDK processing).
   * Useful for debugging or handling custom events.
   *
   * @param callback - Called with the event name and raw data
   * @returns Unsubscribe function
   */
  onRawEvent(callback: RawEventCallback): () => void {
    this.rawEventCallbacks.push(callback);
    return () => {
      this.rawEventCallbacks = this.rawEventCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Disconnect from Pusher entirely.
   * Cleans up all subscriptions and the WebSocket connection.
   */
  disconnect(): void {
    this.unsubscribeAll();
    this.pusher.disconnect();
    this.log("[Pusher] Disconnected");
  }

  /**
   * Get the underlying Pusher instance for advanced usage.
   */
  getPusherInstance(): Pusher {
    return this.pusher;
  }

  /**
   * Get the current connection state.
   */
  getConnectionState(): string {
    return this.pusher.connection.state;
  }

  /**
   * Extract Post data from a Pusher event payload.
   * Handles both `{ post: {...} }` wrapper and top-level post data.
   */
  static extractPost(data: unknown): Post | null {
    if (!data || typeof data !== "object") return null;

    const d = data as Record<string, unknown>;

    // Wrapped in { post: {...} } or { data: {...} }
    if (d.post && typeof d.post === "object") {
      return d.post as Post;
    }
    if (d.data && typeof d.data === "object") {
      return d.data as Post;
    }

    // Top-level post data (has ulid or id field)
    if (d.ulid || d.id) {
      return d as unknown as Post;
    }

    return null;
  }

  /**
   * Extract a post ULID from a deletion event payload.
   */
  static extractDeletedPostUlid(data: unknown): Ulid | null {
    if (!data || typeof data !== "object") return null;

    const d = data as Record<string, unknown>;
    return (d.postUlid ?? d.post_ulid ?? d.ulid ?? d.id ?? null) as Ulid | null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal
  // ──────────────────────────────────────────────────────────────────────────

  private handlePostEvent(eventName: string, data: unknown): void {
    // Fire raw callbacks first
    for (const cb of this.rawEventCallbacks) {
      try {
        cb(eventName, data);
      } catch (e) {
        this.log("[Pusher] Raw callback error:", e);
      }
    }

    const post = PusherManager.extractPost(data);
    if (!post) {
      this.log("[Pusher] Could not extract post from event data:", data);
      return;
    }

    this.log("[Pusher] Post received:", post.ulid ?? post.id, (post as any).title);

    for (const cb of this.postReceivedCallbacks) {
      try {
        cb(post);
      } catch (e) {
        this.log("[Pusher] Post callback error:", e);
      }
    }
  }

  private handleDeleteEvent(eventName: string, data: unknown): void {
    // Fire raw callbacks first
    for (const cb of this.rawEventCallbacks) {
      try {
        cb(eventName, data);
      } catch (e) {
        this.log("[Pusher] Raw callback error:", e);
      }
    }

    const ulid = PusherManager.extractDeletedPostUlid(data);
    if (!ulid) {
      this.log("[Pusher] Could not extract ulid from delete event:", data);
      return;
    }

    this.log("[Pusher] Post deleted:", ulid);

    for (const cb of this.postDeletedCallbacks) {
      try {
        cb(ulid);
      } catch (e) {
        this.log("[Pusher] Delete callback error:", e);
      }
    }
  }

  private log(...args: unknown[]): void {
    if (this.enableLogging) {
      console.log(...args);
    }
  }
}
