# Example app

A minimal Expo app that exercises every part of `expo-cisco-anyconnect`.

## Prerequisites

1. Build the module first — the example consumes it through `file:..`:

   ```sh
   cd ..
   npm install
   npm run build
   ```

2. Have **Cisco Secure Client / AnyConnect installed** on the device, plus a reachable Cisco secure
   gateway (ASA, Firepower/FTD, or IOS/IOS-XE router). Without a headend you can still verify
   everything except a real tunnel, using the "Simulate a success callback" button.

## Run it

```sh
npm install
npm run ios        # or: npm run android
```

A development build is required — the module ships native code, so Expo Go will not work.

## What to change

| Where | Why |
| --- | --- |
| `DEFAULT_HOST` in `App.tsx` | Point it at your secure gateway. Group URLs (`vpn.example.com/group-url`) work too. |
| `scheme` in `app.json` | Your callback scheme. It must match `callbackScheme` passed to `configure()`. |
| `ios.bundleIdentifier` / `android.package` | Avoid clashing with anyone else's build. |

## What the screen shows

- **AnyConnect installed** — `isInstalled()` plus `getAppInfo()`. `false` on iOS usually means the
  query scheme is missing; `false` on Android usually means package visibility.
- **Tunnel state** — the live `useAnyConnect()` snapshot, including the `vpnTransportActive` flag
  (Android only) and the resolved callback scheme.
- **Secure gateway + buttons** — `connect`, `disconnect`, `createConnection` and `refresh`, each
  logging its `AnyConnectDispatchResult` (including the exact URI emitted).
- **Last callback** — the most recent `AnyConnectCallbackEvent`, i.e. what AnyConnect reported back.
- **Simulate a success callback** — feeds a synthetic callback URL through
  `handleCallbackUrl(...)`. This proves the callback path end to end without a VPN, and is handy when
  the headend is unavailable.
- **Log** — a running log of dispatches, errors and callbacks.

## Expected first run

1. `AnyConnect installed: true` and a version string (Android) or `Cisco Secure Client` (iOS).
2. Press **Connect** → AnyConnect opens (or prompts, if URI External Control is `prompted`).
3. Authenticate in AnyConnect. On success AnyConnect returns to this app.
4. **Last callback** shows `action: "connect"`, `result: "success"` and the token from step 2.

If step 2 does nothing, see
[docs/troubleshooting.md](../docs/troubleshooting.md#connect-throws-no_handler). If step 4 stays
empty, check that `scheme` in `app.json` matches `callbackScheme` in `App.tsx`, and that you re-ran
`npx expo prebuild --clean` after changing either.
