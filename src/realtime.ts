/**
 * Real-time chat client for the CC Platform SDK.
 *
 * Wraps Laravel Echo + Pusher (pointed at the platform's **soketi** server,
 * which speaks the Pusher protocol) into a small, framework-agnostic client.
 * It mirrors the backend broadcast contract:
 *
 *   - Private channel `chat.{conversationUlid}` — event `message.sent`
 *     (payload {@link MessageSentEvent})
 *   - Private channel `user-{userUlid}` — event `chat.unread.updated`
 *     (payload {@link ChatUnreadCountUpdatedEvent})
 *
 * `laravel-echo` and `pusher-js` are loaded lazily via dynamic `import()` the
 * first time {@link RealtimeClient.connect} runs, so importing the SDK root does
 * not pull the WebSocket libraries into REST-only bundles.
 *
 * @example
 * ```typescript
 * const rt = createRealtimeClient({
 *   apiBaseUrl: "https://api.example.com",
 *   appKey: "soketi-app-key",
 *   wsHost: "s.closedcircuit.io",
 *   getToken: () => localStorage.getItem("auth_token"),
 * });
 * await rt.connect();
 *
 * rt.subscribeToChat(groupUlid, (evt) => {
 *   console.log("new message:", evt.message.body);
 * });
 *
 * rt.subscribeToUserChannel(myUserUlid, (evt) => {
 *   console.log("total unread:", evt.totalUnreadCount);
 * });
 * ```
 *
 * @module realtime
 * @category Realtime
 */

/**
 * Payload of the `message.sent` broadcast on `chat.{conversationUlid}`.
 *
 * @category Realtime
 */
export interface MessageSentEvent {
  /** ULID of the conversation the message belongs to */
  conversation_id: string;
  /** The sent message (or a `{ ulid, deleted: true }` tombstone on deletion) */
  message: {
    id?: number | string;
    ulid: string;
    body?: string;
    createdAt?: string;
    username?: string;
    user?: {
      userId: string;
      avatar?: string | null;
      name?: string | null;
    };
    attachments?: { url: string; type: "image" | "video" }[];
    /** Present and true when the message was deleted */
    deleted?: boolean;
  };
}

/**
 * Payload of the `chat.unread.updated` broadcast on `user-{userUlid}`.
 *
 * @category Realtime
 */
export interface ChatUnreadCountUpdatedEvent {
  /** ULID of the conversation whose unread count changed */
  conversationUlid: string;
  /** Unread count for that conversation */
  unreadCount: number;
  /** Total unread count across all conversations (badge counter) */
  totalUnreadCount: number;
}

/**
 * Configuration for {@link createRealtimeClient}.
 *
 * @category Realtime
 */
export interface RealtimeClientConfig {
  /** API base URL, used to build the `/broadcasting/auth` endpoint */
  apiBaseUrl: string;
  /** Soketi/Pusher app key */
  appKey: string;
  /** WebSocket host (e.g. `s.closedcircuit.io`) */
  wsHost: string;
  /** WebSocket port (default 443) */
  wsPort?: number;
  /** Secure WebSocket port (default = `wsPort`) */
  wssPort?: number;
  /** Pusher cluster (soketi ignores this; default "") */
  cluster?: string;
  /** Force TLS (default true) */
  forceTLS?: boolean;
  /** Returns the current bearer token used to authorize private channels */
  getToken: () => string | null | undefined;
  /** Override the broadcasting auth endpoint (default `${apiBaseUrl}/broadcasting/auth`) */
  authEndpoint?: string;
  /** Optional logger; defaults to no-op */
  logger?: (message: string, ...args: unknown[]) => void;
  /**
   * Optional factory that builds the Echo-like instance from the resolved
   * Pusher options. Lets advanced consumers reuse an existing Echo connection
   * (and lets tests inject a fake). When omitted, `laravel-echo` + `pusher-js`
   * are dynamically imported and wired with a bearer-token authorizer.
   */
  echoFactory?: (options: Record<string, unknown>) => unknown;
}

/** Minimal shape of an Echo channel we rely on. */
interface EchoChannel {
  listen(event: string, handler: (data: unknown) => void): EchoChannel;
  stopListening?(event: string): EchoChannel;
}

/** Minimal shape of the Echo instance we rely on. */
interface EchoLike {
  private(channel: string): EchoChannel;
  channel(channel: string): EchoChannel;
  leave(channel: string): void;
  disconnect(): void;
}

interface ChannelAuthData {
  auth: string;
  channel_data?: string;
}

/**
 * A connected real-time chat client. Create via {@link createRealtimeClient}.
 *
 * @category Realtime
 */
export class RealtimeClient {
  private echo: EchoLike | null = null;
  private connecting: Promise<void> | null = null;
  private readonly subscriptions = new Map<string, EchoChannel>();
  private readonly log: (message: string, ...args: unknown[]) => void;

  constructor(private readonly config: RealtimeClientConfig) {
    this.log = config.logger ?? (() => {});
  }

  /** True once the underlying Echo instance exists. */
  get isConnected(): boolean {
    return this.echo !== null;
  }

  private get authEndpoint(): string {
    return (
      this.config.authEndpoint ?? `${this.config.apiBaseUrl}/broadcasting/auth`
    );
  }

