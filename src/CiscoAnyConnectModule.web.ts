import type { CiscoAnyConnectNativeModule } from './CiscoAnyConnectModule';

/**
 * Web build. The module is implemented with platform APIs that have no web equivalent
 * (`UIApplication`, `PackageManager`, `ConnectivityManager`), so it degrades to a no-op surface.
 */

export const isNativeModuleAvailable = false;

export function getNativeModule(): CiscoAnyConnectNativeModule {
  throw new Error(
    'expo-cisco-anyconnect is not available on the web platform. Use it on iOS or Android only.'
  );
}

export default null;
