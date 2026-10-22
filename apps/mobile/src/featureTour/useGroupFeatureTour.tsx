import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
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
  retreatTour,
  startTour,
  stopTour,
  type TourControllerState,
} from './tourController';
import { getWindowSize, measureTourStepRects } from './measureTarget';
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
  /**
   * Currently selected carousel destination id.
   * Measurement waits until this matches tourDestinationId so gatherCard ref
   * is the tour card (preferred shared target may differ from initial selection).
   */
  selectedDestinationId?: string | null;
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
  lifecycle: import('react').ReactElement;
  tourActive: boolean;
  step: TourStepDef | null;
  stepIndex: number;
  targetRect: LayoutRectangle | null;
  placementRect: LayoutRectangle | null;
  /** True while a new pane/target snapshot is being measured. */
  transitioning: boolean;
  onNext: () => void;
  onPrev: () => void;
  canGoPrev: boolean;
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
  /** Copy and geometry become visible together after the target is measured. */
  const [snapshot, setSnapshot] = useState<{
    stepIndex: number;
    step: TourStepDef | null;
    pane: TourStepDef['sheetPane'] | null;
    targetRect: LayoutRectangle | null;
    placementRect: LayoutRectangle | null;
  }>({ stepIndex: 0, step: null, pane: null, targetRect: null, placementRect: null });
  const [transitioning, setTransitioning] = useState(false);
  const [measureNonce, setMeasureNonce] = useState(0);
  const [gateReady, setGateReady] = useState(false);
  const [tourCompleted, setTourCompleted] = useState(true); // optimistic until load
  const [completing, setCompleting] = useState(false);
  const committedInput = useMemo<GroupTourCommittedInput>(() => ({ steps, measureTarget: input.measureTarget, accountPreferences: input.accountPreferences, accountId: input.accountId, onTourActiveChange: input.onTourActiveChange, tourDestinationId: input.tourDestinationId, expandCard: input.expandCard, pauseAutoCollapse: input.pauseAutoCollapse, resumeAutoCollapse: input.resumeAutoCollapse, setSheetMid: input.setSheetMid, selectSheetPane: input.selectSheetPane }), [
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
  const committedInputRef = useRef(committedInput);
  const appliedStepRef = useRef<number>(-1);
  const completingRef = useRef(false);
  const transitioningRef = useRef(false);
  const measureGenerationRef = useRef(0);

  // Keep latest callbacks/values without writing refs during render body in a way
  // that confuses React Compiler: schedule via effect.
  const groupTourInputPublicationLifecycle = <GroupTourInputPublication committedInputRef={committedInputRef} committedInput={committedInput} />;

  const reevaluate = useCallback(() => {
    void (async () => {
      let local = await readGroupFeatureTourCompletedLocal();
      const accountId = committedInputRef.current.accountId;
      const pending = await readTourAccountSyncPending();
      const resetIntent = await readTourResetIntent();
      const prefsDone = committedInputRef.current.accountPreferences?.groupFeatureTourCompleted === true;

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
          existingPreferences: committedInputRef.current.accountPreferences,
        });
      } else {
        void retryPendingTourAccountSync({
          accountId,
          existingPreferences: committedInputRef.current.accountPreferences,
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

  const groupTourCompletionLoadLifecycle = <GroupTourCompletionLoad committedInputRef={committedInputRef} committedInput={committedInput} reevaluate={reevaluate} input={input} />;

  // Start when gate allows.
  const groupTourEligibilityLoadLifecycle = <GroupTourEligibilityLoad committedInputRef={committedInputRef} committedInput={committedInput} gateReady={gateReady} tourCompleted={tourCompleted} ctrl={ctrl} input={input} setCtrl={setCtrl} />;

  // Notify MapScreen when tour active changes (carousel lock).
  const groupTourActiveNotificationLifecycle = <GroupTourActiveNotification committedInputRef={committedInputRef} committedInput={committedInput} ctrl={ctrl} />;

  // `ctrl` is the requested step used to drive the sheet.  The overlay uses
  // the committed snapshot so a new copy never renders over the old hole.
  const requestedStep = currentStep(ctrl, steps);

  // Apply step side effects (expand, sheet, pause).

  // Measure target with bounded retry + stable-parent fallback.
  // Clear happens only after async work starts (no sync setState in effect body).
  // Remeasure when carousel selection catches up to tourDestinationId so the
  // first collapsedCard step does not stick to the pre-lock gatherCard rect.
  const groupTourTargetMeasurementLifecycle = <GroupTourTargetMeasurement appliedStepRef={appliedStepRef} committedInputRef={committedInputRef} committedInput={committedInput} ctrl={ctrl} requestedStep={requestedStep} input={input} measureGenerationRef={measureGenerationRef} transitioningRef={transitioningRef} setTransitioning={setTransitioning} setSnapshot={setSnapshot} measureNonce={measureNonce} />;

  // Derived: hide hole when tour inactive (avoids sync setState on deactivate).
  const visibleTargetRect = ctrl.active ? snapshot.targetRect : null;
  const visiblePlacementRect = ctrl.active ? snapshot.placementRect : null;

  const onNext = useCallback(() => {
    if (!ctrl.active || completingRef.current || transitioningRef.current) return;
    const plan = committedInputRef.current.steps;
    // A failed measurement leaves the requested step ahead of the committed
    // snapshot. Retry it instead of advancing again.
    if (ctrl.stepIndex !== snapshot.stepIndex) {
      transitioningRef.current = true;
      setTransitioning(true);
      setMeasureNonce((n) => n + 1);
      return;
    }
    const cur = currentStep(ctrl, plan);
    if (cur?.final || ctrl.stepIndex >= plan.length - 1) {
      completingRef.current = true;
      setCompleting(true);
      void (async () => {
        try {
          await completeGroupFeatureTour({
            accountId: committedInputRef.current.accountId,
            existingPreferences: committedInputRef.current.accountPreferences,
          });
          setCtrl(stopTour());
          setTourCompleted(true);
          committedInputRef.current.resumeAutoCollapse();
        } catch {
          // Keep overlay open so the user can retry Get started.
        } finally {
          completingRef.current = false;
          setCompleting(false);
        }
      })();
      return;
    }
    transitioningRef.current = true;
    setTransitioning(true);
    setCtrl((s) => advanceTour(s, plan));
  }, [ctrl, snapshot.stepIndex]);

  const onPrev = useCallback(() => {
    if (!ctrl.active || completingRef.current || transitioningRef.current) return;
    if (ctrl.stepIndex <= 0 || ctrl.stepIndex !== snapshot.stepIndex) return;
    appliedStepRef.current = -1;
    transitioningRef.current = true;
    setTransitioning(true);
    setCtrl((s) => retreatTour(s));
  }, [ctrl, snapshot.stepIndex]);

  return {
    lifecycle: <Fragment key={'group-tour-runtime'}>{groupTourInputPublicationLifecycle}{groupTourCompletionLoadLifecycle}{groupTourEligibilityLoadLifecycle}{groupTourActiveNotificationLifecycle}{groupTourTargetMeasurementLifecycle}</Fragment>,
    tourActive: ctrl.active,
    step: ctrl.active ? snapshot.step : null,
    stepIndex: snapshot.stepIndex,
    targetRect: visibleTargetRect,
    placementRect: visiblePlacementRect,
    transitioning: ctrl.active && (transitioning || ctrl.stepIndex !== snapshot.stepIndex),
    onNext,
    onPrev,
    canGoPrev: ctrl.active
      && !transitioning
      && ctrl.stepIndex === snapshot.stepIndex
      && snapshot.stepIndex > 0,
    completing,
    reevaluate,
    steps,
  };
}

type GroupTourCommittedInput = Pick<UseGroupFeatureTourInput, 'measureTarget' | 'accountPreferences' | 'accountId' | 'onTourActiveChange' | 'tourDestinationId' | 'expandCard' | 'pauseAutoCollapse' | 'resumeAutoCollapse' | 'setSheetMid' | 'selectSheetPane'> & { steps: readonly TourStepDef[] };

function GroupTourInputPublication({ committedInputRef, committedInput }: {
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
}) {
  const [groupTourInputPublicationInputs, setGroupTourInputPublicationInputs] = useState(() => ({ generation: 0, committedInput }));
  if (!(Object.is(groupTourInputPublicationInputs.committedInput, committedInput))) {
    setGroupTourInputPublicationInputs({ generation: groupTourInputPublicationInputs.generation + 1, committedInput });
  }
  return <GroupTourInputPublicationCommit key={groupTourInputPublicationInputs.generation} committedInputRef={committedInputRef} committedInput={committedInput} />;
}

function GroupTourInputPublicationCommit({ committedInputRef, committedInput }: {
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
}) {
  useMountEffect(() => { committedInputRef.current = committedInput; });
  return null;
}

function GroupTourCompletionLoad({ committedInputRef, committedInput, reevaluate, input }: {
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
  reevaluate: () => void;
  input: UseGroupFeatureTourInput;
}) {
  const [groupTourCompletionLoadInputs, setGroupTourCompletionLoadInputs] = useState(() => ({ generation: 0, reevaluate, input_accountId: input.accountId, input_accountPreferences_groupFeatureTourCompleted: input.accountPreferences?.groupFeatureTourCompleted }));
  if (!(Object.is(groupTourCompletionLoadInputs.reevaluate, reevaluate) && Object.is(groupTourCompletionLoadInputs.input_accountId, input.accountId) && Object.is(groupTourCompletionLoadInputs.input_accountPreferences_groupFeatureTourCompleted, input.accountPreferences?.groupFeatureTourCompleted))) {
    setGroupTourCompletionLoadInputs({ generation: groupTourCompletionLoadInputs.generation + 1, reevaluate, input_accountId: input.accountId, input_accountPreferences_groupFeatureTourCompleted: input.accountPreferences?.groupFeatureTourCompleted });
  }
  return <GroupTourCompletionLoadCommit key={groupTourCompletionLoadInputs.generation} committedInputRef={committedInputRef} committedInput={committedInput} reevaluate={reevaluate} input={input} />;
}

function GroupTourCompletionLoadCommit({ committedInputRef, committedInput, reevaluate, input }: {
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
  reevaluate: () => void;
  input: UseGroupFeatureTourInput;
}) {
  useMountEffect(() => {
    committedInputRef.current = committedInput;
    reevaluate();
  });
  return null;
}

function GroupTourEligibilityLoad({ committedInputRef, committedInput, gateReady, tourCompleted, ctrl, input, setCtrl }: {
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
  gateReady: boolean;
  tourCompleted: boolean;
  ctrl: TourControllerState;
  input: UseGroupFeatureTourInput;
  setCtrl: import("react").Dispatch<import("react").SetStateAction<TourControllerState>>;
}) {
  const [groupTourEligibilityLoadInputs, setGroupTourEligibilityLoadInputs] = useState(() => ({ generation: 0, gateReady, tourCompleted, ctrl_active: ctrl.active, input_groupId: input.groupId, input_destinationCount: input.destinationCount, input_passiveMode: input.passiveMode, input_denseChrome: input.denseChrome }));
  if (!(Object.is(groupTourEligibilityLoadInputs.gateReady, gateReady) && Object.is(groupTourEligibilityLoadInputs.tourCompleted, tourCompleted) && Object.is(groupTourEligibilityLoadInputs.ctrl_active, ctrl.active) && Object.is(groupTourEligibilityLoadInputs.input_groupId, input.groupId) && Object.is(groupTourEligibilityLoadInputs.input_destinationCount, input.destinationCount) && Object.is(groupTourEligibilityLoadInputs.input_passiveMode, input.passiveMode) && Object.is(groupTourEligibilityLoadInputs.input_denseChrome, input.denseChrome))) {
    setGroupTourEligibilityLoadInputs({ generation: groupTourEligibilityLoadInputs.generation + 1, gateReady, tourCompleted, ctrl_active: ctrl.active, input_groupId: input.groupId, input_destinationCount: input.destinationCount, input_passiveMode: input.passiveMode, input_denseChrome: input.denseChrome });
  }
  return <GroupTourEligibilityLoadCommit key={groupTourEligibilityLoadInputs.generation} committedInputRef={committedInputRef} committedInput={committedInput} gateReady={gateReady} tourCompleted={tourCompleted} ctrl={ctrl} input={input} setCtrl={setCtrl} />;
}

function GroupTourEligibilityLoadCommit({ committedInputRef, committedInput, gateReady, tourCompleted, ctrl, input, setCtrl }: {
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
  gateReady: boolean;
  tourCompleted: boolean;
  ctrl: TourControllerState;
  input: UseGroupFeatureTourInput;
  setCtrl: import("react").Dispatch<import("react").SetStateAction<TourControllerState>>;
}) {
  useMountEffect(() => {
    committedInputRef.current = committedInput;
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
  });
  return null;
}

function GroupTourActiveNotification({ committedInputRef, committedInput, ctrl }: {
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
  ctrl: TourControllerState;
}) {
  const [groupTourActiveNotificationInputs, setGroupTourActiveNotificationInputs] = useState(() => ({ generation: 0, ctrl_active: ctrl.active }));
  if (!(Object.is(groupTourActiveNotificationInputs.ctrl_active, ctrl.active))) {
    setGroupTourActiveNotificationInputs({ generation: groupTourActiveNotificationInputs.generation + 1, ctrl_active: ctrl.active });
  }
  return <GroupTourActiveNotificationCommit key={groupTourActiveNotificationInputs.generation} committedInputRef={committedInputRef} committedInput={committedInput} ctrl={ctrl} />;
}

function GroupTourActiveNotificationCommit({ committedInputRef, committedInput, ctrl }: {
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
  ctrl: TourControllerState;
}) {
  useMountEffect(() => {
    committedInputRef.current = committedInput;
    committedInputRef.current.onTourActiveChange?.(ctrl.active, committedInputRef.current.tourDestinationId);
  });
  return null;
}

function GroupTourTargetMeasurement({ appliedStepRef, committedInputRef, committedInput, ctrl, requestedStep, input, measureGenerationRef, transitioningRef, setTransitioning, setSnapshot, measureNonce }: {
  appliedStepRef: import("react").RefObject<number>;
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
  ctrl: TourControllerState;
  requestedStep: TourStepDef | null;
  input: UseGroupFeatureTourInput;
  measureGenerationRef: import("react").RefObject<number>;
  transitioningRef: import("react").RefObject<boolean>;
  setTransitioning: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setSnapshot: import("react").Dispatch<import("react").SetStateAction<{ stepIndex: number; step: TourStepDef | null; pane: TourStepDef["sheetPane"] | null; targetRect: LayoutRectangle | null; placementRect: LayoutRectangle | null; }>>;
  measureNonce: number;
}) {
  const [groupTourTargetMeasurementInputs, setGroupTourTargetMeasurementInputs] = useState(() => ({ generation: 0, ctrl_active: ctrl.active, ctrl_stepIndex: ctrl.stepIndex, requestedStep, input_tourDestinationId: input.tourDestinationId, input_selectedDestinationId: input.selectedDestinationId, measureNonce }));
  if (!(Object.is(groupTourTargetMeasurementInputs.ctrl_active, ctrl.active) && Object.is(groupTourTargetMeasurementInputs.ctrl_stepIndex, ctrl.stepIndex) && Object.is(groupTourTargetMeasurementInputs.requestedStep, requestedStep) && Object.is(groupTourTargetMeasurementInputs.input_tourDestinationId, input.tourDestinationId) && Object.is(groupTourTargetMeasurementInputs.input_selectedDestinationId, input.selectedDestinationId) && Object.is(groupTourTargetMeasurementInputs.measureNonce, measureNonce))) {
    setGroupTourTargetMeasurementInputs({ generation: groupTourTargetMeasurementInputs.generation + 1, ctrl_active: ctrl.active, ctrl_stepIndex: ctrl.stepIndex, requestedStep, input_tourDestinationId: input.tourDestinationId, input_selectedDestinationId: input.selectedDestinationId, measureNonce });
  }
  return <GroupTourTargetMeasurementCommit key={groupTourTargetMeasurementInputs.generation} appliedStepRef={appliedStepRef} committedInputRef={committedInputRef} committedInput={committedInput} ctrl={ctrl} requestedStep={requestedStep} input={input} measureGenerationRef={measureGenerationRef} transitioningRef={transitioningRef} setTransitioning={setTransitioning} setSnapshot={setSnapshot} measureNonce={measureNonce} />;
}

function GroupTourTargetMeasurementCommit({ appliedStepRef, committedInputRef, committedInput, ctrl, requestedStep, input, measureGenerationRef, transitioningRef, setTransitioning, setSnapshot, measureNonce }: {
  appliedStepRef: import("react").RefObject<number>;
  committedInputRef: import("react").RefObject<GroupTourCommittedInput>;
  committedInput: GroupTourCommittedInput;
  ctrl: TourControllerState;
  requestedStep: TourStepDef | null;
  input: UseGroupFeatureTourInput;
  measureGenerationRef: import("react").RefObject<number>;
  transitioningRef: import("react").RefObject<boolean>;
  setTransitioning: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setSnapshot: import("react").Dispatch<import("react").SetStateAction<{ stepIndex: number; step: TourStepDef | null; pane: TourStepDef["sheetPane"] | null; targetRect: LayoutRectangle | null; placementRect: LayoutRectangle | null; }>>;
  measureNonce: number;
}) {
  useMountEffect(() => {
    committedInputRef.current = committedInput;

    if (ctrl.active && requestedStep && appliedStepRef.current !== ctrl.stepIndex) {
      appliedStepRef.current = ctrl.stepIndex;
      if (requestedStep.pauseAutoCollapse) committedInputRef.current.pauseAutoCollapse();
      if (requestedStep.expandCard && committedInputRef.current.tourDestinationId) {
        committedInputRef.current.expandCard(committedInputRef.current.tourDestinationId);
      }
      if (requestedStep.openStageTwo) committedInputRef.current.setSheetMid();
      if (requestedStep.sheetPane) committedInputRef.current.selectSheetPane(requestedStep.sheetPane);
      if (!requestedStep.pauseAutoCollapse && !requestedStep.expandCard) {
        committedInputRef.current.resumeAutoCollapse();
      }
    }
    if (!ctrl.active || !requestedStep) return;
    const tourDest = input.tourDestinationId;
    const selectedDest = input.selectedDestinationId;
    // When caller reports selection, wait until it matches the tour card.
    if (
      tourDest
      && selectedDest !== undefined
      && selectedDest !== null
      && selectedDest !== tourDest
    ) {
      return;
    }
    let cancelled = false;
    const generation = ++measureGenerationRef.current;
    transitioningRef.current = true;
    const run = async () => {
      try {
        setTransitioning(true);
        const win = getWindowSize();
        const measured = await measureTourStepRects({
          measure: (id) => committedInputRef.current.measureTarget(id),
          step: requestedStep,
          winW: win.width,
          winH: win.height,
          requireStable: Boolean(requestedStep.expandCard),
        }).catch(() => ({ targetRect: null, placementRect: null }));
        if (!cancelled && generation === measureGenerationRef.current) {
          // A detached target falls back to the centered copy; controls stay usable.
          setSnapshot({
            stepIndex: ctrl.stepIndex,
            step: requestedStep,
            pane: requestedStep.sheetPane ?? null,
            targetRect: measured.targetRect,
            placementRect: measured.placementRect,
          });
        }
      } finally {
        if (!cancelled && generation === measureGenerationRef.current) {
          transitioningRef.current = false;
          setTransitioning(false);
        }
      }
    };
    void run().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  });
  return null;
}
