import { AuthFlowError } from '../auth/types';
import type { GoogleAuthCredentials } from './googleSignInTypes';

export type { GoogleAuthCredentials } from './googleSignInTypes';

/** Android keeps the existing Supabase hosted OAuth flow in useAuthFlow. */
export const usesNativeGoogleSignIn = false;

export async function getGoogleIdToken(): Promise<string | null> {
  throw new AuthFlowError(
    'Native Google Sign-In is only available on iOS.',
    'google_native_unavailable',
  );
}

/**
 * Android keeps the hosted OAuth fallback. This method exists so the shared
 * auth flow can request the same credential shape on either platform.
 */
export async function getGoogleAuthCredentials(): Promise<GoogleAuthCredentials | null> {
  const idToken = await getGoogleIdToken();
  return idToken ? { idToken, accessToken: null, nonce: null } : null;
}
