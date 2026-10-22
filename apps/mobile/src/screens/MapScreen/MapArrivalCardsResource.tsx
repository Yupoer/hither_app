import React, { useRef, useState } from 'react';
import { useMountEffect } from '../../hooks/useMountEffect';
import type { Destination } from '../../types';
import { clearAllCelebrateClearTimers, cancelCelebrateClearTimer, newlyCompletedVisibleCards,
  resolveExitIndexAtStart, nextVisibleCarouselOrder, type ArrivalCardExitRecord, type CelebrateClearStore } from '../../utils/arrivalCardExit';

export type MapArrivalCardsInput = {
  allScopedDestinations: Destination[];
  arrivalExitContextRef: React.RefObject<string>;
  arrivalExitContext: string;
  arrivalExitTimersRef: React.RefObject<Map<string, ReturnType<typeof setTimeout>[]>>;
  celebrateClearTimersRef: React.RefObject<CelebrateClearStore>;
  setArrivalExitRecords: React.Dispatch<React.SetStateAction<Map<string, ArrivalCardExitRecord>>>;
  setArrivalExitSnapshots: React.Dispatch<React.SetStateAction<Map<string, Destination>>>;
  setArrivalCelebrateDestId: React.Dispatch<React.SetStateAction<string | null>>;
  knownClosedDestIdsRef: React.RefObject<Set<string> | null>;
  remoteAutoCompleteDestIdsRef: React.RefObject<Set<string>>;
  state: { group: { id: string } } | null;
  groupId: string | null;
  loading: boolean;
  prevVisibleDestOrderRef: React.RefObject<string[]>;
  uiVisible: boolean;
  openDestinations: Destination[];
  startArrivalCardExit: (destination: Destination, indexAtStart?: number) => void;
  arrivalExitRecords: Map<string, ArrivalCardExitRecord>;
};

function cancelMapArrivalCardTimers(input: MapArrivalCardsInput) {
  for (const timers of input.arrivalExitTimersRef.current.values()) for (const timer of timers) clearTimeout(timer);
  input.arrivalExitTimersRef.current.clear();
  clearAllCelebrateClearTimers(input.celebrateClearTimersRef.current);
}

function commitMapArrivalCardVisibility(input: MapArrivalCardsInput, committed: React.RefObject<boolean | null>) {
  if (Object.is(committed.current, input.uiVisible)) return;
  if (committed.current !== null) cancelMapArrivalCardTimers(input);
  committed.current = input.uiVisible;
  if (!input.uiVisible) {
    input.setArrivalExitRecords(new Map());
    input.setArrivalExitSnapshots(new Map());
    input.setArrivalCelebrateDestId(null);
  }
}

export function MapArrivalCardsResource(input: MapArrivalCardsInput) {
  const committedVisibility = useRef<boolean | null>(null);
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.uiVisible, input.uiVisible)
    || !Object.is(previous.input.allScopedDestinations, input.allScopedDestinations)
    || !Object.is(previous.input.openDestinations, input.openDestinations)
    || !Object.is(previous.input.startArrivalCardExit, input.startArrivalCardExit)
    || !Object.is(previous.input.arrivalExitRecords, input.arrivalExitRecords)
    || !Object.is(previous.input.arrivalExitContext, input.arrivalExitContext)
    || !Object.is(previous.input.groupId, input.groupId)
    || !Object.is(previous.input.loading, input.loading)
    || !Object.is(previous.input.state, input.state)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  useMountEffect(() => () => cancelMapArrivalCardTimers(input));
  return <MapArrivalCardsJob key={previous.generation} input={input} committedVisibility={committedVisibility} />;
}

function MapArrivalCardsJob({ input, committedVisibility }: {
  input: MapArrivalCardsInput; committedVisibility: React.RefObject<boolean | null>;
}) {
  const { allScopedDestinations, arrivalExitContextRef, arrivalExitContext, arrivalExitTimersRef, celebrateClearTimersRef, setArrivalExitRecords, setArrivalExitSnapshots, setArrivalCelebrateDestId, knownClosedDestIdsRef, remoteAutoCompleteDestIdsRef, state, groupId, loading, prevVisibleDestOrderRef, uiVisible, openDestinations, startArrivalCardExit, arrivalExitRecords } = input;
  useMountEffect(() => {
    // Visibility cleanup must finish before detecting new completions.
    commitMapArrivalCardVisibility(input, committedVisibility);

    const closedNow = allScopedDestinations.filter((d) => d.closedAt != null);
    if (arrivalExitContextRef.current !== arrivalExitContext) {
      arrivalExitContextRef.current = arrivalExitContext;
      for (const timers of arrivalExitTimersRef.current.values()) for (const timer of timers) clearTimeout(timer);
      arrivalExitTimersRef.current.clear();
      clearAllCelebrateClearTimers(celebrateClearTimersRef.current);
      setArrivalExitRecords(new Map());
      setArrivalExitSnapshots(new Map());
      setArrivalCelebrateDestId(null);
      knownClosedDestIdsRef.current = null;
      remoteAutoCompleteDestIdsRef.current.clear();
    }
    if (!state || state.group.id !== groupId || loading) {
      knownClosedDestIdsRef.current = null;
      prevVisibleDestOrderRef.current = [];
      return;
    }
    if (!uiVisible) {
      knownClosedDestIdsRef.current = new Set(closedNow.map(d => d.id));
      prevVisibleDestOrderRef.current = openDestinations.map(d => d.id);
      return;
    }
    if (knownClosedDestIdsRef.current == null) {
      // First paint: seed known closed so past history does not animate out.
      knownClosedDestIdsRef.current = new Set(closedNow.map((d) => d.id));
      prevVisibleDestOrderRef.current = openDestinations.map((d) => d.id);
      return;
    }
    for (const id of knownClosedDestIdsRef.current) {
      if (closedNow.some(d => d.id === id)) continue;
      knownClosedDestIdsRef.current.delete(id);
      for (const timer of arrivalExitTimersRef.current.get(id) ?? []) clearTimeout(timer);
      arrivalExitTimersRef.current.delete(id);
      cancelCelebrateClearTimer(celebrateClearTimersRef.current, id);
      setArrivalCelebrateDestId(cur => cur === id ? null : cur);
      setArrivalExitRecords(prev => { const next = new Map(prev); next.delete(id); return next; });
      setArrivalExitSnapshots(prev => { const next = new Map(prev); next.delete(id); return next; });
    }
    const newlyStarted: string[] = [];
    for (const dest of newlyCompletedVisibleCards(closedNow, knownClosedDestIdsRef.current,
      prevVisibleDestOrderRef.current, true)) {
      knownClosedDestIdsRef.current.add(dest.id);
      const priorIdx = resolveExitIndexAtStart(
        prevVisibleDestOrderRef.current,
        dest.id,
        prevVisibleDestOrderRef.current.length,
      );
      startArrivalCardExit(dest, priorIdx);
      newlyStarted.push(dest.id);
    }
    knownClosedDestIdsRef.current = new Set(closedNow.map(destination => destination.id));
    const exitingIds = new Set<string>([
      ...arrivalExitRecords.keys(),
      ...newlyStarted,
    ]);
    // Keep exiting cards ranked until their record is removed (exit complete).
    prevVisibleDestOrderRef.current = nextVisibleCarouselOrder(
      prevVisibleDestOrderRef.current,
      openDestinations.map((d) => d.id),
      [...exitingIds],
    );

  });
  return null;
}
