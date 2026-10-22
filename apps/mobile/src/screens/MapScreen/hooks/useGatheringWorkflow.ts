import { createElement, Fragment, useCallback, useRef, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { Alert } from 'react-native';
import { fetchDestinationArrivals, fetchPendingGatherPointRequests } from '../../../api/client';
import { isDemoGroup } from '../../../api/demo';
import { supabase } from '../../../api/supabase';
import type { TranslationKey } from '../../../i18n';
import { getCoreOperationOutbox } from '../../../state/coreDataSync';
import { useForegroundReconcile } from '../../../state/useForegroundReconcile';
import type { Destination, DestinationArrival, GatherPointRequest } from '../../../types';
import type { CoreOperation } from '../../../types/coreData';

const WORKFLOW_MIN_INTERVAL_MS = 2_500;

export interface UseGatheringWorkflowInput {
  groupId: string | null;
  userId: string | undefined;
  myScopeId: string | undefined;
  isMainLeader: boolean;
  isSubgroupLeader: boolean;
  canEditItinerary: boolean;
  t: (key: TranslationKey) => string;
  /** My queued arrival intents; acked receipts are compacted once the server reflects them. */
  arrivalOperations: CoreOperation[];
  arrivalSessionScope: string[];
  rawDestinations: Destination[];
}

/**
 * Remote arrival rows and the leader's pending gather-point requests for my
 * scope: single-flight loads, Realtime-coalesced reloads, and compaction of
 * my acknowledged arrival receipts once the server reflects them.
 */
export function useGatheringWorkflow({
  groupId,
  userId,
  myScopeId,
  isMainLeader,
  isSubgroupLeader,
  canEditItinerary,
  t,
  arrivalOperations,
  arrivalSessionScope,
  rawDestinations,
}: UseGatheringWorkflowInput) {
  const [remoteArrivals, setDestinationArrivals] = useState<DestinationArrival[]>([]);
  const [gatherPointRequests, setGatherPointRequests] = useState<GatherPointRequest[]>([]);
  // Keep translator out of effect deps — unstable `t` historically re-subscribed
  // gathering Realtime and hammered destination_arrivals (~5–6 SELECT/s).
  const workflowReloadRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useMountEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  });
  const tRef = useRef(t);
  tRef.current = t;
  const isMainLeaderRef = useRef(isMainLeader);
  isMainLeaderRef.current = isMainLeader;
  const isSubgroupLeaderRef = useRef(isSubgroupLeader);
  isSubgroupLeaderRef.current = isSubgroupLeader;
  const myScopeIdRef = useRef(myScopeId);
  myScopeIdRef.current = myScopeId;
  const isScopeLeaderRef = useRef(canEditItinerary);
  isScopeLeaderRef.current = canEditItinerary;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const workflowInFlightRef = useRef<Promise<void> | null>(null);
  /** Set while a load is in flight so a concurrent request re-runs after. */
  const workflowPendingRef = useRef(false);
  const workflowLastLoadAtRef = useRef(0);
  const workflowChannelSeqRef = useRef(0);
  const workflowContext = `${groupId ?? ''}:${userId ?? ''}:${myScopeId ?? 'main'}`;
  const workflowContextRef = useRef(workflowContext);
  workflowContextRef.current = workflowContext;
  

  const loadGatheringWorkflow = useCallback(async () => {
    const isCurrent = () => mountedRef.current && workflowContextRef.current === workflowContext;
    if (!groupId || isDemoGroup(groupId) || !isCurrent()) return;
    // Single-flight with pending re-run: a second caller during an in-flight
    // fetch must not return stale arrivals (e.g. mark then realtime overlap).
    if (workflowInFlightRef.current) {
      workflowPendingRef.current = true;
      await workflowInFlightRef.current;
      if (!isCurrent()) return;
      if (!workflowPendingRef.current) return;
    }
    do {
      workflowPendingRef.current = false;
      const run = (async () => {
        const [arrivals, requests] = await Promise.all([
          fetchDestinationArrivals(groupId),
          isScopeLeaderRef.current
            ? fetchPendingGatherPointRequests(groupId)
            : Promise.resolve([]),
        ]);
        if (!isCurrent()) return;
        setDestinationArrivals(arrivals);
        const scopedRequests = isSubgroupLeaderRef.current
          ? requests.filter((request) => request.subgroupId === myScopeIdRef.current)
          : requests.filter((request) => request.subgroupId == null);
        setGatherPointRequests(scopedRequests);
        workflowLastLoadAtRef.current = Date.now();
      })();
      const tracked = run.finally(() => {
        if (workflowInFlightRef.current === tracked) workflowInFlightRef.current = null;
      });
      workflowInFlightRef.current = tracked;
      await tracked;
    } while (isCurrent() && workflowPendingRef.current);
  }, [groupId, workflowContext]);

  useForegroundReconcile(Boolean(groupId), loadGatheringWorkflow);

  /** Optimistic arrival row so N/M progress updates before reload finishes. */
  const patchLocalArrival = useCallback((
    destinationId: string,
    targetUserId: string,
    arrived: boolean,
    arrivedAt?: string | null,
    navigationSessionId?: string | null,
  ) => {
    setDestinationArrivals((prev) => {
      const without = prev.filter(
        (row) => !(row.destinationId === destinationId && row.userId === targetUserId),
      );
      if (!arrived) return without;
      if (prev.some((row) => row.destinationId === destinationId && row.userId === targetUserId)) {
        return prev;
      }
      return [
        ...without,
        {
          id: `local-${destinationId}-${targetUserId}`,
          groupId: groupId ?? '',
          destinationId,
          userId: targetUserId,
          arrivedAt: arrivedAt === undefined ? new Date().toISOString() : arrivedAt,
          source: 'leader_correction' as const,
          markedBy: userId ?? targetUserId,
          ...(navigationSessionId ? { navigationSessionId } : {}),
        },
      ];
    });
  }, [groupId, userId]);

  const arrivalReceiptCompactionLifecycle = createElement(ArrivalReceiptCompaction, { arrivalOperations, userId, arrivalSessionScope, remoteArrivals, rawDestinations });

  const scheduleWorkflowReload = useCallback(() => {
    if (workflowReloadRef.current) return;
    workflowReloadRef.current = setTimeout(() => {
      workflowReloadRef.current = null;
      // Preserve the last event while coalescing bursts.
      void loadGatheringWorkflow().catch(() => undefined);
    }, Math.max(300, WORKFLOW_MIN_INTERVAL_MS - (Date.now() - workflowLastLoadAtRef.current)));
  }, [loadGatheringWorkflow]);

  const gatheringWorkflowChannelLifecycle = createElement(GatheringWorkflowChannel, { setDestinationArrivals, setGatherPointRequests, groupId, workflowLastLoadAtRef, loadGatheringWorkflow, workflowChannelSeqRef, scheduleWorkflowReload, isMainLeaderRef, isSubgroupLeaderRef, myScopeIdRef, isScopeLeaderRef, userIdRef, tRef, workflowReloadRef, workflowInFlightRef, workflowPendingRef, mountedRef });

  return {
    lifecycle: createElement(Fragment, { key: 'gathering-workflow-runtime' }, arrivalReceiptCompactionLifecycle, gatheringWorkflowChannelLifecycle),
    remoteArrivals,
    gatherPointRequests,
    setGatherPointRequests,
    loadGatheringWorkflow,
    patchLocalArrival,
    /** `group:user:scope`; async work started under one context must not land in another. */
    workflowContext,
    isWorkflowContextCurrent: useCallback((context: string) => mountedRef.current
      && workflowContextRef.current === context, []),
  };
}

