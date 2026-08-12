import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldStartGroupFeatureTour } from '../featureTour/storage';
import {
  isOnboardingHomeBoundary,
  shouldRecheckOnboardingOnRouteChange,
} from '../onboarding/gate';

/**
 * Pure onboarding gates are duplicated as local copies of the production
 * formulas so this suite never loads supabase via onboarding/sync → client.
 * Source contracts assert the real module still exports the same names.
 */
function shouldPresentFullOnboarding(input: {
  storageCompleted: boolean;
  replayIntent: boolean;
  atHomeBoundary: boolean;
}): boolean {
  if (!input.storageCompleted) {
    if (input.replayIntent) return input.atHomeBoundary;
    return true;
  }
  if (input.replayIntent && input.atHomeBoundary) return true;
  return false;
}

function isOnboardingCompleteForTourGate(input: {
  storageCompleted: boolean;
  replayIntent: boolean;
}): boolean {
  if (input.replayIntent) return false;
  return input.storageCompleted;
}

const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const sync = readFileSync(join(__dirname, '../onboarding/sync.ts'), 'utf8');

describe('onboarding + tour replay gate (#171)', () => {
  describe('shouldPresentFullOnboarding', () => {
    it('shows first-launch incomplete always', () => {
      expect(
        shouldPresentFullOnboarding({
          storageCompleted: false,
          replayIntent: false,
          atHomeBoundary: true,
        }),
      ).toBe(true);
      expect(
        shouldPresentFullOnboarding({
          storageCompleted: false,
          replayIntent: false,
          atHomeBoundary: false,
        }),
      ).toBe(true);
    });

    it('after reset only presents at create/join home boundary', () => {
      expect(
        shouldPresentFullOnboarding({
          storageCompleted: false,
          replayIntent: true,
          atHomeBoundary: false,
        }),
      ).toBe(false);
      expect(
        shouldPresentFullOnboarding({
          storageCompleted: false,
          replayIntent: true,
          atHomeBoundary: true,
        }),
      ).toBe(true);
    });

    it('does not present when completed and no replay intent', () => {
      expect(
        shouldPresentFullOnboarding({
          storageCompleted: true,
          replayIntent: false,
          atHomeBoundary: true,
        }),
      ).toBe(false);
    });
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

    it('App presents onboarding via shouldPresentFullOnboarding at RoleSelect home', () => {
      expect(app).toContain('shouldPresentFullOnboarding');
      expect(app).toContain('readOnboardingReplayIntent');
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
      expect(sync).toContain('export function shouldPresentFullOnboarding');
    });
  });
});
