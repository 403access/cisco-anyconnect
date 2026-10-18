# Contributing

Thanks for taking the time. This is a small, focused package: it wraps Cisco's documented
`anyconnect://` URI handler for Expo apps. Keeping it small is a feature.

## Getting set up

See [DEVELOPMENT.md](DEVELOPMENT.md) for prerequisites, scripts and the native iteration loop.
The short version:

```sh
npm install
npm run typecheck && npm run lint && npm test && npm run build
```

## Before opening a PR

- [ ] `npm run typecheck` — runs over `src` **and** `plugin/src`, including tests.
- [ ] `npm run lint` — clean, no warnings.
- [ ] `npm test` — all suites passing.
- [ ] `npm run build` — `build/` and `plugin/build/` regenerate without errors.
- [ ] Docs updated — `README.md`, `docs/api.md`, and the platform guide if behaviour is
      platform-specific.
- [ ] `CHANGELOG.md` entry added.
- [ ] If you touched native code: you ran the example app on a real device and said so in the PR
      description. CI does not compile Swift or Kotlin — see
      [DEVELOPMENT § What is not covered](DEVELOPMENT.md#what-is-not-covered).

## Scope

**In scope**

- Anything that makes the URI handler integration more correct, more typed, or better documented.
- Better platform observation — for example a legitimate, App Store-safe way to detect a tunnel on
  iOS.
- Config plugin coverage for MDM/EMM deployments.
- Tests, especially for the native layer.

**Out of scope**

- **An in-process tunnel.** Shipping AnyConnect inside the app needs Cisco's partner SDK
  (NDA + paid licence) and, on iOS, Apple's `packet-tunnel-provider` entitlement. This package will
  not grow a VPN implementation.
- **Undocumented private APIs.** The Android AIDL service, `getifaddrs` interface sniffing, and
  anything requiring a profile allow-list or an entitlement normal consumers do not have. The
  transport seam exists so you can build those privately — not so they land here.
- **Bypassing user consent.** AnyConnect's flow is intentionally visible to the user, and on Android
  gated by URI External Control. Do not add anything that tries to hide that.

If you need an in-process tunnel, implement `AnyConnectTransport` in your own app and call
`CiscoAnyConnect.setTransport(...)`. That is the supported extension point, and we are happy to
review documentation improvements for it.

## Conventions

- **TypeScript** — strict, no `any` in new public surface, JSDoc on exported API. Explain *why*
  where a platform quirk is being worked around; the reasoning is the valuable part.
- **Errors** — throw `CiscoAnyConnectError` with a stable code, and document the code in
  `docs/api.md`.
- **Honesty over convenience** — if a platform cannot report something, report that it cannot rather
  than returning a plausible guess. The iOS state behaviour is the deliberate precedent.
- **Tests** — pin exact strings for anything URI-shaped. The encoding rules are easy to break
  silently.
- **Commits** — imperative mood, one logical change per commit. Reference the issue where relevant.

## Reporting bugs

Use the [diagnostics dump](docs/troubleshooting.md#diagnostics-dump) — it captures platform, module
availability, callback scheme, resolved state, install status and app info. Most reports are
resolved from that plus the exact URI that was dispatched.

For behaviour that depends on the headend, say which platform the gateway runs on (ASA, FTD,
IOS/IOS-XE) and whether the tunnel group uses SAML, certificate or AAA authentication.

## Licence

By contributing you agree that your contribution is licensed under the MIT licence in
[LICENSE](LICENSE).
