import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const groupActions = readFileSync(join(__dirname, '../screens/MapScreen/hooks/useGroupActions.ts'), 'utf8');
const accountActions = readFileSync(join(__dirname, '../screens/MapScreen/hooks/useAccountActions.ts'), 'utf8');
const authScreen = readFileSync(join(__dirname, '../screens/AuthScreen.tsx'), 'utf8');
const myTeamsScreen = readFileSync(join(__dirname, '../screens/MyTeamsScreen.tsx'), 'utf8');
const rootNavigator = readFileSync(join(__dirname, '../navigation/RootNavigator.tsx'), 'utf8');

function goHomeBody(): string {
  const start = groupActions.indexOf('goHomeCreateOrJoin = useCallback');
  expect(start).toBeGreaterThanOrEqual(0);
  // Function body is short; keep a bounded slice for assertions.
  return groupActions.slice(start, start + 700);
}

describe('navigation interaction contract (go home / re-enter map)', () => {
  it('goHomeCreateOrJoin uses reset, not stack-preserving navigate to RoleSelect', () => {
    const body = goHomeBody();
    expect(body).toContain("navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] })");
    expect(body).not.toContain("navigation.navigate('RoleSelect')");
    expect(body).toContain("logEvent('navigation_reset'");
    // Same transaction: clear overlay before leaving the Map route.
    expect(body).toContain('setOverlay(null)');
  });

  it('goHomeCreateOrJoin does not clear membership, session, or force leave', () => {
    const body = goHomeBody();
    expect(body).not.toContain('leaveGroup');
    expect(body).not.toContain('leaveGroups');
    expect(body).not.toContain('signOut');
  });

  it('Auth and MyTeams re-enter Map with replace so stack does not accumulate Maps', () => {
    expect(authScreen).toContain("navigation.replace('Map'");
    expect(myTeamsScreen).toContain("navigation.replace('Map'");
    // Root stack still exposes a single Map route name (not nested stacks).
    expect(rootNavigator).toContain('name="Map"');
    expect(rootNavigator).toContain('<Stack.Screen name="RoleSelect"');
  });

  it('Map disables interactive / full-screen pop so horizontal swipes cannot leave the team layer', () => {
    expect(rootNavigator).toContain('gestureEnabled: false');
    expect(rootNavigator).toContain('fullScreenGestureEnabled: false');
  });

  it('leave-group path still resets to RoleSelect separately from go-home', () => {
    // confirmLeave may reset after leave; that is a different actionId.
    expect(accountActions).toContain("routes: [{ name: 'RoleSelect' }]");
    const leaveStart = accountActions.indexOf('const confirmLeave = useCallback');
    expect(leaveStart).toBeGreaterThanOrEqual(0);
    const leaveBody = accountActions.slice(leaveStart, leaveStart + 900);
    expect(leaveBody).toContain('leaveGroup');
  });
});
