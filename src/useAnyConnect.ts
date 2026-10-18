import { useEffect, useRef, useState } from 'react';

import CiscoAnyConnect from './CiscoAnyConnect';
import type { AnyConnectCallbackEvent, AnyConnectStateSnapshot } from './CiscoAnyConnect.types';

/**
 * Subscribes to the tunnel state.
 *
 * ```tsx
 * const { state } = useAnyConnect();
 * ```
 */
export function useAnyConnect(): AnyConnectStateSnapshot {
  const [snapshot, setSnapshot] = useState<AnyConnectStateSnapshot>(() =>
    CiscoAnyConnect.getState()
  );

  useEffect(() => {
    // Read the whole snapshot rather than rebuilding it from the event, so every field — including
    // `anyConnectInstalled` — stays in sync. The event only carries the state fields.
    const unsubscribe = CiscoAnyConnect.addStateListener(() => {
      setSnapshot(CiscoAnyConnect.getState());
    });

    CiscoAnyConnect.refresh().catch(() => {
      // Unavailable native module; `isNativeModuleAvailable` covers that case for callers.
    });

    return unsubscribe;
  }, []);

  return snapshot;
}

/**
 * Runs `listener` whenever AnyConnect reports a connection outcome through a callback URL.
 *
 * ```tsx
 * useAnyConnectCallback((event) => {
 *   if (event.action === 'connect' && event.result === 'error') showToast(event.error);
 * });
 * ```
 */
export function useAnyConnectCallback(listener: (event: AnyConnectCallbackEvent) => void): void {
  // The ref keeps the subscription stable while always calling the latest listener. It is written
  // in an effect rather than during render so React's refs rule is satisfied.
  const listenerRef = useRef(listener);

  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(() => {
    return CiscoAnyConnect.addCallbackListener((event) => listenerRef.current(event));
  }, []);
}
