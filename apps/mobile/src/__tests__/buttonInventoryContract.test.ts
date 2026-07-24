import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * High-risk navigation / session / map / account handlers must go through runUiAction.
 * Pure setState buttons are listed as pure-UI (minimal safe handlers).
 */
const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const authScreen = readFileSync(join(__dirname, '../screens/AuthScreen.tsx'), 'utf8');
const roleSelect = readFileSync(join(__dirname, '../screens/RoleSelectScreen.tsx'), 'utf8');
const myTeams = readFileSync(join(__dirname, '../screens/MyTeamsScreen.tsx'), 'utf8');
const loginScreen = readFileSync(join(__dirname, '../screens/LoginScreen.tsx'), 'utf8');
const accountSheet = readFileSync(join(__dirname, '../components/AccountSheet.tsx'), 'utf8');
const feedbackSheet = readFileSync(join(__dirname, '../components/FeedbackSheet.tsx'), 'utf8');
const uiAction = readFileSync(join(__dirname, '../utils/uiAction.ts'), 'utf8');
const safePressable = readFileSync(join(__dirname, '../components/SafePressable.tsx'), 'utf8');
const recoveryBanner = readFileSync(
  join(__dirname, '../components/InteractionRecoveryBanner.tsx'),
  'utf8',
);
const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');

/** Known high-risk actionIds that must remain wired. */
const HIGH_RISK_ACTION_IDS = [
  // Nav / session (batch 3a)
  'map.go_home_create_or_join',
  'map.switch_group',
  'map.leave_group',
  'map.sign_out',
  'map.open_group_menu',
  'map.open_settings',
  'auth.create_group',
  'auth.join_group',
  'role_select.sign_out',
  'my_teams.enter_group',
  'my_teams.leave_group',
  'my_teams.clear_all',
  // Map / sheet (batch 3b)
  'map.destination_add',
  'map.destination_add_coords',
  'map.destination_delete',
  'map.destination_reorder',
  'map.destination_suggest',
  'map.confirm_add_destination',
  'map.fit_all_members',
  'map.locate_me',
  'map.open_feedback',
  'map.sync_db_and_logs',
  // Account / network (batch 3c)
  'login.sign_in',
  'login.sign_up',
  'login.google',
  'login.apple',
  'account.redeem',
  'account.upgrade_email',
  'account.link_google',
  'account.link_apple',
  'feedback.submit',
] as const;

