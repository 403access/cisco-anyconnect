# Changelog

## Unreleased

- Unit tests for the `useAnyConnect` / `useAnyConnectCallback` hooks, via
  `@testing-library/react-native`.

## 0.1.0

Initial release.

- Drive Cisco Secure Client / AnyConnect through Cisco's documented `anyconnect://` URI handler:
  `createConnection`, `connect`, `disconnect`, `importProfile`, `importCertificate`, `localize`,
  `closeGui`.
- Availability detection (`isInstalled`, `getAppInfo`) with Android package visibility handled by the
  library manifest, and iOS query schemes handled by the config plugin.
- Connection results reported back through `onsuccess` / `onerror` callback URLs, surfaced as typed
  events; callback URLs captured natively on Android and through `Linking` on iOS.
- Tunnel state observation on Android via the system VPN transport, plus `useAnyConnect` and
  `useAnyConnectCallback` React hooks.
- Config plugin that writes `LSApplicationQueriesSchemes`, the callback scheme, Android `<queries>`
  and the callback intent filter.
- Transport abstraction (`AnyConnectTransport`) so a Cisco SDK or in-process tunnel implementation can
  be dropped in without changing the public API.
- Unit tests for the URI builders and the callback URL parser.
