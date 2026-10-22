import React, { useCallback, useRef, useState } from 'react';
import { useMountEffect } from '../../hooks/useMountEffect';
import { loadBackgroundManualUndo, type BackgroundManualUndoMarker } from '../../state/backgroundJourney';
import type { Destination } from '../../types';
import type { CoreOperation } from '../../types/coreData';
import type { ArrivalState } from '../../utils/navigationArrival';

export type MapForegroundArrivalInput = {
  foregroundArrivalRef: React.RefObject<{ key: string; state: ArrivalState; sampledAtMs: number | null } | null>;
  foregroundAckRef: React.RefObject<string | null>;
  autoArrivalMarkedRef: React.RefObject<string | null>;
  automaticArrivalRetryAt: React.RefObject<number>;
  arrivalFeedbackShownRef: React.RefObject<string | null>;
  manualUndoSuppressedRef: React.RefObject<Map<string, BackgroundManualUndoMarker>>;
  foregroundUndoHydrationRef: React.RefObject<{ key: string; pending: boolean }>;
  foregroundUndoHydrationKey: string;
  groupId: string | null;
  user: { id: string } | null;
  navTarget: Pick<Destination, 'id'> | undefined;
  currentArrivalNavigationSessionId: string | null;
  setArrivalCelebrateDestId: React.Dispatch<React.SetStateAction<string | null>>;
  arrivalContext: string;
  arrivalSessionKey: string;
  foregroundUndoHydrationSequenceRef: React.RefObject<number>;
  foregroundUndoMutationSequenceRef: React.RefObject<number>;
  incomingArrivalHandlerRef: React.RefObject<() => void>;
  arrivalOperations: CoreOperation[];
  evaluateForegroundArrival: () => void;
};

function publishMapArrivalContext(input: MapForegroundArrivalInput, committed: React.RefObject<MapForegroundArrivalInput | null>) {
  const previous = committed.current;
  if (previous && Object.is(previous.arrivalContext, input.arrivalContext)
    && Object.is(previous.currentArrivalNavigationSessionId, input.currentArrivalNavigationSessionId)
    && Object.is(previous.foregroundUndoHydrationKey, input.foregroundUndoHydrationKey)
    && Object.is(previous.groupId, input.groupId)
    && Object.is(previous.navTarget?.id, input.navTarget?.id)
    && Object.is(previous.user?.id, input.user?.id)) return;
  committed.current = input;
  const { foregroundArrivalRef, foregroundAckRef, autoArrivalMarkedRef, automaticArrivalRetryAt, arrivalFeedbackShownRef, manualUndoSuppressedRef, foregroundUndoHydrationRef, foregroundUndoHydrationKey, groupId, user, navTarget, currentArrivalNavigationSessionId, setArrivalCelebrateDestId } = input;

    foregroundArrivalRef.current = null;
    foregroundAckRef.current = null;
    autoArrivalMarkedRef.current = null;
    automaticArrivalRetryAt.current = 0;
    arrivalFeedbackShownRef.current = null;
    manualUndoSuppressedRef.current.clear();
    foregroundUndoHydrationRef.current = {
      key: foregroundUndoHydrationKey,
      pending: Boolean(groupId && user?.id && navTarget?.id && currentArrivalNavigationSessionId),
    };
    setArrivalCelebrateDestId(null);

}

function beginMapManualUndoHydration(input: MapForegroundArrivalInput) {
  const { user, navTarget, currentArrivalNavigationSessionId, foregroundUndoHydrationKey, arrivalSessionKey,
    foregroundUndoHydrationSequenceRef, foregroundUndoMutationSequenceRef, groupId, foregroundUndoHydrationRef,
    incomingArrivalHandlerRef, manualUndoSuppressedRef, arrivalOperations } = input;

    const actorId = user?.id;
    const destinationId = navTarget?.id;
    const sessionId = currentArrivalNavigationSessionId;
    const hydrationKey = foregroundUndoHydrationKey;
    const suppressionKey = `${arrivalSessionKey}:${destinationId ?? ''}:${actorId ?? ''}`;
    const generation = ++foregroundUndoHydrationSequenceRef.current;
    const mutationAtStart = foregroundUndoMutationSequenceRef.current;
    if (!groupId || !actorId || !destinationId || !sessionId) {
      foregroundUndoHydrationRef.current = { key: hydrationKey, pending: false };
      return;
    }
    foregroundUndoHydrationRef.current = { key: hydrationKey, pending: true };
    let cancelled = false;
    const finishHydration = (marker: BackgroundManualUndoMarker | null) => {
      if (cancelled
        || generation !== foregroundUndoHydrationSequenceRef.current
        || foregroundUndoHydrationRef.current.key !== hydrationKey) return;
      // A tap can create or release an undo while the AsyncStorage read is
      // in flight. Never let that older read overwrite the newer in-memory
      // intent; the next outbox/store update will hydrate it again.
      const hasNewerForegroundMutation = foregroundUndoMutationSequenceRef.current !== mutationAtStart;
      if (hasNewerForegroundMutation) {
        foregroundUndoHydrationRef.current = { key: hydrationKey, pending: false };
        incomingArrivalHandlerRef.current();
        return;
      }
      if (marker) {
        // Keep released markers too: they are the shared session state, but
        // only a suppressed marker gates the next in-radius fix.
        manualUndoSuppressedRef.current.set(suppressionKey, marker);
      } else {
        // Storage can be unavailable while the durable undo operation is
        // already in the outbox. Retain that active tombstone as a fallback.
        const fallback = arrivalOperations
          .filter(op => op.operationType === 'record_arrival'
            && op.entityId === destinationId
            && (op.actorId ?? op.payload.actorId) === actorId
            && op.payload.actorId === actorId
            && op.payload.userId === actorId
            && String(op.payload.navigationSessionId ?? op.payload.sessionId ?? '') === sessionId
            && op.payload.arrived === false)
          .sort((a, b) => {
            const aTime = typeof a.payload.occurredAt === 'string' ? Date.parse(a.payload.occurredAt) : Number.NaN;
            const bTime = typeof b.payload.occurredAt === 'string' ? Date.parse(b.payload.occurredAt) : Number.NaN;
            return (Number.isFinite(aTime) ? aTime : a.createdAt)
              - (Number.isFinite(bTime) ? bTime : b.createdAt);
          })
          .at(-1);
        if (fallback) {
          manualUndoSuppressedRef.current.set(suppressionKey, {
            actorId,
            groupId,
            destinationId,
            navigationSessionId: sessionId,
            operationId: fallback.id,
            occurredAt: typeof fallback.payload.occurredAt === 'string'
              ? fallback.payload.occurredAt
              : new Date(fallback.createdAt).toISOString(),
            suppressed: true,
          });
        }
      }
      foregroundUndoHydrationRef.current = { key: hydrationKey, pending: false };
      // A fix may have arrived while hydration was pending. Re-evaluate it
      // now that suppression (including a released marker) is known.
      incomingArrivalHandlerRef.current();
    };
    void loadBackgroundManualUndo(actorId, groupId, destinationId, sessionId)
      .then(finishHydration)
      .catch(() => finishHydration(null));
    return () => { cancelled = true; };

}

