/**
 * Pure builders for the `anyconnect://` URIs documented by Cisco.
 *
 * Kept free of any native dependency so they can be unit tested and so the exact wire format is
 * auditable in one place.
 *
 * Reference:
 * https://www.cisco.com/c/en/us/td/docs/security/vpn_client/anyconnect/anyconnect49/administration/guide/b_AnyConnect_Administrator_Guide_4-9/b_AnyConnect_Administrator_Guide_4-4_chapter_01101.html
 */

import type {
  AnyConnectCallbackEvent,
  AnyConnectConnectOptions,
  AnyConnectConnectionOptions,
  AnyConnectImportCertificateOptions,
  AnyConnectLocalizeOptions,
} from './CiscoAnyConnect.types';

const SCHEME = 'anyconnect';

/** Path segment used on our own callback URLs. */
export const CALLBACK_PATH = 'anyconnect/callback';

/**
 * Encodes a value for use inside an `anyconnect://` query string.
 *
 * Cisco examples leave `/` unescaped inside `host` (e.g. `host=hr.example.com/group-url`) and by
 * convention URLs handed to `onsuccess`/`onerror` *are* fully escaped. We therefore escape
 * everything and then restore `/` and `:` for host-like values, which both Cisco and the Android
 * URI parser accept.
 */
export function encodeValue(value: string, { keepSlashes = false } = {}): string {
  let encoded = encodeURIComponent(value);
  if (keepSlashes) {
    encoded = encoded.replace(/%2F/gi, '/').replace(/%3A/gi, ':');
  }
  return encoded;
}

function encodeList(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  // Cisco expects a comma-separated list; commas themselves must not be escaped.
  return values.map((value) => encodeValue(value)).join(',');
}

function isBlank(value: string | undefined | null): boolean {
  return value === undefined || value === null || value.trim() === '';
}

/**
 * Turns an options object into the ordered list of query parameters Cisco understands, dropping
 * anything that was not provided.
 */
export function connectionQueryParameters(options: AnyConnectConnectionOptions): [string, string][] {
  const params: [string, string][] = [];

  if (!isBlank(options.name)) {
    params.push(['name', encodeValue(options.name!)]);
  }
  if (!isBlank(options.host)) {
    params.push(['host', encodeValue(options.host!, { keepSlashes: true })]);
  }
  if (options.protocol) {
    params.push(['protocol', options.protocol]);
  }
  if (options.authentication) {
    params.push(['authentication', options.authentication]);
  }
  if (!isBlank(options.ikeIdentity)) {
    params.push(['ike-identity', encodeValue(options.ikeIdentity!)]);
  }
  if (!isBlank(options.keychainAlias)) {
    params.push(['keychainalias', encodeValue(options.keychainAlias!)]);
  }
  if (options.useCert !== undefined) {
    params.push(['usecert', String(options.useCert)]);
  }
  if (!isBlank(options.certCommonName)) {
    params.push(['certcommonname', encodeValue(options.certCommonName!)]);
  }
  if (options.netRoam !== undefined) {
    params.push(['netroam', String(options.netRoam)]);
  }
  if (options.useOnDemand !== undefined) {
    params.push(['useondemand', String(options.useOnDemand)]);
  }

  const always = encodeList(options.domainListAlways);
  if (always) params.push(['domainlistalways', always]);
  const ifNeeded = encodeList(options.domainListIfNeeded);
  if (ifNeeded) params.push(['domainlistifneeded', ifNeeded]);
  const never = encodeList(options.domainListNever);
  if (never) params.push(['domainlistnever', never]);

  return params;
}

function assemble(action: string, params: [string, string][]): string {
  const query = params.map(([key, value]) => `${key}=${value}`).join('&');
  // Cisco's own examples use both `anyconnect://create?` and `anyconnect://create/?`. The trailing
  // slash form is the one listed first in the documentation and is accepted on both platforms.
  return query.length > 0 ? `${SCHEME}://${action}/?${query}` : `${SCHEME}://${action}`;
}

/** `anyconnect://create/?name=..&host=..` — adds a connection entry without connecting. */
export function buildCreateConnectionUri(options: AnyConnectConnectionOptions): string {
  return assemble('create', connectionQueryParameters(options));
}

