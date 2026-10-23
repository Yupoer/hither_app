import React, { createElement, Fragment, useState, useCallback, useRef, } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { Alert } from 'react-native';
import type { TranslationKey } from '../../../i18n';
import type { Destination, DestinationArrival, MemberLocation, User } from '../../../types';
import type { useNavigationSession } from '../../../state/useNavigationSession';
import type { useGroupState } from '../../../state/useGroupState';
import type { useRouteDraft } from './useRouteDraft';
import { enqueueJourneyCompletion } from '../../../state/journeyCompletion';
import { getOperationErrorMessage } from '../../../utils/operationError';
import { logError } from '../../../utils/activityLog';
import { applyLocalClosedAt, deriveScopedArrivalCounts, planCompleteGatheringApply, resolveCompletePrompt } from '../../../utils/gatherCommand';
import { resolveExitIndexAtStart } from '../../../utils/arrivalCardExit';
import * as notifications from '../../../native/notifications';

export interface UseGatheringCompletionInput {
  groupId: string | null;
  user: User | null;
  canEditItinerary: boolean;
  pendingLeaderTargetId: string | null;
  resolveCurrentNavigationSessionId: (destination: Destination) => string | null;
  arrivalContext: string;
  mapMountedRef: React.RefObject<boolean>;
  arrivalContextRef: React.RefObject<string>;
  allScopedDestinations: Destination[];
  completingDestIdsRef: React.RefObject<Set<string>>;
  remoteAutoCompleteDestIdsRef: React.RefObject<Set<string>>;
  sessionEligibleMembers: MemberLocation[];
  activeDestinationArrivals: DestinationArrival[];
  refreshLocalSnapshot: () => Promise<boolean>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  routeDraft: Pick<ReturnType<typeof useRouteDraft>, 'latestDestinations' | 'setDestinations'>;
  prevVisibleDestOrderRef: React.RefObject<string[]>;
  startArrivalCardExit: (destination: Destination, indexAtStart?: number) => void;
  stopRemovedDestination: (destinationId: string, sessionId: string | null) => void;
  navigationSessionState: Pick<ReturnType<typeof useNavigationSession>, 'refresh'>;
  refresh: ReturnType<typeof useGroupState>['refresh'];
  loadGatheringWorkflow: () => Promise<void>;
  loadHistory: () => Promise<void>;
  members: MemberLocation[];
  navTargetId: string | null;
}

