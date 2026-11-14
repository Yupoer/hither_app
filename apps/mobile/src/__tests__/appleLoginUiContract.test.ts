import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const providers = readFileSync(join(__dirname, '../components/AuthProviderButtons.tsx'), 'utf8');
const session = readFileSync(join(__dirname, '../state/SessionContext.tsx'), 'utf8');
const appConfig = readFileSync(join(__dirname, '../../app.json'), 'utf8');

describe('native Apple login UI contract', () => {
  it('renders the Apple system Continue button in its white variant', () => {
    expect(session).toContain('signInWithApple: () => Promise<User | null>');
    expect(providers).toContain('<AppleAuthentication.AppleAuthenticationButton');
    expect(providers).toContain('buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}');
    expect(providers).toContain('buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}');
  });

  it('enables the Expo Sign in with Apple capability', () => {
    const config = JSON.parse(appConfig);
    expect(config.expo.ios.usesAppleSignIn).toBe(true);
    expect(config.expo.plugins).toContain('expo-apple-authentication');
  });
});
