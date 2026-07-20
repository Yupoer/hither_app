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

  if (!mapsKey) {
    console.warn(
      '[app.config] GOOGLE_MAPS_ANDROID_API_KEY is empty. ' +
        'Android Google Maps will omit com.google.android.geo.API_KEY. ' +
        'Set it in apps/mobile/.env (see .env.example).',
    );
  }

  return {
    ...expoBase,
    ...config,
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
