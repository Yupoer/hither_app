import { fetchVisitedWaypoints } from '../../../api/client';
import type { VisitedWaypoint, Destination, MemberLocation } from '../../../types';
import { type CoreOperation } from '../../../types/coreData';
import { projectHistoryForViewer } from '../../../utils/gatherCommand';
import { type HistoryDayGroup, historyFromDestinationArrivals, mergeHistoryWithPastStops, groupHistoryByDay } from '../../../utils/history';
import { createElement, Fragment, useState, useRef, useCallback, } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import type { DestinationArrival, Group, User } from '../../../types';

export interface UseVisitHistoryInput {
  allScopedDestinations: Destination[];
  arrivalOperations: CoreOperation[];
  destinationArrivals: DestinationArrival[];
  group: Group | null;
  groupId: string | null;
  isLeader: boolean;
  members: MemberLocation[];
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  routeDepartureDate: string | undefined;
  routeTripDays: number | undefined;
  user: User | null;
}

export function useVisitHistory({
  allScopedDestinations,
  arrivalOperations,
  destinationArrivals,
  group,
  groupId,
  isLeader,
  members,
  overlay,
  routeDepartureDate,
  routeTripDays,
  user,
}: UseVisitHistoryInput) {
  // Visited-waypoint history — fetched fresh each time the overlay opens.
  // Past trip-day stops the viewer never reached are merged in as 未抵達/未完成.
  const [historyGroups, setHistoryGroups] = useState<HistoryDayGroup[]>([]);
  const historyRequestRef = useRef(0);
  const loadHistory = useCallback(async () => {
    const request = ++historyRequestRef.current;
    const renderHistory = (items: VisitedWaypoint[]) => {
    const arrivalHistory = historyFromDestinationArrivals(destinationArrivals, allScopedDestinations, {
      viewerId: user?.id,
      isGroupLeader: !!isLeader,
    });
    const existingKeys = new Set(items.map((item) => item.destinationId + ":" + (item.userId ?? "")));
    const projected = projectHistoryForViewer([...items, ...arrivalHistory.filter((item) => !existingKeys.has(item.destinationId + ":" + (item.userId ?? "")))], {
      viewerId: user?.id,
      isGroupLeader: !!isLeader,
    });
    const memberNames = new Map(members.map(member => [member.userId, member.name]));
    const pendingArrivalKeys = new Set(arrivalOperations
      .filter(op => op.payload.actorId === user?.id && op.status !== 'acked' && op.status !== 'conflict')
      .map(op => `${op.entityId}:${op.payload.userId}`));
    const named = projected.map((item) => ({
      ...item,
      userName: item.userId ? memberNames.get(item.userId) : undefined,
      status: item.status ?? ('arrived' as const),
      pendingSync: pendingArrivalKeys.has(`${item.destinationId}:${item.userId}`),
    }));
    const merged = mergeHistoryWithPastStops(named, allScopedDestinations, {
      departureDate: routeDepartureDate,
      tripDays: routeTripDays,
      userId: user?.id,
    });
    setHistoryGroups(groupHistoryByDay(merged));
    };
    // Pending local history is visible even while a disconnected request waits.
    renderHistory([]);
    const items = await fetchVisitedWaypoints(groupId ?? undefined).catch(() => []);
    if (historyRequestRef.current === request) renderHistory(items);
  }, [
    groupId,
    members,
    allScopedDestinations,
    routeDepartureDate,
    routeTripDays,
    group?.departureDate,
    group?.tripDays,
    user?.id,
    isLeader,
    destinationArrivals,
    arrivalOperations,
  ]);
  const visitedHistoryLoadLifecycle = createElement(VisitedHistoryLoad, { overlay, loadHistory });
  return {
    lifecycle: createElement(Fragment, { key: 'visit-history-runtime' }, visitedHistoryLoadLifecycle),
    historyGroups,
    loadHistory,
  };
}

function VisitedHistoryLoad({ overlay, loadHistory }: {
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  loadHistory: () => Promise<void>;
}) {
  const [visitedHistoryLoadInputs, setVisitedHistoryLoadInputs] = useState(() => ({ generation: 0, overlay, loadHistory }));
  if (!(Object.is(visitedHistoryLoadInputs.overlay, overlay) && Object.is(visitedHistoryLoadInputs.loadHistory, loadHistory))) {
    setVisitedHistoryLoadInputs({ generation: visitedHistoryLoadInputs.generation + 1, overlay, loadHistory });
  }
  return createElement(VisitedHistoryLoadCommit, { key: visitedHistoryLoadInputs.generation, overlay, loadHistory });
}

function VisitedHistoryLoadCommit({ overlay, loadHistory }: {
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  loadHistory: () => Promise<void>;
}) {
  useMountEffect(() => {
    if (overlay !== 'history') return;
    void loadHistory().catch(() => undefined);
  });
  return null;
}
