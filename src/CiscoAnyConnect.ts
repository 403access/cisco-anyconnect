import { AppState, Linking, Platform } from 'react-native';

import type {
  AnyConnectAppInfo,
  AnyConnectCallbackEvent,
  AnyConnectConfigureOptions,
  AnyConnectConnectOptions,
  AnyConnectConnectionOptions,
  AnyConnectDispatchResult,
  AnyConnectImportCertificateOptions,
  AnyConnectLocalizeOptions,
  AnyConnectState,
  AnyConnectStateChangeEvent,
  AnyConnectStateSnapshot,
  AnyConnectStateSource,
  AnyConnectUrlResultEvent,
} from './CiscoAnyConnect.types';
import { CiscoAnyConnectError } from './CiscoAnyConnectError';
import { getNativeModule, isNativeModuleAvailable } from './CiscoAnyConnectModule';
import { UriHandlerTransport, type AnyConnectTransport } from './transport';
import { parseCallbackUrl } from './uri';

export type Unsubscribe = () => void;

/** Re-exported so consumers can import the error from the package root. */
export { CiscoAnyConnectError };

const HEURISTIC_UNKNOWN: AnyConnectStateSnapshot = {
  state: 'unknown',
  vpnTransportActive: null,
  anyConnectInstalled: false,
};

function isDev(): boolean {
  try {
    return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  } catch {
    return false;
  }
}

/** Accepts either `myapp` or `myapp://` and returns `myapp`. */
function normaliseScheme(scheme: string): string {
  return scheme.trim().replace(/:\/\/.*$/, '').replace(/:$/, '');
}

/**
 * Facade over the AnyConnect integration.
 *
 * ```ts
 * import CiscoAnyConnect from 'expo-cisco-anyconnect';
 *
 * CiscoAnyConnect.configure({ callbackScheme: 'myapp' });
 * await CiscoAnyConnect.connect({ host: 'vpn.example.com' });
 * ```
 */
class CiscoAnyConnectClient {
  private transport: AnyConnectTransport = new UriHandlerTransport(() => this.callbackScheme);
  private options: Required<Pick<AnyConnectConfigureOptions, 'autoWireDeepLinks'>> &
    Pick<AnyConnectConfigureOptions, 'callbackScheme'> = {
    autoWireDeepLinks: true,
  };
  private callbackScheme: string | false = false;
  private schemeResolved = false;

  private snapshot: AnyConnectStateSnapshot = { ...HEURISTIC_UNKNOWN };
  private stateListeners = new Set<(event: AnyConnectStateChangeEvent) => void>();
  private callbackListeners = new Set<(event: AnyConnectCallbackEvent) => void>();
  private urlResultListeners = new Set<(event: AnyConnectUrlResultEvent) => void>();

  private subscriptions: { remove(): void }[] = [];
  private initialised = false;
  private initPromise: Promise<void> | null = null;

  // ---------------------------------------------------------------- configuration

  /**
   * Configures the client. Safe to call more than once; the newest options win. Call it as early as
   * possible (module scope, before the first `connect`) so callback URLs are wired up in time.
   */
  configure(options: AnyConnectConfigureOptions = {}): void {
    this.options = {
      autoWireDeepLinks: options.autoWireDeepLinks ?? true,
      callbackScheme: options.callbackScheme,
    };

    // Apply an explicit scheme immediately: `configure` may be called after the first connection,
    // and a re-resolve only happens during `initialise`.
    const configured = options.callbackScheme;
    if (configured === false) {
      this.callbackScheme = false;
      this.schemeResolved = true;
    } else if (typeof configured === 'string' && configured.trim().length > 0) {
      this.callbackScheme = normaliseScheme(configured);
      this.schemeResolved = true;
    } else {
      // Auto-detect: resolved from the platform during `initialise`. Before that there is nothing
      // to report; afterwards an already-detected scheme is kept.
      this.schemeResolved = false;
      if (!this.initialised) {
        this.callbackScheme = false;
      }
    }
  }

  /** Replaces the transport. Use this to plug in a Cisco SDK or in-process tunnel implementation. */
  setTransport(transport: AnyConnectTransport): void {
    this.transport?.dispose?.();
    this.transport = transport;
  }

  /** Identifier of the active transport, e.g. `uriHandler`. */
  get transportId(): string {
    return this.transport.id;
  }

  // ---------------------------------------------------------------- availability

  /** Whether the Cisco Secure Client / AnyConnect app is installed and can be driven. */
  async isInstalled(): Promise<boolean> {
    if (!isNativeModuleAvailable) return false;
    return this.transport.isAvailable();
  }

  /** Version details of the installed AnyConnect app, when the platform exposes them. */
  async getAppInfo(): Promise<AnyConnectAppInfo | null> {
    if (!isNativeModuleAvailable) return null;
    return this.transport.getAppInfo();
  }

  /** Synchronous last-known state. For the live value call {@link refresh} first. */
  getState(): AnyConnectStateSnapshot {
    return this.snapshot;
  }

