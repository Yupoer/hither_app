/** Credentials returned by the native Google account picker. */
export type GoogleAuthCredentials = {
  /** OpenID Connect ID token used by Supabase to identify the account. */
  idToken: string;
  /** Optional OAuth access token for providers/flows that explicitly require one. */
  accessToken: string | null;
  /** Raw nonce whose SHA-256 value was sent to Google on iOS. */
  nonce: string | null;
};
