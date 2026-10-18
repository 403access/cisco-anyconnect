/**
 * expo-cisco-anyconnect
 *
 * Drive the Cisco Secure Client (AnyConnect) app from a React Native / Expo app via Cisco's
 * documented `anyconnect://` URI handler, and observe the resulting tunnel state.
 */

export { CiscoAnyConnect, default } from './CiscoAnyConnect';
export type { Unsubscribe } from './CiscoAnyConnect';
export { CiscoAnyConnectError } from './CiscoAnyConnectError';
export type { CiscoAnyConnectErrorCode } from './CiscoAnyConnectError';
export { UriHandlerTransport } from './transport';
export type { AnyConnectTransport } from './transport';
export { useAnyConnect, useAnyConnectCallback } from './useAnyConnect';
export { isNativeModuleAvailable } from './CiscoAnyConnectModule';
export {
  CALLBACK_PATH,
  buildCallbackUrl,
  buildCloseUri,
  buildConnectUri,
  buildCreateConnectionUri,
  buildDisconnectUri,
  buildImportCertificateUri,
  buildImportProfileUri,
  buildLocalizeUri,
  connectionQueryParameters,
  encodeValue,
  parseCallbackUrl,
} from './uri';
export * from './CiscoAnyConnect.types';
