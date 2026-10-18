# Android guide

## What the module uses

Plain `Intent` + `PackageManager` + `ConnectivityManager`. No AIDL, no VPN service of our own, no
Cisco SDK.

| Call | Implementation |
| --- | --- |
| `isInstalled()` | `resolveActivity` for `anyconnect://`, then a `getPackageInfo` fallback over known packages |
| `getAppInfo()` | `PackageManager` metadata for the resolved package |
| `openUrl()` | `startActivity(ACTION_VIEW)` from the current activity, `ACTIVITY_NOT_FOUND` mapped to `false` |
| `getAppUrlSchemes()` | Your own package's intent filters (`GET_INTENT_FILTERS`) |
| `getState()` | `ConnectivityManager` → `TRANSPORT_VPN` on the active network |

## URI External Control

AnyConnect refuses external URIs unless its profile allows them. This is the single most common cause
of "nothing happens" on Android.

The profile key is **`vpn_setting_uri_external_control`**:

| Value | Behaviour |
| --- | --- |
| `prompted` *(default)* | AnyConnect asks the user to allow the request, then proceeds. |
| `enabled` | The request runs with no prompt. Use this for kiosk / managed fleets. |
| `disabled` | The request is silently ignored. |

When it is `disabled`, `connect()` rejects with `NO_HANDLER`, and `addUrlResultListener` reports
`success: false`. There is no way for your app to detect or change this setting — it belongs to the
AnyConnect profile, which is pushed by the headend or an MDM.

## MDM / managed configuration

If you deploy an EMM (Intune, Workspace ONE, Knox Manage, ChromeOS admin console…), these are the
AnyConnect managed configuration keys that matter when pairing it with this module. Keys are the same
names Cisco documents; the `vpn_configuration_list` array is how you push several entries at once.

| Key | Purpose |
| --- | --- |
| `vpn_connection_host` | **Required.** Headend URL. |
| `vpn_connection_name` | Display name; defaults to the host. |
| `vpn_connection_profile` | `SSL` (default) or `IPsec`. |
| `vpn_connection_ipsec_auth_mode` | `EAP-AnyConnect` (default), `EAP-GTC`, `EAP-MD5`, `EAP-MSCHAPv2`, `IKE-RSA`. |
| `vpn_connection_ipsec_ike_identity` | IKE identity; only for `EAP_GTC`, `EAP-MD5`, `EAP-MSCHAPv2`. |
| `vpn_connection_keychain_cert_alias` | Keychain certificate alias for the entry. |
| `vpn_connection_allowed_apps` / `vpn_connection_disallowed_apps` | Comma-separated package names, for Per-App VPN. |
| `vpn_connection_allow_bypass` | Let apps bypass the tunnel. |
| `vpn_connection_set_active` | Make this the selected entry (default `true`). |
| `vpn_setting_replace_existing_profile` | Whether the managed profile replaces one pushed by the headend. |
| `vpn_setting_uri_external_control` | `prompted` / `enabled` / `disabled` — **the one that gates this module**. |
| `vpn_setting_strict_mode` | Strict Certificate Trust. |
| `vpn_setting_certificate_revocation` | OCSP checking. |
| `vpn_setting_fips_mode` | FIPS mode. |
| `vpn_setting_allowed_saved_credentials` | Allow saved credentials (default `false`). |
| `vpn_connection_device_id` | Fixed device identifier reported to the headend. |
| `vpn_connection_report_hardware_id` | Report MAC/IMEI for authentication. |
| `vpn_connection_profile` (XML) | Inline or Base64 AnyConnect profile XML to import. |
| `accept_seula_for_user` | Skip the end-user licence prompt on managed devices. |

Per-entry keys inside `vpn_configuration_list` use the same names without the `vpn_connection_`
prefix: `vpn_name`, `vpn_host`, `vpn_protocol`, `vpn_ipsec_auth_mode`, `vpn_ipsec_ike_identity`,
`vpn_keychain_cert_alias`, `vpn_allowed_apps`, `vpn_disallowed_apps`, `vpn_allow_bypass`,
`vpn_set_active`.

Pair a managed configuration with `vpn_setting_uri_external_control: "enabled"` if you want your app
to drive the connection without a per-request prompt.