  /**
   * Establish the WebSocket connection. Lazily imports `laravel-echo` and
   * `pusher-js`. Idempotent and safe to await from multiple callers.
   */
  async connect(): Promise<void> {
    if (this.echo) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const wsPort = this.config.wsPort ?? 443;
      const authEndpoint = this.authEndpoint;
      const getToken = this.config.getToken;

      const options: Record<string, unknown> = {
        broadcaster: "pusher",
        key: this.config.appKey,
        cluster: this.config.cluster ?? "",
        wsHost: this.config.wsHost,
        wsPort,
        wssPort: this.config.wssPort ?? wsPort,
        forceTLS: this.config.forceTLS ?? true,
        encrypted: true,
        disableStats: true,
        enabledTransports: ["ws", "wss"],
        authorizer: (channel: { name: string }) => ({
          authorize: (
            socketId: string,
            callback: (
              error: Error | null,
              data: ChannelAuthData | null,
            ) => void,
          ) => {
            fetch(authEndpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Bearer ${getToken() ?? ""}`,
                Accept: "application/json",
                "X-Requested-With": "XMLHttpRequest",
              },
              body: new URLSearchParams({
                socket_id: socketId,
                channel_name: channel.name,
              }),
            })
              .then((res) => {
                if (!res.ok) {
                  throw new Error(`Authorization failed: ${res.status}`);
                }
                return res.json();
              })
              .then((data: ChannelAuthData) => callback(null, data))
              .catch((err: unknown) => {
                this.log("[Realtime] auth error", err);
                callback(err as Error, null);
              });
          },
        }),
      };

      if (this.config.echoFactory) {
        this.echo = this.config.echoFactory(options) as EchoLike;
      } else {
        const [{ default: Echo }, { default: Pusher }] = await Promise.all([
          import("laravel-echo"),
          import("pusher-js"),
        ]);
        options.Pusher = Pusher;
        // Echo's constructor has a heavily-overloaded option type; our options
        // object is built to match the pusher broadcaster at runtime.
        this.echo = new (Echo as unknown as new (
          opts: Record<string, unknown>,
        ) => unknown)(options) as EchoLike;
      }

      this.log("[Realtime] connected");
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Subscribe to new/deleted messages in a conversation.
   *
   * @param conversationUlid - The chat group ULID
   * @param handler - Called with each {@link MessageSentEvent}
   * @returns An unsubscribe function
   */
  subscribeToChat(
    conversationUlid: string,
    handler: (event: MessageSentEvent) => void,
  ): () => void {
    return this.subscribePrivate(`chat.${conversationUlid}`, {
      "message.sent": handler as (data: unknown) => void,
      ".message.sent": handler as (data: unknown) => void,
    });
  }

  /**
   * Subscribe to the current user's private channel for unread-count updates.
   *
   * @param userUlid - The current user's ULID
   * @param handler - Called with each {@link ChatUnreadCountUpdatedEvent}
   * @returns An unsubscribe function
   */
  subscribeToUserChannel(
    userUlid: string,
    handler: (event: ChatUnreadCountUpdatedEvent) => void,
  ): () => void {
    return this.subscribePrivate(`user-${userUlid}`, {
      "chat.unread.updated": handler as (data: unknown) => void,
      ".chat.unread.updated": handler as (data: unknown) => void,
    });
  }

  /**
   * Subscribe to a private channel with one or more event handlers.
   * Lower-level escape hatch behind {@link subscribeToChat} and
   * {@link subscribeToUserChannel}.
   *
   * @returns An unsubscribe function that leaves the channel.
   */
  subscribePrivate(
    channel: string,
    events: Record<string, (data: unknown) => void>,
  ): () => void {
    if (!this.echo) {
      this.log("[Realtime] not connected; call connect() first");
      return () => {};
    }

    let sub = this.subscriptions.get(channel);
    if (!sub) {
      sub = this.echo.private(channel);
      this.subscriptions.set(channel, sub);
    }
    for (const [event, handler] of Object.entries(events)) {
      sub.listen(event, handler);
    }

    return () => this.unsubscribe(channel);
  }

  /** Leave a channel and drop its subscription. */
  unsubscribe(channel: string): void {
    if (!this.subscriptions.has(channel)) return;
    try {
      this.echo?.leave(channel);
    } catch (err) {
      this.log("[Realtime] error leaving channel", channel, err);
    }
    this.subscriptions.delete(channel);
  }

  /** Leave all channels and tear down the connection. */
  disconnect(): void {
    for (const channel of this.subscriptions.keys()) {
      try {
        this.echo?.leave(channel);
      } catch {
        // ignore
      }
    }
    this.subscriptions.clear();
    try {
      this.echo?.disconnect();
    } catch {
      // ignore
    }
    this.echo = null;
  }
}

/**
 * Channel-name helpers mirroring the backend broadcast channels.
 *
 * @category Realtime
 */
export const realtimeChannels = {
  /** Private channel for a conversation's messages */
  chat: (conversationUlid: string) => `chat.${conversationUlid}`,
  /** Private channel for a user's unread-count + processing events */
  user: (userUlid: string) => `user-${userUlid}`,
} as const;

/**
 * Create a {@link RealtimeClient}. Call `connect()` (awaitable) before subscribing.
 *
 * @category Realtime
 */
export function createRealtimeClient(
  config: RealtimeClientConfig,
): RealtimeClient {
  return new RealtimeClient(config);
}
