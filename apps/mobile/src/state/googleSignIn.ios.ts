import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { AuthFlowError, toAuthFlowError } from '../auth/types';
import type { GoogleAuthCredentials } from './googleSignInTypes';

export type { GoogleAuthCredentials } from './googleSignInTypes';

let configured = false;
export const usesNativeGoogleSignIn = true;
type GoogleSigninApi = {
  GoogleSignin: {
    configure: (options: { webClientId: string; iosClientId: string }) => void;
    signIn: (options?: { nonce?: string }) => Promise<{
      type?: string;
      data?: { idToken?: string | null };
    }>;
  };
  statusCodes?: { SIGN_IN_CANCELLED?: string };
};
let api: GoogleSigninApi | null | undefined;

function safeGoogleErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim();
  return /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : undefined;
}

function toGoogleNativeError(error: unknown, fallback: string, code: string): AuthFlowError {
  const normalized = toAuthFlowError(error, fallback);
  return normalized.code
    ? normalized
    : new AuthFlowError(normalized.message, code, normalized.status);
}

function loadGoogleApi(): GoogleSigninApi {
  if (api) return api;
  try {
    // Keep the native dependency lazy so an older iOS binary reports a normal
    // auth error/fallback instead of crashing while importing the screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('@react-native-google-signin/google-signin') as Partial<GoogleSigninApi>;
    if (!loaded.GoogleSignin
      || typeof loaded.GoogleSignin.configure !== 'function'
      || typeof loaded.GoogleSignin.signIn !== 'function') {
      throw new AuthFlowError(
        'Google Sign-In is unavailable in this app build.',
        'google_native_unavailable',
      );
    }
    api = loaded as GoogleSigninApi;
    return api;
  } catch (error) {
    if (error instanceof AuthFlowError) throw error;
    api = null;
    throw toGoogleNativeError(
      error,
      'Google Sign-In is unavailable in this app build.',
      'google_native_unavailable',
    );
  }
}

function publicConfig(name: string): string {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as { google?: Record<string, string> } | undefined;
  return extra?.google?.[name]?.trim() ?? '';
}

function configureGoogle(): void {
  if (configured) return;
  try {
    const { GoogleSignin } = loadGoogleApi();
    const webClientId = publicConfig('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
    const iosClientId = publicConfig('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
    if (!webClientId || !iosClientId) {
      throw new AuthFlowError('Google Sign-In is not configured.', 'google_not_configured');
    }
    GoogleSignin.configure({ webClientId, iosClientId });
    configured = true;
  } catch (error) {
    // Native SDK/configuration failures are part of the auth flow. Convert
    // them before they reach a screen so a stale binary cannot crash render.
    throw toGoogleNativeError(
      error,
      'Google Sign-In could not be configured.',
      'google_native_configure_failed',
    );
  }
}

export async function getGoogleAuthCredentials(): Promise<GoogleAuthCredentials | null> {
  let cancelCode: string | undefined;
  try {
    configureGoogle();
    const { GoogleSignin, statusCodes } = loadGoogleApi();
    cancelCode = statusCodes?.SIGN_IN_CANCELLED;
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    const result = await GoogleSignin.signIn({ nonce: hashedNonce });
    if (result.type === 'cancelled') return null;
    const idToken = result.data?.idToken;
    // Keep native diagnostics deliberately token-free. A release simulator
    // can therefore tell us whether the SDK handed the JS exchange usable
    // credentials without ever logging a credential value.
    console.log('[auth][google] native_sign_in_completed', {
      hasIdToken: Boolean(idToken),
    });
    if (!idToken) {
      throw new AuthFlowError('Google did not return an ID token.', 'google_token_missing');
    }
    // Supabase's Google ID-token exchange only needs the OIDC ID token. Do
    // not call getTokens here: newer SDK/runtime combinations may not expose
    // that API, and requiring an OAuth access token incorrectly blocks login.
    return { idToken, accessToken: null, nonce: rawNonce };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if ((cancelCode && code === cancelCode) || code === 'SIGN_IN_CANCELLED') return null;
    console.warn('[auth][google] native_credential_stage_failed', {
      code: safeGoogleErrorCode(code),
    });
    throw toGoogleNativeError(error, 'Google Sign-In failed.', 'google_native_sign_in_failed');
  }
}

export async function getGoogleIdToken(): Promise<string | null> {
  const credentials = await getGoogleAuthCredentials();
  return credentials?.idToken ?? null;
}

/** Test-only reset for isolated configuration/error-boundary tests. */
export function __resetGoogleSignInForTests(): void {
  configured = false;
  api = undefined;
}