> Deployment detail: Cisco's managed-configuration keys and their exact semantics are documented in
> the [AnyConnect Administrator Guide, *AnyConnect on Mobile Devices*](https://www.cisco.com/c/en/us/td/docs/security/vpn_client/anyconnect/anyconnect49/administration/guide/b_AnyConnect_Administrator_Guide_4-9/b_AnyConnect_Administrator_Guide_4-4_chapter_01101.html).
> Cisco changes these between releases, so confirm against the guide for the version you ship.

## Package visibility (Android 11+)

Since API 30, an app cannot see other installed apps unless it declares them. Without this, both
`isInstalled()` and deep-link dispatch **silently fail** — `resolveActivity` returns `null` even
though AnyConnect is installed.

The library manifest ships the declarations, and the manifest merger folds them into your app:

```xml
<queries>
  <intent>
    <action android:name="android.intent.action.VIEW" />
    <data android:scheme="anyconnect" />
  </intent>
  <package android:name="com.cisco.anyconnect.vpn.android.avf" />
  <package android:name="com.cisco.anyconnect.vpn.android" />
  <package android:name="com.cisco.anyconnect.vpn.android.nodpi" />
</queries>
```

The config plugin writes the same block. If you strip library manifests or use a restrictive
`android:tools:node` policy, either keep the plugin enabled or copy these entries into your own
manifest.

### Known packages

| Package | Ships |
| --- | --- |
| `com.cisco.anyconnect.vpn.android.avf` | Cisco Secure Client (formerly AnyConnect) — current |
| `com.cisco.anyconnect.vpn.android` | Legacy AnyConnect |
| `com.cisco.anyconnect.vpn.android.nodpi` | Legacy AnyConnect variant |

Scheme resolution is tried first, so an unknown future package name still works as long as it handles
`anyconnect://`.

## Activity launch mode

Callback URLs arrive through `onNewIntent` when your app is already running, which requires the main
activity to be `singleTask` or `singleTop`. Expo already imposes `singleTask` for its own `scheme`
handling, so this normally needs no action. The plugin can force it if your project is unusual:

```json
{ "plugins": [["expo-cisco-anyconnect", { "androidLaunchMode": "singleTask" }]] }
```

If your app is launched cold by the callback URL, the module reads the launch intent instead and
queues the URL until JavaScript is ready. Both paths are covered — see
[Architecture § Callback routing](architecture.md#callback-routing).

## State observation

`getState().state` on Android is derived from whether the system's active network has the
`TRANSPORT_VPN` capability. This is a real observation, not an inference from what the module asked
for, and it works even when the user connected from the AnyConnect app directly.

Two consequences:

- **It is system-wide.** Another VPN app being active sets it too. There is no public API to
  attribute a tunnel to AnyConnect specifically.
- **It is only true once the tunnel is up.** Immediately after `connect()` the state may briefly read
  `disconnected`. That is accurate: `source: 'request'` events are intent, `source: 'system'` events
  are observation.

Observation starts when the first `onAnyConnectStateChange` listener is added and stops when the last
one is removed, so there is no cost if you never subscribe.

The `ACCESS_NETWORK_STATE` permission the module needs is declared in the library manifest.

## Permissions

The module adds exactly one:

```xml
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

For auditors, these are the permissions on the **AnyConnect app itself** (not on your app), as Cisco
documents them: `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `BROADCAST_STICKY`, `INTERNET`,
`READ_EXTERNAL_STORAGE`, `READ_LOGS`, `READ_PHONE_STATE`, `RECEIVE_BOOT_COMPLETED`.

## Platform notes

- **Android Enterprise work profiles.** AnyConnect may be installed inside the work profile rather
  than the personal one. Whether your app can resolve and launch it then depends on the profile's
  cross-profile configuration. Verify on your actual fleet; the module's `<queries>` block only
  removes the *package visibility* obstacle, not a policy one.
- **Disconnect callbacks.** The `onsuccess` action is Android-only for the `disconnect` URI, so the
  transport appends it there and omits it on iOS.
- **AnyConnect always closes its UI** after a successful or failed connection on Android, which is
  why your app reliably regains focus and why callbacks work well here.

## Verifying a deployment

```ts
await CiscoAnyConnect.isInstalled(); // false → not installed, or package visibility is blocked
await CiscoAnyConnect.getAppInfo(); // null  → not installed

try {
  await CiscoAnyConnect.connect({ host: 'vpn.example.com' });
} catch (error) {
  // NO_HANDLER → AnyConnect is missing, or URI External Control is disabled
  console.warn(error.code);
}
```

A "nothing happened, no error" report is almost always `vpn_setting_uri_external_control`. See
[Troubleshooting](troubleshooting.md#connect-throws-no_handler).