export function useGatheringCompletion({
  groupId,
  user,
  canEditItinerary,
  pendingLeaderTargetId,
  resolveCurrentNavigationSessionId,
  arrivalContext,
  mapMountedRef,
  arrivalContextRef,
  allScopedDestinations,
  completingDestIdsRef,
  remoteAutoCompleteDestIdsRef,
  sessionEligibleMembers,
  activeDestinationArrivals,
  refreshLocalSnapshot,
  t,
  routeDraft,
  prevVisibleDestOrderRef,
  startArrivalCardExit,
  stopRemovedDestination,
  navigationSessionState,
  refresh,
  loadGatheringWorkflow,
  loadHistory,
  members,
  navTargetId,
}: UseGatheringCompletionInput) {
  const latestAuthorityRef = useRef({ groupId, userId: user?.id, canEditItinerary,
    arrivalContext, allScopedDestinations, resolveCurrentNavigationSessionId });
  latestAuthorityRef.current = { groupId, userId: user?.id, canEditItinerary,
    arrivalContext, allScopedDestinations, resolveCurrentNavigationSessionId };
  /** @returns true after local completion is saved; transport never owns success. */
  const runCompleteGatheringStop = useCallback(async (destination: Destination, force = true): Promise<boolean> => {
    // Complete is separate from End navigation: only this path closes the stop
    // (closed_at → leaves carousel → history). End only pauses flock travel.
    // Server complete_gathering_stop also cancels any active nav for this stop.
    if (!groupId || !user?.id || !canEditItinerary) return false;
    const sessionId = resolveCurrentNavigationSessionId(destination);
    if (pendingLeaderTargetId === destination.id && !sessionId) return false;
    const completionContext = arrivalContext;
    const isCurrent = () => {
      const latest = latestAuthorityRef.current;
      const currentDestination = latest.allScopedDestinations.find(item => item.id === destination.id);
      const currentSessionId = latest.resolveCurrentNavigationSessionId(destination);
      return mapMountedRef.current && arrivalContextRef.current === completionContext
        && latest.arrivalContext === completionContext && latest.groupId === groupId
        && latest.userId === user.id && latest.canEditItinerary
        && (!currentSessionId || currentSessionId === sessionId) && !!currentDestination
        && (currentDestination.subgroupId ?? null) === (destination.subgroupId ?? null);
    };
    const isSessionCurrent = () => isCurrent()
      && latestAuthorityRef.current.resolveCurrentNavigationSessionId(destination) === sessionId;
    if (!isSessionCurrent()) return false;
    const alreadyClosed = !!destination.closedAt
      || allScopedDestinations.find((d) => d.id === destination.id)?.closedAt != null;
    const plan = planCompleteGatheringApply({
      alreadyClosed,
      rpcInFlight: completingDestIdsRef.current.has(destination.id),
      remoteAutoCompleted: remoteAutoCompleteDestIdsRef.current.has(destination.id),
    });
    if (!alreadyClosed && !sessionId) return false;
    const closedAt = destination.closedAt ?? new Date().toISOString();
    if (completingDestIdsRef.current.has(destination.id)) return false;
    if (plan.callRpc) {
      completingDestIdsRef.current.add(destination.id);
      try {
        const operation = await enqueueJourneyCompletion({
          groupId, destinationId: destination.id, navigationSessionId: sessionId,
          actorId: user.id, scopeSubgroupId: destination.subgroupId ?? null,
          leaderId: user.id,
          navigationMemberIds: sessionEligibleMembers.filter(member => !member.solo
            && (member.subgroupId ?? null) === (destination.subgroupId ?? null)).map(member => member.userId),
          arrivedMemberIds: activeDestinationArrivals.filter(arrival => arrival.destinationId === destination.id)
            .map(arrival => arrival.userId),
          force, isCurrent: isSessionCurrent,
        });
        if (!isCurrent() || !operation) {
          completingDestIdsRef.current.delete(destination.id);
          return false;
        }
        await refreshLocalSnapshot();
        if (!isCurrent()) return false;
      } catch (error) {
        logError('complete_gathering_failed', error, { groupId, destId: destination.id });
        Alert.alert(
          t('map.setFailedTitle'),
          getOperationErrorMessage(error),
        );
        return false;
      } finally {
        completingDestIdsRef.current.delete(destination.id);
      }
    }
    if (!isCurrent()) return false;
    // The durable completion already closed the stop in the local snapshot;
    // only an open route draft still holds its own copy of the list.
    const draft = routeDraft.latestDestinations();
    if (plan.applyLocalClosedAt && draft) {
      routeDraft.setDestinations(applyLocalClosedAt(draft, destination.id, closedAt));
    }
    if (plan.startCardExit) {
      const priorIdx = resolveExitIndexAtStart(
        prevVisibleDestOrderRef.current,
        destination.id,
        prevVisibleDestOrderRef.current.length,
      );
      startArrivalCardExit({ ...destination, closedAt }, priorIdx);
    }
    stopRemovedDestination(destination.id, sessionId);
    if (plan.refreshHistory) void Promise.all([
      navigationSessionState.refresh(), refresh(), loadGatheringWorkflow(), loadHistory(),
    ]).catch(() => undefined);
    return true;
  }, [
    allScopedDestinations,
    activeDestinationArrivals,
    arrivalContext,
    sessionEligibleMembers,
    canEditItinerary,
    groupId,
    members,
    user?.id,
    loadGatheringWorkflow,
    loadHistory,
    navigationSessionState,
    resolveCurrentNavigationSessionId,
    pendingLeaderTargetId,
    refresh,
    refreshLocalSnapshot,
    startArrivalCardExit,
    stopRemovedDestination,
    t,
  ]);


  /** Shared auto-complete: guard + complete RPC + this-device notify (native boundary). */
  const executeAutoCompleteStop = useCallback(async (destination: Destination) => {
    const alreadyTracked = remoteAutoCompleteDestIdsRef.current.has(destination.id);
    remoteAutoCompleteDestIdsRef.current.add(destination.id);
    const ok = await runCompleteGatheringStop(destination, false);
    if (!ok) {
      remoteAutoCompleteDestIdsRef.current.delete(destination.id);
      return;
    }
    if (alreadyTracked) return;
    // Platform path lives in native/notifications (not MapScreen Platform.OS).
    void notifications.notifyThisDeviceAutoComplete({
      title: t('gathering.autoCompleteTitle'),
      body: t('gathering.autoCompleteBody', { title: destination.title }),
      data: { kind: 'gathering_auto_complete', destinationId: destination.id },
    }).catch(() => undefined);
  }, [runCompleteGatheringStop, t]);

  const promptCompleteAfterArrival = useCallback((destination: Destination, opts?: {
    /**
     * Only true after a successful local arrival write.
     * Manual Complete / remote path must not invent a self arrival (P1).
     */
    includeSelf?: boolean;
  }) => {
    const sessionId = resolveCurrentNavigationSessionId(destination);
    if (canEditItinerary && !sessionId) return;
    const promptContext = arrivalContext;
    const isPromptCurrent = () => {
      const latest = latestAuthorityRef.current;
      const currentDestination = latest.allScopedDestinations.find(item => item.id === destination.id);
      return mapMountedRef.current && arrivalContextRef.current === promptContext
        && latest.arrivalContext === promptContext && latest.groupId === groupId
        && latest.userId === user?.id && latest.canEditItinerary === canEditItinerary
        && !!currentDestination
        && (currentDestination.subgroupId ?? null) === (destination.subgroupId ?? null)
        && latest.resolveCurrentNavigationSessionId(destination) === sessionId;
    };
    if (!isPromptCurrent()) return;
    const arrivedIds = new Set(
      activeDestinationArrivals
        .filter((a) => a.destinationId === destination.id)
        .map((a) => a.userId),
    );
    const counts = deriveScopedArrivalCounts({
      members: sessionEligibleMembers,
      destinationSubgroupId: destination.subgroupId,
      arrivedUserIds: arrivedIds,
      // Opt-in only — default false so failed write cannot force auto-complete.
      includeUserId: opts?.includeSelf ? user?.id : null,
      travelerFallback: t('group.travelerFallback'),
    });
    const stopAlreadyComplete = !!destination.closedAt
      || allScopedDestinations.find((d) => d.id === destination.id)?.closedAt != null;
    const prompt = resolveCompletePrompt({
      isLeader: canEditItinerary,
      missingMemberNames: counts.missingMemberNames,
      allArrived: counts.allArrived,
      stopAlreadyComplete: !!stopAlreadyComplete,
      arrivedCount: counts.arrivedCount,
      totalCount: counts.totalCount,
    });
    if (prompt.kind === 'none') return;

    // All arrived → auto-complete + this-device notification. No confirm dialog.
    // Already-closed is the same apply path (never a silent no-op).
    if (prompt.kind === 'auto_complete' || prompt.kind === 'already_complete') {
      void executeAutoCompleteStop(destination);
      return;
    }

    // Manual complete (someone missing) or member notice — i18n only (helper kind/counts).
    const isMissing = prompt.kind === 'leader_missing_members';
    const isMemberDone = prompt.kind === 'member_leader_already_done';
    const title = isMissing
      ? t('gathering.completeMissingTitle')
      : isMemberDone
        ? t('gathering.memberLeaderDoneTitle')
        : prompt.title;
    const message = isMissing
      ? t('gathering.completeMissingMessage', {
          arrived: String(prompt.arrivedCount ?? 0),
          total: String(prompt.totalCount ?? 0),
        })
      : isMemberDone
        ? t('gathering.memberLeaderDoneMessage')
        : prompt.message;
    const confirmLabel = isMissing
      ? t('gathering.completeConfirm')
      : isMemberDone
        ? t('common.confirm')
        : prompt.confirmLabel;
    const cancelLabel = isMissing
      ? t('common.cancel')
      : prompt.cancelLabel;

    const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }> = [];
    if (cancelLabel) {
      buttons.push({
        text: cancelLabel,
        style: 'cancel',
      });
    }
    buttons.push({
      text: confirmLabel,
      style: isMissing ? 'destructive' : undefined,
      onPress: () => {
        if (!isPromptCurrent()) return;
        // Leader RPC only — members already have arrival/history; just refresh.
        if (isMemberDone) {
          void refresh();
          void loadGatheringWorkflow();
          return;
        }
        void runCompleteGatheringStop(destination);
      },
    });
    Alert.alert(title, message, buttons);
  }, [
    allScopedDestinations,
    activeDestinationArrivals,
    arrivalContext,
    groupId,
    resolveCurrentNavigationSessionId,
    executeAutoCompleteStop,
    canEditItinerary,
    loadGatheringWorkflow,
    members,
    refresh,
    runCompleteGatheringStop,
    sessionEligibleMembers,
    t,
    user?.id,
  ]);

  // Remote final arrival (Realtime / workflow reload): leader auto-completes when
  // every *scoped* member has an arrival row — no personal-arrive path required.
  const committedGatheringCompletionLifecycle = createElement(CommittedGatheringCompletion, { canEditItinerary, groupId, allScopedDestinations, navTargetId, remoteAutoCompleteDestIdsRef, completingDestIdsRef, activeDestinationArrivals, sessionEligibleMembers, t, executeAutoCompleteStop, members });

  return {
    lifecycle: createElement(Fragment, { key: 'gathering-completion-runtime' }, committedGatheringCompletionLifecycle), runCompleteGatheringStop, promptCompleteAfterArrival };
}

