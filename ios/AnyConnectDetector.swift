import Foundation
import UIKit

/**
 Detection and URL dispatch for the Cisco Secure Client (AnyConnect) app.

 The module deliberately touches only Apple's public URL APIs: it never ships a VPN tunnel of its
 own, so it needs no Network Extension entitlement and no Cisco SDK. Discovery works through
 `UIApplication.canOpenURL`, which on iOS requires the `anyconnect` scheme to be listed under
 `LSApplicationQueriesSchemes` — the bundled config plugin does that for you.

 Every method here touches `UIApplication` and must therefore run on the main thread. The module
 achieves that with `.runOnQueue(.main)` on the calling side rather than annotating with
 `@MainActor`, so there is no mixing of GCD and Swift concurrency.
 */
enum AnyConnectDetector {
  /// Scheme registered by the Cisco Secure Client / AnyConnect app on iOS.
  static let scheme = "anyconnect"

  /// iOS never exposes the bundle identifier of the app that owns a URL scheme, so this is a
  /// best-effort constant used to fill in `AnyConnectAppInfo.packageName`.
  static let assumedBundleIdentifier = "com.cisco.anyconnect"

  // MARK: - Availability

  static func isInstalled() -> Bool {
    guard let url = URL(string: "\(scheme)://") else {
      return false
    }
    return UIApplication.shared.canOpenURL(url)
  }

  static func canOpen(url: String) -> Bool {
    guard let parsed = URL(string: url), let scheme = parsed.scheme, !scheme.isEmpty else {
      return false
    }
    return UIApplication.shared.canOpenURL(parsed)
  }

  /**
   Hands the URL to the OS and returns whether it was dispatched.

   iOS only reports the real outcome asynchronously, so `completion` receives it later; the return
   value answers "did we even try", which is what a synchronous caller can act on.
   */
  static func open(url: String, completion: @escaping (Bool) -> Void) -> Bool {
    guard let parsed = URL(string: url), canOpen(url: url) else {
      return false
    }

    UIApplication.shared.open(parsed, options: [:]) { success in
      completion(success)
    }
    return true
  }

  // MARK: - Metadata

  static func appInfo() -> [String: Any] {
    return [
      "platform": "ios",
      "packageName": assumedBundleIdentifier,
      "versionName": NSNull(),
      "versionCode": NSNull(),
      "appName": "Cisco Secure Client",
      "source": "intentHandler"
    ]
  }

  /**
   Custom URL schemes this *host app* has registered, read straight from `Info.plist`.

   The module uses this to pick a scheme for AnyConnect's `onsuccess`/`onerror` callbacks, so
   callback routing works with no extra configuration beyond adding `scheme` to the app config.
   */
  static func appUrlSchemes() -> [String] {
    guard
      let urlTypes = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]]
    else {
      return []
    }

    var seen = Set<String>()
    var schemes: [String] = []

    for urlType in urlTypes {
      guard let declared = urlType["CFBundleURLSchemes"] as? [String] else {
        continue
      }
      for scheme in declared where !scheme.isEmpty {
        let key = scheme.lowercased()
        if seen.insert(key).inserted {
          schemes.append(scheme)
        }
      }
    }

    return schemes
  }
}
