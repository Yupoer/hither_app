import Constants from 'expo-constants';
import { AuthFlowError, toAuthFlowError } from '../auth/types';

let configured = false;
export const usesNativeGoogleSignIn = true;
type GoogleSigninApi = {
  GoogleSignin: {
    configure: (options: { webClientId: string; iosClientId: string }) => void;
    signIn: () => Promise<{ type?: string; data?: { idToken?: string | null } }>;
  };
  statusCodes?: { SIGN_IN_CANCELLED?: string };
};
let api: GoogleSigninApi | null | undefined;

function loadGoogleApi(): GoogleSigninApi {
  if (api) return api;
  try {
    // Keep the native dependency lazy so an older iOS binary reports a normal
    // auth error/fallback instead of crashing while importing the screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    api = require('@react-native-google-signin/google-signin') as GoogleSigninApi;
    return api;
  } catch {
    api = null;
    throw new AuthFlowError('Google Sign-In is unavailable in this app build.', 'google_native_unavailable');
  }
}

function publicConfig(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as { google?: Record<string, string> } | undefined;
  return extra?.google?.[name] ?? '';
}

function configureGoogle(): void {
  if (configured) return;
  const { GoogleSignin } = loadGoogleApi();
  const webClientId = publicConfig('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  const iosClientId = publicConfig('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
  if (!webClientId || !iosClientId) {
    throw new AuthFlowError('Google Sign-In is not configured.', 'google_not_configured');
  }
  GoogleSignin.configure({ webClientId, iosClientId });
  configured = true;
}

export async function getGoogleIdToken(): Promise<string | null> {
  configureGoogle();
  const { GoogleSignin, statusCodes } = loadGoogleApi();
  try {
    const result = await GoogleSignin.signIn();
    if (result.type === 'cancelled') return null;
    const idToken = result.data?.idToken;
    if (!idToken) {
      throw new AuthFlowError('Google did not return an ID token.', 'google_token_missing');
    }
    return idToken;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === statusCodes?.SIGN_IN_CANCELLED || code === 'SIGN_IN_CANCELLED') return null;
    throw toAuthFlowError(error, 'Google Sign-In failed.');
  }
}

