import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../../');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const authFlow = read('apps/mobile/src/state/useAuthFlow.ts');
const session = read('apps/mobile/src/state/SessionContext.tsx');
const login = read('apps/mobile/src/screens/LoginScreen.tsx');
const authFieldIos = read('apps/mobile/src/components/AuthField.ios.tsx');
const modeSelector = read('apps/mobile/src/components/AuthModeSelector.tsx');
const modeSelectorIos = read('apps/mobile/src/components/AuthModeSelector.ios.tsx');
const googleIos = read('apps/mobile/src/state/googleSignIn.ios.ts');
const googleFallback = read('apps/mobile/src/state/googleSignIn.ts');
const googleGIcon = read('apps/mobile/src/components/GoogleGIcon.tsx');
const zh = read('apps/mobile/src/i18n/locales/zh.ts');
const packageConfig = JSON.parse(read('apps/mobile/package.json')) as {
  dependencies: Record<string, string>;
};

describe('auth overhaul contract', () => {
  it('returns verification pending for unconfirmed email sign-up', () => {
    expect(authFlow).not.toContain("data: { nickname: trimmed }");
    expect(authFlow).toContain('emailRedirectTo: AUTH_CALLBACK_URL');
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

  it('uses native Google ID tokens on iOS and hosted OAuth only on the fallback platform', () => {
    expect(packageConfig.dependencies['@react-native-google-signin/google-signin']).toBeTruthy();
    expect(googleIos).toContain('GoogleSignin.configure');
    expect(googleIos).toContain('GoogleSignin.signIn');
    expect(authFlow).toContain("from './googleSignIn'");
    expect(authFlow).toContain('getGoogleAuthCredentials');
    expect(authFlow).toContain('getGoogleIdToken');
    expect(authFlow).toMatch(/signInWithIdToken\(\{[\s\S]*?provider: 'google'/);
    expect(authFlow).toContain('access_token: accessToken');
    expect(authFlow).toContain('!usesNativeGoogleSignIn');
    expect(googleFallback).toContain('hosted OAuth');
    expect(authFlow).toContain('signInWithOAuth');
    expect(authFlow).toContain("queryParams: { prompt: 'select_account' }");
    expect(authFlow).toContain("provider: 'google'");
  });

  it('keeps the login UI single-mounted, stable, accessible, and haptic-aware', () => {
    expect(login).not.toContain('Alert.alert');
    expect(login).toContain('emailAlreadyRegistered');
    expect(login).not.toContain('Animated.timing');
    expect(login).toContain('formViewport');
    expect(login).toContain('renderAuthPanel(mode, true)');
    expect(login).toContain('selectionTick');
    expect(login).toContain('login-resend-confirmation');
    expect(login).toContain('getLegalUrl');
    expect(login).not.toContain('translateX');
    expect(login).toContain('SOCIAL_AUTH_TIMEOUT_MS = 120_000');
    expect(login).toContain('timeoutMs: SOCIAL_AUTH_TIMEOUT_MS');
    expect(authFieldIos).toContain("from 'react-native'");
    expect(authFieldIos).toContain('<TextInput');
    expect(login).toContain("primaryAction: { width: '100%'");
    expect(login).toContain("guestButton: { alignSelf: 'center'");
    expect(login).toContain("resetAction: { width: '100%'");
    expect(login).not.toContain('testID="login-signup-terms"');
    expect(login).not.toContain('termsAccepted');
    expect(login).toContain('BlockingAuthOverlay');
    expect(googleGIcon).toContain("require('../../assets/google-g.png')");
    expect(existsSync(join(root, 'apps/mobile/assets/google-g.png'))).toBe(true);
    expect(modeSelector).toContain("width: '66.667%'");
    expect(modeSelectorIos).toContain('<Picker');
    expect(modeSelectorIos).toContain("pickerStyle('segmented')");
    expect(zh).toContain("'login.signupAgreementPrefix': '點擊開始即表示同意'");
    expect(zh).not.toContain('註冊即表示你同意');
  });
});
