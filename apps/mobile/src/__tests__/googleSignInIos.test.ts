import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import resolveExpoConfig from '../../app.config';

const mockConfigure = jest.fn();
const mockSignIn = jest.fn();
const mockDigestStringAsync = jest.fn().mockResolvedValue('hashed-google-nonce');
const mockGoogleExtra: { google: Record<string, string> } = {
  google: {
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-client-id',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-client-id',
  },
};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: mockGoogleExtra,
    },
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'raw-google-nonce',
  digestStringAsync: (...args: unknown[]) => mockDigestStringAsync(...args),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    signIn: (...args: unknown[]) => mockSignIn(...args),
  },
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

import {
  __resetGoogleSignInForTests,
  getGoogleAuthCredentials,
  getGoogleIdToken,
} from '../state/googleSignIn.ios';

const appConfigSource = readFileSync(join(__dirname, '../../app.config.ts'), 'utf8');
const appJson = readFileSync(join(__dirname, '../../app.json'), 'utf8');
const nativeInfoPlist = readFileSync(join(__dirname, '../../ios/Hither/Info.plist'), 'utf8');
const productionGoogleWebClientId =
  '542661452505-sr3ljbqvkk997q2gn6vakbq8bgnqq8o9.apps.googleusercontent.com';
const productionGoogleIosClientId =
  '542661452505-5d0l9jotbl9asqloju792rdd7rafc2s5.apps.googleusercontent.com';
const productionGoogleIosUrlScheme =
  'com.googleusercontent.apps.542661452505-5d0l9jotbl9asqloju792rdd7rafc2s5';

describe('native iOS Google sign-in adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetGoogleSignInForTests();
    mockGoogleExtra.google = {
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-client-id',
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-client-id',
    };
  });

  it('configures both client IDs and returns the Google ID token', async () => {
    mockSignIn.mockResolvedValueOnce({ data: { idToken: 'id-token' } });

    await expect(getGoogleIdToken()).resolves.toBe('id-token');
    expect(mockConfigure).toHaveBeenCalledWith({
      webClientId: 'web-client-id',
      iosClientId: 'ios-client-id',
    });
    expect(mockSignIn).toHaveBeenCalledWith({ nonce: 'hashed-google-nonce' });
  });

  it('returns the ID token without requiring a getTokens API', async () => {
    mockSignIn.mockResolvedValueOnce({ data: { idToken: 'id-token' } });

    await expect(getGoogleAuthCredentials()).resolves.toEqual({
      idToken: 'id-token',
      accessToken: null,
      nonce: 'raw-google-nonce',
    });
    expect(mockDigestStringAsync).toHaveBeenCalledWith('SHA-256', 'raw-google-nonce');
  });

  it('returns null when the account picker is cancelled', async () => {
    mockSignIn.mockResolvedValueOnce({ type: 'cancelled' });
    await expect(getGoogleIdToken()).resolves.toBeNull();
  });

  it('fails clearly when Google does not return an ID token', async () => {
    mockSignIn.mockResolvedValueOnce({ data: {} });
    await expect(getGoogleIdToken()).rejects.toMatchObject({ code: 'google_token_missing' });
  });

  it('converts native SDK/configuration failures to AuthFlowError', async () => {
    mockConfigure.mockImplementationOnce(() => {
      throw new Error('Google SDK unavailable');
    });
    await expect(getGoogleIdToken()).rejects.toMatchObject({
      name: 'AuthFlowError',
      message: 'Google SDK unavailable',
    });
  });

  it('converts an async native sign-in rejection to AuthFlowError', async () => {
    mockSignIn.mockRejectedValueOnce(new Error('Google account picker failed'));
    await expect(getGoogleIdToken()).rejects.toMatchObject({
      name: 'AuthFlowError',
      code: 'google_native_sign_in_failed',
      message: 'Google account picker failed',
    });
  });

  it('returns a normal configuration error when the runtime IDs are missing', async () => {
    mockGoogleExtra.google = {};
    await expect(getGoogleIdToken()).rejects.toMatchObject({
      name: 'AuthFlowError',
      code: 'google_not_configured',
    });
    expect(mockConfigure).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('keeps the production public IDs and iOS URL scheme in every config layer', () => {
    expect(appConfigSource).toContain(productionGoogleWebClientId);
    expect(appConfigSource).toContain(productionGoogleIosClientId);
    expect(appConfigSource).toContain(productionGoogleIosUrlScheme);
    expect(appJson).toContain(productionGoogleIosUrlScheme);
    expect(nativeInfoPlist).toContain(`<string>${productionGoogleIosUrlScheme}</string>`);
  });

  it('injects the default IDs and scheme into the runtime Expo config', () => {
    const envNames = [
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
      'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
      'GOOGLE_IOS_URL_SCHEME',
      'EAS_BUILD_PROFILE',
    ] as const;
    const saved = new Map(envNames.map((name) => [name, process.env[name]]));
    envNames.forEach((name) => {
      delete process.env[name];
    });
    try {
      const resolved = resolveExpoConfig({ config: JSON.parse(appJson).expo } as Parameters<typeof resolveExpoConfig>[0]);
      const google = resolved.extra?.google as Record<string, string>;
      const urlTypes = resolved.ios?.infoPlist?.CFBundleURLTypes as Array<{
        CFBundleURLSchemes?: string[];
      }>;
      expect(google.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).toBe(productionGoogleWebClientId);
      expect(google.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID).toBe(productionGoogleIosClientId);
      expect(google.GOOGLE_IOS_URL_SCHEME).toBe(productionGoogleIosUrlScheme);
      expect(urlTypes[0]?.CFBundleURLSchemes).toContain(productionGoogleIosUrlScheme);
      expect(resolved.plugins).toContainEqual([
        '@react-native-google-signin/google-signin',
        { iosUrlScheme: productionGoogleIosUrlScheme },
      ]);
    } finally {
      envNames.forEach((name) => {
        const value = saved.get(name);
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      });
    }
  });
});
