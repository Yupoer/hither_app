import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const login = readFileSync(join(__dirname, '../screens/LoginScreen.tsx'), 'utf8');
const session = readFileSync(join(__dirname, '../state/SessionContext.tsx'), 'utf8');
const appConfig = readFileSync(join(__dirname, '../../app.json'), 'utf8');

describe('native Apple login UI contract', () => {
  it('exposes Apple login and renders the official button beside Google', () => {
    expect(session).toContain('signInWithApple: () => Promise<User | null>');
    expect(login).toContain('AppleAuthentication.AppleAuthenticationButton');
    expect(login).toContain('styles.socialRow');
  });

  it('enables the Expo Sign in with Apple capability', () => {
    const config = JSON.parse(appConfig);
    expect(config.expo.ios.usesAppleSignIn).toBe(true);
    expect(config.expo.plugins).toContain('expo-apple-authentication');
  });
});
