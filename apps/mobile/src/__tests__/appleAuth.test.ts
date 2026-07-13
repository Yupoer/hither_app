const mockSignInAsync = jest.fn();
const mockSignInWithIdToken = jest.fn();
const mockUpdateUser = jest.fn();
const mockProfileUpsert = jest.fn();
const mockMaybeSingle = jest.fn();

jest.mock('react', () => ({ useCallback: (fn: unknown) => fn }));
jest.mock('expo-web-browser', () => ({}));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: jest.fn() }));
jest.mock('expo-auth-session/build/QueryParams', () => ({ getQueryParams: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'raw-nonce',
  digestStringAsync: jest.fn().mockResolvedValue('hashed-nonce'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-apple-authentication', () => ({
  signInAsync: mockSignInAsync,
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('../api/client', () => ({
  updateNickname: jest.fn(),
  updateProfile: jest.fn(),
}));
jest.mock('../api/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: mockSignInWithIdToken,
      updateUser: mockUpdateUser,
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
      upsert: mockProfileUpsert,
    }),
  },
}));

import { useAuthFlow } from '../state/useAuthFlow';

function makeFlow() {
  return useAuthFlow({
    user: null,
    setUser: jest.fn(),
    setIsAnonymous: jest.fn(),
    setIsPro: jest.fn(),
    setMembershipState: jest.fn(),
  });
}

describe('signInWithApple', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null });
    mockProfileUpsert.mockResolvedValue({ error: null });
    mockUpdateUser.mockResolvedValue({ error: null });
  });

  it('exchanges the identity token and saves the first-login name', async () => {
    mockSignInAsync.mockResolvedValue({
      identityToken: 'apple.jwt',
      fullName: { givenName: 'Alex', familyName: 'Chen' },
      email: 'alex@privaterelay.appleid.com',
    });
    mockSignInWithIdToken.mockResolvedValue({
      data: { user: { id: 'u1', email: 'alex@privaterelay.appleid.com' } },
      error: null,
    });

    const flow = makeFlow();
    await expect(flow.signInWithApple()).resolves.toMatchObject({ id: 'u1', name: 'Alex Chen' });
    expect(mockSignInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'hashed-nonce' }));
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple.jwt',
      nonce: 'raw-nonce',
    });
    expect(mockProfileUpsert).toHaveBeenCalledWith(
      { id: 'u1', nickname: 'Alex Chen' },
      { onConflict: 'id' },
    );
  });

  it('returns null when the Apple sheet is cancelled', async () => {
    mockSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });

    await expect(makeFlow().signInWithApple()).resolves.toBeNull();
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });
});
