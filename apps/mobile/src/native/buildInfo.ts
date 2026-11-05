import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';

export const nativeBuildNumber = nativeBuildVersion ?? 'development';
export const nativeAppVersion = nativeApplicationVersion ?? 'development';
