import AsyncStorage from '@react-native-async-storage/async-storage';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
import type { LayoutRectangle } from 'react-native';
import type { AccountPreferences } from '../types';
import type { TourTargetId } from './constants';
import { measureTargetWithRetry } from './measureTarget';

export const ROUTE_REORDER_TOUR_STORAGE_KEY = 'hither.routeReorderTour.v1';
export const ROUTE_REORDER_TOUR_ACCOUNT_SYNC_PENDING_KEY =
  'hither.routeReorderTour.accountSyncPending';

export type RouteReorderTourTargetId =
  | 'routeMode'
  | 'routeDate'
  | 'routeAccommodation'
  | 'routeTripDetails'
  | 'routeFavorites'
  | 'routeImport';

export interface RouteReorderTourStep {
  id: RouteReorderTourTargetId;
  target: TourTargetId;
  titleKey: string;
  bodyKey: string;
}

export const ROUTE_REORDER_TOUR_STEPS: readonly RouteReorderTourStep[] = [
  {
    id: 'routeMode',
    target: 'routeMode',
    titleKey: 'tour.route.mode.title',
    bodyKey: 'tour.route.mode.body',
  },
  {
    id: 'routeDate',
    target: 'routeDate',
    titleKey: 'tour.route.date.title',
    bodyKey: 'tour.route.date.body',
  },
  {
    id: 'routeAccommodation',
    target: 'routeAccommodation',
    titleKey: 'tour.route.accommodation.title',
    bodyKey: 'tour.route.accommodation.body',
  },
  {
    id: 'routeTripDetails',
    target: 'routeTripDetails',
    titleKey: 'tour.route.tripDetails.title',
    bodyKey: 'tour.route.tripDetails.body',
  },
  {
    id: 'routeFavorites',
    target: 'routeFavorites',
    titleKey: 'tour.route.favorites.title',
    bodyKey: 'tour.route.favorites.body',
  },
  {
    id: 'routeImport',
    target: 'routeImport',
    titleKey: 'tour.route.import.title',
    bodyKey: 'tour.route.import.body',
  },
];

/** Return the smallest scroll delta that makes a route-tour target readable. */
export function routeTourScrollOffset({
  currentOffset,
  targetPageY,
  targetHeight,
  containerPageY,
  viewportHeight,
  margin = 16,
}: {
  currentOffset: number;
  targetPageY: number;
  targetHeight: number;
  containerPageY: number;
  viewportHeight: number;
  margin?: number;
}): number {
  const safeViewport = Math.max(0, viewportHeight);
  const safeMargin = Math.max(0, margin);
  const visibleTop = containerPageY + safeMargin;
  const visibleBottom = containerPageY + safeViewport - safeMargin;
  const targetBottom = targetPageY + targetHeight;
  const delta = targetHeight + safeMargin * 2 > safeViewport
    ? targetPageY - visibleTop
    : targetPageY < visibleTop
      ? targetPageY - visibleTop
      : targetBottom > visibleBottom
        ? targetBottom - visibleBottom
        : 0;
  return Math.max(0, currentOffset + delta);
}

export function routeReorderTourStorageKey(accountId?: string | null): string {
  return accountId ? `${ROUTE_REORDER_TOUR_STORAGE_KEY}:${accountId}` : ROUTE_REORDER_TOUR_STORAGE_KEY;
}

export function routeReorderTourAccountSyncPendingKey(accountId: string): string {
  return `${ROUTE_REORDER_TOUR_ACCOUNT_SYNC_PENDING_KEY}:${accountId}`;
}

export interface RouteReorderTourAccountSyncPending {
  accountId: string;
  completed: boolean;
}

export function parseRouteReorderTourAccountSyncPending(
  raw: string | null,
): RouteReorderTourAccountSyncPending | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RouteReorderTourAccountSyncPending>;
    if (
      typeof parsed.accountId === 'string'
      && parsed.accountId.length > 0
      && typeof parsed.completed === 'boolean'
    ) {
      return { accountId: parsed.accountId, completed: parsed.completed };
    }
  } catch {
    // Ignore malformed local state.
  }
  return null;
}

export async function readRouteReorderTourCompletedLocal(
  accountId?: string | null,
): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(routeReorderTourStorageKey(accountId))) === '1';
  } catch {
    return false;
  }
}

export async function writeRouteReorderTourCompletedLocal(
  completed: boolean,
  accountId?: string | null,
): Promise<void> {
  const key = routeReorderTourStorageKey(accountId);
  if (completed) await AsyncStorage.setItem(key, '1');
  else await AsyncStorage.removeItem(key);
}

