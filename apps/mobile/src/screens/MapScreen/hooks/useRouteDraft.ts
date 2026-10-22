import { createElement, useCallback, useMemo, useRef, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { rollbackItinerary, type ItineraryRollback } from '../../../state/itineraryRollback';
import type { DailyAccommodation, Destination, Group } from '../../../types';
import type { CoreOperation } from '../../../types/coreData';
import { alignMeetTimeToTripDay } from '../../../utils/meetTime';

/** What the route sheet changed since it was last saved. */
export interface RouteDraftDirty {
  destinations: boolean;
  daily: boolean;
  trip: boolean;
  /** Saved stops removed from the draft; deleted on flush before the reorder. */
  deletedIds: string[];
}

const clean = (): RouteDraftDirty => ({ destinations: false, daily: false, trip: false, deletedIds: [] });

export function hasDraftWork(dirty: RouteDraftDirty): boolean {
  return dirty.destinations || dirty.daily || dirty.trip || dirty.deletedIds.length > 0;
}

export function byDayThenOrder(a: Destination, b: Destination): number {
  return (a.day ?? 0) - (b.day ?? 0) || a.order - b.order;
}

/** Insert a draft card at its order inside its day, shifting later cards of that day. */
export function insertDraftDestination(base: readonly Destination[], card: Destination): Destination[] {
  const shifted = base.map((destination) => destination.day === card.day && destination.order >= card.order
    ? { ...destination, order: destination.order + 1 }
    : destination);
  return [...shifted, card].sort(byDayThenOrder);
}

/** Next free order after the last card of `day`, or `fallback` when the day is empty. */
export function nextOrderInDay(base: readonly Destination[], day: number | null, fallback: number): number {
  const sameDay = base.filter((destination) => destination.day === day);
  return sameDay.length > 0 ? Math.max(...sameDay.map((destination) => destination.order)) + 1 : fallback;
}

function serverMatchesDraft(draft: readonly Destination[], server: readonly Destination[]): boolean {
  if (draft.length !== server.length) return false;
  const serverById = new Map(server.map((destination) => [destination.id, destination]));
  return draft.every((destination) => {
    const remote = serverById.get(destination.id);
    return remote && remote.order === destination.order && remote.day === destination.day
      && remote.closedAt === destination.closedAt;
  });
}

export interface UseRouteDraftInput {
  /** My current itinerary scope; changing it discards every draft of the old scope. */
  scopeId: string | undefined;
  /** Server list of my scope; a clean draft that matches it is dropped. */
  rawDestinations: Destination[];
  /** Every server destination (all scopes); the editor filters by its own scope. */
  serverDestinations: Destination[];
  serverDaily: DailyAccommodation[];
  group: Group | null;
  openOperations: readonly CoreOperation[];
}

/**
 * The route sheet's unsaved edit buffer. Saved writes are painted and rolled
 * back by the durable core projection; this only holds what the leader has not
 * saved yet (flushed when the sheet closes) plus the list the editor opened on.
 */
export function useRouteDraft(input: UseRouteDraftInput) {
  const { scopeId, rawDestinations, serverDestinations, serverDaily, group, openOperations } = input;
  const [editorScopeId, setEditorScopeIdState] = useState<string | undefined>(scopeId);
  const editorScopeIdRef = useRef(editorScopeId);
  const [destinations, setDestinationsState] = useState<Destination[] | null>(null);
  const destinationsRef = useRef<Destination[] | null>(null);
  const [daily, setDailyState] = useState<DailyAccommodation[] | null>(null);
  const dailyRef = useRef<DailyAccommodation[] | null>(null);
  const [draftTripDays, setDraftTripDays] = useState<number | null>(null);
  const [draftDepartureDate, setDraftDepartureDate] = useState<string | null>(null);
  const dirtyRef = useRef<RouteDraftDirty>(clean());
  const draftIdSequence = useRef(0);

  const setEditorScopeId = useCallback((next: string | undefined) => {
    editorScopeIdRef.current = next;
    setEditorScopeIdState(next);
  }, []);
  const editorServerDestinations = useMemo(() => editorScopeId
    ? serverDestinations.filter((destination) => destination.subgroupId === editorScopeId)
    : serverDestinations.filter((destination) => destination.subgroupId == null),
  [editorScopeId, serverDestinations]);
  const editorServerRef = useRef(editorServerDestinations);
  editorServerRef.current = editorServerDestinations;
  const serverDailyRef = useRef(serverDaily);
  serverDailyRef.current = serverDaily;

  const setDestinations = useCallback((next: Destination[] | null, options?: { dirty?: boolean }) => {
    destinationsRef.current = next;
    setDestinationsState(next);
    if (options?.dirty) dirtyRef.current.destinations = true;
  }, []);
  const setDaily = useCallback((next: DailyAccommodation[] | null) => {
    dailyRef.current = next;
    setDailyState(next);
  }, []);
  /** Edit the draft list (or the editor's server list when no draft exists yet). */
  const editDestinations = useCallback((edit: (base: Destination[]) => Destination[]) => {
    setDestinations(edit(destinationsRef.current ?? editorServerRef.current), { dirty: true });
  }, [setDestinations]);
  const editDaily = useCallback((edit: (base: DailyAccommodation[]) => DailyAccommodation[]) => {
    setDaily(edit(dailyRef.current ?? serverDailyRef.current));
    dirtyRef.current.daily = true;
  }, [setDaily]);
  const markDeleted = useCallback((id: string) => {
    dirtyRef.current.deletedIds = [...dirtyRef.current.deletedIds.filter((value) => value !== id), id];
  }, []);
  const forgetDeleted = useCallback((id: string) => {
    dirtyRef.current.deletedIds = dirtyRef.current.deletedIds.filter((value) => value !== id);
  }, []);
  const setTripDetails = useCallback((days: number, date: string) => {
    setDraftTripDays(days);
    setDraftDepartureDate(date);
    dirtyRef.current.trip = true;
    editDestinations((base) => base.map((destination) => {
      if (!destination.meetAt || destination.day == null) return destination;
      return {
        ...destination,
        meetAt: alignMeetTimeToTripDay(new Date(destination.meetAt), date, destination.day || 1).toISOString(),
      };
    }));
  }, [editDestinations]);
  const reset = useCallback(() => {
    setDestinations(null);
    setDaily(null);
    setDraftTripDays(null);
    setDraftDepartureDate(null);
    dirtyRef.current = clean();
  }, [setDaily, setDestinations]);
  const dirty = useCallback((): RouteDraftDirty => ({
    ...dirtyRef.current,
    deletedIds: [...dirtyRef.current.deletedIds],
  }), []);
  const hasUnsavedChanges = useCallback(() => hasDraftWork(dirtyRef.current), []);
  const nextDraftId = useCallback((prefix: string) => `${prefix}-${Date.now()}-${draftIdSequence.current++}`, []);
  const latestDestinations = useCallback(() => destinationsRef.current, []);
  const latestDaily = useCallback(() => dailyRef.current, []);
  /**
   * Point the editor at a scope. Unsaved edits pin the editor to their own
   * scope (returns false for another one); a clean editor opens on `list`.
   */
  const openEditor = useCallback((nextScopeId: string | undefined, list: Destination[]): boolean => {
    const unsaved = hasDraftWork(dirtyRef.current);
    if (unsaved && editorScopeIdRef.current !== nextScopeId) return false;
    setEditorScopeId(nextScopeId);
    if (!unsaved) setDestinations(list);
    return true;
  }, [setDestinations, setEditorScopeId]);


  const handledRejections = useRef(new Set<string>());


  if ((draftTripDays !== null || draftDepartureDate !== null) && group
    && group.tripDays === draftTripDays && group.departureDate === draftDepartureDate) {
    setDraftTripDays(null);
    setDraftDepartureDate(null);
  }

  const tripDays = draftTripDays ?? group?.tripDays;
  const departureDate = draftDepartureDate ?? group?.departureDate;
  const lifecycle = createElement(RouteDraftReconciliation, { destinations, dirtyRef, rawDestinations, setDestinations, openOperations, handledRejections, destinationsRef, reset, setEditorScopeId, scopeId });
  return useMemo(() => ({
    lifecycle,
    editorScopeId,
    editorScopeIdRef,
    setEditorScopeId,
    editorServerDestinations,
    /** Unsaved list, or null while the editor shows server truth. */
    destinations,
    editorDestinations: destinations ?? editorServerDestinations,
    dailyAccommodations: daily ?? serverDaily,
    tripDays,
    departureDate,
    latestDestinations,
    latestDaily,
    dirty,
    hasUnsavedChanges,
    setDestinations,
    setDaily,
    editDestinations,
    editDaily,
    markDeleted,
    forgetDeleted,
    setTripDetails,
    reset,
    openEditor,
    nextDraftId,
  }), [lifecycle, daily, departureDate, destinations, dirty, editDaily, editDestinations, editorScopeId,
    editorServerDestinations, forgetDeleted, hasUnsavedChanges, latestDaily, latestDestinations, markDeleted,
    nextDraftId, openEditor, reset, serverDaily, setDaily, setDestinations, setEditorScopeId, setTripDetails,
    tripDays]);
}

export type RouteDraft = ReturnType<typeof useRouteDraft>;

interface RouteDraftReconciliationGenerations { convergence: number; rejection: number; scope: number; }
type RouteDraftReconciliationInput = {
  destinations: Destination[] | null;
  dirtyRef: import("react").RefObject<RouteDraftDirty>;
  rawDestinations: Destination[];
  setDestinations: (next: Destination[] | null, options?: { dirty?: boolean; }) => void;
  openOperations: readonly CoreOperation[];
  handledRejections: import("react").RefObject<Set<string>>;
  destinationsRef: import("react").RefObject<Destination[] | null>;
  reset: () => void;
  setEditorScopeId: (next: string | undefined) => void;
  scopeId: string | undefined;
};

function RouteDraftReconciliation({ destinations, dirtyRef, rawDestinations, setDestinations, openOperations, handledRejections, destinationsRef, reset, setEditorScopeId, scopeId }: RouteDraftReconciliationInput) {
  const [routeDraftConvergenceInputs, setRouteDraftConvergenceInputs] = useState(() => ({ generation: 0, rawDestinations, destinations, setDestinations }));
  if (!(Object.is(routeDraftConvergenceInputs.rawDestinations, rawDestinations) && Object.is(routeDraftConvergenceInputs.destinations, destinations) && Object.is(routeDraftConvergenceInputs.setDestinations, setDestinations))) {
      setRouteDraftConvergenceInputs({ generation: routeDraftConvergenceInputs.generation + 1, rawDestinations, destinations, setDestinations });
    }
  const [routeDraftRejectionRollbackInputs, setRouteDraftRejectionRollbackInputs] = useState(() => ({ generation: 0, openOperations, setDestinations }));
  if (!(Object.is(routeDraftRejectionRollbackInputs.openOperations, openOperations) && Object.is(routeDraftRejectionRollbackInputs.setDestinations, setDestinations))) {
      setRouteDraftRejectionRollbackInputs({ generation: routeDraftRejectionRollbackInputs.generation + 1, openOperations, setDestinations });
    }
  const [routeDraftScopeResetInputs, setRouteDraftScopeResetInputs] = useState(() => ({ generation: 0, scopeId, reset, setEditorScopeId }));
  if (!(Object.is(routeDraftScopeResetInputs.scopeId, scopeId) && Object.is(routeDraftScopeResetInputs.reset, reset) && Object.is(routeDraftScopeResetInputs.setEditorScopeId, setEditorScopeId))) {
      setRouteDraftScopeResetInputs({ generation: routeDraftScopeResetInputs.generation + 1, scopeId, reset, setEditorScopeId });
    }
  const [committedInputs, setCommittedInputs] = useState<RouteDraftReconciliationGenerations>({ convergence: -1, rejection: -1, scope: -1 });
  return createElement(RouteDraftReconciliationCommit, {
    key: `convergence:${routeDraftConvergenceInputs.generation}/rejection:${routeDraftRejectionRollbackInputs.generation}/scope:${routeDraftScopeResetInputs.generation}`, destinations, dirtyRef, rawDestinations, setDestinations, openOperations, handledRejections, destinationsRef, reset, setEditorScopeId, scopeId, observeRouteDraftConvergence: routeDraftConvergenceInputs.generation !== committedInputs.convergence, observeRouteDraftRejectionRollback: routeDraftRejectionRollbackInputs.generation !== committedInputs.rejection, observeRouteDraftScopeReset: routeDraftScopeResetInputs.generation !== committedInputs.scope,
    committedGenerations: { convergence: routeDraftConvergenceInputs.generation, rejection: routeDraftRejectionRollbackInputs.generation, scope: routeDraftScopeResetInputs.generation }, setCommittedInputs,
  });
}

function RouteDraftReconciliationCommit({ destinations, dirtyRef, rawDestinations, setDestinations, openOperations, handledRejections, destinationsRef, reset, setEditorScopeId, scopeId, observeRouteDraftConvergence, observeRouteDraftRejectionRollback, observeRouteDraftScopeReset, committedGenerations, setCommittedInputs }: RouteDraftReconciliationInput & {
  observeRouteDraftConvergence: boolean;
  observeRouteDraftRejectionRollback: boolean;
  observeRouteDraftScopeReset: boolean;
  committedGenerations: RouteDraftReconciliationGenerations;
  setCommittedInputs: import('react').Dispatch<import('react').SetStateAction<RouteDraftReconciliationGenerations>>;
}) {
  useMountEffect(() => {
    function reconcileDraftAgainstServer() {
    if (!destinations || dirtyRef.current.destinations) return;
    if (serverMatchesDraft(destinations, rawDestinations)) setDestinations(null);
  }
    if (observeRouteDraftConvergence) reconcileDraftAgainstServer();
    function rollbackRejectedItinerary() {
    const rejected = openOperations.filter((operation) => operation.entityType === 'itinerary'
      && operation.status === 'conflict' && !handledRejections.current.has(operation.id));
    if (!rejected.length) return;
    rejected.forEach((operation) => handledRejections.current.add(operation.id));
    if (!dirtyRef.current.destinations) {
      setDestinations(null);
      return;
    }
    let next = destinationsRef.current;
    if (!next) return;
    for (const operation of [...rejected].sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))) {
      const undo = operation.payload._localRollback as ItineraryRollback | undefined;
      if (undo?.before && undo.after) next = rollbackItinerary(next, undo);
    }
    setDestinations(next);
  }
    if (observeRouteDraftRejectionRollback) rollbackRejectedItinerary();
    function resetDraftScope() {
    reset();
    setEditorScopeId(scopeId);
  }
    if (observeRouteDraftScopeReset) resetDraftScope();
    setCommittedInputs(committedGenerations);
  });
  return null;
}
