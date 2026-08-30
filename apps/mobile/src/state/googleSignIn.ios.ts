import Constants from 'expo-constants';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { AuthFlowError, toAuthFlowError } from '../auth/types';

let configured = false;

function publicConfig(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as { google?: Record<string, string> } | undefined;
  return extra?.google?.[name] ?? '';
}

function configureGoogle(): void {
  if (configured) return;
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
  try {
    const result = await GoogleSignin.signIn();
    if (result.type === 'cancelled') return null;
    if (!result.data.idToken) {
      throw new AuthFlowError('Google did not return an ID token.', 'google_token_missing');
    }
    return result.data.idToken;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === statusCodes.SIGN_IN_CANCELLED || code === 'SIGN_IN_CANCELLED') return null;
    throw toAuthFlowError(error, 'Google Sign-In failed.');
  }
}

