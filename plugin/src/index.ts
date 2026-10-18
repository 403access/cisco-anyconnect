import type { ExpoConfig } from '@expo/config-types';
import {
  AndroidConfig,
  ConfigPlugin,
  createRunOncePlugin,
  withAndroidManifest,
  withInfoPlist,
} from 'expo/config-plugins';

/**
 * Config plugin for `expo-cisco-anyconnect`.
 *
 * It performs the two pieces of native configuration the module cannot do from JavaScript:
 *
 * - **iOS** — adds `anyconnect` to `LSApplicationQueriesSchemes` (without it, `canOpenURL` always
 *   answers "no"), and registers the callback scheme so AnyConnect's `onsuccess`/`onerror` URLs
 *   route back into your app.
 * - **Android** — declares the `<queries>` entries needed for package visibility on Android 11+,
 *   and adds a `VIEW` intent filter for the callback scheme.
 */

/** Scheme AnyConnect uses on both platforms. */
const ANYCONNECT_SCHEME = 'anyconnect';

/** Packages that ship the AnyConnect / Cisco Secure Client VPN client. */
const KNOWN_ANDROID_PACKAGES = [
  'com.cisco.anyconnect.vpn.android.avf',
  'com.cisco.anyconnect.vpn.android',
  'com.cisco.anyconnect.vpn.android.nodpi',
];

export interface CiscoAnyConnectPluginProps {
  /**
   * URL schemes to add to `LSApplicationQueriesSchemes` on iOS so the module can probe them.
   * Defaults to `['anyconnect']`. Pass `[]` to opt out.
   */
  querySchemes?: string[];
  /**
   * Deep-link scheme AnyConnect should open to report a connection outcome.
   *
   * Defaults to the first scheme in your app config (`scheme`). Without one, connection results
   * cannot be routed back and the module can only report what it asked AnyConnect to do.
   *
   * Pass `false` to disable callbacks entirely.
   */
  callbackScheme?: string | false;
  /**
   * Register the `anyconnect` scheme and the known AnyConnect packages in the Android `<queries>`
   * block. Defaults to `true`. The library manifest already declares these, so this only matters if
   * you disable library manifest merging.
   */
  androidQueries?: boolean;
  /**
   * `launchMode` to force on the Android main activity.
   *
   * Callback URLs arrive through `onNewIntent` when the activity is already running, which needs
   * `singleTask` or `singleTop`. Expo's own `scheme` config already requires `singleTask`, so this
   * defaults to `undefined` (leave as-is) and only exists as an escape hatch.
   */
  androidLaunchMode?: 'standard' | 'singleTop' | 'singleTask' | 'singleInstance';
}

interface ResolvedProps {
  querySchemes: string[];
  callbackScheme: string | false;
  androidQueries: boolean;
  androidLaunchMode?: CiscoAnyConnectPluginProps['androidLaunchMode'];
}

