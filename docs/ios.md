# iOS guide

## What the module uses

Only Apple's public URL APIs — `UIApplication.canOpenURL` / `openURL`, and your app's own `Info.plist`
entries. No Network Extension, no `packet-tunnel-provider` entitlement, no Cisco SDK.

| Call | Implementation |
| --- | --- |
| `isInstalled()` | `UIApplication.canOpenURL(URL("anyconnect://"))` |
| `getAppInfo()` | Best-effort constant when the app is present (iOS cannot read another app's bundle) |
| `openUrl()` | `canOpenURL` pre-check, then `UIApplication.open` |
| `getAppUrlSchemes()` | `CFBundleURLTypes` from `Info.plist` |
| `getState()` | Always `state: 'unknown'`, `vpnTransportActive: null` |

## Query schemes

`canOpenURL` is a question the OS will not answer about arbitrary apps: for any scheme not declared in
`LSApplicationQueriesSchemes`, it returns `false` regardless of what is installed. Without the entry,
`isInstalled()` reports `false` on a device that has AnyConnect installed.

The [config plugin](config-plugin.md) adds it:

```xml
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>anyconnect</string>
</array>
```

Two things worth knowing:

- **There is a limit of 50 entries.** If your app already declares close to that, trim elsewhere or
  set `querySchemes: []` and drive the app by dispatching URIs without ever calling `isInstalled()` —
  `openUrl` does not consult the query list.
- **Apple reviews query schemes.** Declaring `anyconnect` is legitimate (it is the documented
  integration surface for a VPN client), but reviewers may ask why. The plugin comment explains it in
  your own config if you use the `querySchemes` option explicitly.

## Callback scheme

The plugin registers your app's scheme in `CFBundleURLTypes` so AnyConnect's `onsuccess`/`onerror`
URLs route back:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key><string>myapp.anyconnect</string>
    <key>CFBundleURLSchemes</key><array><string>myapp</string></array>
  </dict>
</array>
```

If `scheme` is already set in your app config, Expo writes an equivalent entry and the plugin simply
leaves it alone. Custom schemes are all this needs — there is no universal-link or associated-domain
setup involved.

## Why state is limited on iOS

`getState()` on iOS always reports `state: 'unknown'` and `vpnTransportActive: null`. This is
deliberate, not a gap waiting to be filled.

- `NEVPNManager` reports the status of **your own** personal VPN configuration. Your app is not the
  VPN here — AnyConnect is — so it says nothing about any other app's tunnel.
- Network Extension gives no API to observe a tunnel owned by another app.
- The usual workaround is enumerating `utun`/`ipsec` interfaces via `getifaddrs`, which is both
  unreliable and a well-known App Store rejection risk. This module does not do that.

What you get instead:

| Signal | Where it comes from | Reliability |
| --- | --- | --- |
| `state: 'connecting'` | `source: 'request'`, immediately after `connect()` | Intent |
| `state: 'connected'` | `source: 'callback'`, when the `onsuccess` URL arrives | Real, per-connection |
| `state: 'disconnected'` | `source: 'callback'`, when the `onerror` URL arrives | Real, per-connection |

So on iOS the callback scheme is not a nicety — it is **the** state channel. Configure it. If your
users can also connect from the AnyConnect app directly, your app will not observe those sessions;
that is a platform limit, so treat `state` as a hint and gate destructive actions on an actual
attempt's callback rather than on the snapshot.

## Platform behaviour that differs from Android

### `closeOnSuccess` competes with the success callback

Cisco documents a single `onsuccess` action on iOS. When `closeOnSuccess` is `true`, the module uses
that slot for `anyconnect://close`, so the AnyConnect UI dismisses but **no success event fires**.
Failures still arrive through `onerror`.

If you need the success event, drop `closeOnSuccess` and let the callback open your app — which also
brings you to the foreground, just with AnyConnect left in the app switcher.

### Disconnect has no callback on iOS

The `onsuccess` parameter of the `disconnect` URI is Android-only in Cisco's documentation, so the
module omits it on iOS. After `disconnect()` you get the optimistic `disconnecting` /
`source: 'request'` transition and nothing more.

### Connect On-Demand (`useOnDemand`)

iOS can bring the tunnel up on its own when an app requests a matching domain. This is the only
platform where the module can configure it:

```ts
await CiscoAnyConnect.createConnection({
  name: 'Corp',
  host: 'vpn.example.com',
  useCert: true,
  certCommonName: 'example-ID',
  useOnDemand: true,
  domainListAlways: ['email.example.com', 'pay.examplecloud.com'],
  domainListIfNeeded: ['intranet.example.com'],
  domainListNever: ['www.example.com'],
});
```

`domainListAlways` or `domainListIfNeeded` is required when `useOnDemand` is `true`. Note Cisco's
caveat: posture information can be misreported when a connection is established purely by On-Demand
logic, because AnyConnect collects device information when its UI launches.

### Per-App VPN needs MDM

Cisco restricts per-app tunnelling on iOS to a **managed environment**. The user-level API in this
module cannot turn it on; your MDM/EMM configuration does. On iOS, multi-tunnel additionally requires
a `MultiTunnel` key set to `true` in the `VendorConfig` of the MDM VPN profile.

### SAML

When the headend uses SAML, authentication happens inside AnyConnect's embedded browser. Your app is
not involved and cannot observe it, so a `connect()` that needs SAML will sit in `connecting` until
the user finishes authenticating — or until the AnyConnect session times out. A long group-policy
idle timeout is the usual mitigation.

## Testing notes

- **Use a physical device.** Simulator VPN stacks do not behave like a device's, and AnyConnect's
  tunnel will not establish meaningfully. The URI handler may appear to work while the connection
  never does, which is a misleading signal.
- **Rebuild after changing the plugin.** `Info.plist` changes are captured at prebuild, not on a
  Metro reload: `npx expo prebuild --clean` then `npx expo run:ios`.
- **Check what is actually registered** when callbacks do not arrive:

  ```ts
  console.log(CiscoAnyConnect.getCallbackScheme()); // what AnyConnect will open
  ```

  If it prints `false`, your app has no custom scheme and the callback cannot route back.
