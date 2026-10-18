import { Platform } from 'react-native';

import type {
  AnyConnectAppInfo,
  AnyConnectConnectOptions,
  AnyConnectConnectionOptions,
  AnyConnectDispatchResult,
  AnyConnectImportCertificateOptions,
  AnyConnectLocalizeOptions,
} from './CiscoAnyConnect.types';
import { CiscoAnyConnectError } from './CiscoAnyConnectError';
import { getNativeModule } from './CiscoAnyConnectModule';
import * as uris from './uri';

/**
 * The seam that keeps this module future proof.
 *
 * `UriHandlerTransport` is the implementation that ships today: it drives the installed Cisco
 * Secure Client app through Cisco's documented `anyconnect://` URI handler. A second transport can
 * be dropped in later — for example one backed by Cisco's partner SDK, or one that runs the tunnel
 * in-process with `NEPacketTunnelProvider` / `VpnService` — without touching the public API or any
 * consuming app.
 */
export interface AnyConnectTransport {
  /** Stable identifier, surfaced for diagnostics. */
  readonly id: string;
  /** Whether this transport can be used on the current device right now. */
  isAvailable(): Promise<boolean>;
  getAppInfo(): Promise<AnyConnectAppInfo | null>;
  createConnection(options: AnyConnectConnectionOptions): Promise<AnyConnectDispatchResult>;
  connect(options: AnyConnectConnectOptions): Promise<AnyConnectDispatchResult>;
  disconnect(): Promise<AnyConnectDispatchResult>;
  importProfile(url: string): Promise<AnyConnectDispatchResult>;
  importCertificate(options: AnyConnectImportCertificateOptions): Promise<AnyConnectDispatchResult>;
  localize(options: AnyConnectLocalizeOptions): Promise<AnyConnectDispatchResult>;
  closeGui(): Promise<AnyConnectDispatchResult>;
  dispose?(): void;
}

let tokenCounter = 0;

function nextToken(action: string): string {
  tokenCounter += 1;
  // Not a secret: only used to correlate a dispatch with the callback that comes back.
  return `${action}-${Date.now().toString(36)}-${tokenCounter.toString(36)}`;
}

/**
 * Drives the AnyConnect app through deep links. Requires:
 *
 * - the Cisco Secure Client / AnyConnect app to be installed, and
 * - on Android 11+, the `<queries>` entry that is merged in by this package's manifest, and
 * - on Android, *URI External Control* enabled (AnyConnect profile key
 *   `vpn_setting_uri_external_control`, default is `prompted`), and
 * - on iOS, `anyconnect` listed in `LSApplicationQueriesSchemes` so availability can be detected.
 */
export class UriHandlerTransport implements AnyConnectTransport {
  readonly id = 'uriHandler';

  constructor(private readonly resolveCallbackScheme: () => string | false) {}

  async isAvailable(): Promise<boolean> {
    return getNativeModule().isInstalled();
  }

  async getAppInfo(): Promise<AnyConnectAppInfo | null> {
    return getNativeModule().getAppInfo();
  }

  async createConnection(options: AnyConnectConnectionOptions): Promise<AnyConnectDispatchResult> {
    if (!options.host) {
      throw new CiscoAnyConnectError('INVALID_ARGUMENTS', 'createConnection: `host` is required.');
    }
    if (!options.name) {
      throw new CiscoAnyConnectError(
        'INVALID_ARGUMENTS',
        'createConnection: `name` is required (it is the connection entry label).'
      );
    }
    return this.dispatch('create', uris.buildCreateConnectionUri(options));
  }

  async connect(options: AnyConnectConnectOptions): Promise<AnyConnectDispatchResult> {
    if (!options.host && !options.name) {
      throw new CiscoAnyConnectError(
        'INVALID_ARGUMENTS',
        'connect: provide at least `name` (an existing entry) or `host`.'
      );
    }

    const scheme = this.resolveCallbackScheme();
    const token = nextToken('connect');

    const withCallbacks: AnyConnectConnectOptions = { ...options };
    if (withCallbacks.onSuccess === undefined && withCallbacks.onError === undefined) {
      if (Platform.OS === 'ios' && withCallbacks.closeOnSuccess) {
        // iOS accepts a single `onsuccess` action, so dismissing the GUI wins over notifying us.
        // Failures still come back through `onerror`.
        withCallbacks.onSuccess = uris.buildCloseUri();
      } else if (scheme) {
        withCallbacks.onSuccess = uris.buildCallbackUrl(scheme, {
          action: 'connect',
          result: 'success',
          token,
        });
      }

      if (scheme) {
        withCallbacks.onError = uris.buildCallbackUrl(scheme, {
          action: 'connect',
          result: 'error',
          token,
        });
      }
    }

    return this.dispatch('connect', uris.buildConnectUri(withCallbacks), token);
  }

  async disconnect(): Promise<AnyConnectDispatchResult> {
    const scheme = this.resolveCallbackScheme();
    const token = nextToken('disconnect');
    // `onsuccess` on the disconnect action is Android-only.
    const onSuccess =
      Platform.OS === 'android' && scheme
        ? uris.buildCallbackUrl(scheme, { action: 'disconnect', result: 'success', token })
        : undefined;

    return this.dispatch('disconnect', uris.buildDisconnectUri(onSuccess), token);
  }

  async importProfile(url: string): Promise<AnyConnectDispatchResult> {
    if (!url) {
      throw new CiscoAnyConnectError('INVALID_ARGUMENTS', 'importProfile: a profile URL is required.');
    }
    return this.dispatch('import:profile', uris.buildImportProfileUri(url));
  }

  async importCertificate(
    options: AnyConnectImportCertificateOptions
  ): Promise<AnyConnectDispatchResult> {
    if (!options?.uri) {
      throw new CiscoAnyConnectError('INVALID_ARGUMENTS', 'importCertificate: `uri` is required.');
    }
    return this.dispatch('import:pkcs12', uris.buildImportCertificateUri(options));
  }

  async localize(options: AnyConnectLocalizeOptions): Promise<AnyConnectDispatchResult> {
    if (!options?.lang || !options?.host) {
      throw new CiscoAnyConnectError('INVALID_ARGUMENTS', 'localize: both `lang` and `host` are required.');
    }
    return this.dispatch('import:localization', uris.buildLocalizeUri(options));
  }

  async closeGui(): Promise<AnyConnectDispatchResult> {
    // Cisco documents `anyconnect://close` for Apple platforms only. Elsewhere the AnyConnect GUI
    // closes itself once a connect attempt settles, so this is a documented no-op.
    if (Platform.OS !== 'ios') {
      return { url: uris.buildCloseUri(), dispatched: false, action: 'close' };
    }
    return this.dispatch('close', uris.buildCloseUri());
  }

  private async dispatch(
    action: string,
    url: string,
    token?: string
  ): Promise<AnyConnectDispatchResult> {
    const dispatched = await getNativeModule().openUrl(url);
    if (!dispatched) {
      throw new CiscoAnyConnectError(
        'NO_HANDLER',
        `expo-cisco-anyconnect: nothing handled the \`${action}\` link (${url}). ` +
          'Is Cisco Secure Client / AnyConnect installed and, on Android, is URI External Control enabled?'
      );
    }
    return { url, dispatched, action, token };
  }
}