function CommittedGatheringCompletion({ canEditItinerary, groupId, allScopedDestinations, navTargetId, remoteAutoCompleteDestIdsRef, completingDestIdsRef, activeDestinationArrivals, sessionEligibleMembers, t, executeAutoCompleteStop, members }: {
  canEditItinerary: boolean;
  groupId: string | null;
  allScopedDestinations: Destination[];
  navTargetId: string | null;
  remoteAutoCompleteDestIdsRef: React.RefObject<Set<string>>;
  completingDestIdsRef: React.RefObject<Set<string>>;
  activeDestinationArrivals: DestinationArrival[];
  sessionEligibleMembers: MemberLocation[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  executeAutoCompleteStop: (destination: Destination) => Promise<void>;
  members: MemberLocation[];
}) {
  const [committedGatheringCompletionInputs, setCommittedGatheringCompletionInputs] = useState(() => ({ generation: 0, allScopedDestinations, activeDestinationArrivals, executeAutoCompleteStop, navTargetId, sessionEligibleMembers, groupId, canEditItinerary, members, t }));
  if (!(Object.is(committedGatheringCompletionInputs.allScopedDestinations, allScopedDestinations) && Object.is(committedGatheringCompletionInputs.activeDestinationArrivals, activeDestinationArrivals) && Object.is(committedGatheringCompletionInputs.executeAutoCompleteStop, executeAutoCompleteStop) && Object.is(committedGatheringCompletionInputs.navTargetId, navTargetId) && Object.is(committedGatheringCompletionInputs.sessionEligibleMembers, sessionEligibleMembers) && Object.is(committedGatheringCompletionInputs.groupId, groupId) && Object.is(committedGatheringCompletionInputs.canEditItinerary, canEditItinerary) && Object.is(committedGatheringCompletionInputs.members, members) && Object.is(committedGatheringCompletionInputs.t, t))) {
    setCommittedGatheringCompletionInputs({ generation: committedGatheringCompletionInputs.generation + 1, allScopedDestinations, activeDestinationArrivals, executeAutoCompleteStop, navTargetId, sessionEligibleMembers, groupId, canEditItinerary, members, t });
  }
  return createElement(CommittedGatheringCompletionCommit, { key: committedGatheringCompletionInputs.generation, canEditItinerary, groupId, allScopedDestinations, navTargetId, remoteAutoCompleteDestIdsRef, completingDestIdsRef, activeDestinationArrivals, sessionEligibleMembers, t, executeAutoCompleteStop, members });
}

function CommittedGatheringCompletionCommit({ canEditItinerary, groupId, allScopedDestinations, navTargetId, remoteAutoCompleteDestIdsRef, completingDestIdsRef, activeDestinationArrivals, sessionEligibleMembers, t, executeAutoCompleteStop, members }: {
  canEditItinerary: boolean;
  groupId: string | null;
  allScopedDestinations: Destination[];
  navTargetId: string | null;
  remoteAutoCompleteDestIdsRef: React.RefObject<Set<string>>;
  completingDestIdsRef: React.RefObject<Set<string>>;
  activeDestinationArrivals: DestinationArrival[];
  sessionEligibleMembers: MemberLocation[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  executeAutoCompleteStop: (destination: Destination) => Promise<void>;
  members: MemberLocation[];
}) {
  useMountEffect(() => {
    if (!canEditItinerary || !groupId) return;
    for (const destination of allScopedDestinations) {
      if (destination.id !== navTargetId) continue;
      if (destination.closedAt) {
        remoteAutoCompleteDestIdsRef.current.delete(destination.id);
        continue;
      }
      if (remoteAutoCompleteDestIdsRef.current.has(destination.id)) continue;
      if (completingDestIdsRef.current.has(destination.id)) continue;

      const arrivedIds = new Set(
        activeDestinationArrivals
          .filter((a) => a.destinationId === destination.id)
          .map((a) => a.userId),
      );
      const counts = deriveScopedArrivalCounts({
        members: sessionEligibleMembers,
        destinationSubgroupId: destination.subgroupId,
        arrivedUserIds: arrivedIds,
        // Remote path: only committed arrivals, never invent self.
        includeUserId: null,
        travelerFallback: t('group.travelerFallback'),
      });
      if (!counts.allArrived) continue;
      void executeAutoCompleteStop(destination);
    }
  });
  return null;
}
