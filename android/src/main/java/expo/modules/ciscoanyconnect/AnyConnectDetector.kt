package expo.modules.ciscoanyconnect

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build

/**
 * Detection and URL dispatch for the Cisco Secure Client (AnyConnect) app on Android.
 *
 * Android exposes third-party control of AnyConnect through the documented `anyconnect://` URI
 * handler. This object only needs `PackageManager` and `Intent`, so it requires no Cisco SDK, no
 * VPN service of its own and no special permission.
 *
 * Two Android-specific traps are handled here:
 *
 * 1. **Package visibility (Android 11+).** `resolveActivity` and `getPackageInfo` return nothing for
 *    packages the app has not declared. The library's manifest ships a `<queries>` block covering
 *    the `anyconnect` scheme and the known AnyConnect packages, which the manifest merger folds into
 *    the host app.
 * 2. **URI External Control.** AnyConnect refuses external URIs unless its profile allows it
 *    (`vpn_setting_uri_external_control`, default `prompted`). When it is `disabled`, dispatch
 *    silently does nothing — the module surfaces that as a failed dispatch so callers can explain
 *    it to the user.
 */
internal object AnyConnectDetector {
  /** Scheme registered by the Cisco Secure Client / AnyConnect app. */
  const val SCHEME = "anyconnect"

  /**
   * Packages known to ship the AnyConnect VPN client.
   *
   * `avf` is the current Cisco Secure Client (formerly AnyConnect) build; the others are legacy
   * AnyConnect builds still found on managed fleets.
   */
  private val KNOWN_PACKAGES =
    listOf(
      "com.cisco.anyconnect.vpn.android.avf",
      "com.cisco.anyconnect.vpn.android",
      "com.cisco.anyconnect.vpn.android.nodpi"
    )

  /** Whether AnyConnect is present. Prefers scheme resolution, then falls back to known packages. */
  fun isInstalled(context: Context): Boolean =
    resolveHandlerPackage(context) != null || KNOWN_PACKAGES.any { packageInfo(context, it) != null }

  /** Whether the OS would accept the given URL. */
  fun canOpen(context: Context, url: String): Boolean {
    val intent = viewIntent(url) ?: return false
    return intent.resolveActivity(context.packageManager) != null
  }

  /**
   * Hands the URL to the AnyConnect app.
   *
   * @return `true` when an activity accepted the intent. `false` means nothing handled it, which in
   *   practice means AnyConnect is missing or its URI External Control setting is disabled.
   */
  fun open(context: Context, url: String): Boolean {
    val intent = viewIntent(url) ?: return false

    // Starting an activity from a non-Activity context (e.g. the Application) needs its own task.
    if (context !is Activity) {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    return try {
      context.startActivity(intent)
      true
    } catch (exception: ActivityNotFoundException) {
      false
    }
  }

  /** Version details of the installed AnyConnect app, or `null` when it is not installed. */
  fun appInfo(context: Context): Map<String, Any?>? {
    val handler = resolveHandlerPackage(context)
    val packageName =
      handler?.takeIf { it in KNOWN_PACKAGES }
        ?: KNOWN_PACKAGES.firstOrNull { packageInfo(context, it) != null }
        ?: handler
        ?: return null

    val info = packageInfo(context, packageName)

    return mapOf(
      "platform" to "android",
      "packageName" to packageName,
      "versionName" to info?.versionName,
      "versionCode" to info?.let { versionCode(it) },
      "appName" to
        info?.applicationInfo?.let { context.packageManager.getApplicationLabel(it).toString() },
      "source" to if (handler == packageName) "intentHandler" else "package"
    )
  }

  /**
   * Custom URL schemes this *host app* registers, read from its own intent filters.
   *
   * The module uses this to choose a scheme for AnyConnect's `onsuccess`/`onerror` callbacks, so
   * callback routing works with no extra configuration beyond the app's own `scheme`.
   */
  fun appUrlSchemes(context: Context): List<String> {
    val info =
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.PackageInfoFlags.of(
              (PackageManager.GET_ACTIVITIES or PackageManager.GET_INTENT_FILTERS).toLong()
            )
          )
        } else {
          @Suppress("DEPRECATION")
          context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_ACTIVITIES or PackageManager.GET_INTENT_FILTERS
          )
        }
      } catch (exception: PackageManager.NameNotFoundException) {
        return emptyList()
      }

    val schemes = LinkedHashSet<String>()
    info.activities?.forEach { activity ->
      activity.intentFilters?.forEach { filter ->
        for (index in 0 until filter.countDataSchemes()) {
          filter.getDataScheme(index)?.takeIf { it.isNotBlank() }?.let(schemes::add)
        }
      }
    }

    return schemes.toList()
  }

  /** Package that currently handles `anyconnect://`, when one can be resolved. */
  fun resolveHandlerPackage(context: Context): String? {
    val intent = viewIntent("$SCHEME://") ?: return null
    return intent.resolveActivity(context.packageManager)?.activityInfo?.packageName
  }

  private fun viewIntent(url: String): Intent? {
    val uri = Uri.parse(url)
    if (uri.scheme.isNullOrBlank()) {
      return null
    }
    return Intent(Intent.ACTION_VIEW, uri)
  }

  private fun packageInfo(context: Context, packageName: String): PackageInfo? =
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0L))
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(packageName, 0)
      }
    } catch (exception: PackageManager.NameNotFoundException) {
      null
    }

  private fun versionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }
}
