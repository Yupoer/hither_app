import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('five-screen Liquid Glass redesign contract', () => {
  it('uses the calibrated low-load Metalforge background', () => {
    const background = read('components/MetalforgeBackground.tsx');
    expect(background).toContain("speed: 1.05");
    expect(background).toContain("flow: 2.2");
    expect(background).toContain("grain: 10.5");
    expect(background).toContain("brightness: 0.72");
    expect(background).toContain("'#9A502B'");
    expect(background).toContain("'#9B7683'");
    expect(background.match(/<LinearGradient/g)?.length).toBe(3);
    expect(background).not.toContain('setInterval');
    expect(background).toContain('cancelAnimation');
    expect(existsSync(join(root, '../assets/metalforge-grain.png'))).toBe(true);
  });

  it('blocks only the four authentication network actions', () => {
    const login = read('screens/LoginScreen.tsx');
    const overlay = read('components/BlockingAuthOverlay.tsx');
    expect(login).toContain('blockingBusy');
    expect(login).toContain("busyAction === 'email_sign_in'");
    expect(login).toContain("busyAction === 'email_sign_up'");
    expect(login).toContain("busyAction === 'google'");
    expect(login).toContain("busyAction === 'apple'");
    expect(login).toContain('<BlockingAuthOverlay');
    expect(overlay).toContain('pointerEvents="auto"');
    expect(overlay).toContain('<BouncingDots');
  });

  it('keeps iOS buttons native and removes the redesigned Home delete action', () => {
    const role = read('screens/RoleSelectScreen.tsx');
    const teams = read('screens/MyTeamsScreen.tsx');
    expect(role).toContain('<NativeRoleActionButton');
    expect(role).toContain('<NativeTeamsButton');
    expect(role).not.toContain('confirmDeleteAccount');
    expect(teams).toContain('<NativeTeamCard');
    expect(teams).toContain('<NativeGlassButton');
    expect(read('components/NativeRoleActionButton.ios.tsx')).toContain("buttonBorderShape('roundedRectangle', 30)");
    expect(read('components/NativeTeamCard.ios.tsx')).toContain("buttonBorderShape('roundedRectangle', 24)");
  });

  it('keeps signup nickname-free and persists the nickname at create/join entry', () => {
    const login = read('screens/LoginScreen.tsx');
    const authFlow = read('state/useAuthFlow.ts');
    const teams = read('screens/MyTeamsScreen.tsx');
    expect(login).not.toContain('login-nickname');
    expect(login).not.toContain('termsAccepted');
    expect(authFlow).not.toContain('data: { nickname: trimmed }');
    expect(teams).toContain('updateNickname(fallback)');
    expect(read('api/services/ProfileService.ts')).toContain('.upsert(');
  });
});
