import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutRectangle } from 'react-native';
import type { AccountPreferences } from '../types';
import {
  buildTourSteps,
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
  retryPendingTourAccountSync,
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
  /** When false, nav-command step is omitted from the plan. */
  navCommandVisible?: boolean;
  /** When false, personal-arrive step is omitted from the plan. */
  personalArriveVisible?: boolean;
}

export interface UseGroupFeatureTourResult {
  tourActive: boolean;
  step: TourStepDef | null;
  stepIndex: number;
  targetRect: LayoutRectangle | null;
  onNext: () => void;
  /** True while waiting for local durable complete. */
  completing: boolean;
  /** Call after reset prefs to allow replay. */
  reevaluate: () => void;
  /** Live step plan (filtered by control availability). */
  steps: readonly TourStepDef[];
}

/**
 * MapScreen seam for one-time group feature tour.
 * No step persistence: remount restarts at 0 until complete flag is set.
 */
export function useGroupFeatureTour(
  input: UseGroupFeatureTourInput,
): UseGroupFeatureTourResult {
  const steps = useMemo(
    () =>
      buildTourSteps({
        navCommandVisible: input.navCommandVisible !== false,
        personalArriveVisible: input.personalArriveVisible !== false,
      }),
    [input.navCommandVisible, input.personalArriveVisible],
  );

  const [ctrl, setCtrl] = useState<TourControllerState>(() => createTourControllerState(false));
  const [targetRect, setTargetRect] = useState<LayoutRectangle | null>(null);
  const [gateReady, setGateReady] = useState(false);
  const [tourCompleted, setTourCompleted] = useState(true); // optimistic until load
  const [completing, setCompleting] = useState(false);
  const appliedStepRef = useRef<number>(-1);
  const completingRef = useRef(false);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const reevaluate = useCallback(() => {
    setGateReady(false);
    void (async () => {
      const local = await readGroupFeatureTourCompletedLocal();
      const accountDone = input.accountPreferences?.groupFeatureTourCompleted === true;
      // If account says done but local missing, seed local.
      if (accountDone && !local) {
        await writeGroupFeatureTourCompletedLocal(true).catch(() => undefined);
      }
      // Retry a previously failed account write without blocking UI.
      if (local || accountDone) {
        void retryPendingTourAccountSync({
          existingPreferences: input.accountPreferences,
          completed: true,
        });
      }
      const done = isTourCompletedFromSources({
        localCompleted: local,
        accountCompleted: accountDone,
      });
      setTourCompleted(done);
      setGateReady(true);
    })();
  }, [input.accountPreferences]);

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

  const step = currentStep(ctrl, steps);

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

  // Measure target for current step — no silent gatherCard fallback for missing controls.
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
      const rect = await input.measureTarget(step.target);
      if (!cancelled) setTargetRect(rect);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ctrl.active, ctrl.stepIndex, step, input.measureTarget]);

  const onNext = useCallback(() => {
    if (!ctrl.active || completingRef.current) return;
    const plan = stepsRef.current;
    const cur = currentStep(ctrl, plan);
    if (cur?.final || ctrl.stepIndex >= plan.length - 1) {
      completingRef.current = true;
      setCompleting(true);
      void (async () => {
        try {
          // Local write must succeed before UI dismisses the tour.
          await completeGroupFeatureTour({
            existingPreferences: input.accountPreferences,
          });
          setCtrl(stopTour());
          setTourCompleted(true);
          input.resumeAutoCollapse();
        } catch {
          // Keep overlay open so the user can retry Get started.
        } finally {
          completingRef.current = false;
          setCompleting(false);
        }
      })();
      return;
    }
    setCtrl((s) => advanceTour(s, plan));
  }, [ctrl, input]);

  return {
    tourActive: ctrl.active,
    step,
    stepIndex: ctrl.stepIndex,
    targetRect,
    onNext,
    completing,
    reevaluate,
    steps,
  };
}
