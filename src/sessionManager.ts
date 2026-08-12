/**
 * Multi-profile session management.
 *
 * Keeps several fully authenticated accounts signed in at once and swaps the
 * active one, Facebook/Instagram style. Each signed-in account gets its **own**
 * {@link CcPlatformSdk} instance, its own token storage, and its own IndexedDB
 * cache database.
 *
 * ## Why one instance per account
 *
 * A `CcPlatformSdk` instance is single-session by construction: tokens, the
 * refresh coordinator, the sign-out epoch, the cross-tab channel, and every
 * batch/dedup queue belong to one session. The cache is single-viewer too —
 * `posts` and `users` rows embed viewer-specific engagement (`liked`,
 * `bookmarked`, `userReaction`, follow/block/mute), and feed routes are keyed by
 * bare strings like `"bookmarks"`. Giving each account its own instance and its
 * own `dbName` makes cross-account isolation structural rather than something
 * every call site has to remember.
 *
 * ## Scope
 *
 * This manager owns the profile *registry* (add / list / switch / remove,
 * display metadata, the active pointer, cross-tab sync). It deliberately does
 * **not** own policy: maximum profile counts, badge/role gating, and
 * encryption-at-rest are the consuming app's decisions. Encryption belongs in
 * the {@link SessionManagerOptions.createSessionStore} factory.
 *
 * This is **not** acting-context / delegation (`setActingContext`), which keeps
 * one authenticated manager acting on a managed user's behalf.
 *
 * @example
 * ```typescript
 * const sessions = new SessionManager({
 *   baseUrl: "https://api.example.com",
 *   createSessionStore: (profileId) => createEncryptedStore(profileId),
 * });
 *
 * await sessions.ready();
 *
 * // Add an account — drive any auth flow you like into the staged instance.
 * await sessions.addProfile((sdk) => sdk.login(email, password));
 *
 * // Render the switcher
 * for (const p of sessions.list()) {
 *   console.log(p.displayName, p.isActive, p.isTokenExpired);
 * }
 *
 * // Swap the whole app identity
 * const sdk = await sessions.switchTo(otherUlid);
 * ```
 *
 * @module sessionManager
 * @category Authentication
 */

import { CcPlatformSdk, type CcPlatformSdkOptions } from "./platformSdk.js";
import { DEFAULT_DB_NAME } from "./cache/cacheDB.js";
import { MemoryTokenProvider, type SessionStore, type StorageLike } from "./auth.js";
import type { AuthTokens } from "./types.js";

/** Registry key used by the default localStorage-backed registry store. */
const DEFAULT_REGISTRY_KEY = "cc_profile_registry";

/**
 * A signed-in account as persisted in the registry.
 *
 * Deliberately carries **no tokens** — those live in the per-profile
 * {@link SessionStore}. This record is display metadata plus bookkeeping, so it
 * is safe to persist somewhere unencrypted.
 *
 * @category Authentication
 */
export interface ProfileRecord {
  /** The account's user ULID. Doubles as the profile's stable identity. */
  ulid: string;
  /** Username (handle) for the switcher UI. */
  username?: string;
  /** Display name for the switcher UI. */
  displayName?: string;
  /** Avatar URL for the switcher UI. */
  avatarUrl?: string;
  /** When this account was added (epoch ms). */
  addedAt: number;
  /** When this account was last the active profile (epoch ms). */
  lastActiveAt: number;
  /** Access-token expiry (ISO 8601) as last observed, when known. */
  tokenExpiresAt?: string;
  /** Set when a refresh definitively failed and the user must sign in again. */
  needsReauth?: boolean;
}

/**
 * A {@link ProfileRecord} decorated with derived state for rendering.
 *
 * @category Authentication
 */
export interface ProfileListItem extends ProfileRecord {
  /** True for the currently active profile. */
  isActive: boolean;
  /** True when this profile needs re-authentication before it can be used. */
  isTokenExpired: boolean;
}

/**
 * Persisted registry shape: the known accounts plus the active pointer.
 *
 * @category Authentication
 */
export interface ProfileRegistrySnapshot {
  profiles: ProfileRecord[];
  activeUlid: string | null;
}

