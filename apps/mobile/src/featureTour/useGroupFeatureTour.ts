import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutRectangle } from 'react-native';
import type { AccountPreferences } from '../types';
import {
  TOUR_STEPS,
  type TourStepDef,
  type TourTargetId,
} from './constants';
import {
  advanceTour,
  createTourControllerState,
  currentStep,
  startTour,
  stopTour,
  type TourControllerState,
} from './tourController';
import {
  completeGroupFeatureTour,
  isTourCompletedFromSources,
  readGroupFeatureTourCompletedLocal,
  shouldStartGroupFeatureTour,
  writeGroupFeatureTourCompletedLocal,
} from './storage';

export type MeasureTargetFn = (
  id: TourTargetId,
) => Promise<LayoutRectangle | null>;

export interface UseGroupFeatureTourInput {
  groupId: string | null | undefined;
  destinationCount: number;
  passiveMode: boolean;
  denseChrome: boolean;
  isLeader: boolean;
  accountPreferences?: AccountPreferences | null;
  /** Expand a gather card by destination id (first destination). */
  expandCard: (id: string) => void;
  pauseAutoCollapse: () => void;
  resumeAutoCollapse: () => void;
  /** First destination id for expand, or null. */
  firstDestinationId: string | null;
  setSheetMid: () => void;
  selectSheetPane: (key: 'members' | 'route' | 'tools' | 'store') => void;
  measureTarget: MeasureTargetFn;
}

export interface UseGroupFeatureTourResult {
  tourActive: boolean;
  step: TourStepDef | null;
  stepIndex: number;
  targetRect: LayoutRectangle | null;
  onNext: () => void;
  /** Call after reset prefs to allow replay. */
  reevaluate: () => void;
}

/**
 * MapScreen seam for one-time group feature tour.
 * No step persistence: remount restarts at 0 until complete flag is set.
 */
export function useGroupFeatureTour(
  input: UseGroupFeatureTourInput,
): UseGroupFeatureTourResult {
  const [ctrl, setCtrl] = useState<TourControllerState>(() => createTourControllerState(false));
  const [targetRect, setTargetRect] = useState<LayoutRectangle | null>(null);
  const [gateReady, setGateReady] = useState(false);
  const [tourCompleted, setTourCompleted] = useState(true); // optimistic until load
  const appliedStepRef = useRef<number>(-1);
  const completingRef = useRef(false);

  const reevaluate = useCallback(() => {
    setGateReady(false);
    void (async () => {
      const local = await readGroupFeatureTourCompletedLocal();
      const accountDone = input.accountPreferences?.groupFeatureTourCompleted === true;
      // If account says done but local missing, seed local.
      if (accountDone && !local) {
        await writeGroupFeatureTourCompletedLocal(true).catch(() => undefined);
      }
      const done = isTourCompletedFromSources({
        localCompleted: local,
        accountCompleted: accountDone,
      });
      setTourCompleted(done);
      setGateReady(true);
    })();
  }, [input.accountPreferences?.groupFeatureTourCompleted]);

  useEffect(() => {
    reevaluate();
  }, [reevaluate]);

  // Start when gate allows.
  useEffect(() => {
    if (!gateReady || tourCompleted || ctrl.active) return;
    // Onboarding is async — resolve inside.
    void (async () => {
      const { readOnboardingState } = await import('../onboarding/sync');
      const onboarding = await readOnboardingState();
      const ok = shouldStartGroupFeatureTour({
        onboardingCompleted: Boolean(onboarding?.completed),
        hasGroupId: Boolean(input.groupId),
        destinationCount: input.destinationCount,
        tourCompleted,
        passiveMode: input.passiveMode || !input.denseChrome,
      });
      if (ok) setCtrl(startTour());
    })();
  }, [
    gateReady,
    tourCompleted,
    ctrl.active,
    input.groupId,
    input.destinationCount,
    input.passiveMode,
    input.denseChrome,
  ]);

  const step = currentStep(ctrl);

  // Apply step side effects (expand, sheet, pause).
  useEffect(() => {
    if (!ctrl.active || !step) return;
    if (appliedStepRef.current === ctrl.stepIndex) return;
    appliedStepRef.current = ctrl.stepIndex;

    if (step.pauseAutoCollapse) input.pauseAutoCollapse();
    if (step.expandCard && input.firstDestinationId) {
      input.expandCard(input.firstDestinationId);
    }
    if (step.openStageTwo) input.setSheetMid();
    if (step.sheetPane) input.selectSheetPane(step.sheetPane);

    // Leaving gathering steps resumes auto-collapse.
    if (!step.pauseAutoCollapse && !step.expandCard) {
      input.resumeAutoCollapse();
    }
  }, [ctrl.active, ctrl.stepIndex, step, input]);

  // Measure target for current step.
  useEffect(() => {
    if (!ctrl.active || !step) {
      setTargetRect(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      if (!step.target) {
        if (!cancelled) setTargetRect(null);
        return;
      }
      // Wait a frame for expand / sheet layout.
      await new Promise((r) => setTimeout(r, 80));
      let rect = await input.measureTarget(step.target);
      if (!rect && step.target !== 'gatherCard') {
        rect = await input.measureTarget('gatherCard');
      }
      if (!cancelled) setTargetRect(rect);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ctrl.active, ctrl.stepIndex, step, input.measureTarget]);

  const onNext = useCallback(() => {
    if (!ctrl.active || completingRef.current) return;
    const cur = currentStep(ctrl);
    if (cur?.final || ctrl.stepIndex >= TOUR_STEPS.length - 1) {
      completingRef.current = true;
      setCtrl(stopTour());
      setTourCompleted(true);
      input.resumeAutoCollapse();
      void completeGroupFeatureTour({
        existingPreferences: input.accountPreferences,
      }).finally(() => {
        completingRef.current = false;
      });
      return;
    }
    setCtrl((s) => advanceTour(s));
  }, [ctrl, input]);

  return {
    tourActive: ctrl.active,
    step,
    stepIndex: ctrl.stepIndex,
    targetRect,
    onNext,
    reevaluate,
  };
}