function ArrivalReceiptCompaction({ arrivalOperations, userId, arrivalSessionScope, remoteArrivals, rawDestinations }: {
  arrivalOperations: CoreOperation[];
  userId: string | undefined;
  arrivalSessionScope: string[];
  remoteArrivals: DestinationArrival[];
  rawDestinations: Destination[];
}) {
  const [arrivalReceiptCompactionInputs, setArrivalReceiptCompactionInputs] = useState(() => ({ generation: 0, arrivalOperations, arrivalSessionScope, remoteArrivals, rawDestinations, userId }));
  if (!(Object.is(arrivalReceiptCompactionInputs.arrivalOperations, arrivalOperations) && Object.is(arrivalReceiptCompactionInputs.arrivalSessionScope, arrivalSessionScope) && Object.is(arrivalReceiptCompactionInputs.remoteArrivals, remoteArrivals) && Object.is(arrivalReceiptCompactionInputs.rawDestinations, rawDestinations) && Object.is(arrivalReceiptCompactionInputs.userId, userId))) {
    setArrivalReceiptCompactionInputs({ generation: arrivalReceiptCompactionInputs.generation + 1, arrivalOperations, arrivalSessionScope, remoteArrivals, rawDestinations, userId });
  }
  return createElement(ArrivalReceiptCompactionCommit, { key: arrivalReceiptCompactionInputs.generation, arrivalOperations, userId, arrivalSessionScope, remoteArrivals, rawDestinations });
}

