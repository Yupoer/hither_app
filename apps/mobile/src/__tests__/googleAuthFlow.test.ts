const mockGetGoogleAuthCredentials = jest.fn();
const mockGetGoogleIdToken = jest.fn();
const mockSignInWithIdToken = jest.fn();
const mockMaybeSingle = jest.fn();
const mockProfileUpsert = jest.fn();
const mockSetUser = jest.fn();
const mockSetIsAnonymous = jest.fn();

jest.mock('react', () => ({ useCallback: (fn: unknown) => fn }));
jest.mock('expo-web-browser', () => ({}));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: jest.fn() }));
jest.mock('expo-auth-session/build/QueryParams', () => ({ getQueryParams: jest.fn() }));
jest.mock('expo-apple-authentication', () => ({}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'raw-nonce',
  digestStringAsync: jest.fn().mockResolvedValue('hashed-nonce'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('../api/client', () => ({
  updateNickname: jest.fn(),
  updateProfile: jest.fn(),
}));
jest.mock('../constants/avatars', () => ({
  displayMemberAvatar: jest.fn(() => ({ emoji: '🐑' })),
}));
jest.mock('../state/googleSignIn', () => ({
  getGoogleAuthCredentials: (...args: unknown[]) => mockGetGoogleAuthCredentials(...args),
  getGoogleIdToken: (...args: unknown[]) => mockGetGoogleIdToken(...args),
  usesNativeGoogleSignIn: true,
}));
jest.mock('../api/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...args: unknown[]) => mockSignInWithIdToken(...args),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
      upsert: (...args: unknown[]) => mockProfileUpsert(...args),
    }),
  },
}));

import { useAuthFlow } from '../state/useAuthFlow';

function makeFlow() {
  // This invokes the hook-shaped service factory without rendering React.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAuthFlow({
    user: null,
    setUser: mockSetUser,
    setIsAnonymous: mockSetIsAnonymous,
    setIsPro: jest.fn(),
    setMembershipState: jest.fn(),
  });
}

describe('Google ID-token auth flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGoogleAuthCredentials.mockResolvedValue({
      idToken: 'id-token',
      accessToken: null,
      nonce: 'raw-google-nonce',
    });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockProfileUpsert.mockResolvedValue({ error: null });
    mockSignInWithIdToken.mockResolvedValue({
      data: {
        user: {
          id: 'google-user',
          email: 'user@example.com',
          app_metadata: { provider: 'google' },
          user_metadata: {},
        },
      },
      error: null,
    });
  });

  it('exchanges an ID token when native Google has no getTokens API', async () => {
    const nextUser = await makeFlow().signInWithGoogle();

    expect(nextUser).toMatchObject({ id: 'google-user' });
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'id-token',
      nonce: 'raw-google-nonce',
    });
    expect(mockSignInWithIdToken.mock.calls[0][0]).not.toHaveProperty('access_token');
  });
});
