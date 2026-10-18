/**
 * Public types for `expo-cisco-anyconnect`.
 *
 * The module drives the **Cisco Secure Client (AnyConnect)** app that is already installed on the
 * device, using the `anyconnect://` URI handler that Cisco documents for third-party automation:
 *
 * - https://www.cisco.com/c/en/us/td/docs/security/vpn_client/anyconnect/anyconnect49/administration/guide/b_AnyConnect_Administrator_Guide_4-9/b_AnyConnect_Administrator_Guide_4-4_chapter_01101.html
 *
 * This is the only integration surface Cisco exposes publicly. Embedding an AnyConnect tunnel
 * directly into your own app requires Cisco's partner SDK (NDA + paid licence) plus the Apple
 * `packet-tunnel-provider` entitlement. See `AnyConnectTransport` for the extension point that lets
 * you drop such an implementation in without changing the public API.
 */

/** Transport protocol for a connection entry. Defaults to `SSL`. */
export type AnyConnectProtocol = 'SSL' | 'IPsec';

/** IPsec authentication mode. Only applies when `protocol` is `IPsec`. */
export type AnyConnectAuthMode =
  | 'EAP-AnyConnect'
  | 'EAP-GTC'
  | 'EAP-MD5'
  | 'EAP-MSCHAPv2'
  | 'IKE-RSA';

/**
 * Best-effort view of the tunnel state.
 *
 * The URI handler is fire-and-forget, so a state is only truly *observed* when:
 * - the app is running on Android (the module watches the system VPN transport), or
 * - a connection callback URL comes back from AnyConnect (see {@link CiscoAnyConnect.configure}).
 *
 * Otherwise the state reflects what this module last *asked* AnyConnect to do, and may be
 * `unknown`/stale. Treat it as a UI hint, not as an authoritative tunnel check.
 */
export type AnyConnectState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'unknown';

/** Where a state update came from. Useful for debugging. */
export type AnyConnectStateSource = 'system' | 'callback' | 'request' | 'initial';

/** Information about the installed Cisco Secure Client / AnyConnect app. */
export interface AnyConnectAppInfo {
  platform: 'android' | 'ios';
  /**
   * Android package name. On iOS this is the value reported by `UIApplication` for the
   * `anyconnect://` scheme handler, which is always `com.cisco.anyconnect` (the app is sandboxed
   * and iOS does not let an app read the bundle id of the app that handles a URL scheme).
   */
  packageName: string;
  versionName: string | null;
  versionCode: number | null;
  appName: string | null;
  /** How the app was discovered. */
  source: 'package' | 'intentHandler';
}

/** Options shared by `createConnection` and `connect`. */
export interface AnyConnectConnectionOptions {
  /**
   * Connection entry name (the *Description* field in the AnyConnect UI). Must be unique for
   * `createConnection`. Cisco recommends at most 24 characters. Case-sensitive.
   */
  name?: string;
  /**
   * Domain name, IP address, or Group URL of the secure gateway. Required for `createConnection`,
   * required for `connect` unless a matching `name` already exists on the device.
   */
  host?: string;
  /** VPN protocol. Defaults to `SSL`. */
  protocol?: AnyConnectProtocol;
  /** IPsec authentication mode. Only used when `protocol` is `IPsec`. */
  authentication?: AnyConnectAuthMode;
  /** IKE identity. Required when `authentication` is `EAP-GTC`, `EAP-MD5` or `EAP-MSCHAPv2`. */
  ikeIdentity?: string;
  /**
   * Android only. Name of a certificate in the system keychain to copy into the AnyConnect
   * certificate store and bind to this entry.
   */
  keychainAlias?: string;
  /** Whether AnyConnect may automatically select a client certificate. Defaults to `true`. */
  useCert?: boolean;
  /** Common Name of a certificate to bind to the entry. Requires `useCert`. */
  certCommonName?: string;
  /** iOS only. Optimise for a sustained connection (`true`) or for battery life (`false`). */
  netRoam?: boolean;
  /** iOS only. Allow the OS to start the tunnel on demand (Connect On-Demand). */
  useOnDemand?: boolean;
  /** iOS only. Requires `useOnDemand`. Domains that *may* bring the tunnel up. */
  domainListAlways?: string[];
  /** iOS only. Requires `useOnDemand`. Domains that bring the tunnel up after a DNS failure. */
  domainListIfNeeded?: string[];
  /** iOS only. Requires `useOnDemand`. Domains that must *not* bring the tunnel up. */
  domainListNever?: string[];
}

/** Options for {@link CiscoAnyConnect.connect}. */
export interface AnyConnectConnectOptions extends AnyConnectConnectionOptions {
  /**
   * Username to prefill in the AnyConnect prompt.
   *
   * Do **not** pass a real long-lived password here: the URI is handed to the AnyConnect app and
   * will be visible in device logs and to any other app that can observe it. Only use the password
   * fields with a one-time-password / token headend, which is what Cisco recommends.
   */
  username?: string;
  /** One-time password to prefill. See the warning on {@link AnyConnectConnectOptions.username}. */
  password?: string;
  /** Second username, for headends configured with double authentication. */
  secondaryUsername?: string;
  /** Second one-time password, for headends configured with double authentication. */
  secondaryPassword?: string;
  /** Connection profile / group alias (`prefill_group_list`). */
  group?: string;
  /** Override the URL AnyConnect opens on success. Defaults to this module's callback URL. */
  onSuccess?: string;
  /** Override the URL AnyConnect opens on failure. Defaults to this module's callback URL. */
  onError?: string;
  /** iOS only. Close the AnyConnect GUI once the connection succeeds. */
  closeOnSuccess?: boolean;
}

