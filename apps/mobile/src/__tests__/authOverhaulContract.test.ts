import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../../');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const authFlow = read('apps/mobile/src/state/useAuthFlow.ts');
const session = read('apps/mobile/src/state/SessionContext.tsx');
const login = read('apps/mobile/src/screens/LoginScreen.tsx');
const googleIos = read('apps/mobile/src/state/googleSignIn.ios.ts');
const googleFallback = read('apps/mobile/src/state/googleSignIn.ts');
const packageConfig = JSON.parse(read('apps/mobile/package.json')) as {
  dependencies: Record<string, string>;
};

describe('auth overhaul contract', () => {
  it('returns verification pending for unconfirmed email sign-up', () => {
    expect(authFlow).toContain("data: { nickname: trimmed }");
    expect(authFlow).toContain("data.user.identities.length === 0");
    expect(authFlow).toContain("status: 'verification_required'");
    expect(authFlow).toContain("status: 'signed_in'");
    expect(session).toContain("type: 'signup'");
    expect(session).toContain('hither://auth/callback');
  });

  it('keeps reset and recovery inside the SessionContext boundary', () => {
    expect(session).toContain('resetPasswordForEmail');
    expect(session).toContain('hither://auth/recovery');
    expect(session).toContain("event === 'PASSWORD_RECOVERY'");
    expect(session).toContain('updateUser({ password })');
    expect(session).toContain("recovery_not_active");
  });

  it('uses the native iOS token path and hosted OAuth only as the fallback', () => {
    expect(packageConfig.dependencies['@react-native-google-signin/google-signin']).toBeTruthy();
    expect(googleIos).toContain('GoogleSignin.configure');
    expect(googleIos).toContain('GoogleSignin.signIn');
    expect(authFlow).toMatch(/signInWithIdToken\(\{[\s\S]*?provider: 'google'/);
    expect(authFlow).toContain("linkIdentity({ provider: 'google', token })");
    expect(googleFallback).toContain('hosted OAuth');
    expect(authFlow).toContain('signInWithOAuth');
  });

  it('keeps the login UI inline, animated, accessible, and haptic-aware', () => {
    expect(login).not.toContain('Alert.alert');
    expect(login).toContain('emailAlreadyRegistered');
    expect(login).toContain('Animated.timing');
    expect(login).toContain('reduceMotion ? 120 : 220');
    expect(login).toContain('selectionTick');
    expect(login).toContain('login-resend-confirmation');
    expect(login).toContain('getLegalUrl');
  });
});
