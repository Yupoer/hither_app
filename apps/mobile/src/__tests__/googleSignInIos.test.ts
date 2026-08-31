const mockConfigure = jest.fn();
const mockSignIn = jest.fn();

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        google: {
          EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-client-id',
          EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-client-id',
        },
      },
    },
  },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    signIn: (...args: unknown[]) => mockSignIn(...args),
  },
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

import { getGoogleIdToken } from '../state/googleSignIn.ios';

describe('native iOS Google sign-in adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('configures both client IDs and returns the Google ID token', async () => {
    mockSignIn.mockResolvedValueOnce({ data: { idToken: 'id-token' } });

    await expect(getGoogleIdToken()).resolves.toBe('id-token');
    expect(mockConfigure).toHaveBeenCalledWith({
      webClientId: 'web-client-id',
      iosClientId: 'ios-client-id',
    });
  });

  it('returns null when the account picker is cancelled', async () => {
    mockSignIn.mockResolvedValueOnce({ type: 'cancelled' });
    await expect(getGoogleIdToken()).resolves.toBeNull();
  });

  it('fails clearly when Google does not return an ID token', async () => {
    mockSignIn.mockResolvedValueOnce({ data: {} });
    await expect(getGoogleIdToken()).rejects.toMatchObject({ code: 'google_token_missing' });
  });
});