/**
 * Persistence for the profile registry.
 *
 * Contains no secrets, so the default localStorage implementation is fine.
 * Supply your own to move it into IndexedDB or native storage.
 *
 * @category Authentication
 */
export interface ProfileRegistryStore {
  load(): Promise<ProfileRegistrySnapshot | null>;
  save(snapshot: ProfileRegistrySnapshot): Promise<void>;
}

/**
 * Per-profile SDK configuration. `baseUrl` and everything that must be unique
 * per account (token provider, session store, cache database) are owned by the
 * manager and therefore excluded.
 *
 * `storage` is deliberately NOT excluded: React Native has no `localStorage`,
 * so consumers must be able to inject one backend for every profile. Keys that
 * would otherwise collide across profiles are namespaced by `dbName`, which the
 * manager makes unique per account.
 *
 * @category Authentication
 */
export type SharedSdkOptions = Omit<
  CcPlatformSdkOptions,
  "baseUrl" | "tokens" | "tokenProvider" | "sessionStore" | "cache" | "dbName"
>;

/**
 * Configuration for {@link SessionManager}.
 *
 * @category Authentication
 */
export interface SessionManagerOptions {
  /** API server URL, shared by every profile. */
  baseUrl: string;
  /**
   * Builds the token persistence for one profile. Called once per account with
   * that account's ULID. **This is the encryption-at-rest boundary** — whatever
   * this returns is where tokens land, so wrap it if the platform requires
   * encrypted storage. Keys must be namespaced by `profileId`, or accounts will
   * overwrite each other.
   */
  createSessionStore: (profileId: string) => SessionStore;
  /**
   * Prefix for each profile's IndexedDB cache database. The final name is
   * `${dbNamePrefix}:${userUlid}`. Default: `"CcPlatformSdkCache"`.
   */
  dbNamePrefix?: string;
  /** Registry persistence. Default: localStorage when available, else memory. */
  registryStore?: ProfileRegistryStore;
  /** Options applied to every per-profile SDK instance. */
  sdkOptions?: SharedSdkOptions;
  /**
   * Called when a profile's refresh definitively fails. The profile is marked
   * `needsReauth` before this fires; other profiles are unaffected.
   */
  onProfileUnauthorized?: (profileUlid: string) => void;
  /**
   * Disable cross-tab active-profile sync. By default a switch in one tab is
   * followed by the others, since the registry is shared storage.
   */
  disableCrossTabSync?: boolean;
}

/**
 * localStorage-backed {@link ProfileRegistryStore}.
 *
 * @param storage - Web Storage implementation (localStorage/sessionStorage)
 * @param key - Storage key (default `"cc_profile_registry"`)
 * @category Authentication
 */
export function createStorageProfileRegistry(
  storage: StorageLike,
  key: string = DEFAULT_REGISTRY_KEY,
): ProfileRegistryStore {
  return {
    async load() {
      const raw = storage.getItem(key);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as ProfileRegistrySnapshot;
        if (!parsed || !Array.isArray(parsed.profiles)) return null;
        return {
          profiles: parsed.profiles.filter((p) => typeof p?.ulid === "string"),
          activeUlid: typeof parsed.activeUlid === "string" ? parsed.activeUlid : null,
        };
      } catch {
        // Corrupt registry is treated as empty rather than wedging startup.
        return null;
      }
    },
    async save(snapshot) {
      storage.setItem(key, JSON.stringify(snapshot));
    },
  };
}

/** Non-persistent registry, used when no storage is available. */
function createMemoryProfileRegistry(): ProfileRegistryStore {
  let snapshot: ProfileRegistrySnapshot | null = null;
  return {
    async load() {
      return snapshot;
    },
    async save(next) {
      snapshot = next;
    },
  };
}

/**
 * Coordinates several concurrently signed-in accounts and exposes the active
 * one's {@link CcPlatformSdk}.
 *
 * All mutating methods resolve only after the registry has been persisted, so
 * awaiting them is enough to know a reload will see the same state.
 *
 * @category Authentication
 */
export class SessionManager {
  private readonly dbNamePrefix: string;
  private readonly registry: ProfileRegistryStore;
  private readonly instances = new Map<string, CcPlatformSdk>();
  private readonly subscribers = new Set<(profiles: ProfileListItem[]) => void>();

