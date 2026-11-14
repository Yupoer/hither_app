import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../../');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const authFlow = read('apps/mobile/src/state/useAuthFlow.ts');
const session = read('apps/mobile/src/state/SessionContext.tsx');
const login = read('apps/mobile/src/screens/LoginScreen.tsx');
const authFieldIos = read('apps/mobile/src/components/AuthField.ios.tsx');
const googleIos = read('apps/mobile/src/state/googleSignIn.ios.ts');
const googleFallback = read('apps/mobile/src/state/googleSignIn.ts');
const googleGIcon = read('apps/mobile/src/components/GoogleGIcon.tsx');
const packageConfig = JSON.parse(read('apps/mobile/package.json')) as {
  dependencies: Record<string, string>;
};

describe('auth overhaul contract', () => {
  it('returns verification pending for unconfirmed email sign-up', () => {
    expect(authFlow).not.toContain("data: { nickname: trimmed }");
    expect(authFlow).toContain('emailRedirectTo: redirectTo');
    expect(authFlow).toContain("data.user.identities.length === 0");
    expect(authFlow).toContain("status: 'verification_required'");
    expect(authFlow).toContain("status: 'signed_in'");
    expect(session).toContain("type: 'signup'");
    expect(session).toContain("beginAuthCallback('signup')");
  });

  it('keeps reset and recovery inside the SessionContext boundary', () => {
    expect(session).toContain('resetPasswordForEmail');
    expect(session).toContain("beginAuthCallback('recovery')");
    expect(session).toContain("event === 'PASSWORD_RECOVERY'");
    expect(session).toContain('updateUser({ password })');
    expect(session).toContain("recovery_not_active");
  });

  it('uses native Google ID tokens on iOS and hosted OAuth only on the fallback platform', () => {
    expect(packageConfig.dependencies['@react-native-google-signin/google-signin']).toBeTruthy();
    expect(googleIos).toContain('GoogleSignin.configure');
    expect(googleIos).toContain('GoogleSignin.signIn');
    expect(authFlow).toContain("from './googleSignIn'");
    expect(authFlow).toContain('getGoogleAuthCredentials');
    expect(authFlow).toMatch(/signInWithIdToken\(\{[\s\S]*?provider: 'google'/);
    expect(authFlow).toContain('access_token: accessToken');
    expect(authFlow).toContain('!usesNativeGoogleSignIn');
    expect(googleFallback).toContain('hosted OAuth');
    expect(authFlow).toContain('signInWithOAuth');
    expect(authFlow).toContain("queryParams: { prompt: 'select_account' }");
    expect(authFlow).toContain("provider: 'google'");
  });

  it('uses the native text entry boundary and offline provider logo', () => {
    expect(authFieldIos).toContain("from 'react-native'");
    expect(authFieldIos).toContain('<TextInput');
    expect(login).toContain('SOCIAL_AUTH_TIMEOUT_MS = 120_000');
    expect(login).toContain('BlockingAuthOverlay');
    expect(googleGIcon).toContain("require('../../assets/google-g.png')");
    expect(existsSync(join(root, 'apps/mobile/assets/google-g.png'))).toBe(true);
  });
});
