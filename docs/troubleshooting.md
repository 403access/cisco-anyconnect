# Troubleshooting

Pair this with the platform guides: [Android](android.md) · [iOS](ios.md).
When reporting a problem, include the [diagnostics dump](#diagnostics-dump) below.

---

## `connect()` throws `NO_HANDLER`

*"expo-cisco-anyconnect: nothing handled the `connect` link."*

The URI was dispatched but no app claimed it. In order of likelihood:

1. **Android — URI External Control is off.** AnyConnect ignores external URIs unless its profile
   allows them. Set `vpn_setting_uri_external_control` to `prompted` or `enabled`. This is the most
   common cause by far, and it is invisible from your app: the intent is delivered and dropped.
2. **AnyConnect is not actually installed** on this device or profile. Confirm with
   `await CiscoAnyConnect.isInstalled()`.
3. **Android — package visibility.** On API 30+, `resolveActivity` returns `null` for undeclared
   packages. Keep the plugin's `androidQueries` enabled, or restore the library manifest's
   `<queries>` block. See [Android § Package visibility](android.md#package-visibility-android-11).
4. **You are in Expo Go.** The native module is absent; that raises `NATIVE_MODULE_UNAVAILABLE`
   instead. See [below](#native_module_unavailable-in-expo-go).

```ts
CiscoAnyConnect.addUrlResultListener((event) => {
  if (!event.success) console.warn('dispatch failed:', event.url, event.error);
});
```

---

## `isInstalled()` returns `false` but AnyConnect is installed

**On iOS** this is nearly always the missing query scheme — `canOpenURL` is always `false` for
undeclared schemes. Confirm the entry is present after a prebuild:

```sh
plutil -p ios/YourApp/Info.plist | grep -A3 LSApplicationQueriesSchemes
```

If it is absent, the plugin did not run: check it is listed in `app.json` `plugins`, and that you
re-ran `npx expo prebuild --clean`. If your app is near the 50-entry query-scheme limit, trim the
list; `connect()` still works with `querySchemes: []` because `openUrl` does not consult that list.

**On Android** it is package visibility. Check the merged manifest:

```sh
grep -A12 '<queries>' android/app/build/intermediates/merged_manifests/*/AndroidManifest.xml
```

An empty or missing block means something stripped it — see
[Android § Package visibility](android.md#package-visibility-android-11).

---

## Callbacks never arrive

`addCallbackListener` fires nothing, and the state stays at `connecting`.

Work through these in order:

1. **Is a scheme configured?** `CiscoAnyConnect.getCallbackScheme()` must print a string, not `false`.
   If it prints `false`, either your app config has no `scheme` or callbacks were disabled.
2. **Is the scheme registered with the OS?** iOS: `CFBundleURLTypes` in `Info.plist`. Android: a
   `VIEW` intent filter on the main activity. The plugin writes both; a prebuild is required.
3. **Is the app actually resumed?** iOS uses React Native's `Linking`. If your app has its own
   deep-link router that swallows URLs, either let the module see them first or disable auto-wiring
   and forward explicitly:

   ```ts
   CiscoAnyConnect.configure({ autoWireDeepLinks: false });
   Linking.addEventListener('url', ({ url }) => {
     if (!CiscoAnyConnect.handleCallbackUrl(url)) myRouter.navigate(url);
   });
   ```

4. **Did the connection actually succeed?** AnyConnect opens `onerror` on failure, which is still a
   callback — check `event.result`.
5. **`closeOnSuccess: true` on iOS.** This consumes the single `onsuccess` action, so a successful
   connect reports nothing. Failures still arrive. Drop `closeOnSuccess` if you need the event.

---

## The state sticks at `connecting`

Either the connection is genuinely still in flight — SAML authentication inside AnyConnect keeps it
open, and a slow headend does too — or the callback never came back (see above).

`connecting` is set the moment the URI is *dispatched* (`source: 'request'`), so it means "asked",
not "in progress". If you need certainty, drive UI off the callback event and treat a timeout as
failure:

```ts
const result = await CiscoAnyConnect.connect({ host });
// then race a timeout against addCallbackListener if you need a hard deadline.
```

---

## State is `connected` when nothing is connected (Android)

`getState()` on Android reports whether the system's active network has `TRANSPORT_VPN`. Another VPN
app being active sets the same flag — there is no public API to attribute a tunnel to AnyConnect
specifically. If you need per-attempt truth, use the callback event for the attempt you made.

---

## State flips to `disconnected` right after `connect()` (Android)

That is accurate, not a bug. The system VPN transport is not up yet during negotiation, and Android
state is an observation rather than a request echo. The sequence is normally:
`connecting` (`request`) → `connected` (`system`) once the tunnel is up.

Note that `refresh()` is deliberately not called when the app returns to the foreground, precisely so
this does not clobber an in-flight state. See
[Architecture § State machine](architecture.md#state-machine).

---

## The state is always `unknown` (iOS)

Expected. iOS gives an app no way to observe another app's Tunnel Provider, and the module will not
fake it with interface enumeration. Configure a callback scheme so the `onsuccess`/`onerror` URLs
supply real transitions. Full rationale in
[iOS § Why state is limited](ios.md#why-state-is-limited-on-ios).

---

## `NATIVE_MODULE_UNAVAILABLE` in Expo Go

The module ships custom native code, so Expo Go cannot load it. Create a development build:

```sh
npx expo run:ios      # or: npx expo run:android
```

The error carries `code: 'NATIVE_MODULE_UNAVAILABLE'` so you can branch on it. Use the exported
`isNativeModuleAvailable` boolean to render a fallback without catching:

```ts
import { isNativeModuleAvailable } from 'expo-cisco-anyconnect';

if (!isNativeModuleAvailable) return <Text>VPN control needs a development build.</Text>;
```

---

## Plugin changes have no effect

Native config is applied at prebuild, not on a Metro reload:

```sh
npx expo prebuild --clean
npx expo run:ios
```

Also confirm the plugin is actually in `app.json` → `expo.plugins`, and that you are not relying on a
stale `ios/` or `android/` directory from a previous prebuild.

---

## `importProfile` / `importCertificate` does nothing

AnyConnect fetches the URL **itself**, from the device. The URL must be reachable *on the device*, not
on your development machine:

| URL | Works? |
| --- | --- |
| `https://mdm.example.com/profile.xml` | yes |
| `file:///sdcard/profile.xml` | only if the file really exists on that device path |
| `http://localhost:8081/...` | no — that is the device's own loopback |

`importCertificate` accepts PKCS#12 only; other certificate types are not supported by Cisco.

---

## `localize()` does nothing

All three parameters are required by Cisco (`type=localization`, `lang`, `host`), and the secure
gateway must actually have a translation table for that language installed. If the gateway has none,
AnyConnect falls back to its pre-packaged translations.

---

## Prefilled credentials do not appear

Cisco applies `prefill_username` / `prefill_password` only in authentication configurations that
support it, and documents the password field for use with a one-time-password headend. If the fields
stay empty, check the tunnel group's authentication method before assuming a bug here.

Reminder that this is worth getting right: prefilled passwords travel inside a URI handed to another
app. Keep long-lived secrets out of it.

---

## Diagnostics dump

Paste this into a bug report — it captures nearly everything that can go wrong:

```ts
import { Platform } from 'react-native';
import CiscoAnyConnect, { isNativeModuleAvailable } from 'expo-cisco-anyconnect';

async function diagnostics() {
  const report = {
    platform: Platform.OS,
    platformVersion: String(Platform.Version),
    nativeModuleAvailable: isNativeModuleAvailable,
    transport: CiscoAnyConnect.transportId,
    callbackScheme: CiscoAnyConnect.getCallbackScheme(),
    snapshot: CiscoAnyConnect.getState(),
    installed: await CiscoAnyConnect.isInstalled(),
    appInfo: await CiscoAnyConnect.getAppInfo(),
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}
```

For callback problems also log every URL the app receives:

```ts
CiscoAnyConnect.addUrlResultListener((event) => console.log('url result', event));
CiscoAnyConnect.addCallbackListener((event) => console.log('callback', event));
```
