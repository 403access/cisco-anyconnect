import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import CiscoAnyConnect, {
  useAnyConnect,
  useAnyConnectCallback,
  type AnyConnectCallbackEvent,
} from 'expo-cisco-anyconnect';

/**
 * Demonstrates the module end to end.
 *
 * Run it against a real secure gateway: the AnyConnect app needs a reachable headend to connect to.
 * Replace `DEFAULT_HOST` with the hostname of your ASA / FTD, or type one into the field.
 */
const DEFAULT_HOST = 'vpn.example.com';

export default function App() {
  const [host, setHost] = useState(DEFAULT_HOST);
  const [lastCallback, setLastCallback] = useState<AnyConnectCallbackEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const { state, anyConnectInstalled } = useAnyConnect();

  const append = useCallback((line: string) => {
    setLog((previous) => [
      `${new Date().toLocaleTimeString()}  ${line}`,
      ...previous.slice(0, 24),
    ]);
  }, []);

  useAnyConnectCallback((event) => {
    setLastCallback(event);
  });

  useEffect(() => {
    // Configure early so callback URLs are wired before the first connection.
    CiscoAnyConnect.configure({
      callbackScheme: 'ciscoanyconnectexample',
    });

    CiscoAnyConnect.getAppInfo()
      .then((info) => {
        append(info ? `AnyConnect ${info.versionName ?? '?'} (${info.packageName})` : 'AnyConnect not found');
      })
      .catch((error: Error) => append(`getAppInfo failed: ${error.message}`));
  }, [append]);

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        const result = await action();
        append(`${label} → ${JSON.stringify(result)}`);
      } catch (error) {
        append(`${label} failed: ${(error as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [append]
  );

  const installed = anyConnectInstalled;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>expo-cisco-anyconnect</Text>

        <View style={styles.card}>
          <Text style={styles.row}>
            AnyConnect installed: <Text style={styles.strong}>{String(installed)}</Text>
          </Text>
          <Text style={styles.row}>
            Tunnel state: <Text style={styles.strong}>{state.state}</Text>
          </Text>
          <Text style={styles.row}>
            VPN transport up: <Text style={styles.strong}>{String(state.vpnTransportActive)}</Text>
          </Text>
          <Text style={styles.row}>
            Callbacks on: <Text style={styles.strong}>{String(CiscoAnyConnect.getCallbackScheme())}</Text>
          </Text>
          <Text style={styles.row}>
            Platform: <Text style={styles.strong}>{Platform.OS}</Text>
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Secure gateway</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="vpn.example.com or vpn.example.com/group-url"
          />
          <Button
            title="Connect"
            disabled={busy || host.length === 0}
            onPress={() => run('connect', () => CiscoAnyConnect.connect({ name: 'Example', host }))}
          />
          <View style={styles.spacer} />
          <Button
            title="Disconnect"
            disabled={busy}
            onPress={() => run('disconnect', () => CiscoAnyConnect.disconnect())}
          />
          <View style={styles.spacer} />
          <Button
            title="Create connection entry"
            disabled={busy || host.length === 0}
            onPress={() =>
              run('createConnection', () =>
                CiscoAnyConnect.createConnection({ name: 'Example', host })
              )
            }
          />
          <View style={styles.spacer} />
          <Button
            title="Refresh state"
            disabled={busy}
            onPress={() => CiscoAnyConnect.refresh()}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Last callback</Text>
          <Text style={styles.mono}>
            {lastCallback ? JSON.stringify(lastCallback, null, 2) : 'none yet'}
          </Text>
          <View style={styles.spacer} />
          <Button
            title="Simulate a success callback"
            onPress={() => {
              // Exercises the callback path without a headend: this is exactly the URL AnyConnect
              // would open for `onsuccess`.
              CiscoAnyConnect.handleCallbackUrl(
                'ciscoanyconnectexample://anyconnect/callback?action=connect&result=success'
              );
            }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Log</Text>
          <Text style={styles.mono}>{log.join('\n') || 'empty'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 4 },
  label: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', color: '#6b7280' },
  row: { fontSize: 15 },
  strong: { fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  spacer: { height: 8 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 12 },
});
