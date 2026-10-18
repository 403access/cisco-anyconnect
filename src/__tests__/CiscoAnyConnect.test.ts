import CiscoAnyConnect, { CiscoAnyConnectError } from '../CiscoAnyConnect';
import type { AnyConnectCallbackEvent, AnyConnectStateChangeEvent } from '../CiscoAnyConnect.types';

/**
 * These exercise the JavaScript facade on its own. The native module is deliberately absent in this
 * environment (Jest), which is exactly the "Expo Go / web" case, so the tests also pin down how the
 * facade degrades.
 */

describe('handleCallbackUrl', () => {
  beforeEach(() => {
    CiscoAnyConnect.dispose();
    CiscoAnyConnect.configure({ callbackScheme: 'myapp' });
  });

  afterAll(() => {
    CiscoAnyConnect.dispose();
  });

  it('emits a typed event for a successful connect', () => {
    const events: AnyConnectCallbackEvent[] = [];
    CiscoAnyConnect.addCallbackListener((event) => events.push(event));

    const handled = CiscoAnyConnect.handleCallbackUrl(
      'myapp://anyconnect/callback?action=connect&result=success&token=connect-1'
    );

    expect(handled).toBe(true);
    expect(events).toEqual([
      {
        action: 'connect',
        result: 'success',
        url: 'myapp://anyconnect/callback?action=connect&result=success&token=connect-1',
        token: 'connect-1',
        error: undefined,
      },
    ]);
  });

  it('reports a failed connect as disconnected and forwards the error', () => {
    const states: AnyConnectStateChangeEvent[] = [];
    const callbacks: AnyConnectCallbackEvent[] = [];
    CiscoAnyConnect.addStateListener((event) => states.push(event));
    CiscoAnyConnect.addCallbackListener((event) => callbacks.push(event));

    CiscoAnyConnect.handleCallbackUrl(
      'myapp://anyconnect/callback?action=connect&result=error&error=Certificate%20rejected'
    );

    expect(callbacks[0].error).toBe('Certificate rejected');
    expect(states[states.length - 1]?.state).toBe('disconnected');
    expect(states[states.length - 1]?.source).toBe('callback');
  });

  it('treats a successful disconnect as disconnected', () => {
    CiscoAnyConnect.handleCallbackUrl(
      'myapp://anyconnect/callback?action=disconnect&result=success'
    );

    expect(CiscoAnyConnect.getState().state).toBe('disconnected');
  });

  it('ignores URLs that are not AnyConnect callbacks', () => {
    const events: AnyConnectCallbackEvent[] = [];
    CiscoAnyConnect.addCallbackListener((event) => events.push(event));

    expect(CiscoAnyConnect.handleCallbackUrl('myapp://some/other/path?result=success')).toBe(false);
    expect(CiscoAnyConnect.handleCallbackUrl('https://example.com')).toBe(false);
    expect(CiscoAnyConnect.handleCallbackUrl(null)).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('stops notifying a listener after it unsubscribes', () => {
    const events: AnyConnectCallbackEvent[] = [];
    const unsubscribe = CiscoAnyConnect.addCallbackListener((event) => events.push(event));

    unsubscribe();
    CiscoAnyConnect.handleCallbackUrl('myapp://anyconnect/callback?action=connect&result=success');

    expect(events).toHaveLength(0);
  });

  it('timestamps state changes from a callback', () => {
    const states: AnyConnectStateChangeEvent[] = [];
    CiscoAnyConnect.addStateListener((event) => states.push(event));

    CiscoAnyConnect.handleCallbackUrl('myapp://anyconnect/callback?action=connect&result=success');

    expect(states).toHaveLength(1);
    expect(Number.isNaN(Date.parse(states[0].timestamp))).toBe(false);
    expect(states[0].state).toBe('connected');
  });
});

describe('configure', () => {
  afterAll(() => {
    CiscoAnyConnect.dispose();
  });

  it('defaults to no callback scheme when nothing is configured and no native module exists', () => {
    CiscoAnyConnect.dispose();
    CiscoAnyConnect.configure({});
    expect(CiscoAnyConnect.getCallbackScheme()).toBe(false);
  });

  it('normalises a scheme passed with a suffix', () => {
    CiscoAnyConnect.configure({ callbackScheme: 'myapp://' });
    expect(CiscoAnyConnect.getCallbackScheme()).toBe('myapp');
  });

  it('can disable callbacks', () => {
    CiscoAnyConnect.configure({ callbackScheme: false });
    expect(CiscoAnyConnect.getCallbackScheme()).toBe(false);
  });
});

describe('without a native module', () => {
  afterAll(() => {
    CiscoAnyConnect.dispose();
  });

  it('reports the client as not installed instead of throwing', async () => {
    await expect(CiscoAnyConnect.isInstalled()).resolves.toBe(false);
    await expect(CiscoAnyConnect.getAppInfo()).resolves.toBeNull();
  });

  it('explains that a development build is required when an action is attempted', async () => {
    await expect(CiscoAnyConnect.connect({ host: 'vpn.example.com' })).rejects.toMatchObject({
      code: 'NATIVE_MODULE_UNAVAILABLE',
      message: expect.stringMatching(/Expo Go/),
    });
    await expect(CiscoAnyConnect.disconnect()).rejects.toBeInstanceOf(CiscoAnyConnectError);
  });

  it('recovers after a failed initialisation so a later call can retry', async () => {
    await expect(CiscoAnyConnect.connect({ host: 'vpn.example.com' })).rejects.toThrow();
    CiscoAnyConnect.dispose();
    await expect(CiscoAnyConnect.connect({ host: 'vpn.example.com' })).rejects.toMatchObject({
      code: 'NATIVE_MODULE_UNAVAILABLE',
    });
  });

  it('exposes the active transport id', () => {
    expect(CiscoAnyConnect.transportId).toBe('uriHandler');
  });
});
