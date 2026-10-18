import type { ExpoConfig } from '@expo/config-types';
import { AndroidConfig } from 'expo/config-plugins';

import plugin, { type CiscoAnyConnectPluginProps } from '../index';

/**
 * These exercise the plugin the way Expo does: build the mod chain, then run the mod with a
 * pre-seeded `modResults` (the piece the prebuild base-mod provider normally reads from disk).
 */

type PluginConfig = Parameters<typeof plugin>[0];

/** The runtime shape a plugin returns: the config, plus the mod chain it registered. */
type ModCapableConfig = PluginConfig & {
  mods?: {
    ios?: { infoPlist?: (config: unknown) => Promise<{ modResults: unknown }> };
    android?: { manifest?: (config: unknown) => Promise<{ modResults: unknown }> };
  };
};

interface IosModResults {
  LSApplicationQueriesSchemes?: string[];
  CFBundleURLTypes?: { CFBundleURLName?: string; CFBundleURLSchemes?: string[] }[];
}

function makeConfig(scheme?: string): PluginConfig {
  const config: ExpoConfig = { name: 'demo', slug: 'demo' };
  if (scheme) {
    config.scheme = scheme;
  }
  return config;
}

async function runIosMod(
  config: PluginConfig,
  props?: CiscoAnyConnectPluginProps,
  seed: IosModResults = {}
): Promise<IosModResults> {
  const withMods = plugin(config, props ?? {}) as ModCapableConfig;
  const mod = withMods.mods?.ios?.infoPlist;
  if (!mod) {
    throw new Error('the plugin did not register the ios infoPlist mod');
  }
  const result = await mod({ ...withMods, modResults: seed });
  return result.modResults as IosModResults;
}

function emptyManifest(): AndroidConfig.Manifest.AndroidManifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      queries: [],
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [{ $: { 'android:name': '.MainActivity' } }],
        },
      ],
    },
  };
}

async function runAndroidMod(
  config: PluginConfig,
  props?: CiscoAnyConnectPluginProps,
  seed: AndroidConfig.Manifest.AndroidManifest = emptyManifest()
): Promise<AndroidConfig.Manifest.AndroidManifest> {
  const withMods = plugin(config, props ?? {}) as ModCapableConfig;
  const mod = withMods.mods?.android?.manifest;
  if (!mod) {
    throw new Error('the plugin did not register the android manifest mod');
  }
  const result = await mod({ ...withMods, modResults: seed });
  return result.modResults as AndroidConfig.Manifest.AndroidManifest;
}

function urlSchemes(results: IosModResults): string[] {
  return (results.CFBundleURLTypes ?? []).flatMap((type) => type.CFBundleURLSchemes ?? []);
}

describe('iOS', () => {
  it('allows querying the anyconnect scheme', async () => {
    const results = await runIosMod(makeConfig('myapp'));
    expect(results.LSApplicationQueriesSchemes).toContain('anyconnect');
  });

  it('registers the app scheme from the app config as the callback scheme', async () => {
    expect(urlSchemes(await runIosMod(makeConfig('myapp')))).toContain('myapp');
  });

  it('accepts a callback scheme passed as `myapp://`', async () => {
    const results = await runIosMod(makeConfig(), { callbackScheme: 'myapp://' });
    expect(urlSchemes(results)).toEqual(['myapp']);
  });

  it('does not duplicate entries that are already in Info.plist', async () => {
    const results = await runIosMod(makeConfig('myapp'), undefined, {
      CFBundleURLTypes: [{ CFBundleURLSchemes: ['myapp'] }],
      LSApplicationQueriesSchemes: ['anyconnect'],
    });

    expect(urlSchemes(results)).toEqual(['myapp']);
    expect(results.LSApplicationQueriesSchemes).toEqual(['anyconnect']);
  });

  it('skips callback registration when callbacks are disabled', async () => {
    const results = await runIosMod(makeConfig('myapp'), { callbackScheme: false });
    expect(results.CFBundleURLTypes).toBeUndefined();
    // The query scheme is independent of callbacks and must still be present.
    expect(results.LSApplicationQueriesSchemes).toContain('anyconnect');
  });

  it('lets querySchemes be opted out of', async () => {
    const results = await runIosMod(makeConfig('myapp'), { querySchemes: [] });
    expect(results.LSApplicationQueriesSchemes).toBeUndefined();
  });
});

describe('Android', () => {
  it('declares the anyconnect scheme and known packages for package visibility', async () => {
    const manifest = await runAndroidMod(makeConfig('myapp'));
    const queries = manifest.manifest.queries ?? [];

    const schemeIntent = queries
      .flatMap((entry) => entry.intent ?? [])
      .flatMap((intent) => intent.data ?? [])
      .map((data) => data.$?.['android:scheme']);
    expect(schemeIntent).toContain('anyconnect');

    const packages = queries.flatMap((entry) =>
      (entry.package ?? []).map((item) => item.$['android:name'])
    );
    expect(packages).toContain('com.cisco.anyconnect.vpn.android.avf');
  });

  it('adds a browsable intent filter for the callback scheme to the main activity', async () => {
    const manifest = await runAndroidMod(makeConfig('myapp'));
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);

    const callbackFilter = (activity['intent-filter'] ?? []).find((filter) =>
      (filter.data ?? []).some((data) => data.$?.['android:scheme'] === 'myapp')
    );

    expect(callbackFilter).toBeDefined();
    expect(callbackFilter?.category?.map((category) => category.$['android:name'])).toEqual([
      'android.intent.category.DEFAULT',
      'android.intent.category.BROWSABLE',
    ]);
  });

  it('is idempotent when the mod runs more than once', async () => {
    const once = await runAndroidMod(makeConfig('myapp'));
    const twice = await runAndroidMod(makeConfig('myapp'), undefined, once);

    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(twice);
    const myappFilters = (activity['intent-filter'] ?? []).filter((filter) =>
      (filter.data ?? []).some((data) => data.$?.['android:scheme'] === 'myapp')
    );
    expect(myappFilters).toHaveLength(1);
  });

  it('only writes launchMode when explicitly asked', async () => {
    const untouched = AndroidConfig.Manifest.getMainActivityOrThrow(
      await runAndroidMod(makeConfig('myapp'))
    );
    expect(untouched.$['android:launchMode']).toBeUndefined();

    const forced = AndroidConfig.Manifest.getMainActivityOrThrow(
      await runAndroidMod(makeConfig('myapp'), { androidLaunchMode: 'singleTask' })
    );
    expect(forced.$['android:launchMode']).toBe('singleTask');
  });

  it('skips the callback intent filter when callbacks are disabled', async () => {
    const manifest = await runAndroidMod(makeConfig('myapp'), { callbackScheme: false });
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    const schemes = (activity['intent-filter'] ?? []).flatMap((filter) =>
      (filter.data ?? []).map((data) => data.$?.['android:scheme'])
    );
    expect(schemes).not.toContain('myapp');
  });
});