  /** Reads the current state from the platform and notifies listeners if it changed. */
  async refresh(): Promise<AnyConnectStateSnapshot> {
    if (!isNativeModuleAvailable) return this.snapshot;
    const native = getNativeModule();

    let nativeSnapshot: AnyConnectStateSnapshot | null = null;
    try {
      nativeSnapshot = native.getState();
    } catch {
      nativeSnapshot = null;
    }

    let installed = this.snapshot.anyConnectInstalled;
    try {
      installed = (await native.isInstalled()) || installed;
    } catch {
      // Keep the previous value.
    }

    this.updateState(
      nativeSnapshot && nativeSnapshot.state !== 'unknown'
        ? nativeSnapshot.state
        : this.snapshot.state,
      'system',
      {
        vpnTransportActive: nativeSnapshot
          ? nativeSnapshot.vpnTransportActive
          : this.snapshot.vpnTransportActive,
        anyConnectInstalled: installed,
      }
    );

    return this.snapshot;
  }

  // ---------------------------------------------------------------- actions

  /** Adds a connection entry to the AnyConnect app without connecting. */
  async createConnection(options: AnyConnectConnectionOptions): Promise<AnyConnectDispatchResult> {
    await this.ensureInitialised();
    return this.transport.createConnection(options);
  }

  /**
   * Starts a tunnel. When a callback scheme is available, `onsuccess`/`onerror` are pointed back at
   * your app so {@link addCallbackListener} receives the outcome.
   */
  async connect(options: AnyConnectConnectOptions): Promise<AnyConnectDispatchResult> {
    await this.ensureInitialised();
    const result = await this.transport.connect(options);
    this.updateState('connecting', 'request');
    return result;
  }

  /** Tears the tunnel down. */
  async disconnect(): Promise<AnyConnectDispatchResult> {
    await this.ensureInitialised();
    const result = await this.transport.disconnect();
    this.updateState('disconnecting', 'request');
    return result;
  }

  /** Imports an AnyConnect client profile (XML) from a URL the device can reach. */
  async importProfile(url: string): Promise<AnyConnectDispatchResult> {
    await this.ensureInitialised();
    return this.transport.importProfile(url);
  }

  /** Imports a PKCS#12 client certificate. AnyConnect fetches the URL itself. */
  async importCertificate(
    options: AnyConnectImportCertificateOptions
  ): Promise<AnyConnectDispatchResult> {
    await this.ensureInitialised();
    return this.transport.importCertificate(options);
  }

  /** Pulls localization data (an `anyconnect.po` translation table) from a secure gateway. */
  async localize(options: AnyConnectLocalizeOptions): Promise<AnyConnectDispatchResult> {
    await this.ensureInitialised();
    return this.transport.localize(options);
  }

  /** iOS only: dismisses the AnyConnect GUI. */
  async closeGui(): Promise<AnyConnectDispatchResult> {
    await this.ensureInitialised();
    return this.transport.closeGui();
  }

  // ---------------------------------------------------------------- listeners

