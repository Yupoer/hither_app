import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPassiveCompanionModel,
  coarseProgressFromRatio,
  isPassiveActionAllowed,
  PASSIVE_ALLOWED_ACTIONS,
  PASSIVE_FORBIDDEN_ACTIONS,
  passiveModeTransitionSideEffects,
  teamPhaseFromJourneyGoing,
} from '../utils/passiveCompanion';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const preferences = read('state/PreferencesContext.tsx');
const mapScreen = read('screens/MapScreen.tsx');
const panel = read('screens/MapScreen/components/PassiveCompanionPanel.tsx');
const settings = read('screens/MapScreen/components/SettingsOverlay.tsx');
const i18n = [read('i18n/locales/zh.ts'), read('i18n/locales/en.ts')].join('\n');
const util = read('utils/passiveCompanion.ts');

describe('OTA-07 full/passive presentation contract', () => {
  it('persists passive mode as a device-local preference (default off, no server sync)', () => {
    expect(preferences).toContain("PASSIVE_COMPANION_MODE_KEY = 'pref.passiveCompanionMode'");
    expect(preferences).toContain('passiveCompanionMode');
    expect(preferences).toContain('setPassiveCompanionMode');
    expect(preferences).toContain("storedPassiveCompanionMode[1] === 'true'");
    // Not a second navigation tree / store.
    expect(mapScreen).not.toContain('PassiveCompanionNavigator');
    expect(mapScreen).not.toContain('createPassiveStore');
  });

  it('enters passive mode from Tools and restores after relaunch via preference', () => {
    expect(mapScreen).toContain("t('passive.enter')");
    expect(mapScreen).toContain('testID="tools-enter-passive"');
    expect(mapScreen).toContain('setPassiveCompanionMode');
    expect(mapScreen).toContain('passiveCompanionMode');
    expect(mapScreen).toContain('PassiveCompanionPanel');
    expect(settings).not.toContain("t('settings.passiveCompanionMode')");
    expect(i18n).toContain("'settings.passiveCompanionMode'");
    expect(i18n).toContain("'passive.switchBack'");
    expect(i18n).toContain("'passive.enter'");
  });

  it('shows current point, team phase, next point, and coarse personal progress', () => {
    expect(panel).toContain("t('passive.currentPoint')");
    expect(panel).toContain("t('passive.nextPoint')");
    expect(panel).toContain("t('passive.personalProgress')");
    expect(panel).toContain('phaseKey');
    expect(panel).toContain('progressKey');
    expect(mapScreen).toContain('buildPassiveCompanionModel');
    expect(mapScreen).toContain('journeyGoing');
    expect(mapScreen).toContain('liveProgress');
  });

  it('keeps switch-back available in normal, loading, empty, and error states', () => {
    expect(panel).toContain('testID="passive-switch-back"');
    expect(panel).toContain('disabled={false}');
    expect(panel).toContain("accessibilityLabel={t('passive.switchBack')}");
    expect(mapScreen).toContain('exitPassiveCompanionMode');
    // Loading early-return still mounts the panel when preference is on.
    expect(mapScreen).toMatch(
      /if \(loading && !state\)[\s\S]*inPassiveMode[\s\S]*PassiveCompanionPanel/,
    );
    // Offline empty-snapshot early-return also mounts the panel (OTA-07 #1).
    expect(mapScreen).toMatch(
      /emptyLocalSnapshot[\s\S]*inPassiveMode[\s\S]*PassiveCompanionPanel[\s\S]*exitPassiveCompanionMode/,
    );
    const modelReady = buildPassiveCompanionModel({
      mode: 'passive',
      loading: false,
      destinations: [{ id: 'a', title: 'A' }],
      journeyGoing: false,
    });
    const modelLoading = buildPassiveCompanionModel({
      mode: 'passive',
      loading: true,
      destinations: [],
      journeyGoing: false,
    });
    const modelEmpty = buildPassiveCompanionModel({
      mode: 'passive',
      loading: false,
      destinations: [],
      journeyGoing: false,
    });
    const modelError = buildPassiveCompanionModel({
      mode: 'passive',
      loading: false,
      destinations: [],
      journeyGoing: false,
      errorMessage: 'network',
    });
    expect(modelReady.switchBackAvailable).toBe(true);
    expect(modelLoading.switchBackAvailable).toBe(true);
    expect(modelEmpty.switchBackAvailable).toBe(true);
    expect(modelError.switchBackAvailable).toBe(true);
    expect(modelLoading.contentStatus).toBe('loading');
    expect(modelEmpty.contentStatus).toBe('empty');
    expect(modelError.contentStatus).toBe('error');
  });

  it('keeps companion fields when error coexists with cached destinations', () => {
    // Error must not wipe team state when itinerary is already known.
    const errorWithCache = buildPassiveCompanionModel({
      mode: 'passive',
      loading: false,
      destinations: [
        { id: 'a', title: 'Park' },
        { id: 'b', title: 'Cafe' },
      ],
      currentPointId: 'a',
      journeyGoing: true,
      personalProgress: 0.4,
      errorMessage: 'network blip',
    });
    expect(errorWithCache.contentStatus).toBe('ready');
    expect(errorWithCache.errorMessage).toBe('network blip');
    expect(errorWithCache.currentPoint?.title).toBe('Park');
    expect(errorWithCache.nextPoint?.title).toBe('Cafe');
    expect(errorWithCache.teamPhase).toBe('en_route');
    expect(errorWithCache.coarseProgress).toBe('mid');
    // Panel surfaces error as non-blocking banner over fields.
    expect(panel).toContain('testID="passive-error-banner"');
    expect(panel).toContain("model.contentStatus === 'ready'");
    expect(util).toContain('Prefer companion fields when cached team data exists');
  });

  it('keeps external navigation and help without implied consent or payment', () => {
    expect(panel).toContain('testID="passive-external-nav"');
    // Full command catalogue parity with「全部快捷指令」(not a reduced 3-chip list).
    expect(panel).toContain('testID="passive-quick-commands"');
    expect(panel).toContain('QuickCommandsCard');
    expect(panel).toContain('variant="full"');
    expect(panel).toContain('onConfigureCustom');
    expect(panel).not.toContain('LEADER_QUICK');
    expect(panel).not.toContain('MEMBER_QUICK');
    expect(panel).toContain('HitherText');
    expect(panel).toContain('onOpenExternalNavigation');
    expect(panel).toContain("t('passive.noAutoConsent')");
    // No paywall / vote / safety approval actions from the panel.
    expect(panel).not.toContain('Paywall');
    expect(panel).not.toContain('openPaywall');
    expect(panel).not.toContain('openVote');
    expect(panel).not.toContain('safety_approval');
    expect(panel).not.toContain('confirmConsent');
  });

  it('uses the shortened passive mode title without a redundant visible hint', () => {
    expect(i18n).toContain("'passive.title': '被動模式'");
    expect(i18n).toContain("'passive.enter': '被動模式'");
    expect(i18n).toContain("'passive.enter': 'Passive mode'");
    expect(i18n).not.toContain("'passive.enter': '進入被動模式'");
    expect(i18n).not.toContain("'passive.enter': 'Enter passive mode'");
    expect(i18n).not.toContain("'passive.enterHint'");
    expect(mapScreen).not.toContain("t('passive.enterHint')");
    expect(mapScreen).not.toContain('passiveEnterHint');
    expect(mapScreen).toContain('numberOfLines={1}');
  });

  it('uses shared type tokens instead of exclusive large/bold passive titles', () => {
    expect(panel).toContain('TYPE_BASE');
    expect(panel).toContain('TYPE_BASE.title');
    // No residual 28px / 800-weight hero title for passive point names.
    expect(panel).not.toMatch(/pointTitle:[\s\S]{0,80}fontSize:\s*28/);
    expect(panel).not.toMatch(/pointTitle:[\s\S]{0,80}fontWeight:\s*'800'/);
  });

  it('derives the same team phase semantics as the full interface', () => {
    expect(teamPhaseFromJourneyGoing(true)).toBe('en_route');
    expect(teamPhaseFromJourneyGoing(false)).toBe('staying');
    const enRoute = buildPassiveCompanionModel({
      mode: 'passive',
      loading: false,
      destinations: [
        { id: 'a', title: 'Park' },
        { id: 'b', title: 'Cafe' },
      ],
      currentPointId: 'a',
      journeyGoing: true,
      personalProgress: 0.4,
    });
    expect(enRoute.teamPhase).toBe('en_route');
    expect(enRoute.currentPoint?.title).toBe('Park');
    expect(enRoute.nextPoint?.title).toBe('Cafe');
    expect(enRoute.coarseProgress).toBe('mid');

    const staying = buildPassiveCompanionModel({
      mode: 'passive',
      loading: false,
      destinations: [
        { id: 'a', title: 'Park' },
        { id: 'b', title: 'Cafe' },
      ],
      currentPointId: 'a',
      journeyGoing: false,
    });
    expect(staying.teamPhase).toBe('staying');
  });

  it('keeps personal progress user-scoped and never mutates team state', () => {
    expect(util).toContain('never written into team state');
    // Personal progress is user-scoped; prefer teamSurfaceView personal then shared local model.
    expect(mapScreen).toContain('teamSurfaceView.personal?.progress');
    expect(mapScreen).toContain('personalProgressRatio');
    // Coarse buckets only — no team write APIs in the util.
    expect(util).not.toContain('startSession');
    expect(util).not.toContain('completeGatheringStop');
    expect(util).not.toContain('sendCommand');
    expect(coarseProgressFromRatio(0, false)).toBe('not_started');
    expect(coarseProgressFromRatio(0.2, false)).toBe('early');
    expect(coarseProgressFromRatio(0.5, false)).toBe('mid');
    expect(coarseProgressFromRatio(0.8, false)).toBe('late');
    expect(coarseProgressFromRatio(1, false)).toBe('arrived');
    expect(coarseProgressFromRatio(0.1, true)).toBe('arrived');
  });

  it('emits no implicit consent, payment, vote, or safety action on mode transition', () => {
    expect(passiveModeTransitionSideEffects('full', 'passive')).toEqual([]);
    expect(passiveModeTransitionSideEffects('passive', 'full')).toEqual([]);
    for (const action of PASSIVE_FORBIDDEN_ACTIONS) {
      expect(isPassiveActionAllowed(action)).toBe(false);
    }
    for (const action of PASSIVE_ALLOWED_ACTIONS) {
      expect(isPassiveActionAllowed(action)).toBe(true);
    }
    // Pure contract helper only — not a runtime gate on MapScreen handlers.
    expect(util).toContain('do not call this from production UI handlers');
    expect(mapScreen).not.toContain('passiveModeTransitionSideEffects');
    expect(util).toContain("'consent'");
    expect(util).toContain("'payment'");
    expect(util).toContain("'vote'");
    expect(util).toContain("'safety_approval'");
  });

  it('gates passive presentation on preferencesReady to avoid full-chrome flash', () => {
    expect(mapScreen).toContain(
      'const inPassiveMode = preferencesReady && passiveCompanionMode',
    );
    expect(mapScreen).toContain(
      'const showDenseChrome = preferencesReady && !passiveCompanionMode',
    );
    expect(mapScreen).toContain('inPassiveMode');
    expect(mapScreen).toContain('showDenseChrome');
  });

  it('implements reduced existing UI (not a second navigation shell)', () => {
    // Decision: presentation simplification on MapScreen.
    expect(mapScreen).toContain('OTA-07');
    expect(mapScreen).toContain('passiveCompanionMode');
    expect(mapScreen).toContain('PassiveCompanionPanel');
    // Still the same MapScreen route tree.
    expect(mapScreen).toContain('export default function MapScreen');
    expect(panel).toContain('PassiveCompanionPanel');
  });
});
