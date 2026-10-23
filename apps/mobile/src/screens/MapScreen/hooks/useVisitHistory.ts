import { AppState } from 'react-native';
import { supabase } from '../../../api/supabase';
import { effectiveArrivalForOperation, type EffectiveArrival } from '../../../state/arrivalSync';
import { isDemoGroup } from '../../../api/demo';
import { fetchVisitedWaypoints } from '../../../api/client';
import type { VisitedWaypoint, Destination, MemberLocation } from '../../../types';
import { type CoreOperation } from '../../../types/coreData';
import { projectHistoryForViewer } from '../../../utils/gatherCommand';
import { type HistoryDayGroup, historyFromDestinationArrivals, mergeHistoryWithPastStops, groupHistoryByDay } from '../../../utils/history';
import { createElement, Fragment, useState, useRef, useCallback, } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import type { DestinationArrival, Group, User } from '../../../types';

export interface UseVisitHistoryInput {
  arrivalCorrections?: readonly EffectiveArrival[];
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
  arrivalCorrections,
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
    const effectiveResults = arrivalOperations.filter(op => (op.actorId ?? op.payload.actorId) === user?.id)
      .map(effectiveArrivalForOperation).filter((row): row is EffectiveArrival => row != null);
    for (const effective of [...effectiveResults, ...(arrivalCorrections ?? [])]) {
      const newer = destinationArrivals.find(row => row.destinationId === effective.destinationId
        && row.userId === effective.userId && row.navigationSessionId === effective.sessionId
        && row.updatedAt && effective.updatedAt && Date.parse(row.updatedAt) > Date.parse(effective.updatedAt));
      if (newer) continue;
      items = items.flatMap(item => {
        if (item.destinationId !== effective.destinationId || item.userId !== effective.userId
          || item.navigationSessionId !== effective.sessionId) return [item];
        if (item.updatedAt && effective.updatedAt && Date.parse(item.updatedAt) > Date.parse(effective.updatedAt)) return [item];
        return effective.arrived ? [{ ...item, arrivedAt: effective.arrivedAt,
          timeUnknown: effective.arrivedAt == null, status: 'arrived' as const }] : [];
      });
    }
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
    arrivalCorrections,
  ]);
  const visitedHistoryLoadLifecycle = createElement(VisitedHistoryLoad, { overlay, loadHistory, groupId });
  return {
    lifecycle: createElement(Fragment, { key: 'visit-history-runtime' }, visitedHistoryLoadLifecycle),
    historyGroups,
    loadHistory,
  };
}

function VisitedHistoryLoad({ overlay, loadHistory, groupId }: {
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  loadHistory: () => Promise<void>;
  groupId: string | null;
}) {
  const [visitedHistoryLoadInputs, setVisitedHistoryLoadInputs] = useState(() => ({ generation: 0, overlay, loadHistory, groupId }));
  if (!(Object.is(visitedHistoryLoadInputs.groupId, groupId) && Object.is(visitedHistoryLoadInputs.overlay, overlay) && Object.is(visitedHistoryLoadInputs.loadHistory, loadHistory))) {
    setVisitedHistoryLoadInputs({ generation: visitedHistoryLoadInputs.generation + 1, overlay, loadHistory, groupId });
  }
  return createElement(VisitedHistoryLoadCommit, { key: visitedHistoryLoadInputs.generation, overlay, loadHistory, groupId });
}

function VisitedHistoryLoadCommit({ overlay, loadHistory, groupId }: {
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  loadHistory: () => Promise<void>;
  groupId: string | null;
}) {
  useMountEffect(() => {
    if (overlay !== 'history') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; void loadHistory().catch(() => undefined); }, 300);
    };
    void loadHistory().catch(() => undefined);
    const appState = AppState.addEventListener('change', state => { if (state === 'active') reload(); });
    const channel = groupId && !isDemoGroup(groupId) ? supabase.channel(`visit-history:${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visited_waypoints', filter: `group_id=eq.${groupId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'navigation_session_history', filter: `group_id=eq.${groupId}` }, reload)
      .subscribe(status => { if (status === 'SUBSCRIBED') reload(); }) : null;
    return () => {
      if (timer) clearTimeout(timer);
      appState.remove();
      if (channel) void supabase.removeChannel(channel);
    };
  });
  return null;
}