export async function readRouteReorderTourAccountSyncPending(
  accountId: string | null | undefined,
): Promise<RouteReorderTourAccountSyncPending | null> {
  if (!accountId) return null;
  try {
    const parsed = parseRouteReorderTourAccountSyncPending(
      await AsyncStorage.getItem(routeReorderTourAccountSyncPendingKey(accountId)),
    );
    return parsed?.accountId === accountId ? parsed : null;
  } catch {
    return null;
  }
}

async function writePending(
  accountId: string,
  completed: boolean | null,
): Promise<void> {
  const key = routeReorderTourAccountSyncPendingKey(accountId);
  if (completed == null) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, JSON.stringify({ accountId, completed }));
}

async function updateAccountPreferences(preferences: AccountPreferences): Promise<void> {
  const { updateProfile } = await import('../api/services/ProfileService');
  await updateProfile({ preferences });
}

export async function retryPendingRouteReorderTourAccountSync(opts: {
  accountId: string | null | undefined;
  existingPreferences?: AccountPreferences | null;
}): Promise<boolean> {
  if (!opts.accountId) return true;
  const pending = await readRouteReorderTourAccountSyncPending(opts.accountId);
  if (!pending) return true;
  try {
    await updateAccountPreferences({
      ...(opts.existingPreferences ?? {}),
      routeReorderTourCompleted: pending.completed,
    });
    await writePending(opts.accountId, null);
    return true;
  } catch {
    return false;
  }
}

export async function completeRouteReorderTour(opts: {
  accountId?: string | null;
  existingPreferences?: AccountPreferences | null;
}): Promise<void> {
  await writeRouteReorderTourCompletedLocal(true, opts.accountId);
  if (!opts.accountId) return;
  try {
    await updateAccountPreferences({
      ...(opts.existingPreferences ?? {}),
      routeReorderTourCompleted: true,
    });
    await writePending(opts.accountId, null);
  } catch {
    await writePending(opts.accountId, true).catch(() => undefined);
  }
}

export async function clearRouteReorderTour(opts: {
  accountId?: string | null;
  existingPreferences?: AccountPreferences | null;
}): Promise<void> {
  await writeRouteReorderTourCompletedLocal(false, opts.accountId);
  if (!opts.accountId) return;
  try {
    await updateAccountPreferences({
      ...(opts.existingPreferences ?? {}),
      routeReorderTourCompleted: false,
    });
    await writePending(opts.accountId, null);
  } catch {
    await writePending(opts.accountId, false).catch(() => undefined);
  }
}

export function shouldStartRouteReorderTour(input: {
  routeOverlayOpenComplete: boolean;
  isLeader: boolean;
  canEditItinerary: boolean;
  gatheringPointCount: number;
  localCompleted: boolean;
  accountCompleted?: boolean | null;
  targetsReady: boolean;
}): boolean {
  return input.routeOverlayOpenComplete
    && input.isLeader
    && input.canEditItinerary
    && input.gatheringPointCount > 0
    && !input.localCompleted
    && input.accountCompleted !== true
    && input.targetsReady;
}

export interface UseRouteReorderTourInput {
  routeOverlayOpenComplete: boolean;
  isLeader: boolean;
  canEditItinerary: boolean;
  gatheringPointCount: number;
  accountId?: string | null;
  accountPreferences?: AccountPreferences | null;
  measureTarget: (id: TourTargetId) => Promise<LayoutRectangle | null>;
  scrollToTarget?: (id: RouteReorderTourTargetId) => void | Promise<void>;
}

export interface UseRouteReorderTourResult {
  lifecycle: import('react').ReactElement;
  tourActive: boolean;
  step: RouteReorderTourStep | null;
  stepIndex: number;
  targetRect: LayoutRectangle | null;
  transitioning: boolean;
  completing: boolean;
  onNext: () => void;
  onPrev: () => void;
  canGoPrev: boolean;
  reevaluate: () => void;
}

