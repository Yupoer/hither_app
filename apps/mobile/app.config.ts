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
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
  const googleIosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME ?? '';
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

  if (isProduction && (!googleWebClientId || !googleIosClientId || !googleIosUrlScheme)) {
    throw new Error(
      '[app.config] Production Google Sign-In requires ' +
        'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, and GOOGLE_IOS_URL_SCHEME.',
    );
  }
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
  if (googleIosUrlScheme) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: googleIosUrlScheme },
    ]);
  }

  return {
    ...expoBase,
    ...config,
    plugins,
    extra: {
      ...expoBase.extra,
      ...config.extra,
      google: {
        ...(expoBase.extra as { google?: Record<string, string> } | undefined)?.google,
        ...(config.extra as { google?: Record<string, string> } | undefined)?.google,
        EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: googleWebClientId,
        EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: googleIosClientId,
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
