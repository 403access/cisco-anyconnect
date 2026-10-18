package expo.modules.ciscoanyconnect

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

/**
 * Watches the system's VPN transport.
 *
 * Android has no API that reports *which* app owns the active tunnel, but the system does expose
 * whether a VPN transport is currently up. That is enough to turn a fire-and-forget deep link into
 * an observable state change, and it is the one piece of the module that cannot work on iOS.
 *
 * Caveat to keep in mind when reading the state: another VPN app would set the same flag. This is a
 * "a tunnel is up" signal, not an "AnyConnect is connected" signal.
 */
internal class VpnStateObserver(
  context: Context,
  private val onChanged: (active: Boolean) -> Unit
) {
  private val connectivityManager =
    context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

  private var callback: ConnectivityManager.NetworkCallback? = null

  fun isVpnTransportActive(): Boolean = Companion.isVpnTransportActive(connectivityManager)

  fun start() {
    if (callback != null) {
      return
    }
    val manager = connectivityManager ?: return
    val networkCallback =
      object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = publish()

        override fun onLost(network: Network) = publish()

        override fun onCapabilitiesChanged(
          network: Network,
          networkCapabilities: NetworkCapabilities
        ) = publish()
      }

    try {
      manager.registerDefaultNetworkCallback(networkCallback)
      callback = networkCallback
    } catch (exception: Exception) {
      // Without this permission/callback the state is simply not observable; the JS layer still
      // works from connection callbacks.
      callback = null
    }
  }

  fun stop() {
    val manager = connectivityManager ?: return
    val networkCallback = callback ?: return
    callback = null
    try {
      manager.unregisterNetworkCallback(networkCallback)
    } catch (exception: Exception) {
      // Already unregistered.
    }
  }

  private fun publish() = onChanged(isVpnTransportActive())

  companion object {
    /**
     * Reports whether the active network is a VPN. Also usable without an observer, so `getState()`
     * stays accurate even when nobody is listening for changes.
     */
    fun isVpnTransportActive(manager: ConnectivityManager?): Boolean {
      val resolved = manager ?: return false
      val network = resolved.activeNetwork ?: return false
      val capabilities = resolved.getNetworkCapabilities(network) ?: return false
      return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
    }
  }
}
