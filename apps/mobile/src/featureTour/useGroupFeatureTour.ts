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
import { measureTargetWithRetry } from './measureTarget';
import {
  completeGroupFeatureTour,
  isTourCompletedFromSources,
  readGroupFeatureTourCompletedLocal,
  readTourAccountSyncPending,
  readTourResetIntent,
  retryPendingTourAccountSync,
  shouldStartGroupFeatureTour,
  writeGroupFeatureTourCompletedLocal,
  writeTourResetIntent,
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
  /** Signed-in account id for scoped pending sync (required for account retry). */
  accountId?: string | null;
  /** Expand the tour destination gather card. */
  expandCard: (id: string) => void;
  pauseAutoCollapse: () => void;
  resumeAutoCollapse: () => void;
  /**
   * Single destination id for expand + availability lock.
   * Must match the card that owns measured refs.
   */
  tourDestinationId: string | null;
  setSheetMid: () => void;
  selectSheetPane: (key: 'members' | 'route' | 'tools' | 'store') => void;
  measureTarget: MeasureTargetFn;
  /** When false, nav-command step is omitted from the plan. */
  navCommandVisible?: boolean;
  /** When false, personal-arrive step is omitted from the plan. */
  personalArriveVisible?: boolean;
  /** Called when tour becomes active so MapScreen can lock carousel selection. */
  onTourActiveChange?: (active: boolean, destinationId: string | null) => void;
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
  const measureRef = useRef(input.measureTarget);
  const prefsRef = useRef(input.accountPreferences);
  const accountIdRef = useRef(input.accountId);
  const onActiveRef = useRef(input.onTourActiveChange);
  const tourDestRef = useRef(input.tourDestinationId);
  const expandRef = useRef(input.expandCard);
  const pauseRef = useRef(input.pauseAutoCollapse);
  const resumeRef = useRef(input.resumeAutoCollapse);
  const setSheetMidRef = useRef(input.setSheetMid);
  const selectPaneRef = useRef(input.selectSheetPane);

  // Keep latest callbacks/values without writing refs during render body in a way
  // that confuses React Compiler: schedule via effect.
  useEffect(() => {
    stepsRef.current = steps;
    measureRef.current = input.measureTarget;
    prefsRef.current = input.accountPreferences;
    accountIdRef.current = input.accountId;
    onActiveRef.current = input.onTourActiveChange;
    tourDestRef.current = input.tourDestinationId;
    expandRef.current = input.expandCard;
    pauseRef.current = input.pauseAutoCollapse;
    resumeRef.current = input.resumeAutoCollapse;
    setSheetMidRef.current = input.setSheetMid;
    selectPaneRef.current = input.selectSheetPane;
  }, [
    steps,
    input.measureTarget,
    input.accountPreferences,
    input.accountId,
    input.onTourActiveChange,
    input.tourDestinationId,
    input.expandCard,
    input.pauseAutoCollapse,
    input.resumeAutoCollapse,
    input.setSheetMid,
    input.selectSheetPane,
  ]);

  const reevaluate = useCallback(() => {
    void (async () => {
      let local = await readGroupFeatureTourCompletedLocal();
      const accountId = accountIdRef.current;
      const pending = await readTourAccountSyncPending();
      const resetIntent = await readTourResetIntent();
      const prefsDone = prefsRef.current?.groupFeatureTourCompleted === true;

      // Prefer per-account pending desired value over stale session prefs.
      const pendingForAccount =
        pending != null
        && typeof accountId === 'string'
        && pending.accountId === accountId
          ? pending
          : null;

      // Effective account intent for this evaluation.
      // - pending.completed wins for this account (reset retries false, complete retries true)
      // - reset intent blocks account→local hydrate from stale memory prefs === true
      let accountIntent: boolean;
      if (pendingForAccount) {
        accountIntent = pendingForAccount.completed;
      } else if (resetIntent) {
        accountIntent = false;
      } else {
        accountIntent = prefsDone;
      }

      // Cross-device hydrate: account says done and local is empty — only when not
      // in a reset / pending-false path.
      if (accountIntent && !local) {
        await writeGroupFeatureTourCompletedLocal(true).catch(() => undefined);
        local = true;
      }

      // Retry pending before computing done so a successful write can clear state.
      if (pendingForAccount) {
        await retryPendingTourAccountSync({
          accountId,
          existingPreferences: prefsRef.current,
        });
      } else {
        void retryPendingTourAccountSync({
          accountId,
          existingPreferences: prefsRef.current,
        });
      }

      // Clear reset intent once session prefs catch up (false) or local completed.
      if (resetIntent && (!prefsDone || local)) {
        await writeTourResetIntent(false).catch(() => undefined);
      }

      const done = isTourCompletedFromSources({
        localCompleted: local,
        accountCompleted: accountIntent,
      });
      setTourCompleted(done);
      setGateReady(true);
    })();
  }, []);

  useEffect(() => {
    reevaluate();
  }, [reevaluate, input.accountId, input.accountPreferences?.groupFeatureTourCompleted]);

  // Start when gate allows.
  useEffect(() => {
    if (!gateReady || tourCompleted || ctrl.active) return;
    let cancelled = false;
    void (async () => {
      const {
        readOnboardingState,
        readOnboardingReplayIntent,
        isOnboardingCompleteForTourGate,
      } = await import('../onboarding/sync');
      const onboarding = await readOnboardingState();
      const replayIntent = await readOnboardingReplayIntent();
      if (cancelled) return;
      const onboardingOk = isOnboardingCompleteForTourGate({
        storageCompleted: Boolean(onboarding?.completed),
        replayIntent,
      });
      const ok = shouldStartGroupFeatureTour({
        onboardingCompleted: onboardingOk,
        hasGroupId: Boolean(input.groupId),
        destinationCount: input.destinationCount,
        tourCompleted,
        passiveMode: input.passiveMode || !input.denseChrome,
        onboardingReplayPending: replayIntent,
      });
      if (ok && !cancelled) {
        setCtrl(startTour());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    gateReady,
    tourCompleted,
    ctrl.active,
    input.groupId,
    input.destinationCount,
    input.passiveMode,
    input.denseChrome,
  ]);

  // Notify MapScreen when tour active changes (carousel lock).
  useEffect(() => {
    onActiveRef.current?.(ctrl.active, tourDestRef.current);
  }, [ctrl.active]);

  const step = currentStep(ctrl, steps);

  // Apply step side effects (expand, sheet, pause).
  useEffect(() => {
    if (!ctrl.active || !step) return;
    if (appliedStepRef.current === ctrl.stepIndex) return;
    appliedStepRef.current = ctrl.stepIndex;

    if (step.pauseAutoCollapse) pauseRef.current();
    if (step.expandCard && tourDestRef.current) {
      expandRef.current(tourDestRef.current);
    }
    if (step.openStageTwo) setSheetMidRef.current();
    if (step.sheetPane) selectPaneRef.current(step.sheetPane);

    if (!step.pauseAutoCollapse && !step.expandCard) {
      resumeRef.current();
    }
  }, [ctrl.active, ctrl.stepIndex, step]);

  // Measure target with bounded retry + stable-parent fallback.
  // Clear happens only after async work starts (no sync setState in effect body).
  useEffect(() => {
    if (!ctrl.active || !step) return;
    let cancelled = false;
    const run = async () => {
      if (!step.target) {
        if (!cancelled) setTargetRect(null);
        return;
      }
      const rect = await measureTargetWithRetry({
        measure: (id) => measureRef.current(id),
        target: step.target,
        maxAttempts: 5,
        retryDelayMs: 80,
      });
      if (!cancelled) setTargetRect(rect);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ctrl.active, ctrl.stepIndex, step]);

  // Derived: hide hole when tour inactive (avoids sync setState on deactivate).
  const visibleTargetRect = ctrl.active ? targetRect : null;

  const onNext = useCallback(() => {
    if (!ctrl.active || completingRef.current) return;
    const plan = stepsRef.current;
    const cur = currentStep(ctrl, plan);
    if (cur?.final || ctrl.stepIndex >= plan.length - 1) {
      completingRef.current = true;
      setCompleting(true);
      void (async () => {
        try {
          await completeGroupFeatureTour({
            accountId: accountIdRef.current,
            existingPreferences: prefsRef.current,
          });
          setCtrl(stopTour());
          setTourCompleted(true);
          resumeRef.current();
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
  }, [ctrl]);

  return {
    tourActive: ctrl.active,
    step,
    stepIndex: ctrl.stepIndex,
    targetRect: visibleTargetRect,
    onNext,
    completing,
    reevaluate,
    steps,
  };
}
