import Constants from 'expo-constants';

export const nativeBuildNumber = String(
  Constants.platform?.ios?.buildNumber ?? Constants.platform?.android?.versionCode ?? 'development',
);
