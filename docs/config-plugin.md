# Config plugin

```json
{
  "expo": {
    "scheme": "myapp",
    "plugins": ["expo-cisco-anyconnect"]
  }
}
```

The plugin exists because two pieces of native configuration cannot be done from JavaScript. It is
wrapped in `createRunOncePlugin`, so listing it twice is harmless.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `querySchemes` | `string[]` | `['anyconnect']` | Schemes appended to `LSApplicationQueriesSchemes` (iOS). Pass `[]` to opt out. |
| `callbackScheme` | `string \| false` | first `scheme` in the app config | Scheme AnyConnect opens to report outcomes. `false` disables callbacks. |
| `androidQueries` | `boolean` | `true` | Write the `<queries>` block for Android 11+ package visibility. |
| `androidLaunchMode` | `'standard' \| 'singleTop' \| 'singleTask' \| 'singleInstance'` | *leave as-is* | Force `android:launchMode` on the main activity. |

`callbackScheme` accepts either form — `myapp` or `myapp://` are both normalised to `myapp`.

When neither `callbackScheme` nor a `scheme` in the app config is present, the plugin logs a warning
and skips callback registration. Connection results then cannot be reported; the module can still
dispatch commands.

## What it writes

### iOS — `Info.plist`

```xml
<!-- from querySchemes -->
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>anyconnect</string>
</array>

<!-- from callbackScheme; skipped when the scheme is already registered -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>myapp.anyconnect</string>
    <key>CFBundleURLSchemes</key>
    <array><string>myapp</string></array>
  </dict>
</array>
```

Both operations are idempotent: existing entries are detected and not duplicated, which matters
because Expo's own `scheme` handling may have written `CFBundleURLTypes` already.

### Android — `AndroidManifest.xml`

```xml
<!-- from androidQueries (skipped if an equivalent entry already exists) -->
<queries>
  <intent>
    <action android:name="android.intent.action.VIEW" />
    <data android:scheme="anyconnect" />
  </intent>
  <package android:name="com.cisco.anyconnect.vpn.android.avf" />
  <package android:name="com.cisco.anyconnect.vpn.android" />
  <package android:name="com.cisco.anyconnect.vpn.android.nodpi" />
</queries>

<!-- from callbackScheme, on the main activity -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="myapp" />
</intent-filter>
```

### What it deliberately does not touch

- **Permissions.** `ACCESS_NETWORK_STATE` comes from the library manifest, which the merger folds in.
- **Entitlements.** None are needed — the module is a controller, not a tunnel.
- **`android:exported`.** Callback filtering relies on the existing activity attributes.
- **Expo's `scheme` handling.** The plugin only adds what is missing.

## Recipes

**Minimal — reuse your existing app scheme**

```json
{
  "expo": {
    "scheme": "myapp",
    "plugins": ["expo-cisco-anyconnect"]
  }
}
```

**Explicit callback scheme**

```json
{
  "expo": {
    "scheme": ["myapp", "myapp-dev"],
    "plugins": [["expo-cisco-anyconnect", { "callbackScheme": "myapp" }]]
  }
}
```

**Managed / MDM deployment, no user prompt**

Combine with the AnyConnect profile key `vpn_setting_uri_external_control: "enabled"` — see the
[Android guide](android.md#uri-external-control).

**Disable callbacks entirely**

```json
{ "plugins": [["expo-cisco-anyconnect", { "callbackScheme": false }]] }
```

**Tight query-scheme budget**

```json
{ "plugins": [["expo-cisco-anyconnect", { "querySchemes": [] }]] }
```

`isInstalled()` will then always return `false` on iOS, but `connect()` still works — `openUrl` does
not consult the query list.

**Strip library manifests**

If your project removes or rewrites third-party manifest entries, keep `androidQueries: true` so the
plugin re-adds what Android 11+ needs.

## Applying changes

Plugin output is consumed at prebuild time. A Metro reload will not pick it up:

```sh
npx expo prebuild --clean
npx expo run:ios      # or: npx expo run:android
```

## Using it without the plugin

Everything the plugin writes can be done by hand:

- iOS: add `anyconnect` to `LSApplicationQueriesSchemes`; if you want callbacks, ensure a scheme is
  registered in `CFBundleURLTypes` (Expo does this for you when `scheme` is set).
- Android: keep the `<queries>` block, and make sure the main activity has a `VIEW` intent filter for
  your callback scheme and `launchMode="singleTask"`.

The plugin is strongly recommended for iOS: without the query-scheme entry, `isInstalled()` silently
returns `false`.