export function useRouteReorderTour(
  input: UseRouteReorderTourInput,
): UseRouteReorderTourResult {
  const [localCompleted, setLocalCompleted] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    stepIndex: number;
    targetRect: LayoutRectangle | null;
  }>({ stepIndex: 0, targetRect: null });
  const [transitioning, setTransitioning] = useState(false);
  const [completing, setCompleting] = useState(false);
  const committedInput = useMemo<RouteReorderTourCommittedInput>(() => ({ measureTarget: input.measureTarget, scrollToTarget: input.scrollToTarget, accountPreferences: input.accountPreferences, accountId: input.accountId }), [input.measureTarget, input.scrollToTarget, input.accountPreferences, input.accountId]);
  const committedInputRef = useRef(committedInput);
  const generationRef = useRef(0);
  const transitioningRef = useRef(false);
  const tourEligible = input.routeOverlayOpenComplete
    && loaded
    && !localCompleted
    && input.accountPreferences?.routeReorderTourCompleted !== true
    && input.isLeader
    && input.canEditItinerary
    && input.gatheringPointCount > 0;

  const routeTourInputPublicationLifecycle = <RouteTourInputPublication committedInputRef={committedInputRef} committedInput={committedInput} />;

  const reevaluate = useCallback(() => {
    let cancelled = false;
    void (async () => {
      const [local, pending] = await Promise.all([
        readRouteReorderTourCompletedLocal(committedInputRef.current.accountId),
        readRouteReorderTourAccountSyncPending(committedInputRef.current.accountId),
      ]);
      if (cancelled) return;
      setLocalCompleted(local || pending?.completed === true);
      setLoaded(true);
      void retryPendingRouteReorderTourAccountSync({
        accountId: committedInputRef.current.accountId,
        existingPreferences: committedInputRef.current.accountPreferences,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const routeTourCompletionLoadLifecycle = <RouteTourCompletionLoad committedInputRef={committedInputRef} committedInput={committedInput} reevaluate={reevaluate} input={input} />;

  const routeTourEligibilityMeasurementLifecycle = <RouteTourEligibilityMeasurement committedInputRef={committedInputRef} committedInput={committedInput} tourEligible={tourEligible} generationRef={generationRef} setTransitioning={setTransitioning} transitioningRef={transitioningRef} setSnapshot={setSnapshot} setActive={setActive} input={input} loaded={loaded} localCompleted={localCompleted} />;

  const tourActive = active && tourEligible;

  const onNext = useCallback(async () => {
    if (!tourActive || transitioningRef.current || completing) return;
    if (snapshot.stepIndex >= ROUTE_REORDER_TOUR_STEPS.length - 1) {
      transitioningRef.current = true;
      setCompleting(true);
      void completeRouteReorderTour({
        accountId: committedInputRef.current.accountId,
        existingPreferences: committedInputRef.current.accountPreferences,
      }).finally(() => {
        setLocalCompleted(true);
        setActive(false);
        transitioningRef.current = false;
        setTransitioning(false);
        setCompleting(false);
      });
      return;
    }
    const nextIndex = snapshot.stepIndex + 1;
    const next = ROUTE_REORDER_TOUR_STEPS[nextIndex];
    if (!next) return;
    const generation = ++generationRef.current;
    transitioningRef.current = true;
    setTransitioning(true);
    try {
      await committedInputRef.current.scrollToTarget?.(next.id);
      if (generation !== generationRef.current) return;
      const rect = await measureTargetWithRetry({
        measure: (id) => committedInputRef.current.measureTarget(id),
        target: next.target,
        maxAttempts: 6,
      });
      if (generation !== generationRef.current) return;
      setSnapshot({ stepIndex: nextIndex, targetRect: rect });
      transitioningRef.current = false;
      setTransitioning(false);
    } catch {
      if (generation !== generationRef.current) return;
      transitioningRef.current = false;
      setTransitioning(false);
    }
  }, [completing, snapshot.stepIndex, tourActive]);

  const onPrev = useCallback(async () => {
    if (!tourActive || transitioningRef.current || completing || snapshot.stepIndex <= 0) return;
    const previousIndex = snapshot.stepIndex - 1;
    const previous = ROUTE_REORDER_TOUR_STEPS[previousIndex];
    if (!previous) return;
    const generation = ++generationRef.current;
    transitioningRef.current = true;
    setTransitioning(true);
    try {
      await committedInputRef.current.scrollToTarget?.(previous.id);
      if (generation !== generationRef.current) return;
      const rect = await measureTargetWithRetry({
        measure: (id) => committedInputRef.current.measureTarget(id),
        target: previous.target,
        maxAttempts: 6,
      });
      if (generation !== generationRef.current) return;
      setSnapshot({ stepIndex: previousIndex, targetRect: rect });
      transitioningRef.current = false;
      setTransitioning(false);
    } catch {
      if (generation !== generationRef.current) return;
      transitioningRef.current = false;
      setTransitioning(false);
    }
  }, [completing, snapshot.stepIndex, tourActive]);

  return {
    lifecycle: <Fragment key={'route-tour-runtime'}>{routeTourInputPublicationLifecycle}{routeTourCompletionLoadLifecycle}{routeTourEligibilityMeasurementLifecycle}</Fragment>,
    tourActive,
    step: tourActive ? ROUTE_REORDER_TOUR_STEPS[snapshot.stepIndex] ?? null : null,
    stepIndex: snapshot.stepIndex,
    targetRect: tourActive ? snapshot.targetRect : null,
    transitioning,
    completing,
    onNext,
    onPrev,
    canGoPrev: tourActive && snapshot.stepIndex > 0 && !transitioning,
    reevaluate,
  };
}

type RouteReorderTourCommittedInput = Pick<UseRouteReorderTourInput, 'measureTarget' | 'scrollToTarget' | 'accountPreferences' | 'accountId'>;

function RouteTourInputPublication({ committedInputRef, committedInput }: {
  committedInputRef: import("react").RefObject<RouteReorderTourCommittedInput>;
  committedInput: RouteReorderTourCommittedInput;
}) {
  const [routeTourInputPublicationInputs, setRouteTourInputPublicationInputs] = useState(() => ({ generation: 0, committedInput }));
  if (!(Object.is(routeTourInputPublicationInputs.committedInput, committedInput))) {
    setRouteTourInputPublicationInputs({ generation: routeTourInputPublicationInputs.generation + 1, committedInput });
  }
  return <RouteTourInputPublicationCommit key={routeTourInputPublicationInputs.generation} committedInputRef={committedInputRef} committedInput={committedInput} />;
}

function RouteTourInputPublicationCommit({ committedInputRef, committedInput }: {
  committedInputRef: import("react").RefObject<RouteReorderTourCommittedInput>;
  committedInput: RouteReorderTourCommittedInput;
}) {
  useMountEffect(() => { committedInputRef.current = committedInput; });
  return null;
}

function RouteTourCompletionLoad({ committedInputRef, committedInput, reevaluate, input }: {
  committedInputRef: import("react").RefObject<RouteReorderTourCommittedInput>;
  committedInput: RouteReorderTourCommittedInput;
  reevaluate: () => () => void;
  input: UseRouteReorderTourInput;
}) {
  const [routeTourCompletionLoadInputs, setRouteTourCompletionLoadInputs] = useState(() => ({ generation: 0, reevaluate, input_accountId: input.accountId, input_accountPreferences_routeReorderTourCompleted: input.accountPreferences?.routeReorderTourCompleted }));
  if (!(Object.is(routeTourCompletionLoadInputs.reevaluate, reevaluate) && Object.is(routeTourCompletionLoadInputs.input_accountId, input.accountId) && Object.is(routeTourCompletionLoadInputs.input_accountPreferences_routeReorderTourCompleted, input.accountPreferences?.routeReorderTourCompleted))) {
    setRouteTourCompletionLoadInputs({ generation: routeTourCompletionLoadInputs.generation + 1, reevaluate, input_accountId: input.accountId, input_accountPreferences_routeReorderTourCompleted: input.accountPreferences?.routeReorderTourCompleted });
  }
  return <RouteTourCompletionLoadCommit key={routeTourCompletionLoadInputs.generation} committedInputRef={committedInputRef} committedInput={committedInput} reevaluate={reevaluate} input={input} />;
}

function RouteTourCompletionLoadCommit({ committedInputRef, committedInput, reevaluate, input }: {
  committedInputRef: import("react").RefObject<RouteReorderTourCommittedInput>;
  committedInput: RouteReorderTourCommittedInput;
  reevaluate: () => () => void;
  input: UseRouteReorderTourInput;
}) {
  useMountEffect(() => {
    committedInputRef.current = committedInput;
    const cancel = reevaluate();
    return typeof cancel === 'function' ? cancel : undefined;
  });
  return null;
}

function RouteTourEligibilityMeasurement({ committedInputRef, committedInput, tourEligible, generationRef, setTransitioning, transitioningRef, setSnapshot, setActive, input, loaded, localCompleted }: {
  committedInputRef: import("react").RefObject<RouteReorderTourCommittedInput>;
  committedInput: RouteReorderTourCommittedInput;
  tourEligible: boolean;
  generationRef: import("react").RefObject<number>;
  setTransitioning: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  transitioningRef: import("react").RefObject<boolean>;
  setSnapshot: import("react").Dispatch<import("react").SetStateAction<{ stepIndex: number; targetRect: LayoutRectangle | null; }>>;
  setActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  input: UseRouteReorderTourInput;
  loaded: boolean;
  localCompleted: boolean;
}) {
  const [routeTourEligibilityMeasurementInputs, setRouteTourEligibilityMeasurementInputs] = useState(() => ({ generation: 0, input_routeOverlayOpenComplete: input.routeOverlayOpenComplete, input_isLeader: input.isLeader, input_canEditItinerary: input.canEditItinerary, input_gatheringPointCount: input.gatheringPointCount, input_accountPreferences_routeReorderTourCompleted: input.accountPreferences?.routeReorderTourCompleted, loaded, localCompleted, tourEligible }));
  if (!(Object.is(routeTourEligibilityMeasurementInputs.input_routeOverlayOpenComplete, input.routeOverlayOpenComplete) && Object.is(routeTourEligibilityMeasurementInputs.input_isLeader, input.isLeader) && Object.is(routeTourEligibilityMeasurementInputs.input_canEditItinerary, input.canEditItinerary) && Object.is(routeTourEligibilityMeasurementInputs.input_gatheringPointCount, input.gatheringPointCount) && Object.is(routeTourEligibilityMeasurementInputs.input_accountPreferences_routeReorderTourCompleted, input.accountPreferences?.routeReorderTourCompleted) && Object.is(routeTourEligibilityMeasurementInputs.loaded, loaded) && Object.is(routeTourEligibilityMeasurementInputs.localCompleted, localCompleted) && Object.is(routeTourEligibilityMeasurementInputs.tourEligible, tourEligible))) {
    setRouteTourEligibilityMeasurementInputs({ generation: routeTourEligibilityMeasurementInputs.generation + 1, input_routeOverlayOpenComplete: input.routeOverlayOpenComplete, input_isLeader: input.isLeader, input_canEditItinerary: input.canEditItinerary, input_gatheringPointCount: input.gatheringPointCount, input_accountPreferences_routeReorderTourCompleted: input.accountPreferences?.routeReorderTourCompleted, loaded, localCompleted, tourEligible });
  }
  return <RouteTourEligibilityMeasurementCommit key={routeTourEligibilityMeasurementInputs.generation} committedInputRef={committedInputRef} committedInput={committedInput} tourEligible={tourEligible} generationRef={generationRef} setTransitioning={setTransitioning} transitioningRef={transitioningRef} setSnapshot={setSnapshot} setActive={setActive} input={input} loaded={loaded} localCompleted={localCompleted} />;
}

function RouteTourEligibilityMeasurementCommit({ committedInputRef, committedInput, tourEligible, generationRef, setTransitioning, transitioningRef, setSnapshot, setActive, input, loaded, localCompleted }: {
  committedInputRef: import("react").RefObject<RouteReorderTourCommittedInput>;
  committedInput: RouteReorderTourCommittedInput;
  tourEligible: boolean;
  generationRef: import("react").RefObject<number>;
  setTransitioning: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  transitioningRef: import("react").RefObject<boolean>;
  setSnapshot: import("react").Dispatch<import("react").SetStateAction<{ stepIndex: number; targetRect: LayoutRectangle | null; }>>;
  setActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  input: UseRouteReorderTourInput;
  loaded: boolean;
  localCompleted: boolean;
}) {
  useMountEffect(() => {
    committedInputRef.current = committedInput;
    if (!tourEligible) return;

    let cancelled = false;
    const generation = ++generationRef.current;
    void (async () => {
      setTransitioning(true);
      transitioningRef.current = true;
      const rects = await Promise.all(
        ROUTE_REORDER_TOUR_STEPS.map((step) =>
          measureTargetWithRetry({
            measure: (id) => committedInputRef.current.measureTarget(id),
            target: step.target,
            maxAttempts: 6,
          }),
        ),
      );
      if (cancelled || generation !== generationRef.current) return;
      if (rects.some((rect) => !rect || rect.width <= 0 || rect.height <= 0)) {
        transitioningRef.current = false;
        setTransitioning(false);
        return;
      }
      setSnapshot({ stepIndex: 0, targetRect: rects[0] });
      setActive(true);
      transitioningRef.current = false;
      setTransitioning(false);
    })();
    return () => {
      cancelled = true;
    };
  });
  return null;
}