describe('button inventory / high-risk action contract', () => {
  it('provides the shared action runner, SafePressable, and retryable recovery banner', () => {
    expect(uiAction).toContain('export async function runUiAction');
    expect(uiAction).toContain('export async function retryLastUiAction');
    expect(uiAction).toContain("logEvent('ui_action_start'");
    expect(uiAction).toContain("logEvent('ui_action_success'");
    expect(uiAction).toContain("logEvent('ui_action_error'");
    expect(uiAction).toContain("logEvent('ui_action_timeout'");
    expect(safePressable).toContain('runUiAction');
    expect(safePressable).toContain('suppressBanner');
    expect(recoveryBanner).toContain('retryLastUiAction');
    expect(recoveryBanner).toContain('clearUiActionFailure');
    expect(recoveryBanner).toContain("t('interaction.retry')");
    expect(recoveryBanner).toContain("t('common.cancel')");
  });

  it('wires Map navigation/session actions through runUiAction', () => {
    expect(mapScreen).toContain('runUiAction(');
    expect(mapScreen).toContain("'map.go_home_create_or_join'");
    expect(mapScreen).toContain("'map.switch_group'");
    expect(mapScreen).toContain("'map.leave_group'");
    expect(mapScreen).toContain("'map.sign_out'");
    expect(mapScreen).toContain("'map.open_group_menu'");
  });

  it('wires Map/Sheet high-risk async handlers through runUiAction', () => {
    expect(mapScreen).toContain("'map.destination_add'");
    expect(mapScreen).toContain("'map.destination_add_coords'");
    expect(mapScreen).toContain("'map.destination_delete'");
    expect(mapScreen).toContain("'map.destination_reorder'");
    expect(mapScreen).toContain("'map.destination_suggest'");
    expect(mapScreen).toContain("'map.confirm_add_destination'");
    expect(mapScreen).toContain("'map.fit_all_members'");
    expect(mapScreen).toContain("'map.locate_me'");
    expect(mapScreen).toContain("'map.open_feedback'");
    expect(mapScreen).toContain("'map.sync_db_and_logs'");
  });

  it('treats destination_add_coords success as true (sheet closes only on success)', () => {
    // Regression: void/undefined success was treated as failure and also kept
    // CoordinateDestinationSheet open after a successful write.
    const coordsBlockStart = mapScreen.indexOf("'map.destination_add_coords'");
    expect(coordsBlockStart).toBeGreaterThanOrEqual(0);
    const coordsBlock = mapScreen.slice(coordsBlockStart, coordsBlockStart + 2500);
    expect(coordsBlock).toContain('return true');
    expect(coordsBlock).toContain('if (result !== true)');
    // Follower notify path must throw on false so the sheet stays open.
    expect(mapScreen).toContain("if (!ok) throw new Error(t('map.setFailedMsg'))");
  });

  it('wires Auth create/join and RoleSelect sign-out through runUiAction / SafePressable', () => {
    expect(authScreen).toContain("'auth.create_group'");
    expect(authScreen).toContain("'auth.join_group'");
    expect(authScreen).toContain('SafePressable');
    expect(authScreen).toContain('token.isCurrent()');
    expect(roleSelect).toContain("'role_select.sign_out'");
    expect(roleSelect).toContain('token.isCurrent()');
    expect(myTeams).toContain("'my_teams.enter_group'");
    expect(myTeams).toContain("'my_teams.leave_group'");
    expect(myTeams).toContain("'my_teams.clear_all'");
    expect(myTeams).toContain('token.isCurrent()');
  });

  it('wires Login, account upgrade/redeem, and feedback submit through runUiAction', () => {
    expect(loginScreen).toContain('SafePressable');
    expect(loginScreen).toContain("'login.sign_in'");
    expect(loginScreen).toContain("'login.sign_up'");
    expect(loginScreen).toContain("'login.google'");
    expect(loginScreen).toContain("'login.apple'");
    expect(accountSheet).toContain("'account.redeem'");
    expect(accountSheet).toContain("'account.upgrade_email'");
    expect(accountSheet).toContain("'account.link_google'");
    expect(accountSheet).toContain("'account.link_apple'");
    expect(feedbackSheet).toContain("'feedback.submit'");
    expect(feedbackSheet).toContain('token.isCurrent()');
  });

  it('mounts the shared interaction recovery banner at the app root', () => {
    expect(app).toContain('InteractionRecoveryBanner');
  });

  it('keeps a local map subtree boundary with finite remount (no timer remount)', () => {
    expect(groupMap).toContain('MapSubtreeBoundary');
    expect(groupMap).toContain('map_surface_failure');
    expect(groupMap).toContain('map_surface_retry');
    expect(groupMap).toContain('remountUsed');
    expect(groupMap).toContain('resetKey');
    expect(groupMap).not.toMatch(/setInterval\([^)]*setSurfaceKey/);
    expect(groupMap).toContain('onRequestGoHome');
    expect(groupMap).toContain("logError('map_loaded_timeout'");
  });

  it('locks the high-risk actionId inventory so new handlers are not silent', () => {
    const corpus = [
      mapScreen,
      authScreen,
      roleSelect,
      myTeams,
      loginScreen,
      accountSheet,
      feedbackSheet,
    ].join('\n');
    for (const actionId of HIGH_RISK_ACTION_IDS) {
      expect(corpus).toContain(`'${actionId}'`);
    }
  });

  it('documents pure-UI handlers that stay as minimal setState (no forced runUiAction)', () => {
    // These are intentionally local state setters — inventory only.
    expect(mapScreen).toContain('const closeOverlay = useCallback(() => {');
    expect(mapScreen).toContain('setOverlay(null)');
    expect(loginScreen).toContain("onPress={() => setMode(m)}");
    expect(feedbackSheet).toContain('onPress={() => setCategory(c.key)}');
  });

  it('uses SafePressable in production call sites (not only the component definition)', () => {
    expect(loginScreen).toMatch(/from ['"]\.\.\/components\/SafePressable['"]/);
    expect(authScreen).toMatch(/from ['"]\.\.\/components\/SafePressable['"]/);
    expect(loginScreen).toContain('<SafePressable');
    expect(authScreen).toContain('<SafePressable');
  });
});