  /** Subscribes to tunnel state changes. */
  addStateListener(listener: (event: AnyConnectStateChangeEvent) => void): Unsubscribe {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Subscribes to connection outcomes reported by AnyConnect through callback URLs. Fires only when
   * a callback scheme is configured and reachable (see {@link configure}).
   */
  addCallbackListener(listener: (event: AnyConnectCallbackEvent) => void): Unsubscribe {
    this.callbackListeners.add(listener);
    return () => {
      this.callbackListeners.delete(listener);
    };
  }

  /** Subscribes to low-level "URI was handed to AnyConnect" results. Mainly for debugging. */
  addUrlResultListener(listener: (event: AnyConnectUrlResultEvent) => void): Unsubscribe {
    this.urlResultListeners.add(listener);
    return () => {
      this.urlResultListeners.delete(listener);
    };
  }

  /**
   * Feeds a deep link into the module. Call this from your own linking listener if the built-in
   * auto-wiring is disabled or does not fire on your setup.
   *
   * @returns `true` when the URL was recognised as an AnyConnect callback.
   */
  handleCallbackUrl(url: string | null | undefined): boolean {
    const event = url ? parseCallbackUrl(url) : null;
    if (!event) {
      return false;
    }

    this.updateState(
      event.result === 'success'
        ? event.action === 'disconnect'
          ? 'disconnected'
          : 'connected'
        : 'disconnected',
      'callback'
    );

    for (const listener of this.callbackListeners) {
      listener(event);
    }
    return true;
  }

  /** The scheme AnyConnect will open to report outcomes, or `false` when callbacks are disabled. */
  getCallbackScheme(): string | false {
    return this.callbackScheme;
  }

  /** Tears down listeners and resets everything this client has tracked. */
  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.remove();
    }
    this.subscriptions = [];
    this.transport?.dispose?.();
    this.stateListeners.clear();
    this.callbackListeners.clear();
    this.urlResultListeners.clear();
    this.snapshot = { ...HEURISTIC_UNKNOWN };
    this.callbackScheme = false;
    this.schemeResolved = false;
    this.initialised = false;
    this.initPromise = null;
  }

  // ---------------------------------------------------------------- internals

  private async ensureInitialised(): Promise<void> {
    if (this.initialised) return;
    if (!this.initPromise) {
      // Clear the cached promise on failure so a later call can retry instead of inheriting a
      // permanently rejected promise.
      this.initPromise = this.initialise().catch((error: unknown) => {
        this.initPromise = null;
        throw error;
      });
    }
    await this.initPromise;
  }

  private async initialise(): Promise<void> {
    if (!isNativeModuleAvailable) {
      // Surface the actionable "you need a dev build" error from getNativeModule().
      getNativeModule();
      return;
    }

    await this.resolveCallbackScheme();
    await this.refresh();

    const native = getNativeModule();

    this.subscriptions.push(
      native.addListener('onAnyConnectStateChange', (event) => {
        this.updateState(event.state, event.source, {
          vpnTransportActive: event.vpnTransportActive,
        });
      })
    );
    this.subscriptions.push(
      native.addListener('onAnyConnectUrlResult', (event) => {
        for (const listener of this.urlResultListeners) {
          listener(event);
        }
      })
    );
    this.subscriptions.push(
      native.addListener('onAnyConnectCallbackUrl', (event) => {
        this.handleCallbackUrl(event.url);
      })
    );

    this.drainNativeCallbacks();

    if (this.options.autoWireDeepLinks) {
      this.wireDeepLinks();
    }

    this.initialised = true;
  }

  /** Android can hand us the callback URL directly, no JS linking setup required. */
  private drainNativeCallbacks(): void {
    if (Platform.OS !== 'android') return;
    try {
      for (const url of getNativeModule().consumePendingCallbackUrls()) {
        this.handleCallbackUrl(url);
      }
    } catch {
      // Non-fatal: the URL will simply not be reported.
    }
  }

  private wireDeepLinks(): void {
    // React Native's Linking works for both platforms and adds no dependency. On Android the native
    // module also captures the URL itself, so this is a redundancy there, not a requirement.
    try {
      this.subscriptions.push(
        Linking.addEventListener('url', ({ url }) => {
          this.handleCallbackUrl(url);
        })
      );
      Linking.getInitialURL()
        .then((url) => {
          if (url) this.handleCallbackUrl(url);
        })
        .catch(() => {});
    } catch {
      // Linking is unavailable in a few exotic environments; handleCallbackUrl still works manually.
    }

    try {
      const appStateSubscription = AppState.addEventListener('change', (next) => {
        if (next === 'active') {
          // Only drain; `refresh()` is deliberately not called here so that an in-flight
          // "connecting" state is not clobbered before the tunnel actually comes up. On Android the
          // native VPN observer reports the real transition, and callbacks cover iOS.
          this.drainNativeCallbacks();
        }
      });
      this.subscriptions.push(appStateSubscription);
    } catch {
      // ignore
    }
  }

  private async resolveCallbackScheme(): Promise<void> {
    if (this.schemeResolved) return;

    const configured = this.options.callbackScheme;
    if (configured === false) {
      this.callbackScheme = false;
      this.schemeResolved = true;
      return;
    }
    if (typeof configured === 'string' && configured.trim().length > 0) {
      this.callbackScheme = normaliseScheme(configured);
      this.schemeResolved = true;
      return;
    }

    let schemes: string[] = [];
    try {
      schemes = await getNativeModule().getAppUrlSchemes();
    } catch {
      schemes = [];
    }

    const candidates = schemes.filter((scheme) => !/^https?$/i.test(scheme));
    const preferred =
      candidates.find((scheme) => /anyconnect|secureclient|secure-client|vpn/i.test(scheme)) ??
      candidates[0];

    this.callbackScheme = preferred ?? false;
    this.schemeResolved = true;

    if (!preferred && isDev()) {
      console.warn(
        '[expo-cisco-anyconnect] No custom URL scheme was found in your app config, so AnyConnect ' +
          'cannot report connection results back. Add `scheme` to app.json / app.config.js, or call ' +
          'CiscoAnyConnect.configure({ callbackScheme: "your-scheme" }).'
      );
    }
  }

  private updateState(
    state: AnyConnectState,
    source: AnyConnectStateSource,
    patch: Partial<AnyConnectStateSnapshot> = {}
  ): void {
    const next: AnyConnectStateSnapshot = {
      ...this.snapshot,
      ...patch,
      state,
    };

    const unchanged =
      next.state === this.snapshot.state &&
      next.vpnTransportActive === this.snapshot.vpnTransportActive &&
      next.anyConnectInstalled === this.snapshot.anyConnectInstalled;
    this.snapshot = next;
    if (unchanged) return;

    const event: AnyConnectStateChangeEvent = {
      state: next.state,
      source,
      vpnTransportActive: next.vpnTransportActive,
      timestamp: new Date().toISOString(),
    };
    for (const listener of this.stateListeners) {
      listener(event);
    }
  }
}

/** The shared client instance. */
export const CiscoAnyConnect = new CiscoAnyConnectClient();

export default CiscoAnyConnect;
