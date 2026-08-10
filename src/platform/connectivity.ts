/**
 * Platform connectivity abstraction.
 *
 * The SDK needs to know whether the device is online and be told when it comes
 * back, but the browser (`window` + `navigator.onLine`) and React Native
 * (NetInfo) expose that through different APIs. Injecting a source keeps
 * `@react-native-community/netinfo` out of this package's dependencies and off
 * the web app's bundle.
 *
 * @module platform/connectivity
 * @category Platform
 */

/**
 * Source of network connectivity state.
 *
 * Implement this to teach the SDK about connectivity on a platform it does not
 * detect natively. The web implementation is used automatically when `window`
 * is available.
 *
 * @example React Native, backed by NetInfo
 * ```typescript
 * import NetInfo from "@react-native-community/netinfo";
 *
 * const netInfoConnectivity: ConnectivitySource = {
 *   isOnline: () => lastKnownState,
 *   onOnline: (cb) =>
 *     NetInfo.addEventListener((s) => { if (s.isConnected) cb(); }),
 * };
 * ```
 *
 * @category Platform
 */
export interface ConnectivitySource {
  /**
   * Whether the device currently has a network connection.
   *
   * Return `true` when the state is unknown — callers use this to skip work on
   * a known-dead network, and a false negative stalls uploads.
   */
  isOnline(): boolean;
  /**
   * Subscribe to the transition back to online.
   *
   * @param cb - Called when connectivity is regained.
   * @returns Unsubscribe function. Must be safe to call more than once.
   */
  onOnline(cb: () => void): () => void;
}

/**
 * Connectivity backed by `navigator.onLine` and the window `online` event.
 *
 * Degrades to "always online, never notifies" when those globals are missing,
 * which is the correct behaviour for Node and React Native — both report
 * online so work is attempted rather than stalled.
 *
 * @category Platform
 */
export class WebConnectivitySource implements ConnectivitySource {
  isOnline(): boolean {
    // Unknown counts as online: only an explicit `false` means known-offline.
    if (typeof navigator === "undefined") return true;
    return navigator.onLine !== false;
  }

  onOnline(cb: () => void): () => void {
    if (typeof globalThis.addEventListener !== "function") return () => { };
    globalThis.addEventListener("online", cb);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      globalThis.removeEventListener("online", cb);
    };
  }
}

/**
 * Default connectivity source. Web-backed, and inert where the globals are
 * absent — safe to use on every platform.
 *
 * @category Platform
 */
export const defaultConnectivitySource: ConnectivitySource = new WebConnectivitySource();
