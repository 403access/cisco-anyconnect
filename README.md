# expo-cisco-anyconnect

Drive the **Cisco Secure Client / AnyConnect** app from a React Native (Expo) app, using Cisco's
documented `anyconnect://` URI handler — then observe the resulting tunnel state.

No Cisco SDK, no NDA, no Network Extension entitlement, no `BIND_VPN_SERVICE` service of your own.

```ts
import CiscoAnyConnect from 'expo-cisco-anyconnect';

await CiscoAnyConnect.connect({ host: 'vpn.example.com' });
```

- [What this module does (and does not do)](#what-this-module-does-and-does-not-do)
- [Requirements](#requirements)
- [Installation](#installation)
- [Setup](#setup)
- [Quick start](#quick-start)
- [Connection callbacks](#connection-callbacks)
- [State semantics](#state-semantics)
- [API](#api)
- [URI reference](#uri-reference)
- [Using a different transport (Cisco SDK / in-app tunnel)](#using-a-different-transport)
- [Troubleshooting](#troubleshooting)
- [Licensing](#licensing)
- [Development](#development)
- [Documentation](#documentation)

## Documentation

| Document | Contents |
| --- | --- |
| [API reference](docs/api.md) | Every function, option, event, type and error code. |
| [Architecture](docs/architecture.md) | How the pieces fit together, and the connect/callback flows. |
| [Android guide](docs/android.md) | URI External Control, MDM managed config, package visibility. |
| [iOS guide](docs/ios.md) | Query schemes, Connect On-Demand, why state is limited. |
| [Config plugin](docs/config-plugin.md) | Plugin options and exactly what they write. |
| [Troubleshooting](docs/troubleshooting.md) | Symptom → cause → fix. |
| [Development](DEVELOPMENT.md) | Build, test, native iteration, releasing. |
| [Contributing](CONTRIBUTING.md) | Conventions and PR expectations. |
| [Website](website/) | The static site, including these docs rendered from Markdown, and how to deploy it. |

## What this module does (and does not do)

Cisco does not publish an embeddable AnyConnect SDK. Shipping the tunnel inside your own app requires
Cisco's partner SDK (NDA + paid licence) *and*, on iOS, Apple's `packet-tunnel-provider` entitlement.
What Cisco **does** document publicly is a URI handler that lets another app drive the installed
AnyConnect client. This module wraps that surface properly: typed options, validated input, correct
percent-encoding, availability detection, and a way to get the connection result back.

**Supported:**

- Detect whether AnyConnect is installed and read its version (Android).
- Add a connection entry, connect, disconnect.
- Import a client profile (XML), a PKCS#12 certificate, or localization data.
- Create a connection entry with `protocol`, `authentication`, `ike-identity`, certificate and
  iOS Connect-on-Demand options.
- Receive the connect/disconnect result through a callback URL, and emit typed events.
- Observe whether a VPN tunnel is up (Android; see [State semantics](#state-semantics)).

**Not supported (by design):**

- Creating the tunnel in-process. Your app is a *controller*; AnyConnect performs the connection and
  shows its own UI.
- Driving AnyConnect silently. Cisco's flow is intentionally user-visible, and Android additionally
  requires *URI External Control* to be allowed in the AnyConnect profile.
- Establishing a tunnel from Expo Go. The module ships native code, so a development build is
  required.

## Requirements

| | |
| --- | --- |
| Expo SDK | 53+ (developed against SDK 58 / React Native 0.88) |
| iOS | 16.4+, Cisco Secure Client (AnyConnect) installed |
| Android | minSdk 24, Cisco Secure Client / AnyConnect installed |
| Runtime | A **development build** or release build — not Expo Go |

The app you integrate also needs its own URL `scheme` (see [Setup](#setup)) so AnyConnect can report
results back.

## Installation

```sh
npx expo install expo-cisco-anyconnect
```

Then add the config plugin and rebuild:

```sh
npx expo prebuild --clean
npx expo run:ios     # or: npx expo run:android
```

## Setup

Add the plugin to your app config. It performs two pieces of native configuration that JavaScript
cannot do:

```json
{
  "expo": {
    "scheme": "myapp",
    "plugins": [
      [
        "expo-cisco-anyconnect",
        {
          "callbackScheme": "myapp"
        }
      ]
    ]
  }
}
```

- **iOS** — adds `anyconnect` to `LSApplicationQueriesSchemes`. Without it, `canOpenURL` always
  answers *no*, so `isInstalled()` would return `false` on a device that has AnyConnect installed.
- **iOS + Android** — registers `callbackScheme` so AnyConnect's `onsuccess` / `onerror` URLs route
  back into your app.

`callbackScheme` defaults to the first `scheme` in your app config, so if you already have `scheme`
set you can omit it entirely. If you have several schemes, pass the one you want explicitly:

```json
{ "plugins": [["expo-cisco-anyconnect", { "callbackScheme": "myapp" }]] }
```

Pass `false` to disable callbacks (you will then only know what you *asked* AnyConnect to do).

### Android: URI External Control

AnyConnect ignores external URIs unless its profile allows them. The profile key is
`vpn_setting_uri_external_control`, with values `prompted` (default), `enabled` and `disabled`.

- `prompted` — AnyConnect asks the user to allow the request. Fine for interactive flows.
- `enabled` — the request runs without a prompt. Use this for kiosk / managed fleets.
- `disabled` — dispatch silently does nothing. `connect()` will throw, and
  `addUrlResultListener` reports `success: false`.

On Android 11+, package visibility is handled for you: the library manifest ships a `<queries>` block
covering the `anyconnect` scheme and the known AnyConnect packages, which the manifest merger folds
into your app.

## Quick start

```ts
import CiscoAnyConnect, { useAnyConnect, useAnyConnectCallback } from 'expo-cisco-anyconnect';

// Configure once, as early as possible, so callback URLs are wired before the first connection.
CiscoAnyConnect.configure({ callbackScheme: 'myapp' });

// Is the client installed?
if (await CiscoAnyConnect.isInstalled()) {
  await CiscoAnyConnect.connect({
    name: 'Corp VPN',           // connection entry label (Description)
    host: 'vpn.example.com',    // FQDN, IP, or Group URL
  });
}

// The callback lands here after AnyConnect finishes.
CiscoAnyConnect.addCallbackListener((event) => {
  if (event.action === 'connect' && event.result === 'error') {
    console.warn('VPN failed:', event.error);
  }
});
```

React:

```tsx
export function VpnStatus() {
  const { state, vpnTransportActive, anyConnectInstalled } = useAnyConnect();
  const [error, setError] = useState<string | undefined>();

  useAnyConnectCallback((event) => {
    if (event.action === 'connect' && event.result === 'error') setError(event.error);
  });

  return (
    <>
      <Text>Installed: {String(anyConnectInstalled)}</Text>
      <Text>State: {state}</Text>
      <Text>Tunnel up: {String(vpnTransportActive)}</Text>
      {error ? <Text>Last error: {error}</Text> : null}
    </>
  );
}
```

Credentials can be prefilled, but read this first:

> **Only prefill one-time passwords.** The generated URI is handed to the AnyConnect app; it can
> appear in device logs and is observable on the device. Cisco documents `prefill_password` for use
> "only in conjunction with a One Time Password (OTP) infrastructure". Keep long-lived secrets out of
> URIs and let the user type them into AnyConnect, or move to certificate-based authentication.

## Connection callbacks

The AnyConnect URI handler is fire-and-forget: `connect` opens the AnyConnect app and returns
immediately. The outcome comes back later, two different ways.

**1. Callback URLs (both platforms).** When a callback scheme is configured, the module embeds
`onsuccess` and `onerror` actions pointing at your own app:

```
anyconnect://connect/?name=Corp%20VPN&host=vpn.example.com
  &onsuccess=myapp%3A%2F%2Fanyconnect%2Fcallback%3Faction%3Dconnect%26result%3Dsuccess%26token%3D...
  &onerror=myapp%3A%2F%2Fanyconnect%2Fcallback%3Faction%3Dconnect%26result%3Derror
```

AnyConnect opens that URL, your app regains focus and the module emits a typed
`AnyConnectCallbackEvent` on `addCallbackListener`. `AnyConnectDispatchResult.token` lets you
correlate a result with the request that caused it — useful when a user fires off several attempts.

How the URL reaches the module:

- **Android** — captured natively (`OnNewIntent`, or the launch intent on cold start), so it works
  with no extra wiring, even if your app was killed.
- **iOS** — via React Native's `Linking`, which the module subscribes to automatically.

If your app has its own deep-link router and you would rather forward URLs yourself, disable the
built-in wiring and call `handleCallbackUrl`:

```ts
CiscoAnyConnect.configure({ callbackScheme: 'myapp', autoWireDeepLinks: false });

Linking.addEventListener('url', ({ url }) => {
  if (!CiscoAnyConnect.handleCallbackUrl(url)) {
    // Not an AnyConnect callback — route it yourself.
  }
});
```

**2. System VPN state (Android only).** Android exposes whether a VPN transport is up, which the
module watches and reports as `onAnyConnectStateChange`.

## State semantics

Be deliberate about this: the two platforms can tell you different amounts.

| Field | Android | iOS |
| --- | --- | --- |
| `state` | `connected` / `disconnected`, derived from the system VPN transport — real, even when your app was never involved | `unknown` until a callback arrives; then `connected` / `disconnected` |
| `vpnTransportActive` | `true` / `false` | `null` (not observable) |
| `anyConnectInstalled` | `true` / `false` from `PackageManager` | `true` / `false` from `canOpenURL` |

Two caveats worth knowing:

- On Android, "a VPN transport is up" is a system-wide fact. If the user has another VPN app active,
  the flag is set for it too. The module cannot attribute a tunnel to AnyConnect specifically —
  there is no public API for that.
- `state` can also be driven by what the module *asked* for (`source: 'request'`). A state change
  event carries its `source`: `system`, `callback`, or `request`, so you can tell observation from
  intent.

## API

### `configure(options)`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `callbackScheme` | `string \| false` | auto-detected | Scheme AnyConnect opens to report results. `false` disables callbacks. |
| `autoWireDeepLinks` | `boolean` | `true` | Subscribe to `Linking` automatically on iOS. |

### Availability

```ts
CiscoAnyConnect.isInstalled(): Promise<boolean>
CiscoAnyConnect.getAppInfo(): Promise<AnyConnectAppInfo | null>
```

`getAppInfo` returns `{ platform, packageName, versionName, versionCode, appName, source }`. iOS
cannot read another app's bundle metadata, so it returns a best-effort constant when AnyConnect is
present.

### Actions

Every action resolves to `AnyConnectDispatchResult`:

```ts
{ url: string; dispatched: boolean; action: string; token?: string }
```

```ts
CiscoAnyConnect.createConnection(options): Promise<AnyConnectDispatchResult>
CiscoAnyConnect.connect(options): Promise<AnyConnectDispatchResult>
CiscoAnyConnect.disconnect(): Promise<AnyConnectDispatchResult>
CiscoAnyConnect.importProfile(url): Promise<AnyConnectDispatchResult>
CiscoAnyConnect.importCertificate({ uri }): Promise<AnyConnectDispatchResult>
CiscoAnyConnect.localize({ lang, host }): Promise<AnyConnectDispatchResult>
CiscoAnyConnect.closeGui(): Promise<AnyConnectDispatchResult>   // iOS
```

`AnyConnectConnectionOptions` (shared by `createConnection` and `connect`):

| Option | Notes |
| --- | --- |
| `name` | Connection entry label (the *Description* field). Case-sensitive, unique, ≤24 chars recommended. |
| `host` | FQDN, IP address, or Group URL of the secure gateway. |
| `protocol` | `'SSL'` (default) or `'IPsec'`. |
| `authentication` | IPsec only: `'EAP-AnyConnect'`, `'EAP-GTC'`, `'EAP-MD5'`, `'EAP-MSCHAPv2'`, `'IKE-RSA'`. |
| `ikeIdentity` | IPsec only; required for `EAP-GTC` / `EAP-MD5` / `EAP-MSCHAPv2`. |
| `keychainAlias` | Android: certificate in the system store to copy into the AnyConnect store. |
| `useCert` | Whether AnyConnect may auto-select a client certificate (default `true`). |
| `certCommonName` | Common Name of the certificate to bind to the entry. |
| `netRoam` | iOS: optimise for a sustained connection (`true`) or battery (`false`). |
| `useOnDemand` | iOS: allow Connect-on-Demand. |
| `domainListAlways` / `domainListIfNeeded` / `domainListNever` | iOS: domains that may / may-after-DNS-failure / must-not bring the tunnel up. Requires `useOnDemand`. |

`AnyConnectConnectOptions` adds `username`, `password`, `secondaryUsername`, `secondaryPassword`,
`group`, `onSuccess`, `onError`, and `closeOnSuccess` (iOS).

> `closeOnSuccess` and the success callback are mutually exclusive on iOS, because Cisco accepts a
> single `onsuccess` action there. `closeOnSuccess` wins, and only failures are reported back.

### State

```ts
CiscoAnyConnect.getState(): AnyConnectStateSnapshot   // synchronous, last known
CiscoAnyConnect.refresh(): Promise<AnyConnectStateSnapshot>
```

### Events

```ts
CiscoAnyConnect.addStateListener((event: AnyConnectStateChangeEvent) => void): Unsubscribe
CiscoAnyConnect.addCallbackListener((event: AnyConnectCallbackEvent) => void): Unsubscribe
CiscoAnyConnect.addUrlResultListener((event: AnyConnectUrlResultEvent) => void): Unsubscribe

CiscoAnyConnect.handleCallbackUrl(url: string | null | undefined): boolean
```

`AnyConnectStateChangeEvent` — `{ state, source, vpnTransportActive, timestamp }`
`AnyConnectCallbackEvent` — `{ action: 'connect' | 'disconnect' | 'unknown', result: 'success' | 'error', url, token?, error? }`
`AnyConnectUrlResultEvent` — `{ url, success, error?, action? }` (low-level; useful for "nothing
handled the link")

React hooks: `useAnyConnect()` → `AnyConnectStateSnapshot`, `useAnyConnectCallback(listener)`.

## URI reference

The module's builders (`src/uri.ts`) map 1:1 onto Cisco's documented URIs. Exported so you can build
your own links — for an email, an MDM push, or a web page — with the same encoding rules.

| Module call | URI produced |
| --- | --- |
| `createConnection({ name, host })` | `anyconnect://create/?name=..&host=..` |
| `connect({ host })` | `anyconnect://connect/?host=..&onsuccess=..&onerror=..` |
| `disconnect()` | `anyconnect://disconnect` |
| `importProfile(url)` | `anyconnect://import/?type=profile&uri=..` |
| `importCertificate({ uri })` | `anyconnect://import/?type=pkcs12&uri=..` |
| `localize({ lang, host })` | `anyconnect://import/?type=localization&lang=..&host=..` |
| `closeGui()` | `anyconnect://close` |

Also exported: `buildCallbackUrl`, `parseCallbackUrl`, `encodeValue`, `connectionQueryParameters`.

## Using a different transport

The public API is transport-agnostic. `UriHandlerTransport` is the implementation that ships today;
to move to Cisco's partner SDK or an in-process tunnel later, implement `AnyConnectTransport` and
swap it in — no changes for consuming apps.

```ts
import CiscoAnyConnect, { type AnyConnectTransport } from 'expo-cisco-anyconnect';

class CiscoSdkTransport implements AnyConnectTransport {
  readonly id = 'ciscoSdk';
  async isAvailable() { /* ... */ }
  async getAppInfo() { /* ... */ }
  async createConnection(options) { /* ... */ }
  async connect(options) { /* ... */ }
  async disconnect() { /* ... */ }
  async importProfile(url) { /* ... */ }
  async importCertificate(options) { /* ... */ }
  async localize(options) { /* ... */ }
  async closeGui() { /* ... */ }
}

CiscoAnyConnect.setTransport(new CiscoSdkTransport());
```

`CiscoAnyConnect.transportId` reports which transport is active.

## Troubleshooting

The three that account for most reports:

**`connect()` throws `NO_HANDLER`.** AnyConnect is not installed, or its URI External Control is
disabled. Check `isInstalled()` / `getAppInfo()`, then set `vpn_setting_uri_external_control` to
`prompted` or `enabled` in the AnyConnect profile.

**`isInstalled()` returns `false` although AnyConnect is installed.** On iOS, `anyconnect` is missing
from `LSApplicationQueriesSchemes`; on Android, package visibility is blocked. Both are written by the
config plugin — re-run `npx expo prebuild --clean`.

**Callbacks never arrive.** Three things must line up: an app `scheme` (or a plugin
`callbackScheme`), a plugin run during prebuild, and the scheme the app actually registered.
`CiscoAnyConnect.getCallbackScheme()` shows which one is in use.

The full symptom → cause → fix list, including a diagnostics dump to paste into bug reports, is in
[docs/troubleshooting.md](docs/troubleshooting.md).

## Licensing

This package is MIT licensed, but it orchestrates **Cisco's proprietary client**, which is governed
separately:

- Using Cisco Secure Client / AnyConnect requires an active Cisco licence (Advantage/Plus or
  Premier/Apex, or VPN Only). Check with your Cisco account team.
- AnyConnect may only connect to Cisco headends (ASA, Firepower/FTD, IOS/IOS-XE routers). Using it
  against non-Cisco servers is not permitted.
- AnyConnect and Cisco Secure Client are trademarks of Cisco Systems, Inc. This project is not
  affiliated with or endorsed by Cisco.

The module contains none of Cisco's code, links no Cisco binaries, and ships no tunnel implementation
— it only generates documented deep links.

## Development

```sh
npm install
npm run build        # src → build/, plugin/src → plugin/build/
npm test             # 44 tests: URI builders, callback parser, facade, config plugin
npm run typecheck    # tsc over src + plugin/src, including tests
npm run lint
```

The example app consumes the module through `file:..`, so build first, then:

```sh
cd example && npm install && npm run ios    # or: npm run android
```

Full setup, the native iteration loop, testing strategy (and its limits), and the release checklist:
[DEVELOPMENT.md](DEVELOPMENT.md). Conventions and scope: [CONTRIBUTING.md](CONTRIBUTING.md).
