import { AuthFlowError } from '../auth/types';

/** Android keeps the existing Supabase hosted OAuth flow in useAuthFlow. */
export async function getGoogleIdToken(): Promise<string | null> {
  throw new AuthFlowError(
    'Native Google Sign-In is only available on iOS.',
    'google_native_unavailable',
  );
}