/** `anyconnect://connect/?name=..&host=..` — connects, creating the entry first if needed. */
export function buildConnectUri(options: AnyConnectConnectOptions): string {
  const params = connectionQueryParameters(options);

  if (!isBlank(options.username)) params.push(['prefill_username', encodeValue(options.username!)]);
  if (!isBlank(options.password)) params.push(['prefill_password', encodeValue(options.password!)]);
  if (!isBlank(options.secondaryUsername)) {
    params.push(['prefill_secondary_username', encodeValue(options.secondaryUsername!)]);
  }
  if (!isBlank(options.secondaryPassword)) {
    params.push(['prefill_secondary_password', encodeValue(options.secondaryPassword!)]);
  }
  if (!isBlank(options.group)) params.push(['prefill_group_list', encodeValue(options.group!)]);
  if (!isBlank(options.onSuccess)) params.push(['onsuccess', encodeValue(options.onSuccess!)]);
  if (!isBlank(options.onError)) params.push(['onerror', encodeValue(options.onError!)]);

  return assemble('connect', params);
}

/**
 * `anyconnect://disconnect` — tears the tunnel down.
 *
 * `onsuccess` is Android-only for this action, so it is only appended when provided and the caller
 * is expected to have checked the platform.
 */
export function buildDisconnectUri(onSuccess?: string): string {
  const params: [string, string][] = [];
  if (!isBlank(onSuccess)) {
    params.push(['onsuccess', encodeValue(onSuccess!)]);
  }
  return assemble('disconnect', params);
}

/** `anyconnect://import/?type=profile&uri=..` */
export function buildImportProfileUri(uri: string): string {
  return assemble('import', [
    ['type', 'profile'],
    ['uri', encodeValue(uri)],
  ]);
}

/** `anyconnect://import/?type=pkcs12&uri=..` */
export function buildImportCertificateUri(options: AnyConnectImportCertificateOptions): string {
  return assemble('import', [
    ['type', 'pkcs12'],
    ['uri', encodeValue(options.uri)],
  ]);
}

/** `anyconnect://import/?type=localization&lang=..&host=..` */
export function buildLocalizeUri(options: AnyConnectLocalizeOptions): string {
  return assemble('import', [
    ['type', 'localization'],
    ['lang', encodeValue(options.lang)],
    ['host', encodeValue(options.host, { keepSlashes: true })],
  ]);
}

/** `anyconnect://close` — iOS only: closes the AnyConnect UI. */
export function buildCloseUri(): string {
  return `${SCHEME}://close`;
}

/** Builds the URL AnyConnect should open to report the outcome of an action back to this app. */
export function buildCallbackUrl(
  callbackScheme: string,
  params: { action: string; result: 'success' | 'error'; token?: string; error?: string }
): string {
  const query: [string, string][] = [
    ['action', params.action],
    ['result', params.result],
  ];
  if (params.token) query.push(['token', encodeURIComponent(params.token)]);
  if (params.error) query.push(['error', encodeURIComponent(params.error)]);

  const scheme = callbackScheme.replace(/:\/\/.*$/, '').replace(/:$/, '');
  return `${scheme}://${CALLBACK_PATH}?${query.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

function parseQuery(query: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    const rawKey = index === -1 ? pair : pair.slice(0, index);
    const rawValue = index === -1 ? '' : pair.slice(index + 1);
    try {
      result[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      result[rawKey] = rawValue;
    }
  }
  return result;
}

/**
 * Parses a URL and returns the event it represents, or `null` when the URL is not one of ours.
 *
 * Accepts any scheme, so it works no matter which callback scheme the app was configured with.
 */
export function parseCallbackUrl(url: string): AnyConnectCallbackEvent | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }

  const withoutScheme = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const queryIndex = withoutScheme.indexOf('?');
  const path = (queryIndex === -1 ? withoutScheme : withoutScheme.slice(0, queryIndex)).replace(
    /^\/+|\/+$/g,
    ''
  );
  const query = queryIndex === -1 ? '' : withoutScheme.slice(queryIndex + 1);

  // AnyConnect appends nothing to the URL, but some OS versions normalise a trailing slash.
  // An exact match also rejects host-based URLs such as `https://example.com/anyconnect/callback`.
  if (path !== CALLBACK_PATH) {
    return null;
  }

  const params = parseQuery(query);
  const result = params.result === 'error' ? 'error' : params.result === 'success' ? 'success' : null;
  if (!result) {
    return null;
  }

  const action =
    params.action === 'connect' || params.action === 'disconnect' ? params.action : 'unknown';

  return {
    action,
    result,
    url,
    token: params.token || undefined,
    error: params.error || undefined,
  };
}
