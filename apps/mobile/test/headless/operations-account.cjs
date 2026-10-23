const assert = require('node:assert/strict');

const operations = {};
function register(name, inventory, file, symbol, level, input, run) {
  operations[name] = { inventory: inventory.split(','), sources: [{ file, symbol }], entry: `${file}::${symbol}`,
    level, input, completion: 'Await the rendered state, durable storage, navigation or external receipt named by the scenario.', run };
}
function control(name, inventory, file, symbol, testId, kind = 'press') {
  register(name, inventory, file, symbol, 'screen', '{ value?, within? }', (app, input = {}) =>
    app.host.call({ testId, kind, ...input }));
}
function exported(name, inventory, file, symbol) {
  register(name, inventory, file, symbol, 'service', '{ args: Parameters<typeof entry> }', (_app, { args = [] }) => {
    assert(Array.isArray(args));
    return require(`../../${file}`)[symbol](...args);
  });
}
function session(name, inventory, symbol) {
  register(name, inventory, 'src/state/SessionContext.tsx', symbol, 'provider', '{ args: Parameters<typeof entry> }',
    (app, { args = [] }) => app.session[symbol](...args));
}

const login = 'src/screens/LoginScreen.tsx';
for (const [name, ids, symbol, id, kind] of [
  ['auth.email.edit', 'A04', 'changeField', 'login-email', 'changeText'],
  ['auth.password.edit', 'A04', 'changeField', 'login-password', 'changeText'],
  ['auth.confirm.edit', 'A04', 'changeField', 'login-confirm-password', 'changeText'],
  ['auth.email.submit', 'A01,A02,A04', 'submitEmail', 'login-submit'],
  ['auth.signin.select', 'A03', 'setAuthMode', 'login-tab-signin'],
  ['auth.signup.select', 'A03', 'setAuthMode', 'login-tab-signup'],
  ['auth.password.reveal', 'A05', 'renderPasswordToggle', 'login-password-toggle'],
  ['auth.confirm.reveal', 'A05', 'renderPasswordToggle', 'login-confirm-password-toggle'],
  ['auth.google', 'A06', 'runSocial', 'login-google'],
  ['auth.apple', 'A07', 'runSocial', 'login-apple'],
  ['auth.reset.open', 'A08', 'openPasswordReset', 'login-forgot-password'],
  ['auth.reset.edit', 'A09', 'changeField', 'login-reset-email', 'changeText'],
  ['auth.reset.send', 'A09', 'submitReset', 'login-reset-submit'],
  ['auth.confirmation.resend', 'A10', 'resendConfirmation', 'login-resend-confirmation'],
  ['auth.reset.back', 'A11', 'backToSignIn', 'login-reset-back'],
  ['auth.pending.back', 'A11', 'backToSignIn', 'login-pending-back'],
  ['auth.guest.open', 'A12', 'openGuestConfirm', 'login-guest'],
  ['auth.guest.confirm', 'A13', 'continueAsGuest', 'guest-confirm-button'],
  ['auth.guest.cancel', 'A14', 'cancelGuest', 'guest-cancel-button'],
  ['auth.privacy', 'A15', 'getLegalUrl', 'login-privacy'],
  ['auth.terms', 'A15', 'getLegalUrl', 'login-terms'],
]) control(name, ids, login, symbol, id, kind);
for (const symbol of ['beginAuthCallback', 'consumeAuthCallback', 'validateAuthCallback']) {
  exported(`auth.callback.${symbol}`, 'A16', 'src/auth/callbacks.ts', symbol);
}
for (const [name, id, kind] of [['password', 'recovery-password', 'changeText'],
  ['confirm', 'recovery-confirm-password', 'changeText'], ['reveal', 'recovery-password-toggle'], ['submit', 'recovery-submit']]) {
  control(`auth.recovery.${name}`, 'A17,A18', 'src/screens/PasswordRecoveryScreen.tsx', 'submit', id, kind);
}

