# API reference

Everything exported from `expo-cisco-anyconnect`. See the [README](../README.md) for setup and the
[Android](android.md) / [iOS](ios.md) guides for platform behaviour.

```ts
import CiscoAnyConnect, {
  CiscoAnyConnectError,
  UriHandlerTransport,
  useAnyConnect,
  useAnyConnectCallback,
  // low-level helpers
  buildConnectUri,
  parseCallbackUrl,
  isNativeModuleAvailable,
} from 'expo-cisco-anyconnect';
```

`CiscoAnyConnect` is a module-level singleton; the default export is the same object.

---

## `configure(options?)`

Must be called as early as possible — ideally at module scope, before the first `connect` — because
it decides the callback scheme that connection results are routed to.

```ts
CiscoAnyConnect.configure({
  callbackScheme: 'myapp',
  autoWireDeepLinks: true,
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `callbackScheme` | `string \| false` | auto-detected | Deep-link scheme AnyConnect opens to report a `connect`/`disconnect` outcome. `false` disables callbacks entirely. |
| `autoWireDeepLinks` | `boolean` | `true` | Subscribe to React Native's `Linking` and `AppState` so callbacks arrive without manual wiring. |

**Auto-detection.** When `callbackScheme` is omitted, the module reads the custom URL schemes your
app has registered — `CFBundleURLTypes` from `Info.plist` on iOS, your own intent filters on Android
— and prefers one matching `/anyconnect|secureclient|vpn/i`, otherwise the first non-`http(s)`
scheme. In development a warning is logged when nothing is found.

Passing a scheme is idempotent and takes effect immediately, so calling `configure` again later (for
example after a login flow) is safe.

Calling `configure` with explicit options replaces the previous options; there is no merge.

---

## Transport

### `setTransport(transport)`

Replaces the active transport. `dispose()` is called on the outbound transport. See
[Architecture § The transport seam](architecture.md#the-transport-seam).

### `transportId: string`

Identifier of the active transport. `'uriHandler'` out of the box.

---

## Availability

### `isInstalled(): Promise<boolean>`

Whether a handler for `anyconnect://` exists on the device. Resolves `false` (rather than throwing)
when the native module is missing.

- **Android** — resolves the `anyconnect://` intent, then falls back to the known AnyConnect package
  names.
- **iOS** — `UIApplication.canOpenURL`, which requires `anyconnect` in `LSApplicationQueriesSchemes`.
  The [config plugin](config-plugin.md) adds it.

### `getAppInfo(): Promise<AnyConnectAppInfo | null>`

Returns metadata for the installed client, or `null` when it is not installed.

```ts
interface AnyConnectAppInfo {
  platform: 'android' | 'ios';
  packageName: string;
  versionName: string | null;
  versionCode: number | null;
  appName: string | null;
  source: 'package' | 'intentHandler';
}
```