  private profiles: ProfileRecord[] = [];
  private activeUlid: string | null = null;

  private readyPromise: Promise<void> | null = null;
  private channel: BroadcastChannel | null = null;

  /**
   * Serializes {@link addProfile}. The staging instance uses a fixed cache
   * database name, so two concurrent adds would otherwise share it.
   */
  private stagingLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: SessionManagerOptions) {
    this.dbNamePrefix = options.dbNamePrefix ?? DEFAULT_DB_NAME;
    this.registry =
      options.registryStore ??
      (typeof localStorage !== "undefined"
        ? createStorageProfileRegistry(localStorage)
        : createMemoryProfileRegistry());

    if (!options.disableCrossTabSync && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`cc-platform-sdk:profiles:${this.dbNamePrefix}`);
      this.channel.onmessage = (event: MessageEvent) => {
        if ((event?.data as { type?: string } | undefined)?.type === "sync") {
          void this.syncFromRegistry();
        }
      };
      // Don't keep a Node process alive just for the channel. No-op in browsers.
      const ch = this.channel as unknown as { unref?: () => void };
      if (typeof ch.unref === "function") ch.unref();
    }
  }

  // ---------------------------------------------------------------------------
  // Reading state
  // ---------------------------------------------------------------------------

  /**
   * Restore the registry and bring the last active profile's session up.
   *
   * Idempotent and never rejects for a missing/expired session — a failed
   * restore simply leaves {@link active} null. Await this before reading
   * {@link active} on app start.
   */
  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.restore().catch(() => undefined);
    }
    return this.readyPromise;
  }

  /** The active profile's SDK, or null when no account is signed in. */
  get active(): CcPlatformSdk | null {
    if (!this.activeUlid) return null;
    return this.instances.get(this.activeUlid) ?? null;
  }

  /** ULID of the active profile, or null. */
  get activeProfileUlid(): string | null {
    return this.activeUlid;
  }

  /**
   * Every signed-in account, most recently active first. Feed this to the
   * switcher UI.
   */
  list(): ProfileListItem[] {
    return this.profiles
      .map((record) => this.decorate(record))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /** A single profile by ULID, or null when it is not signed in. */
  get(profileUlid: string): ProfileListItem | null {
    const record = this.profiles.find((p) => p.ulid === profileUlid);
    return record ? this.decorate(record) : null;
  }

  /**
   * Observe registry changes (add, remove, switch, re-auth, cross-tab sync).
   * Fires immediately with the current list.
   *
   * @returns An unsubscribe function
   */
  subscribe(listener: (profiles: ProfileListItem[]) => void): () => void {
    this.subscribers.add(listener);
    try {
      listener(this.list());
    } catch {
      // A throwing subscriber must not break registration.
    }
    return () => {
      this.subscribers.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Authenticate an additional account and make it active, leaving existing
   * sessions signed in.
   *
   * The callback receives a staged, unauthenticated SDK; drive whatever auth
   * flow you need into it (password, magic link, OAuth, passkey). The manager
   * reads the resulting tokens, resolves the account's identity, and moves the
   * session into that profile's own storage and cache.
   *
   * Adding an account that is already signed in re-installs the fresh tokens
   * and switches to it, which is also how you recover a `needsReauth` profile.
   *
   * @param login - Drives an auth flow against the staged SDK
   * @returns The added (now active) profile
   * @throws If the flow produced no access token, or the identity could not be
   *   resolved. The registry is left untouched in both cases.
   *
   * @example Migrating an existing single-session app to the switcher
   * ```typescript
   * await sessions.addProfile((sdk) => sdk.setSession(legacyTokens));
   * ```
   */
  async addProfile(login: (sdk: CcPlatformSdk) => Promise<unknown>): Promise<ProfileListItem> {
    await this.ready();

    const run = async (): Promise<ProfileListItem> => {
      const staged = await this.stageLogin(login);
      const { tokens, ulid } = staged;

      const now = this.nextActiveStamp();
      const existing = this.profiles.find((p) => p.ulid === ulid);
      const sdk = this.instanceFor(ulid);
      await sdk.setSession(tokens);

      if (existing) {
        existing.username = staged.username ?? existing.username;
        existing.displayName = staged.displayName ?? existing.displayName;
        existing.avatarUrl = staged.avatarUrl ?? existing.avatarUrl;
        existing.lastActiveAt = now;
        existing.needsReauth = false;
        existing.tokenExpiresAt = tokens.expiresAt;
      } else {
        this.profiles.push({
          ulid,
          username: staged.username,
          displayName: staged.displayName,
          avatarUrl: staged.avatarUrl,
          addedAt: now,
          lastActiveAt: now,
          tokenExpiresAt: tokens.expiresAt,
        });
      }

      this.activeUlid = ulid;
      await this.persist();
      return this.get(ulid)!;
    };

    const attempt = this.stagingLock.then(run, run);
    // Keep the chain alive regardless of this attempt's outcome.
    this.stagingLock = attempt.catch(() => undefined);
    return attempt;
  }

  /**
   * Make another signed-in account active.
   *
   * Restores that profile's session (refreshing an expired access token when it
   * can) before resolving, so the returned SDK is ready to use.
   *
   * @param profileUlid - ULID of the profile to activate
   * @returns That profile's SDK
   * @throws If the profile is not signed in
   */
  async switchTo(profileUlid: string): Promise<CcPlatformSdk> {
    await this.ready();

    const record = this.profiles.find((p) => p.ulid === profileUlid);
    if (!record) {
      throw new Error(`Cannot switch to unknown profile: ${profileUlid}`);
    }

    const sdk = this.instanceFor(profileUlid);
    await sdk.ready();

    record.lastActiveAt = this.nextActiveStamp();
    this.syncTokenState(record, sdk);
    this.activeUlid = profileUlid;
    await this.persist();

    return sdk;
  }

  /**
   * Sign one account out and drop it from the registry.
   *
   * Revokes that session server-side, clears its tokens, and wipes **only its
   * own** cache database. Other profiles stay signed in. If the removed profile
   * was active, the next most recently active one becomes active; removing the
   * last profile leaves no active profile.
   *
   * Unknown ULIDs are a no-op.
   */
  async remove(profileUlid: string): Promise<void> {
    await this.ready();

    if (!this.profiles.some((p) => p.ulid === profileUlid)) return;

    const sdk = this.instanceFor(profileUlid);
    try {
      // Restore first so there is a live token to revoke.
      await sdk.ready();
      await sdk.logout();
    } catch {
      // Revocation is best-effort — an expired or offline session must still be
      // removable. Clear local state directly so nothing is left behind.
      try {
        await sdk.clearSession();
      } catch {
        // Store unavailable; in-memory tokens were cleared regardless.
      }
      try {
        await sdk.clearCache();
      } catch {
        // Cache unavailable; nothing to wipe.
      }
    } finally {
      // Never let teardown abort the removal — the record must come out of the
      // registry either way, or the profile is stuck in the switcher forever.
      await sdk.dispose().catch(() => undefined);
      this.instances.delete(profileUlid);
    }

    // Re-resolve the index: teardown above awaits, and a concurrent remove()
    // can splice this array in the meantime. An index captured before those
    // awaits would point at the wrong profile, or past the end — leaving the
    // profile signed out but still listed, and still selectable as active.
    const index = this.profiles.findIndex((p) => p.ulid === profileUlid);
    if (index !== -1) this.profiles.splice(index, 1);

    if (this.activeUlid === profileUlid) {
      const next = this.list()[0] ?? null;
      this.activeUlid = next?.ulid ?? null;
      if (this.activeUlid) {
        try {
          await this.instanceFor(this.activeUlid).ready();
        } catch {
          // Fall through — the new active profile will read as unauthenticated.
        }
      }
    }

    await this.persist();
  }

  /** Sign every account out and empty the registry. */
  async signOutAll(): Promise<void> {
    await this.ready();
    for (const ulid of this.profiles.map((p) => p.ulid)) {
      await this.remove(ulid);
    }
  }

  /**
   * Release every profile's resources and stop cross-tab sync. Call when
   * discarding the manager (HMR, tests, teardown). Does not sign anyone out.
   */
  async dispose(): Promise<void> {
    if (this.channel) {
      this.channel.onmessage = null;
      try {
        this.channel.close();
      } catch {
        // Already closed.
      }
      this.channel = null;
    }
    this.subscribers.clear();
    const instances = [...this.instances.values()];
    this.instances.clear();
    await Promise.all(instances.map((sdk) => sdk.dispose().catch(() => undefined)));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Load the registry and bring the persisted active profile's session up. */
  private async restore(): Promise<void> {
    const snapshot = await this.registry.load();
    this.profiles = snapshot?.profiles ?? [];
    this.activeUlid = snapshot?.activeUlid ?? null;

    if (this.activeUlid && !this.profiles.some((p) => p.ulid === this.activeUlid)) {
      // Active pointer outlived its record.
      this.activeUlid = this.list()[0]?.ulid ?? null;
    }

    if (this.activeUlid) {
      const sdk = this.instanceFor(this.activeUlid);
      try {
        await sdk.ready();
      } catch {
        // Guest state; the caller sees an unauthenticated SDK.
      }
      const record = this.profiles.find((p) => p.ulid === this.activeUlid);
      if (record) this.syncTokenState(record, sdk);
    }

    this.notify();
  }

  /**
   * Re-read the registry after another tab changed it, following the active
   * profile so every tab agrees on who is signed in.
   */
  private async syncFromRegistry(): Promise<void> {
    const snapshot = await this.registry.load();
    if (!snapshot) return;

    const previousActive = this.activeUlid;
    this.profiles = snapshot.profiles;
    this.activeUlid = snapshot.activeUlid;

    // Drop instances for profiles another tab removed.
    for (const [ulid, sdk] of [...this.instances]) {
      if (!this.profiles.some((p) => p.ulid === ulid)) {
        this.instances.delete(ulid);
        void sdk.dispose().catch(() => undefined);
      }
    }

    if (this.activeUlid && this.activeUlid !== previousActive) {
      try {
        await this.instanceFor(this.activeUlid).ready();
      } catch {
        // Guest state.
      }
    }

    this.notify();
  }

  /**
   * Run an auth flow against a throwaway SDK and resolve the resulting identity.
   *
   * The account's ULID is only knowable *after* authenticating, but a profile's
   * token store and cache database are both named from that ULID — hence the
   * staging instance. Nothing is written to the registry here, so a failed flow
   * leaves no partial profile behind.
   */
  private async stageLogin(login: (sdk: CcPlatformSdk) => Promise<unknown>): Promise<{
    tokens: AuthTokens;
    ulid: string;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
  }> {
    const staging = this.createStagingSdk();
    try {
      await login(staging);

      const tokens = staging.getTokens();
      if (!tokens?.accessToken) {
        throw new Error("Add profile failed: the auth flow produced no access token");
      }

      const user = await staging.getCurrentUser();
      if (!user?.ulid) {
        throw new Error("Add profile failed: could not resolve the account identity");
      }

      return {
        tokens,
        ulid: user.ulid,
        username: user.username,
        displayName: user.displayName ?? user.name,
        avatarUrl: user.avatarUrl ?? user.avatar,
      };
    } finally {
      // The staged instance shares one cache database across every add, so wipe
      // it before releasing the lock.
      try {
        await staging.clearCache();
      } catch {
        // Nothing cached, or the database is unavailable.
      }
      await staging.dispose();
    }
  }

  /**
   * Build the throwaway SDK an {@link addProfile} auth flow runs against.
   *
   * Both auth callbacks are deliberately suppressed. A 401 here is *this add's*
   * failure — reported by the rejected promise — not a session expiry. Were the
   * app's `onUnauthorized` allowed to run, mistyping a password while adding a
   * second account would sign the user out of the account they are already
   * using, because that handler typically clears storage and redirects to login.
   */
  private createStagingSdk(): CcPlatformSdk {
    return new CcPlatformSdk({
      ...(this.options.sdkOptions ?? {}),
      baseUrl: this.options.baseUrl,
      tokenProvider: new MemoryTokenProvider(),
      sessionStore: undefined,
      dbName: `${this.dbNamePrefix}:staging`,
      onRefreshTokens: undefined,
      onUnauthorized: undefined,
    });
  }

  /** Build the SDK that owns one account's session. */
  private createProfileSdk(profileUlid: string): CcPlatformSdk {
    const shared = this.options.sdkOptions ?? {};

    // The refresh handler needs the instance it belongs to, which does not exist
    // until the constructor returns. It only runs on a later 401, so resolving
    // through this holder is always populated by then.
    const holder: { sdk?: CcPlatformSdk } = {};

    const instance = new CcPlatformSdk({
      ...shared,
      baseUrl: this.options.baseUrl,
      // Explicit memory provider: the default HybridTokenProvider writes to a
      // single shared `refresh_token` localStorage key, so profiles would
      // clobber each other. Persistence is the per-profile session store's job.
      tokenProvider: new MemoryTokenProvider(),
      sessionStore: this.options.createSessionStore(profileUlid),
      dbName: `${this.dbNamePrefix}:${profileUlid}`,
      onRefreshTokens:
        shared.onRefreshTokens ??
        (async () => {
          const refreshed = await holder.sdk?.refreshToken();
          if (!refreshed?.accessToken) {
            throw new Error("Token refresh failed");
          }
          return refreshed;
        }),
      onUnauthorized: async () => {
        const record = this.profiles.find((p) => p.ulid === profileUlid);
        if (record && !record.needsReauth) {
          record.needsReauth = true;
          await this.persist();
        }
        this.options.onProfileUnauthorized?.(profileUlid);

        // Only the account the user is actually using may trigger the app's
        // global unauthorized handling. A background profile going stale must
        // not sign the user out of the active one — it is flagged for re-auth
        // in the switcher instead.
        if (profileUlid === this.activeUlid) {
          await shared.onUnauthorized?.();
        }
      },
    });

    holder.sdk = instance;
    return instance;
  }

  /** Memoized per-profile SDK instance. */
  private instanceFor(profileUlid: string): CcPlatformSdk {
    let sdk = this.instances.get(profileUlid);
    if (!sdk) {
      sdk = this.createProfileSdk(profileUlid);
      this.instances.set(profileUlid, sdk);
    }
    return sdk;
  }

  /**
   * A strictly-increasing "last active" stamp. Two profile changes can land in
   * the same millisecond, which would make {@link list} ordering — and therefore
   * the rendered switcher and the auto-switch target — non-deterministic.
   */
  private nextActiveStamp(): number {
    const now = Date.now();
    const latest = this.profiles.reduce((max, p) => Math.max(max, p.lastActiveAt), 0);
    return now > latest ? now : latest + 1;
  }

  /**
   * Copy observable token state from a live session onto its record.
   *
   * A present access token clears `needsReauth`: the flag is a cache of a past
   * rejection, and a definitive rejection also clears the session store (ccsdk
   * clears on a 4xx refresh), so a session that still has a token is not the one
   * that was rejected. This keeps a stale flag from stranding a working profile.
   */
  private syncTokenState(record: ProfileRecord, sdk: CcPlatformSdk): void {
    const tokens = sdk.getTokens();
    record.tokenExpiresAt = tokens?.expiresAt;
    if (tokens?.accessToken) {
      record.needsReauth = false;
    }
  }

  private decorate(record: ProfileRecord): ProfileListItem {
    return {
      ...record,
      isActive: record.ulid === this.activeUlid,
      isTokenExpired: this.isExpired(record),
    };
  }

  /**
   * Whether this profile needs re-authentication. An unknown expiry is *not*
   * treated as expired — the session store may hold a usable refresh token, and
   * `switchTo()` will mint from it.
   */
  private isExpired(record: ProfileRecord): boolean {
    if (record.needsReauth) return true;
    if (!record.tokenExpiresAt) return false;
    const expiresAt = new Date(record.tokenExpiresAt).getTime();
    if (Number.isNaN(expiresAt)) return false;
    return Date.now() >= expiresAt;
  }

  /** Persist the registry, tell other tabs, then notify local subscribers. */
  private async persist(): Promise<void> {
    await this.registry.save({
      profiles: this.profiles,
      activeUlid: this.activeUlid,
    });
    try {
      this.channel?.postMessage({ type: "sync" });
    } catch {
      // Channel closed; local state is still authoritative for this tab.
    }
    this.notify();
  }

  private notify(): void {
    if (this.subscribers.size === 0) return;
    const snapshot = this.list();
    for (const listener of this.subscribers) {
      try {
        listener(snapshot);
      } catch {
        // One bad subscriber must not stop the others.
      }
    }
  }
}