function sameMapUndoHydration(previous: MapForegroundArrivalInput, input: MapForegroundArrivalInput) {
  return Object.is(previous.arrivalOperations, input.arrivalOperations)
    && Object.is(previous.arrivalSessionKey, input.arrivalSessionKey)
    && Object.is(previous.currentArrivalNavigationSessionId, input.currentArrivalNavigationSessionId)
    && Object.is(previous.foregroundUndoHydrationKey, input.foregroundUndoHydrationKey)
    && Object.is(previous.groupId, input.groupId)
    && Object.is(previous.navTarget?.id, input.navTarget?.id)
    && Object.is(previous.user?.id, input.user?.id);
}

type ManualUndoLease = { input: MapForegroundArrivalInput; release: () => void };
type ObserveManualUndo = (input: MapForegroundArrivalInput) => () => void;

export function MapForegroundArrivalResource(input: MapForegroundArrivalInput) {
  const committedContext = useRef<MapForegroundArrivalInput | null>(null);
  const manualUndoLease = useRef<ManualUndoLease | null>(null);
  const observeManualUndo = useCallback((snapshot: MapForegroundArrivalInput) => {
    const previous = manualUndoLease.current;
    if (previous && sameMapUndoHydration(previous.input, snapshot)) {
      publishMapArrivalContext(snapshot, committedContext);
      return previous.release;
    }
    previous?.release();
    publishMapArrivalContext(snapshot, committedContext);
    const cancel = beginMapManualUndoHydration(snapshot);
    const lease: ManualUndoLease = { input: snapshot, release: () => {
      cancel?.();
      if (manualUndoLease.current === lease) manualUndoLease.current = null;
    } };
    manualUndoLease.current = lease;
    return lease.release;
  }, []);
  useMountEffect(() => () => { manualUndoLease.current?.release(); });
  return <>
    <MapForegroundArrivalEvaluationResource input={input} observeManualUndo={observeManualUndo} />
    <MapManualUndoHydrationResource input={input} observeManualUndo={observeManualUndo} />
  </>;
}

function MapManualUndoHydrationResource({ input, observeManualUndo }: {
  input: MapForegroundArrivalInput; observeManualUndo: ObserveManualUndo;
}) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!sameMapUndoHydration(previous.input, input)) setPrevious({ input, generation: previous.generation + 1 });
  return <MapManualUndoHydrationJob key={previous.generation} input={input} observeManualUndo={observeManualUndo} />;
}

function MapManualUndoHydrationJob({ input, observeManualUndo }: {
  input: MapForegroundArrivalInput; observeManualUndo: ObserveManualUndo;
}) {
  useMountEffect(() => observeManualUndo(input));
  return null;
}

function MapForegroundArrivalEvaluationResource({ input, observeManualUndo }: {
  input: MapForegroundArrivalInput; observeManualUndo: ObserveManualUndo;
}) {
  const [previous, setPrevious] = useState({ callback: input.evaluateForegroundArrival, generation: 0 });
  if (!Object.is(previous.callback, input.evaluateForegroundArrival)) {
    setPrevious({ callback: input.evaluateForegroundArrival, generation: previous.generation + 1 });
  }
  return <MapForegroundArrivalEvaluationJob key={previous.generation} input={input} observeManualUndo={observeManualUndo} />;
}

function MapForegroundArrivalEvaluationJob({ input, observeManualUndo }: {
  input: MapForegroundArrivalInput; observeManualUndo: ObserveManualUndo;
}) {
  useMountEffect(() => {
    // Hydration owns the reset and pending gate even when this job mounts first.
    observeManualUndo(input);
    input.evaluateForegroundArrival();
  });
  return null;
}
