import { NativeModule, requireOptionalNativeModule } from 'expo';

import type {
  AnyConnectAppInfo,
  AnyConnectStateSnapshot,
  CiscoAnyConnectModuleEvents,
} from './CiscoAnyConnect.types';
import { CiscoAnyConnectError } from './CiscoAnyConnectError';

/**
 * Shape of the native module. Prefer the {@link CiscoAnyConnect} facade; this is exported so that
 * alternative transports can reuse the low-level primitives.
 */
export declare class CiscoAnyConnectNativeModule extends NativeModule<CiscoAnyConnectModuleEvents> {
  /** Whether a handler for the `anyconnect://` scheme exists on this device. */
  isInstalled(): Promise<boolean>;
  /** Version details of the AnyConnect app, or `null` when the platform cannot report them. */
  getAppInfo(): Promise<AnyConnectAppInfo | null>;
  /** Whether the OS would accept the given URL. */
  canOpenUrl(url: string): Promise<boolean>;
  /** Hands the URL to the AnyConnect app. Resolves `true` when the OS accepted it. */
  openUrl(url: string): Promise<boolean>;
  /** Custom URL schemes this app has registered. Used to route connection callbacks back. */
  getAppUrlSchemes(): Promise<string[]>;
  /** Synchronous state snapshot. Never throws. */
  getState(): AnyConnectStateSnapshot;
  /** Drains callback URLs captured natively (Android only; empty on iOS). */
  consumePendingCallbackUrls(): string[];
}

/**
 * `requireOptionalNativeModule` is used so that merely importing this package never throws where the
 * native code is absent (Expo Go, web, Jest). The failure is reported lazily, with an actionable
 * message, the first time the module is actually used.
 */
const nativeModule =
  requireOptionalNativeModule<CiscoAnyConnectNativeModule>('CiscoAnyConnect');

export const isNativeModuleAvailable = nativeModule != null;

export function getNativeModule(): CiscoAnyConnectNativeModule {
  if (!nativeModule) {
    throw new CiscoAnyConnectError(
      'NATIVE_MODULE_UNAVAILABLE',
      'expo-cisco-anyconnect: the native module is not available in this build.\n' +
        'It cannot work in Expo Go because it ships custom native code.\n' +
        'Create a development build instead: `npx expo run:ios` or `npx expo run:android`.'
    );
  }
  return nativeModule;
}

export default nativeModule;
