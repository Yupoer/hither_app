import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldStartGroupFeatureTour } from '../featureTour/storage';
import {
  isOnboardingHomeBoundary,
  shouldRecheckOnboardingOnRouteChange,
} from '../onboarding/gate';

jest.mock('../api/client', () => ({ saveOnboardingProfile: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
import {
  isOnboardingCompleteForTourGate,
  markOnboardingReplayForHome,
  readOnboardingReplayIntent,
  writeOnboardingReplayIntent,
} from '../onboarding/sync';

const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
const map = readFileSync(join(__dirname, '../screens/MapScreen/hooks/useAccountActions.ts'), 'utf8');
const sync = readFileSync(join(__dirname, '../onboarding/sync.ts'), 'utf8');

describe('onboarding + tour replay gate (#171)', () => {
  it('stores an explicit replay request until the survey clears it', async () => {
    await writeOnboardingReplayIntent(false);
    expect(await readOnboardingReplayIntent()).toBe(false);
    await markOnboardingReplayForHome();
    expect(await readOnboardingReplayIntent()).toBe(true);
    await writeOnboardingReplayIntent(false);
    expect(await readOnboardingReplayIntent()).toBe(false);
  });

  describe('tour vs onboarding owners', () => {
    it('blocks tour while onboarding replay is pending', () => {
      expect(
        isOnboardingCompleteForTourGate({
          storageCompleted: false,
          replayIntent: true,
        }),
      ).toBe(false);
      expect(
        shouldStartGroupFeatureTour({
          onboardingCompleted: true,
          hasGroupId: true,
          destinationCount: 2,
          tourCompleted: false,
          onboardingReplayPending: true,
        }),
      ).toBe(false);
    });

    it('starts tour only with completed onboarding, group, and real destination', () => {
      expect(
        shouldStartGroupFeatureTour({
          onboardingCompleted: true,
          hasGroupId: true,
          destinationCount: 1,
          tourCompleted: false,
          onboardingReplayPending: false,
        }),
      ).toBe(true);
      expect(
        shouldStartGroupFeatureTour({
          onboardingCompleted: true,
          hasGroupId: true,
          destinationCount: 0,
          tourCompleted: false,
        }),
      ).toBe(false);
    });
  });

  describe('wiring contracts', () => {
    it('reset marks onboarding replay and clears tour without navigation', () => {
      expect(map).toContain('markOnboardingReplayForHome');
      expect(map).toContain('clearGroupFeatureTour');
      const start = map.indexOf('const resetPrefs = useCallback');
      const body = map.slice(start, map.indexOf('const confirmResetPrefs'));
      expect(body).not.toContain('reevaluateTourRef.current()');
      expect(body).not.toContain('navigation.');
      expect(body).not.toContain('setNeedsOnboarding');
    });

    it('App checks explicit replay at the team entry boundary', () => {
      expect(app).toContain('await readOnboardingReplayIntent()');
      expect(app).toContain('setNeedsOnboarding(replayIntent)');
      expect(app).toContain('isOnboardingHomeBoundary');
      expect(app).toContain('shouldRecheckOnboardingOnRouteChange');
      expect(app).toContain("reevaluateOnboarding('consume')");
    });

    it('RoleSelect is a home boundary even with membership (#181)', () => {
      expect(
        isOnboardingHomeBoundary({
          hasUser: true,
          hasMembership: true,
          routeName: 'RoleSelect',
        }),
      ).toBe(true);
      expect(
        isOnboardingHomeBoundary({
          hasUser: true,
          hasMembership: true,
          routeName: 'Map',
        }),
      ).toBe(false);
      expect(shouldRecheckOnboardingOnRouteChange('Map', 'RoleSelect')).toBe(true);
      expect(shouldRecheckOnboardingOnRouteChange(null, 'RoleSelect')).toBe(false);
    });

    it('exports durable replay intent key separate from tour storage', () => {
      expect(sync).toContain("ONBOARDING_REPLAY_INTENT_KEY = 'hither.onboarding.replayIntent'");
      expect(sync).toContain('markOnboardingReplayForHome');
      expect(sync).toContain('isOnboardingCompleteForTourGate');
    });
  });
});
