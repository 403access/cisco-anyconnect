import ExpoModulesCore
import UIKit

/**
 Native half of `expo-cisco-anyconnect` on iOS.

 It exposes the primitives the JavaScript transport needs — availability probing, custom-scheme
 discovery and URL dispatch — plus a "URI was handed over" event. Tunnel state is derived on the JS
 side from those events, because iOS gives an app no way to observe another app's VPN tunnel.
 */
public class CiscoAnyConnectModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CiscoAnyConnect")

    Events("onAnyConnectStateChange", "onAnyConnectCallback", "onAnyConnectUrlResult")

    /**
     Custom URL schemes registered by the host app, used to route AnyConnect's connection callbacks
     back into the app. Reads `Info.plist`, so it is safe on any thread.
     */
    AsyncFunction("getAppUrlSchemes") { () -> [String] in
      return AnyConnectDetector.appUrlSchemes()
    }

    /// Whether the Cisco Secure Client / AnyConnect app is installed.
    AsyncFunction("isInstalled") { () -> Bool in
      return AnyConnectDetector.isInstalled()
    }
    .runOnQueue(.main)

    /// Whether the OS would accept the given URL.
    AsyncFunction("canOpenUrl") { (url: String) -> Bool in
      return AnyConnectDetector.canOpen(url: url)
    }
    .runOnQueue(.main)

    /**
     Hands a deep link to the AnyConnect app. Emits `onAnyConnectUrlResult` once iOS reports the
     real outcome, so JS callers can surface "nothing handled this link" without racing a promise.
     */
    AsyncFunction("openUrl") { (url: String) -> Bool in
      let dispatched = AnyConnectDetector.open(url: url) { [weak self] success in
        self?.sendEvent(
          "onAnyConnectUrlResult",
          [
            "url": url,
            "success": success,
            "error": success ? NSNull() : "No installed app accepted the URL."
          ]
        )
      }

      if !dispatched {
        self.sendEvent(
          "onAnyConnectUrlResult",
          [
            "url": url,
            "success": false,
            "error": "No installed app accepts the URL. Is Cisco Secure Client installed?"
          ]
        )
      }

      return dispatched
    }
    .runOnQueue(.main)

    /// Version details of the installed app. iOS cannot read another app's bundle metadata, so this
    /// returns a best-effort constant when AnyConnect is present.
    AsyncFunction("getAppInfo") { () -> [String: Any]? in
      guard AnyConnectDetector.isInstalled() else {
        return nil
      }
      return AnyConnectDetector.appInfo()
    }
    .runOnQueue(.main)

    /**
     Synchronous state snapshot.

     `state` is always `unknown` on iOS: without a Network Extension entitlement there is no public
     API that reports whether *another* app's tunnel is up. The JS facade combines this with
     connection callbacks instead. Reporting `unknown` rather than a guess keeps callers honest.
     */
    Function("getState") { () -> [String: Any] in
      return [
        "state": "unknown",
        "vpnTransportActive": NSNull(),
        "anyConnectInstalled": false
      ]
    }

    /// Present for API parity with Android. iOS delivers callback URLs through the host app's own
    /// URL handling, which the JS layer subscribes to, so there is nothing to drain here.
    Function("consumePendingCallbackUrls") { () -> [String] in
      return []
    }
  }
}
