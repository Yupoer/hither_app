import type { ConfigContext, ExpoConfig } from 'expo/config';
import base from './app.json';

/**
 * Dynamic Expo config: inject Maps API key and google-services path from env
 * so secrets never need to live in committed app.json values.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const expoBase = (base as { expo: ExpoConfig }).expo;
  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '';
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  // These are public OAuth client identifiers, not credentials. Keep the
  // production values usable for a local/prebuild invocation while allowing
  // a different Firebase/Google project to override them through env.
  const defaultGoogleWebClientId =
    '542661452505-sr3ljbqvkk997q2gn6vakbq8bgnqq8o9.apps.googleusercontent.com';
  const defaultGoogleIosClientId =
    '542661452505-5d0l9jotbl9asqloju792rdd7rafc2s5.apps.googleusercontent.com';
  const defaultGoogleIosUrlScheme =
    'com.googleusercontent.apps.542661452505-5d0l9jotbl9asqloju792rdd7rafc2s5';
  const googleWebClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || defaultGoogleWebClientId;
  const googleIosClientId =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || defaultGoogleIosClientId;
  const googleIosUrlScheme =
    process.env.GOOGLE_IOS_URL_SCHEME?.trim() || defaultGoogleIosUrlScheme;
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL ?? '';
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL ?? '';
  const isProduction = process.env.EAS_BUILD_PROFILE === 'production';
  const isConfiguredLegalUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:'
        && Boolean(parsed.hostname)
        && !/example\.(com|org)|placeholder|__/i.test(value);
    } catch {
      return false;
    }
  };

  if (isProduction && (!isConfiguredLegalUrl(privacyUrl) || !isConfiguredLegalUrl(termsUrl))) {
    throw new Error(
      '[app.config] Production legal links require HTTPS EXPO_PUBLIC_PRIVACY_URL and EXPO_PUBLIC_TERMS_URL.',
    );
  }

  if (!mapsKey) {
    console.warn(
      '[app.config] GOOGLE_MAPS_ANDROID_API_KEY is empty. ' +
        'Android Google Maps will omit com.google.android.geo.API_KEY. ' +
        'Set it in apps/mobile/.env (see .env.example).',
    );
  }

  const plugins = [...(config.plugins ?? expoBase.plugins ?? [])];
  const hasGoogleSignInPlugin = plugins.some(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@react-native-google-signin/google-signin',
  );
  if (!hasGoogleSignInPlugin) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: googleIosUrlScheme },
    ]);
  }

  const baseIos = { ...(expoBase.ios ?? {}), ...(config.ios ?? {}) };
  const baseInfoPlist = {
    ...(expoBase.ios?.infoPlist ?? {}),
    ...(config.ios?.infoPlist ?? {}),
  } as Record<string, unknown>;
  const urlTypes = Array.isArray(baseInfoPlist.CFBundleURLTypes)
    ? (baseInfoPlist.CFBundleURLTypes as Array<Record<string, unknown>>).map((entry) => ({ ...entry }))
    : [];
  const firstUrlType = urlTypes[0] ?? {};
  const schemes = Array.isArray(firstUrlType.CFBundleURLSchemes)
    ? firstUrlType.CFBundleURLSchemes.filter((scheme): scheme is string => typeof scheme === 'string')
    : [];
  if (!schemes.includes(googleIosUrlScheme)) schemes.push(googleIosUrlScheme);
  urlTypes[0] = { ...firstUrlType, CFBundleURLSchemes: schemes };

  return {
    ...expoBase,
    ...config,
    plugins,
    ios: {
      ...baseIos,
      infoPlist: {
        ...baseInfoPlist,
        CFBundleURLTypes: urlTypes,
      },
    },
    extra: {
      ...expoBase.extra,
      ...config.extra,
      google: {
        ...(expoBase.extra as { google?: Record<string, string> } | undefined)?.google,
        ...(config.extra as { google?: Record<string, string> } | undefined)?.google,
        EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: googleWebClientId,
        EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: googleIosClientId,
        GOOGLE_IOS_URL_SCHEME: googleIosUrlScheme,
      },
      legal: {
        privacyUrl,
        termsUrl,
      },
    },
    android: {
      ...expoBase.android,
      ...config.android,
      package: expoBase.android?.package ?? 'app.hither.mobile',
      googleServicesFile,
      config: {
        ...expoBase.android?.config,
        ...config.android?.config,
        googleMaps: {
          apiKey: mapsKey,
        },
      },
    },
  };
};
