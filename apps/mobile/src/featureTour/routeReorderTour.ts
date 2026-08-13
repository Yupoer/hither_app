import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  scrollToTarget?: (id: RouteReorderTourTargetId) => void;
}

export interface UseRouteReorderTourResult {
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
  const generationRef = useRef(0);
  const transitioningRef = useRef(false);
  const measureRef = useRef(input.measureTarget);
  const scrollRef = useRef(input.scrollToTarget);
  const prefsRef = useRef(input.accountPreferences);
  const accountIdRef = useRef(input.accountId);

  useEffect(() => {
    measureRef.current = input.measureTarget;
    scrollRef.current = input.scrollToTarget;
    prefsRef.current = input.accountPreferences;
    accountIdRef.current = input.accountId;
  }, [input.measureTarget, input.scrollToTarget, input.accountPreferences, input.accountId]);

  const reevaluate = useCallback(() => {
    let cancelled = false;
    void (async () => {
      const [local, pending] = await Promise.all([
        readRouteReorderTourCompletedLocal(accountIdRef.current),
        readRouteReorderTourAccountSyncPending(accountIdRef.current),
      ]);
      if (cancelled) return;
      setLocalCompleted(local || pending?.completed === true);
      setLoaded(true);
      void retryPendingRouteReorderTourAccountSync({
        accountId: accountIdRef.current,
        existingPreferences: prefsRef.current,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cancel = reevaluate();
    return typeof cancel === 'function' ? cancel : undefined;
  }, [reevaluate, input.accountId, input.accountPreferences?.routeReorderTourCompleted]);

  useEffect(() => {
    if (input.routeOverlayOpenComplete && input.gatheringPointCount === 0) {
      setActive(false);
      return;
    }
    if (!input.routeOverlayOpenComplete || !loaded || localCompleted
      || input.accountPreferences?.routeReorderTourCompleted === true
      || !input.isLeader || !input.canEditItinerary || input.gatheringPointCount < 1) {
      setActive(false);
      return;
    }

    let cancelled = false;
    const generation = ++generationRef.current;
    void (async () => {
      setTransitioning(true);
      transitioningRef.current = true;
      const rects = await Promise.all(
        ROUTE_REORDER_TOUR_STEPS.map((step) =>
          measureTargetWithRetry({
            measure: (id) => measureRef.current(id),
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
  }, [
    input.routeOverlayOpenComplete,
    input.isLeader,
    input.canEditItinerary,
    input.gatheringPointCount,
    input.accountPreferences?.routeReorderTourCompleted,
    loaded,
    localCompleted,
  ]);

  const onNext = useCallback(() => {
    if (!active || transitioningRef.current || completing) return;
    if (snapshot.stepIndex >= ROUTE_REORDER_TOUR_STEPS.length - 1) {
      transitioningRef.current = true;
      setCompleting(true);
      void completeRouteReorderTour({
        accountId: accountIdRef.current,
        existingPreferences: prefsRef.current,
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
    scrollRef.current?.(next.id);
    void measureTargetWithRetry({
      measure: (id) => measureRef.current(id),
      target: next.target,
      maxAttempts: 6,
    }).then((rect) => {
      if (generation !== generationRef.current) return;
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        transitioningRef.current = false;
        setTransitioning(false);
        return;
      }
      setSnapshot({ stepIndex: nextIndex, targetRect: rect });
      transitioningRef.current = false;
      setTransitioning(false);
    });
  }, [active, completing, snapshot.stepIndex]);

  const onPrev = useCallback(() => {
    if (!active || transitioningRef.current || completing || snapshot.stepIndex <= 0) return;
    const previousIndex = snapshot.stepIndex - 1;
    const previous = ROUTE_REORDER_TOUR_STEPS[previousIndex];
    if (!previous) return;
    const generation = ++generationRef.current;
    transitioningRef.current = true;
    setTransitioning(true);
    scrollRef.current?.(previous.id);
    void measureTargetWithRetry({
      measure: (id) => measureRef.current(id),
      target: previous.target,
      maxAttempts: 6,
    }).then((rect) => {
      if (generation !== generationRef.current) return;
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        transitioningRef.current = false;
        setTransitioning(false);
        return;
      }
      setSnapshot({ stepIndex: previousIndex, targetRect: rect });
      transitioningRef.current = false;
      setTransitioning(false);
    });
  }, [active, completing, snapshot.stepIndex]);

  return {
    tourActive: active,
    step: active ? ROUTE_REORDER_TOUR_STEPS[snapshot.stepIndex] ?? null : null,
    stepIndex: snapshot.stepIndex,
    targetRect: active ? snapshot.targetRect : null,
    transitioning,
    completing,
    onNext,
    onPrev,
    canGoPrev: active && snapshot.stepIndex > 0 && !transitioning,
    reevaluate,
  };
}