/** Options for {@link CiscoAnyConnect.importCertificate}. */
export interface AnyConnectImportCertificateOptions {
  /**
   * URL the certificate can be downloaded from. Cisco only supports `pkcs12` bundles; the app
   * fetches this URL itself, so it must be reachable from the device.
   */
  uri: string;
}

/** Options for {@link CiscoAnyConnect.localize}. */
export interface AnyConnectLocalizeOptions {
  /** Two- or four-character language tag, e.g. `fr` or `fr-ca`. */
  lang: string;
  /** Secure gateway the localization pack should be fetched from. */
  host: string;
}

/** Payload emitted by {@link CiscoAnyConnect.addStateListener}. */
export interface AnyConnectStateChangeEvent {
  state: AnyConnectState;
  source: AnyConnectStateSource;
  /** True when a system-wide VPN transport is currently up (Android: always available). */
  vpnTransportActive: boolean | null;
  /** ISO timestamp of when the observation was made. */
  timestamp: string;
}

/** Result of a connection attempt reported back by AnyConnect through a callback URL. */
export interface AnyConnectCallbackEvent {
  /** The action whose outcome is being reported. */
  action: 'connect' | 'disconnect' | 'unknown';
  result: 'success' | 'error';
  /** The callback URL exactly as received. */
  url: string;
  /** Opaque token that was embedded by this module, when present. */
  token?: string;
  /** Free-form error detail, when the callback carried one. */
  error?: string;
}

/** Returned by every action that hands a URI to the AnyConnect app. */
export interface AnyConnectDispatchResult {
  /** The exact URI that was dispatched. Handy for logs and bug reports. */
  url: string;
  /** `true` when the OS accepted the URI. */
  dispatched: boolean;
  /** The action that was dispatched, e.g. `connect`. */
  action: string;
  /**
   * Opaque token embedded in the callback URL. It is echoed back on
   * {@link AnyConnectCallbackEvent} so you can correlate a result with the request that caused it.
   */
  token?: string;
}

/** Payload emitted after a URI is handed to the AnyConnect app. */
export interface AnyConnectUrlResultEvent {
  action?: string;
  url: string;
  success: boolean;
  error?: string;
}

/** Events emitted by the native module. */
export interface CiscoAnyConnectModuleEvents {
  onAnyConnectStateChange: (event: AnyConnectNativeStateChangeEvent) => void;
  /**
   * Android only: a `VIEW` intent reached the app. The URL is passed through verbatim and
   * interpreted by {@link parseCallbackUrl}, so no filtering happens natively.
   *
   * On iOS these URLs arrive through the host app's own URL handling instead.
   */
  onAnyConnectCallbackUrl: (event: AnyConnectCallbackUrlEvent) => void;
  onAnyConnectUrlResult: (event: AnyConnectUrlResultEvent) => void;
  // Expo's `EventsMap` constraint requires an index signature; this keeps the named members above
  // strongly typed while still satisfying it.
  [event: string]: (...args: any[]) => void;
}

/**
 * State change as reported by the native layer.
 *
 * The `timestamp` is added by the JavaScript facade, so no date formatting has to happen natively.
 */
export interface AnyConnectNativeStateChangeEvent {
  state: AnyConnectState;
  source: AnyConnectStateSource;
  vpnTransportActive: boolean | null;
}

/** Raw deep link captured natively, waiting to be interpreted by {@link parseCallbackUrl}. */
export interface AnyConnectCallbackUrlEvent {
  url: string;
}

/** Snapshot returned by the native module. */
export interface AnyConnectStateSnapshot {
  state: AnyConnectState;
  /** `null` when the platform cannot report it. */
  vpnTransportActive: boolean | null;
  /** Whether a handler for the `anyconnect://` scheme was found on this device. */
  anyConnectInstalled: boolean;
}

/**
 * Options for {@link CiscoAnyConnect.configure}.
 */
export interface AnyConnectConfigureOptions {
  /**
   * Deep-link scheme that AnyConnect should open when a connection succeeds or fails. When set
   * (the default), {@link CiscoAnyConnect.connect} appends `onsuccess`/`onerror` URLs pointing at
   * this scheme so your app regains control and receives a typed event.
   *
   * Set to `false` to disable callbacks entirely.
   *
   * The scheme must be declared in your app config (see the config plugin) or the OS will not
   * route the link back to your app.
   */
  callbackScheme?: string | false;
  /**
   * Subscribe to React Native's `Linking` (and `AppState`) automatically so callback URLs reach the
   * module without any manual wiring. Defaults to `true`.
   *
   * There is no extra dependency involved: React Native's core `Linking` is used, not
   * `expo-linking`. Turn this off if your app already owns URL handling and would rather forward
   * links itself with {@link CiscoAnyConnect.handleCallbackUrl}.
   */
  autoWireDeepLinks?: boolean;
}