function ArrivalReceiptCompactionCommit({ arrivalOperations, userId, arrivalSessionScope, remoteArrivals, rawDestinations }: {
  arrivalOperations: CoreOperation[];
  userId: string | undefined;
  arrivalSessionScope: string[];
  remoteArrivals: DestinationArrival[];
  rawDestinations: Destination[];
}) {
  useMountEffect(() => {
    const eventOrder = (op: CoreOperation) => {
      const occurredAt = typeof op.payload.occurredAt === 'string'
        ? Date.parse(op.payload.occurredAt)
        : Number.NaN;
      return Number.isFinite(occurredAt) ? occurredAt : (op.sequence ?? op.createdAt);
    };
    const keyFor = (op: CoreOperation) => `${op.entityId}:${String(
      op.payload.targetUserId ?? op.payload.userId ?? ''
    )}:${String(op.payload.navigationSessionId ?? op.payload.sessionId ?? '')}`;
    const latestByKey = new Map<string, CoreOperation>();
    for (const op of arrivalOperations) {
      if (op.status === 'conflict' || op.payload.actorId !== userId) continue;
      const key = keyFor(op);
      const previous = latestByKey.get(key);
      if (!previous || eventOrder(previous) <= eventOrder(op)) latestByKey.set(key, op);
    }
    for (const op of arrivalOperations) {
      if (op.status !== 'acked' || op.payload.actorId !== userId) continue;
      const opSessionId = typeof (op.payload.navigationSessionId ?? op.payload.sessionId) === 'string'
        ? String(op.payload.navigationSessionId ?? op.payload.sessionId)
        : null;
      // Keep the latest active-session undo as a tombstone until the member
      // leaves the geofence.  Background can start after ACK/compaction and
      // still suppress the old arrival for this exact session.
      const activeUndoTombstone = op.operationType === 'record_arrival'
        && op.payload.arrived === false
        && op.payload.userId === userId
        && opSessionId != null
        && arrivalSessionScope.includes(opSessionId);
      if (activeUndoTombstone) continue;
      // Once a newer acked intent is reflected, older receipts are safe to
      // compact too. Otherwise an old leader correction can re-project after
      // the newer undo/correction receipt is removed.
      const latest = latestByKey.get(keyFor(op));
      if (latest && latest.id !== op.id && latest.status === 'acked') {
        void getCoreOperationOutbox().removeArrival(op.id);
        continue;
      }
      const targetUserId = String(op.payload.targetUserId ?? op.payload.userId ?? '');
      const sessionId = opSessionId;
      const matching = remoteArrivals.find(a => a.destinationId === op.entityId
        && a.userId === targetUserId
        && (sessionId == null || a.navigationSessionId === sessionId));
      const isCorrection = op.operationType === 'leader_correct_arrival'
        || op.payload.source === 'leader_correction';
      const closed = !op.payload.completeSolo || rawDestinations.some(d => d.id === op.entityId && d.closedAt);
      const reflected = isCorrection
        ? op.payload.arrived === false
          ? !matching
          : Boolean(matching && matching.source === 'leader_correction'
            && matching.arrivedAt === null && matching.markedBy === op.actorId)
        : op.payload.arrived === false ? !matching : Boolean(matching && closed);
      if (reflected) void getCoreOperationOutbox().removeArrival(op.id);
    }
  });
  return null;
}

function GatheringWorkflowChannel({ setDestinationArrivals, setGatherPointRequests, groupId, workflowLastLoadAtRef, loadGatheringWorkflow, workflowChannelSeqRef, scheduleWorkflowReload, isMainLeaderRef, isSubgroupLeaderRef, myScopeIdRef, isScopeLeaderRef, userIdRef, tRef, workflowReloadRef, workflowInFlightRef, workflowPendingRef, mountedRef }: {
  setDestinationArrivals: import("react").Dispatch<import("react").SetStateAction<DestinationArrival[]>>;
  setGatherPointRequests: import("react").Dispatch<import("react").SetStateAction<GatherPointRequest[]>>;
  groupId: string | null;
  workflowLastLoadAtRef: import("react").RefObject<number>;
  loadGatheringWorkflow: () => Promise<void>;
  workflowChannelSeqRef: import("react").RefObject<number>;
  scheduleWorkflowReload: () => void;
  isMainLeaderRef: import("react").RefObject<boolean>;
  isSubgroupLeaderRef: import("react").RefObject<boolean>;
  myScopeIdRef: import("react").RefObject<string | undefined>;
  isScopeLeaderRef: import("react").RefObject<boolean>;
  userIdRef: import("react").RefObject<string | undefined>;
  tRef: import("react").RefObject<(key: TranslationKey) => string>;
  workflowReloadRef: import("react").RefObject<NodeJS.Timeout | null>;
  workflowInFlightRef: import("react").RefObject<Promise<void> | null>;
  workflowPendingRef: import("react").RefObject<boolean>;
  mountedRef: import("react").RefObject<boolean>;
}) {
  const [gatheringWorkflowChannelInputs, setGatheringWorkflowChannelInputs] = useState(() => ({ generation: 0, groupId, loadGatheringWorkflow, scheduleWorkflowReload }));
  if (!(Object.is(gatheringWorkflowChannelInputs.groupId, groupId) && Object.is(gatheringWorkflowChannelInputs.loadGatheringWorkflow, loadGatheringWorkflow) && Object.is(gatheringWorkflowChannelInputs.scheduleWorkflowReload, scheduleWorkflowReload))) {
    setGatheringWorkflowChannelInputs({ generation: gatheringWorkflowChannelInputs.generation + 1, groupId, loadGatheringWorkflow, scheduleWorkflowReload });
  }
  return createElement(GatheringWorkflowChannelCommit, { key: gatheringWorkflowChannelInputs.generation, setDestinationArrivals, setGatherPointRequests, groupId, workflowLastLoadAtRef, loadGatheringWorkflow, workflowChannelSeqRef, scheduleWorkflowReload, isMainLeaderRef, isSubgroupLeaderRef, myScopeIdRef, isScopeLeaderRef, userIdRef, tRef, workflowReloadRef, workflowInFlightRef, workflowPendingRef, mountedRef });
}

