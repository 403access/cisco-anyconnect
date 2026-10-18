/**
 * Error thrown by every `expo-cisco-anyconnect` API.
 *
 * `code` is stable, so callers can branch on it instead of matching message text.
 */
export type CiscoAnyConnectErrorCode =
  /** The native module is not in this build — typically Expo Go or the web platform. */
  | 'NATIVE_MODULE_UNAVAILABLE'
  /** An argument was missing or malformed before anything was dispatched. */
  | 'INVALID_ARGUMENTS'
  /** The OS accepted the URI, but no app claimed it. */
  | 'NO_HANDLER';

export class CiscoAnyConnectError extends Error {
  readonly code: CiscoAnyConnectErrorCode;

  constructor(code: CiscoAnyConnectErrorCode, message: string) {
    super(message);
    this.name = 'CiscoAnyConnectError';
    this.code = code;
  }
}