| Field | Android | iOS |
| --- | --- | --- |
| `packageName` | Resolved package, e.g. `com.cisco.anyconnect.vpn.android.avf` | Always `com.cisco.anyconnect` — iOS does not expose the bundle id that owns a scheme |
| `versionName` / `versionCode` | From `PackageManager` | `null` (another app's metadata is unreadable) |
| `appName` | Application label | `'Cisco Secure Client'` |
| `source` | `intentHandler` when the package resolved the scheme, else `package` | `intentHandler` |

---

## Actions

All actions resolve to an `AnyConnectDispatchResult`:

```ts
interface AnyConnectDispatchResult {
  url: string;        // exact URI handed to AnyConnect
  dispatched: boolean; // the OS accepted it
  action: string;      // 'connect', 'disconnect', ...
  token?: string;      // echoed back on the callback event
}
```

### `createConnection(options): Promise<AnyConnectDispatchResult>`

Adds a connection entry without connecting. **Requires `name` and `host`**; throws
`INVALID_ARGUMENTS` otherwise.

### `connect(options): Promise<AnyConnectDispatchResult>`

Starts a tunnel. Requires `host`, or `name` when a matching entry already exists on the device.

AnyConnect creates the connection entry on the fly if all parameters do not match an existing one.
When a callback scheme is available, `onsuccess` and `onerror` are pointed back at your app.

### `disconnect(): Promise<AnyConnectDispatchResult>`

Tears the tunnel down. The `onsuccess` action is only appended on Android, because that is the only
platform Cisco supports it on for this action.

### `importProfile(url): Promise<AnyConnectDispatchResult>`

Imports an AnyConnect client profile (XML). `url` must be reachable **from the device** —
AnyConnect fetches it itself, so `file://` paths and LAN/`localhost` URLs only work where the device
can actually read them.

### `importCertificate(options): Promise<AnyConnectDispatchResult>`

```ts
interface AnyConnectImportCertificateOptions {
  uri: string; // PKCS#12 bundle; Cisco supports no other type
}
```

### `localize(options): Promise<AnyConnectDispatchResult>`

```ts
interface AnyConnectLocalizeOptions {
  lang: string; // 'fr' or 'fr-ca'
  host: string; // secure gateway to pull the translation table from
}
```

### `closeGui(): Promise<AnyConnectDispatchResult>`

iOS only. Dismisses the AnyConnect UI. On other platforms it resolves
`{ dispatched: false }` instead of throwing, because the AnyConnect GUI closes itself after a
connect attempt settles.

### `AnyConnectConnectionOptions`

Shared by `createConnection` and `connect`.

| Option | Type | Platform | Description |
| --- | --- | --- | --- |
| `name` | `string` | both | Connection entry label (the *Description* field). Case-sensitive; Cisco recommends ≤ 24 characters. |
| `host` | `string` | both | FQDN, IP address, or Group URL of the secure gateway. |
| `protocol` | `'SSL' \| 'IPsec'` | both | Tunnel protocol. Defaults to `SSL`. |
| `authentication` | `AnyConnectAuthMode` | both | IPsec only: `'EAP-AnyConnect'`, `'EAP-GTC'`, `'EAP-MD5'`, `'EAP-MSCHAPv2'`, `'IKE-RSA'`. |
| `ikeIdentity` | `string` | both | Required when `authentication` is `EAP-GTC`, `EAP-MD5` or `EAP-MSCHAPv2`. |
| `keychainAlias` | `string` | Android | Certificate in the system store to copy into the AnyConnect store and bind to the entry. |
| `useCert` | `boolean` | both | Allow automatic client-certificate selection. Defaults to `true`. |
| `certCommonName` | `string` | both | Common Name of the certificate to bind. Requires `useCert`. |
| `netRoam` | `boolean` | iOS | `true` optimises for a sustained connection, `false` for battery life. |
| `useOnDemand` | `boolean` | iOS | Allow Connect On-Demand. |
| `domainListAlways` | `string[]` | iOS | Domains that may bring the tunnel up. Requires `useOnDemand`. |
| `domainListIfNeeded` | `string[]` | iOS | Domains that bring it up after a DNS failure. Requires `useOnDemand`. |
| `domainListNever` | `string[]` | iOS | Domains that must not bring it up. Requires `useOnDemand`. |

### `AnyConnectConnectOptions`

Extends the above.

| Option | Type | Description |
| --- | --- | --- |
| `username` | `string` | Prefilled username. |
| `password` | `string` | Prefilled **one-time** password — see the warning below. |
| `secondaryUsername` | `string` | Second username for double authentication. |
| `secondaryPassword` | `string` | Second one-time password. |
| `group` | `string` | Connection profile / group alias. |
| `onSuccess` | `string` | Override the success callback URL. |
| `onError` | `string` | Override the failure callback URL. |
| `closeOnSuccess` | `boolean` | iOS only: close the AnyConnect GUI on success. |

> **Never prefill a long-lived password.** The URI is handed to the AnyConnect app and can surface in
> device logs. Cisco documents `prefill_password` for use "only in conjunction with a One Time
> Password (OTP) infrastructure". Prefer certificate-based authentication or let the user type the
> secret into AnyConnect.

> **`closeOnSuccess` vs the success callback.** iOS accepts a single `onsuccess` action, so
> `closeOnSuccess` takes precedence and no success event fires. Failures are still reported through
> `onerror`.

> **Explicit `onSuccess` / `onError` disable the automatic callbacks** for that call. If you set
> only one of them, the other is still filled in for you.

---

## State

### `getState(): AnyConnectStateSnapshot`

Synchronous last-known snapshot. Never throws.

```ts
interface AnyConnectStateSnapshot {
  state: AnyConnectState;
  vpnTransportActive: boolean | null;
  anyConnectInstalled: boolean;
}

type AnyConnectState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'unknown';
```

### `refresh(): Promise<AnyConnectStateSnapshot>`

Reads the platform again and notifies listeners when something changed.

- It also refreshes `anyConnectInstalled` via `isInstalled()`.
- A native `state` of `'unknown'` never overwrites a state the module already knows — that is how
  iOS keeps a callback-derived state instead of being reset on every refresh.

Platform capabilities are summarised in the [README](../README.md#state-semantics) and explained in
the [iOS guide](ios.md#why-state-is-limited-on-ios).

---

## Events

Each `add*Listener` returns an `Unsubscribe` function.

### `addStateListener(listener): Unsubscribe`

```ts
interface AnyConnectStateChangeEvent {
  state: AnyConnectState;
  source: 'system' | 'callback' | 'request' | 'initial';
  vpnTransportActive: boolean | null;
  timestamp: string; // ISO 8601, added by the JS layer
}
```

Only fires when the state actually changes — `state`, `vpnTransportActive` or `anyConnectInstalled`.
Note that the event payload carries the first two plus `source` and `timestamp`; read
`getState()` if you need the install flag too, which is what `useAnyConnect` does.

| `source` | Meaning |
| --- | --- |
| `system` | Observed from the platform (Android VPN transport, or `refresh()`). |
| `callback` | Derived from a URL AnyConnect opened. |
| `request` | Optimistic, set when the module dispatched an action. |
| `initial` | The starting value. |

### `addCallbackListener(listener): Unsubscribe`

```ts
interface AnyConnectCallbackEvent {
  action: 'connect' | 'disconnect' | 'unknown';
  result: 'success' | 'error';
  url: string;
  token?: string;
  error?: string;
}
```

Fires only when a callback scheme is configured and reachable. `token` matches
`AnyConnectDispatchResult.token` from the request that caused it.

### `addUrlResultListener(listener): Unsubscribe`

```ts
interface AnyConnectUrlResultEvent {
  action?: string;
  url: string;
  success: boolean;
  error?: string;
}
```

Low-level: fires whenever a URI is handed to the OS. The most useful signal here is
`success: false`, which usually means AnyConnect is missing or its URI External Control is disabled.

### `handleCallbackUrl(url): boolean`

Feeds a deep link into the module manually. Returns `true` when the URL was recognised as an
AnyConnect callback and dispatched to listeners.

```ts
CiscoAnyConnect.configure({ autoWireDeepLinks: false });

Linking.addEventListener('url', ({ url }) => {
  if (!CiscoAnyConnect.handleCallbackUrl(url)) {
    router.navigate(url); // your own deep link
  }
});
```

### `getCallbackScheme(): string | false`

The scheme AnyConnect will open to report outcomes. Useful in diagnostics screens and bug reports.

### `dispose(): void`

Removes every native and `Linking`/`AppState` subscription, and resets the tracked state, resolved
scheme and initialisation promise. Intended for tests and teardown; the client is reusable
afterwards, but `configure` must be called again.

---

## React hooks

### `useAnyConnect(): AnyConnectStateSnapshot`

Subscribes to state changes and calls `refresh()` once on mount.

```tsx
const { state, vpnTransportActive, anyConnectInstalled } = useAnyConnect();
```

### `useAnyConnectCallback(listener): void`

Runs `listener` on every connection outcome. The latest listener is always called without
re-subscribing.

```tsx
useAnyConnectCallback((event) => {
  if (event.action === 'connect' && event.result === 'error') showToast(event.error);
});
```

---

## Low-level exports

### `isNativeModuleAvailable: boolean`

`false` in Expo Go, on the web, and under Jest. Use it to render a "not supported here" state without
catching exceptions.

### `UriHandlerTransport`, `AnyConnectTransport`

The shipped transport and the interface to implement for a different one. See
[Architecture](architecture.md#the-transport-seam).

### URI helpers

All pure and unit tested. `encodeValue` and `parseCallbackUrl` are exported mainly so you can build
and interpret `anyconnect://` links outside React Native (email, MDM, web).

| Export | Signature | Purpose |
| --- | --- | --- |
| `buildCreateConnectionUri` | `(options: AnyConnectConnectionOptions) => string` | `anyconnect://create/?…` |
| `buildConnectUri` | `(options: AnyConnectConnectOptions) => string` | `anyconnect://connect/?…` |
| `buildDisconnectUri` | `(onSuccess?: string) => string` | `anyconnect://disconnect` |
| `buildImportProfileUri` | `(uri: string) => string` | `anyconnect://import/?type=profile&…` |
| `buildImportCertificateUri` | `(options) => string` | `anyconnect://import/?type=pkcs12&…` |
| `buildLocalizeUri` | `(options) => string` | `anyconnect://import/?type=localization&…` |
| `buildCloseUri` | `() => string` | `anyconnect://close` |
| `buildCallbackUrl` | `(scheme, params) => string` | Builds this module's own callback URL. |
| `parseCallbackUrl` | `(url: string) => AnyConnectCallbackEvent \| null` | Returns `null` for anything that is not a callback. |
| `connectionQueryParameters` | `(options) => [string, string][]` | Ordered query parameters, pre-encoding. |
| `encodeValue` | `(value: string, opts?) => string` | Percent-encoding with Cisco's quirks (`keepSlashes`). |
| `CALLBACK_PATH` | `'anyconnect/callback'` | Path segment of this module's callback URLs. |

### `CiscoAnyConnectError` / `CiscoAnyConnectErrorCode`

Every rejected promise is a `CiscoAnyConnectError` carrying a stable `code`.

```ts
import { CiscoAnyConnectError } from 'expo-cisco-anyconnect';

try {
  await CiscoAnyConnect.connect({ host });
} catch (error) {
  if (error instanceof CiscoAnyConnectError) {
    switch (error.code) {
      case 'NO_HANDLER': /* AnyConnect missing, or URI External Control disabled */
      case 'INVALID_ARGUMENTS': /* bad call */
      case 'NATIVE_MODULE_UNAVAILABLE': /* Expo Go / web */
    }
  }
}
```

| Code | Raised when |
| --- | --- |
| `NATIVE_MODULE_UNAVAILABLE` | The native module is not in this build (Expo Go, web). |
| `INVALID_ARGUMENTS` | Required input missing (`connect` without `host`/`name`, `createConnection` without `name`, …). |
| `NO_HANDLER` | The URI was dispatched but nothing claimed it. |

---

## Type exports

All public types are exported from the package root:
`AnyConnectAppInfo`, `AnyConnectAuthMode`, `AnyConnectCallbackEvent`,
`AnyConnectConfigureOptions`, `AnyConnectConnectOptions`, `AnyConnectConnectionOptions`,
`AnyConnectDispatchResult`, `AnyConnectImportCertificateOptions`, `AnyConnectLocalizeOptions`,
`AnyConnectProtocol`, `AnyConnectState`, `AnyConnectStateChangeEvent`, `AnyConnectStateSnapshot`,
`AnyConnectStateSource`, `AnyConnectTransport`, `AnyConnectUrlResultEvent`, `CiscoAnyConnectErrorCode`,
`Unsubscribe`.
