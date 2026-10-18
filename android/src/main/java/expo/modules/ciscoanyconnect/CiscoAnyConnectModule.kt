package expo.modules.ciscoanyconnect

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Native half of `expo-cisco-anyconnect` on Android.
 *
 * Exposes the primitives the JavaScript transport needs (availability probing, custom-scheme
 * discovery, URL dispatch), captures callback URLs that AnyConnect sends back to the app, and
 * observes the system VPN transport to emit real state changes.
 */
class CiscoAnyConnectModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /**
   * Callback URLs captured natively, waiting for JavaScript to drain them. Needed for the cold-start
   * case, where the deep link arrives before any JS listener exists.
   */
  private val pendingCallbackUrls = mutableListOf<String>()

  private var vpnStateObserver: VpnStateObserver? = null

  /** Cached so the synchronous `getState()` does not hit `PackageManager` on every call. */
  @Volatile private var anyConnectInstalled: Boolean? = null

  override fun definition() = ModuleDefinition {
    Name("CiscoAnyConnect")

    Events("onAnyConnectStateChange", "onAnyConnectCallbackUrl", "onAnyConnectUrlResult")

    /**
     Synchronous snapshot.

     Unlike iOS, Android *can* report whether a tunnel is up, so `state` is populated here.
     */
    Function("getState") {
      val active =
        vpnStateObserver?.isVpnTransportActive()
          ?: VpnStateObserver.isVpnTransportActive(connectivityManager)

      mapOf(
        "state" to if (active) "connected" else "disconnected",
        "vpnTransportActive" to active,
        "anyConnectInstalled" to (anyConnectInstalled ?: false)
      )
    }

    Function("consumePendingCallbackUrls") {
      synchronized(pendingCallbackUrls) {
        val urls = pendingCallbackUrls.toList()
        pendingCallbackUrls.clear()
        urls
      }
    }

    /** Whether the Cisco Secure Client / AnyConnect app is installed. */
    AsyncFunction("isInstalled") {
      AnyConnectDetector.isInstalled(context).also { anyConnectInstalled = it }
    }

    /** Whether the OS would accept the given URL. */
    AsyncFunction("canOpenUrl") { url: String -> AnyConnectDetector.canOpen(context, url) }

    /**
     * Hands a deep link to the AnyConnect app. Emits `onAnyConnectUrlResult` so callers do not have
     * to interpret a `false` return value themselves.
     */
    AsyncFunction("openUrl") { url: String ->
      val dispatched = AnyConnectDetector.open(appContext.currentActivity ?: context, url)

      anyConnectInstalled = anyConnectInstalled ?: AnyConnectDetector.isInstalled(context)

      sendEvent(
        "onAnyConnectUrlResult",
        mapOf<String, Any?>(
          "url" to url,
          "success" to dispatched,
          "error" to
            if (dispatched) {
              null
            } else {
              "Nothing handled the link. Check that Cisco Secure Client is installed and that " +
                "URI External Control is enabled in its profile."
            }
        )
      )

      dispatched
    }

    /** Version details of the installed AnyConnect app, or `null` when it is not installed. */
    AsyncFunction("getAppInfo") {
      AnyConnectDetector.appInfo(context).also { if (it != null) anyConnectInstalled = true }
    }

    /** Custom URL schemes this app registers, used to route connection callbacks back. */
    AsyncFunction("getAppUrlSchemes") { AnyConnectDetector.appUrlSchemes(context) }

    OnStartObserving("onAnyConnectStateChange") { startVpnObserver() }

    OnStopObserving("onAnyConnectStateChange") { stopVpnObserver() }

    /**
     * Deep links delivered while the app is already running. This is what makes a callback URL work
     * when the user returns to a live app, and it needs the main activity to be `singleTask` —
     * a requirement Expo already imposes for its own `scheme` config.
     */
    OnNewIntent { intent -> captureCallbackUrl(intent) }

    /** Deep links that launched the app, so a cold-start callback is not lost. */
    OnCreate { appContext.currentActivity?.intent?.let(::captureCallbackUrl) }

    OnDestroy { stopVpnObserver() }
  }

  private val connectivityManager: ConnectivityManager?
    get() =
      appContext.reactContext?.getSystemService(Context.CONNECTIVITY_SERVICE) as?
        ConnectivityManager

  /**
   * Queues any `VIEW` deep link and hands the raw URL to JavaScript.
   *
   * No filtering happens here on purpose: the URL protocol is owned by the TypeScript layer
   * (`parseCallbackUrl`), which ignores anything that is not an AnyConnect callback. That keeps a
   * single source of truth for the wire format.
   */
  private fun captureCallbackUrl(intent: Intent?) {
    if (intent == null || intent.action != Intent.ACTION_VIEW) {
      return
    }
    val url = intent.data?.toString()?.takeIf { it.isNotBlank() } ?: return

    synchronized(pendingCallbackUrls) { pendingCallbackUrls.add(url) }
    sendEvent("onAnyConnectCallbackUrl", mapOf<String, Any?>("url" to url))
  }

  private fun startVpnObserver() {
    if (vpnStateObserver != null) {
      return
    }

    val observer =
      VpnStateObserver(context) { active ->
        sendEvent(
          "onAnyConnectStateChange",
          mapOf<String, Any?>(
            "state" to if (active) "connected" else "disconnected",
            "source" to "system",
            "vpnTransportActive" to active
          )
        )
      }

    observer.start()
    vpnStateObserver = observer
  }

  private fun stopVpnObserver() {
    vpnStateObserver?.stop()
    vpnStateObserver = null
  }
}