session('session.signout', 'A22', 'signOut');
session('session.leave', 'A24', 'leaveGroup');
session('session.membership', 'B09', 'setMembership');
session('session.entitlement.refresh', 'B09', 'refreshEntitlement');
session('profile.nickname', 'P08', 'updateNickname');
session('profile.refresh', 'P05', 'refreshProfile');

for (const [name, ids, symbol, id, kind] of [
  ['name', 'A19,G01,G02', 'submitAuth', 'auth-name', 'changeText'],
  ['group-name', 'G01', 'submitAuth', 'auth-group-name', 'changeText'],
  ['code', 'G02', 'submitAuth', 'auth-code', 'changeText'],
  ['create', 'G01,A19', 'submitAuth', 'auth-create-group'],
  ['join', 'G02,A19', 'submitAuth', 'auth-join-group'],
]) control(`team.${name}`, ids, 'src/screens/AuthScreen.tsx', symbol, id, kind);
for (const [name, ids, testId] of [['create', 'T01', 'role-create'], ['join', 'T02', 'role-join'],
  ['teams', 'T03,T04', 'role-my-teams'], ['signout', 'A22', 'role-signout']]) {
  control(`home.${name}`, ids, 'src/screens/RoleSelectScreen.tsx', name === 'signout' ? 'startSignOut' : 'RoleSelectScreen', testId);
}
for (const [name, ids, id, symbol] of [['enter', 'T07,T08', 'team-enter', 'handleEnterGroup'],
  ['leave', 'T09', 'team-leave', 'handleLeaveGroup'], ['clear', 'T10', 'teams-clear', 'handleClearAllGroups'],
  ['create', 'T11', 'teams-empty-create', 'MyTeamsScreen'], ['join', 'T12', 'teams-empty-join', 'MyTeamsScreen'],
  ['back', 'T13', 'teams-back', 'MyTeamsScreen']]) {
  control(`teams.${name}`, ids, 'src/screens/MyTeamsScreen.tsx', symbol, id);
}
register('teams.expand', 'T06', 'src/screens/MyTeamsScreen.tsx', 'setExpandedGroupId', 'screen', '{ groupId }',
  (app, { groupId }) => app.host.call({ kind: 'press', testId: `team-card-${groupId}` }));
control('teams.retry', 'T04,T05', 'src/components/GroupLoadError.tsx', 'retry', 'group-load-retry');
control('team.back', 'T13', 'src/screens/AuthScreen.tsx', 'AuthScreen', 'auth-back');

for (const [name, ids, id, kind] of [['email', 'P01', 'account-email', 'changeText'],
  ['password', 'P01,P02', 'account-password', 'changeText'], ['confirm', 'P02', 'account-confirm-password', 'changeText'],
  ['upgrade', 'P01', 'account-upgrade'], ['add-password', 'P02', 'account-add-password'],
  ['google', 'P03', 'account-link-google'], ['apple', 'P04', 'account-link-apple'], ['delete', 'A23', 'account-delete']]) {
  control(`account.${name}`, ids, 'src/components/AccountSheet.tsx', name === 'delete' ? 'confirmDeleteAccount' : name === 'upgrade' ? 'handleUpgrade' : name === 'add-password' ? 'handleAddPassword' : ['google', 'apple'].includes(name) ? 'handleLink' : 'AccountSheetContent', id, kind);
}
for (const [name, ids, id, kind] of [['name', 'P06,P07', 'profile-name', 'changeText'],
  ['save', 'P07', 'overlay-done'], ['cancel', 'P06', 'overlay-close']]) {
  if (name === 'save') register('profile.save', ids, 'src/screens/MapScreen/components/ProfileOverlay.tsx', 'handleSave', 'screen', '{}', app => app.host.call({ kind: 'press', label: 'Done' }));
  else control(`profile.${name}`, ids, 'src/screens/MapScreen/components/ProfileOverlay.tsx', 'handleCancel', id, kind);
}
for (const field of ['avatar', 'color']) register(`profile.${field}`, 'P06,P07', 'src/screens/MapScreen/components/ProfileOverlay.tsx',
  field === 'avatar' ? 'setProfileAvatar' : 'setProfileColor', 'screen', '{ value }',
  (app, { value }) => app.host.call({ kind: 'press', testId: `profile-${field}-${value}` }));
