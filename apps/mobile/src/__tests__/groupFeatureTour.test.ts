/**
 * Tickets 06–09 — group feature tour foundation + lifecycle (pure seams).
 */
import {
  TOUR_STEPS,
  GROUP_FEATURE_TOUR_STORAGE_KEY,
  buildTourSteps,
} from '../featureTour/constants';
import {
  advanceTour,
  createTourControllerState,
  currentStep,
  isFinalStep,
  retreatTour,
  startTour,
  stopTour,
  stepOrder,
  stepCount,
} from '../featureTour/tourController';
import {
  shouldStartGroupFeatureTour,
  isTourCompletedFromSources,
} from '../featureTour/storage';

describe('group feature tour step order', () => {
  it('covers gathering card, stage two panes, avatar, settings, get started', () => {
    const ids = stepOrder();
    expect(ids[0]).toBe('collapsedCard');
    expect(ids).toContain('expandedCard');
    expect(ids).toContain('arrivalProgress');
    expect(ids).toContain('externalMaps');
    expect(ids).toContain('navCommand');
    expect(ids).toContain('transport');
    expect(ids).toContain('personalArrive');
    expect(ids).toContain('meetTime');
    expect(ids).toContain('paneMembers');
    expect(ids).toContain('paneRoute');
    expect(ids).toContain('paneTools');
    expect(ids).toContain('paneStore');
    expect(ids).toContain('avatar');
    expect(ids).toContain('settings');
    expect(ids).toContain('search');
    expect(ids.indexOf('search')).toBeGreaterThan(ids.indexOf('settings'));
    expect(ids.indexOf('search')).toBeLessThan(ids.indexOf('getStarted'));
    expect(ids[ids.length - 1]).toBe('getStarted');
    expect(stepCount()).toBe(TOUR_STEPS.length);
    expect(stepCount()).toBeGreaterThanOrEqual(16);
  });

  it('omits nav and personal-arrive when those controls are unavailable', () => {
    const leaderHiddenNav = buildTourSteps({
      navCommandVisible: false,
      personalArriveVisible: true,
    });
    expect(stepOrder(leaderHiddenNav)).not.toContain('navCommand');
    expect(stepOrder(leaderHiddenNav)).toContain('personalArrive');
    expect(stepOrder(leaderHiddenNav)).toContain('paneMembers');

    const memberNoArrive = buildTourSteps({
      navCommandVisible: true,
      personalArriveVisible: false,
    });
    expect(stepOrder(memberNoArrive)).toContain('navCommand');
    expect(stepOrder(memberNoArrive)).not.toContain('personalArrive');

    const bothMissing = buildTourSteps({
      navCommandVisible: false,
      personalArriveVisible: false,
    });
    expect(stepCount(bothMissing)).toBe(TOUR_STEPS.length - 2);
    // Controller advances only over the filtered plan.
    let state = startTour();
    while (state.active && !isFinalStep(state, bothMissing)) {
      state = advanceTour(state, bothMissing);
    }
    expect(currentStep(state, bothMissing)?.id).toBe('getStarted');
  });

  it('advances only forward and restarts at zero after stop', () => {
    let state = startTour();
    expect(currentStep(state)?.id).toBe('collapsedCard');
    state = advanceTour(state);
    expect(currentStep(state)?.id).toBe('expandedCard');
    // Walk to final.
    while (state.active && !isFinalStep(state)) {
      state = advanceTour(state);
    }
    expect(isFinalStep(state)).toBe(true);
    expect(currentStep(state)?.final).toBe(true);
    state = advanceTour(state);
    expect(state.active).toBe(false);
    expect(state.stepIndex).toBe(0);
    state = startTour();
    expect(currentStep(state)?.id).toBe('collapsedCard');
    state = stopTour();
    expect(createTourControllerState(false).active).toBe(false);
  });

  it('retreatTour stays on step 0 and never deactivates', () => {
    const atStart = startTour();
    expect(retreatTour(atStart)).toEqual({ active: true, stepIndex: 0 });
    const mid = { active: true, stepIndex: 4 };
    expect(retreatTour(mid)).toEqual({ active: true, stepIndex: 3 });
    expect(retreatTour({ active: false, stepIndex: 2 })).toEqual({
      active: false,
      stepIndex: 2,
    });
  });
});

describe('group feature tour trigger gate', () => {
  it('does not start for empty group or incomplete onboarding', () => {
    expect(
      shouldStartGroupFeatureTour({
        onboardingCompleted: false,
        hasGroupId: true,
        destinationCount: 2,
        tourCompleted: false,
      }),
    ).toBe(false);
    expect(
      shouldStartGroupFeatureTour({
        onboardingCompleted: true,
        hasGroupId: true,
        destinationCount: 0,
        tourCompleted: false,
      }),
    ).toBe(false);
    expect(
      shouldStartGroupFeatureTour({
        onboardingCompleted: true,
        hasGroupId: false,
        destinationCount: 2,
        tourCompleted: false,
      }),
    ).toBe(false);
  });

  it('starts when onboarding done, group has destinations, tour incomplete', () => {
    expect(
      shouldStartGroupFeatureTour({
        onboardingCompleted: true,
        hasGroupId: true,
        destinationCount: 1,
        tourCompleted: false,
      }),
    ).toBe(true);
  });

  it('does not start after complete or in passive mode', () => {
    expect(
      shouldStartGroupFeatureTour({
        onboardingCompleted: true,
        hasGroupId: true,
        destinationCount: 1,
        tourCompleted: true,
      }),
    ).toBe(false);
    expect(
      shouldStartGroupFeatureTour({
        onboardingCompleted: true,
        hasGroupId: true,
        destinationCount: 1,
        tourCompleted: false,
        passiveMode: true,
      }),
    ).toBe(false);
  });

  it('does not start while onboarding replay is pending (#171)', () => {
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
});

describe('tour completion sources', () => {
  it('treats local or account flag as completed', () => {
    expect(isTourCompletedFromSources({ localCompleted: true, accountCompleted: false })).toBe(true);
    expect(isTourCompletedFromSources({ localCompleted: false, accountCompleted: true })).toBe(true);
    expect(isTourCompletedFromSources({ localCompleted: false, accountCompleted: false })).toBe(false);
    expect(isTourCompletedFromSources({ localCompleted: false, accountCompleted: null })).toBe(false);
  });

  it('exports a stable storage key', () => {
    expect(GROUP_FEATURE_TOUR_STORAGE_KEY).toBe('hither.groupFeatureTour.v1');
  });
});