function asArray(value: unknown): string[] {
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

/** Accepts either `myapp` or `myapp://` and returns `myapp`. */
function normaliseScheme(scheme: string): string {
  return scheme.replace(/:\/\/.*$/, '').replace(/:$/, '');
}

function resolveOptions(config: ExpoConfig, props: CiscoAnyConnectPluginProps): ResolvedProps {
  let callbackScheme: string | false = false;

  if (props.callbackScheme === false) {
    callbackScheme = false;
  } else if (typeof props.callbackScheme === 'string' && props.callbackScheme.length > 0) {
    callbackScheme = normaliseScheme(props.callbackScheme);
  } else {
    const configured = [
      ...asArray(config.scheme),
      ...asArray(config.ios?.scheme),
      ...asArray(config.android?.scheme),
    ];

    if (configured.length > 0) {
      callbackScheme = normaliseScheme(configured[0]);
    } else {
      console.warn(
        '[expo-cisco-anyconnect] Neither a `callbackScheme` plugin option nor a `scheme` was found ' +
          'in the app config, so AnyConnect cannot report connection results back to the app. ' +
          'Add `scheme` to app.json / app.config.js, or pass the plugin a `callbackScheme`.'
      );
    }
  }

  return {
    querySchemes: props.querySchemes ?? [ANYCONNECT_SCHEME],
    callbackScheme,
    androidQueries: props.androidQueries ?? true,
    androidLaunchMode: props.androidLaunchMode,
  };
}

const withCiscoAnyConnectInfoPlist: ConfigPlugin<ResolvedProps> = (config, options) => {
  return withInfoPlist(config, (config) => {
    const infoPlist = config.modResults;

    if (options.querySchemes.length > 0) {
      const existing = Array.isArray(infoPlist.LSApplicationQueriesSchemes)
        ? infoPlist.LSApplicationQueriesSchemes
        : [];
      infoPlist.LSApplicationQueriesSchemes = Array.from(
        new Set([...existing, ...options.querySchemes])
      );
    }

    if (options.callbackScheme) {
      const urlTypes = Array.isArray(infoPlist.CFBundleURLTypes)
        ? [...infoPlist.CFBundleURLTypes]
        : [];

      const alreadyRegistered = urlTypes.some((urlType) =>
        (urlType?.CFBundleURLSchemes ?? []).includes(options.callbackScheme as string)
      );

      if (!alreadyRegistered) {
        urlTypes.push({
          CFBundleURLName: `${options.callbackScheme}.anyconnect`,
          CFBundleURLSchemes: [options.callbackScheme],
        });
      }

      infoPlist.CFBundleURLTypes = urlTypes;
    }

    return config;
  });
};

const withCiscoAnyConnectManifest: ConfigPlugin<ResolvedProps> = (config, options) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    if (options.androidQueries) {
      const queries: AndroidConfig.Manifest.ManifestQuery[] = Array.isArray(
        manifest.manifest.queries
      )
        ? [...manifest.manifest.queries]
        : [];

      const hasSchemeIntent = queries.some((entry) =>
        (entry.intent ?? []).some(
          (intent) =>
            (intent.action ?? []).some(
              (action) => action.$?.['android:name'] === 'android.intent.action.VIEW'
            ) &&
            (intent.data ?? []).some(
              (data) => data.$?.['android:scheme'] === ANYCONNECT_SCHEME
            )
        )
      );

      if (!hasSchemeIntent) {
        queries.push({
          intent: [
            {
              action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
              data: [{ $: { 'android:scheme': ANYCONNECT_SCHEME } }],
            },
          ],
        });
      }

      const declaredPackages = new Set(
        queries.flatMap((entry) =>
          (entry.package ?? []).map((item) => item.$['android:name'])
        )
      );

      for (const packageName of KNOWN_ANDROID_PACKAGES) {
        if (!declaredPackages.has(packageName)) {
          queries.push({ package: [{ $: { 'android:name': packageName } }] });
        }
      }

      manifest.manifest.queries = queries;
    }

    if (options.callbackScheme) {
      const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
      const intentFilters = activity['intent-filter'] ?? [];

      const alreadyHandled = intentFilters.some((filter) =>
        (filter.data ?? []).some(
          (data) => data.$?.['android:scheme'] === options.callbackScheme
        )
      );

      if (!alreadyHandled) {
        intentFilters.push({
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: [{ $: { 'android:scheme': options.callbackScheme } }],
        });
        activity['intent-filter'] = intentFilters;
      }
    }

    if (options.androidLaunchMode) {
      const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
      activity.$ = activity.$ ?? {};
      activity.$['android:launchMode'] = options.androidLaunchMode;
    }

    return config;
  });
};

const withCiscoAnyConnect: ConfigPlugin<CiscoAnyConnectPluginProps> = (config, props = {}) => {
  const options = resolveOptions(config, props);
  config = withCiscoAnyConnectInfoPlist(config, options);
  config = withCiscoAnyConnectManifest(config, options);
  return config;
};

export default createRunOncePlugin(withCiscoAnyConnect, 'expo-cisco-anyconnect');