for (const [name, id, kind] of [['label', 'custom-command-label', 'changeText'], ['message', 'custom-command-message', 'changeText'],
  ['save', 'custom-command-save'], ['cancel', 'overlay-close']]) {
  control(`command.${name}`, 'P09', 'src/components/CustomQuickCommandSheet.tsx', 'save', id, kind);
}

for (const [symbol, ids] of [['createGroup', 'G01'], ['joinGroup', 'G02'], ['updateGroupAvatar', 'G03'],
  ['getMyJoinedGroups', 'G04,T04,T05'], ['leaveGroups', 'G05'], ['kickGroupMember', 'G06'],
  ['setJourneyStatus', 'G07'], ['setJourneyTarget', 'G08'], ['setStragglerConfig', 'G09'],
  ['reportStraggler', 'G10'], ['updateGroupTripDetails', 'G11'], ['setSolo', 'G12'], ['selfSplit', 'G12'], ['selfMerge', 'G12']]) {
  exported(`group.${symbol}`, ids, 'src/api/services/GroupService.ts', symbol);
}
for (const [symbol, ids] of [['inviteToSubgroup', 'S01'], ['acceptSubgroupInvite', 'S02'],
  ['declineSubgroupInvite', 'S03'], ['fetchMyInvites', 'S04'], ['fetchSentInvites', 'S05']]) {
  exported(`subgroup.${symbol}`, ids, 'src/api/services/SubgroupService.ts', symbol);
}

for (const [symbol, id] of [['setTravelMode', 'V01'], ['setLanguage', 'V02'], ['setThemeName', 'V03'],
  ['setTextScale', 'V04'], ['setHighAccuracy', 'V05'], ['setSharingEnabled', 'V06'], ['setObliqueLocate', 'V07'],
  ['setLiveActivityEnabled', 'V08'], ['setMeetRedMin', 'V09'], ['setDayColor', 'V10'],
  ['setGatherCardDefaultExpanded', 'V11'], ['setGatherCardTitleMarquee', 'V12'], ['setGatherCardMarqueeSpeed', 'V13'],
  ['setArrivalRadiusM', 'V14'], ['setPassiveCompanionMode', 'V15'], ['setDiagnosticUploadEnabled', 'V16']]) {
  register(`preferences.${symbol}`, id, 'src/state/PreferencesContext.tsx', symbol, 'provider', '{ args }',
    (app, { args }) => app.preferences[symbol](...args));
}
for (const page of ['account', 'language', 'theme', 'textSize', 'groupAvatar', 'notifications', 'mapJourney', 'support']) {
  control(`settings.${page}`, 'V18', 'src/screens/MapScreen/components/SettingsOverlay.tsx', 'setPage', `settings-page-${page}`);
}
control('settings.diagnostic', 'V16', 'src/screens/MapScreen/components/SettingsOverlay.tsx', 'onDiagnosticSwitchChange', 'settings-diagnostic-upload', 'toggle');
control('settings.ota', 'X01,X02', 'src/screens/MapScreen/components/SettingsOverlay.tsx', 'handleApplyOta', 'settings-apply-ota');
control('settings.reset', 'V19', 'src/screens/MapScreen/components/SettingsOverlay.tsx', 'onConfirmResetPrefs', 'settings-reset-preferences');
register('settings.back', 'V18', 'src/screens/MapScreen/components/SettingsSheetPanel.tsx', 'onClose', 'screen', '{}', app => app.host.call({ kind: 'press', label: 'close' }));

control('onboarding.continue', 'O01,O02,O03,O04,O05,O06,O07,O08,O09,O10,O12', 'src/onboarding/steps/PrimaryButton.tsx', 'onPress', 'onboarding-continue');
control('onboarding.back', 'O11', 'src/onboarding/steps/StepShell.tsx', 'onBack', 'onboarding-back');
control('onboarding.skip', 'O11', 'src/onboarding/steps/StepShell.tsx', 'onSkip', 'onboarding-skip');
register('onboarding.option', 'O03,O04,O05,O07,O09,O10', 'src/onboarding/steps/OptionCard.tsx', 'onPress', 'screen', '{ label }',
  (app, { label }) => app.host.call({ kind: 'press', testId: `onboarding-option-${label}` }));
