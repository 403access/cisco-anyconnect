import { act, renderHook } from '@testing-library/react-native';

import type {
  AnyConnectCallbackEvent,
  AnyConnectStateChangeEvent,
  AnyConnectStateSnapshot,
} from '../CiscoAnyConnect.types';
import { useAnyConnect, useAnyConnectCallback } from '../useAnyConnect';

const UNKNOWN: AnyConnectStateSnapshot = {
  state: 'unknown',
  vpnTransportActive: null,
  anyConnectInstalled: false,
};

const CONNECTED: AnyConnectStateSnapshot = {
  state: 'connected',
  vpnTransportActive: true,
  anyConnectInstalled: true,
};

// The facade is mocked: these tests cover the hook wiring (subscribe, refresh, resubscribe), not the
// facade itself, which has its own suite in CiscoAnyConnect.test.ts.
const mockStateListeners = new Set<(event: AnyConnectStateChangeEvent) => void>();
const mockCallbackListeners = new Set<(event: AnyConnectCallbackEvent) => void>();

const mockGetState = jest.fn((): AnyConnectStateSnapshot => UNKNOWN);
const mockRefresh = jest.fn(async (): Promise<AnyConnectStateSnapshot> => mockGetState());
const mockAddStateListener = jest.fn((listener: (event: AnyConnectStateChangeEvent) => void) => {
  mockStateListeners.add(listener);
  return () => {
    mockStateListeners.delete(listener);
  };
});
const mockAddCallbackListener = jest.fn((listener: (event: AnyConnectCallbackEvent) => void) => {
  mockCallbackListeners.add(listener);
  return () => {
    mockCallbackListeners.delete(listener);
  };
});

jest.mock('../CiscoAnyConnect', () => ({
  __esModule: true,
  default: {
    getState: () => mockGetState(),
    refresh: () => mockRefresh(),
    addStateListener: (listener: (event: AnyConnectStateChangeEvent) => void) =>
      mockAddStateListener(listener),
    addCallbackListener: (listener: (event: AnyConnectCallbackEvent) => void) =>
      mockAddCallbackListener(listener),
  },
}));

/** Emits a state change to every facade listener, the way the real client does. */
function emitState(event: AnyConnectStateChangeEvent): void {
  for (const listener of mockStateListeners) {
    listener(event);
  }
}

/** Emits a callback event to every facade listener. */
function emitCallback(event: AnyConnectCallbackEvent): void {
  for (const listener of mockCallbackListeners) {
    listener(event);
  }
}

beforeEach(() => {
  mockStateListeners.clear();
  mockCallbackListeners.clear();
  mockGetState.mockReset().mockReturnValue(UNKNOWN);
  mockRefresh.mockReset().mockImplementation(async () => mockGetState());
  mockAddStateListener.mockClear();
  mockAddCallbackListener.mockClear();
});

describe('useAnyConnect', () => {
  it('exposes the synchronous snapshot on first render', async () => {
    mockGetState.mockReturnValue(CONNECTED);

    const { result } = await renderHook(() => useAnyConnect());

    expect(result.current).toEqual(CONNECTED);
  });

  it('subscribes to state changes and refreshes once on mount', async () => {
    await renderHook(() => useAnyConnect());

    expect(mockAddStateListener).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('re-reads the whole snapshot when the facade reports a change', async () => {
    const { result } = await renderHook(() => useAnyConnect());
    expect(result.current).toEqual(UNKNOWN);

    await act(() => {
      mockGetState.mockReturnValue(CONNECTED);
      emitState({
        state: 'connected',
        source: 'system',
        vpnTransportActive: true,
        timestamp: new Date().toISOString(),
      });
    });

    // Not just the fields carried by the event: `anyConnectInstalled` comes from getState() too.
    expect(result.current).toEqual(CONNECTED);
  });

  it('does not resubscribe across re-renders', async () => {
    const { rerender } = await renderHook(() => useAnyConnect());

    await rerender({});

    expect(mockAddStateListener).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderHook(() => useAnyConnect());
    expect(mockStateListeners.size).toBe(1);

    await unmount();

    expect(mockStateListeners.size).toBe(0);
  });

  it('swallows a rejected refresh instead of surfacing it as an unhandled rejection', async () => {
    mockRefresh.mockRejectedValueOnce(new Error('no native module'));

    const { result } = await renderHook(() => useAnyConnect());

    expect(result.current).toEqual(UNKNOWN);
  });
});

describe('useAnyConnectCallback', () => {
  const success: AnyConnectCallbackEvent = {
    action: 'connect',
    result: 'success',
    url: 'myapp://anyconnect?action=connect&result=success',
  };

  it('forwards callback events to the listener', async () => {
    const listener = jest.fn();
    await renderHook(() => useAnyConnectCallback(listener));

    await act(() => emitCallback(success));

    expect(listener).toHaveBeenCalledWith(success);
  });

  it('keeps a single subscription while calling the latest listener', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await renderHook(
      ({ listener }: { listener: (event: AnyConnectCallbackEvent) => void }) =>
        useAnyConnectCallback(listener),
      { initialProps: { listener: first } }
    );

    await rerender({ listener: second });
    expect(mockAddCallbackListener).toHaveBeenCalledTimes(1);

    await act(() => emitCallback(success));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(success);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderHook(() => useAnyConnectCallback(() => {}));
    expect(mockCallbackListeners.size).toBe(1);

    await unmount();

    expect(mockCallbackListeners.size).toBe(0);
  });
});