function GatheringWorkflowChannelCommit({ setDestinationArrivals, setGatherPointRequests, groupId, workflowLastLoadAtRef, loadGatheringWorkflow, workflowChannelSeqRef, scheduleWorkflowReload, isMainLeaderRef, isSubgroupLeaderRef, myScopeIdRef, isScopeLeaderRef, userIdRef, tRef, workflowReloadRef, workflowInFlightRef, workflowPendingRef, mountedRef }: {
  setDestinationArrivals: import("react").Dispatch<import("react").SetStateAction<DestinationArrival[]>>;
  setGatherPointRequests: import("react").Dispatch<import("react").SetStateAction<GatherPointRequest[]>>;
  groupId: string | null;
  workflowLastLoadAtRef: import("react").RefObject<number>;
  loadGatheringWorkflow: () => Promise<void>;
  workflowChannelSeqRef: import("react").RefObject<number>;
  scheduleWorkflowReload: () => void;
  isMainLeaderRef: import("react").RefObject<boolean>;
  isSubgroupLeaderRef: import("react").RefObject<boolean>;
  myScopeIdRef: import("react").RefObject<string | undefined>;
  isScopeLeaderRef: import("react").RefObject<boolean>;
  userIdRef: import("react").RefObject<string | undefined>;
  tRef: import("react").RefObject<(key: TranslationKey) => string>;
  workflowReloadRef: import("react").RefObject<NodeJS.Timeout | null>;
  workflowInFlightRef: import("react").RefObject<Promise<void> | null>;
  workflowPendingRef: import("react").RefObject<boolean>;
  mountedRef: import("react").RefObject<boolean>;
}) {
  useMountEffect(() => {
    mountedRef.current = true;
    workflowInFlightRef.current = null;
    workflowPendingRef.current = false;
    workflowLastLoadAtRef.current = 0;
    setDestinationArrivals([]);
    setGatherPointRequests([]);
    if (!groupId || isDemoGroup(groupId)) return;
    // Mount / group change only — not on every render or translator identity.
    workflowLastLoadAtRef.current = 0;
    void loadGatheringWorkflow().catch(() => undefined);
    const channel = supabase
      .channel(`gathering-workflow:${groupId}:${++workflowChannelSeqRef.current}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'destination_arrivals', filter: `group_id=eq.${groupId}`,
      }, scheduleWorkflowReload)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'gather_point_requests', filter: `group_id=eq.${groupId}`,
      }, (payload) => {
        scheduleWorkflowReload();
        const request = payload.new as { requester_id?: string; subgroup_id?: string | null } | null;
        const isOwnScopeRequest = request?.subgroup_id == null
          ? isMainLeaderRef.current
          : isSubgroupLeaderRef.current && request.subgroup_id === myScopeIdRef.current;
        if (
          isScopeLeaderRef.current
          && isOwnScopeRequest
          && payload.eventType === 'INSERT'
          && request?.requester_id !== userIdRef.current
        ) {
          Alert.alert(
            tRef.current('gatherRequest.newTitle'),
            tRef.current('gatherRequest.newBody'),
          );
        }
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') scheduleWorkflowReload(); });
    return () => {
      if (workflowReloadRef.current) clearTimeout(workflowReloadRef.current);
      workflowReloadRef.current = null;
      supabase.removeChannel(channel);
    };
  });
  return null;
}