control('onboarding.days.increase', 'O05', 'src/onboarding/steps/L2DaysStep.tsx', 'change', 'onboarding-days-increase');
control('onboarding.days.decrease', 'O05', 'src/onboarding/steps/L2DaysStep.tsx', 'change', 'onboarding-days-decrease');
for (const symbol of ['readOnboardingState', 'readOnboardingReplayIntent', 'markOnboardingReplayForHome',
  'shouldPresentFullOnboarding', 'isOnboardingCompleteForTourGate', 'syncOnboardingIfNeeded']) {
  exported(`onboarding.${symbol}`, 'O13,V19', 'src/onboarding/sync.ts', symbol);
}

for (const [name, id, kind] of [['description', 'feedback-description', 'changeText'], ['submit', 'feedback-submit'], ['close', 'settings-child-back']]) {
  control(`feedback.${name}`, name === 'close' ? 'D02' : 'D01', 'src/components/FeedbackSheet.tsx', name === 'close' ? 'handleClose' : 'submit', id, kind);
}
register('feedback.category', 'D01', 'src/components/FeedbackSheet.tsx', 'setCategory', 'screen', '{ value }',
  (app, { value }) => app.host.call({ kind: 'press', testId: `feedback-category-${value}` }));
for (const symbol of ['uploadMetricPayload', 'uploadMetricPayloadBatch']) {
  exported(`diagnostics.${symbol}`, 'D05', 'src/api/services/DiagnosticService.ts', symbol);
}
for (const symbol of ['applyOtaUpdate', 'consumeOtaAppliedNotice', 'startOtaUpdateBootstrap']) {
  exported(`ota.${symbol}`, 'X02,X03', 'src/utils/otaUpdates.ts', symbol);
}
control('error.retry', 'X04', 'src/components/AppErrorBoundary.tsx', 'handleRetry', 'app-error-retry');

for (const [symbol, ids] of [['write', 'D03'], ['flush', 'D04'], ['purge', 'D04'], ['list', 'D06'], ['summary', 'D06'], ['exportJson', 'D06']]) {
  register('diagnostics.' + symbol, ids, 'src/state/diagnostics.ts', 'createDiagnostics', 'service', '{ args? }',
    (_app, { args = [] }) => require('../../src/state/diagnostics.ts').diagnostics[symbol](...args));
}
for (const [symbol, ids] of [['accept', 'S02'], ['decline', 'S03'], ['refresh', 'S06']]) {
  register('invites.' + symbol, ids, 'src/state/useSubgroupInvites.ts', 'useSubgroupInvites', 'hook', '{ args? }',
    (app, { args = [] }) => app.invites[symbol](...args));
}
for (const operation of Object.values(operations)) {
  if (operation.inventory.includes('P06') || operation.inventory.includes('P07')) operation.crossLinks = ['MAP-PROFILE-01'];
  if (operation.inventory.includes('V18') || operation.inventory.includes('V19')) operation.crossLinks = ['MAP-SETTINGS-01'];
}
exports.operations = operations;
exports.lifecycle = [
  { name: 'session.bootstrap', inventory: ['A20'], sources: [{ file: 'src/state/SessionContext.tsx', symbol: 'SessionProvider' }],
    trigger: 'Boot an app or real screen device and await SessionProvider hydration.', scenarios: ['real providers hydrated', 'signed out Login'] },
  { name: 'session.foreground', inventory: ['A21'], sources: [{ file: 'src/state/SessionContext.tsx', symbol: 'restoreSession' }],
    trigger: 'Send background then active through the external AppState subscription.', scenarios: ['foreground session recovery'] },
  { name: 'preferences.hydrate', inventory: ['V17'], sources: [{ file: 'src/state/PreferencesContext.tsx', symbol: 'PreferencesProvider' }],
    trigger: 'Restart the same device and await actual preferences.ready.', scenarios: ['persists every preference through real provider setters and rehydrates the same device'] },
];
