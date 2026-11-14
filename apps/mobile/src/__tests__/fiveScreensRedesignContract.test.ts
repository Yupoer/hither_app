import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('five-screen Liquid Glass redesign contract', () => {
  it('uses the Metalforge grain shader background via Skia', () => {
    const background = read('components/MetalforgeBackground.tsx');
    expect(background).toContain("speed:");
    expect(background).toContain("flow:");
    expect(background).toContain("grain:");
    expect(background).toContain("brightness:");
    expect(background).toContain("'#9A502B'");
    expect(background).toContain("'#9B7683'");
    expect(background).toContain('@shopify/react-native-skia');
    expect(background).toContain('Skia.RuntimeEffect.Make');
    expect(background).toContain('<Shader');
    expect(background).not.toContain('setInterval');
    expect(background).not.toContain('<LinearGradient');
  });

  it('blocks only the four authentication network actions', () => {
    const login = read('screens/LoginScreen.tsx');
    const overlay = read('components/BlockingAuthOverlay.tsx');
    expect(login).toContain('visible={blocking}');
    expect(login).toContain("busy === 'email_sign_in'");
    expect(login).toContain("busy === 'email_sign_up'");
    expect(login).toContain("busy === 'google'");
    expect(login).toContain("busy === 'apple'");
    expect(login).toContain('<BlockingAuthOverlay');
    expect(overlay).toContain('pointerEvents="auto"');
    expect(overlay).toContain('<WaveLoading');
  });

  it('keeps signup nickname-free and preserves names when entering an existing team', () => {
    const login = read('screens/LoginScreen.tsx');
    const authFlow = read('state/useAuthFlow.ts');
    const teams = read('screens/MyTeamsScreen.tsx');
    expect(login).not.toContain('login-nickname');
    expect(login).not.toContain('termsAccepted');
    expect(authFlow).not.toContain('data: { nickname: trimmed }');
    expect(teams).not.toContain('updateNickname');
    expect(read('api/services/ProfileService.ts')).toContain('.upsert(');
  });
});
