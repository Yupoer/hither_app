/**
 * Leader-only Organizer Exception Center.
 *
 * Derives a sorted, deduped exception list from group membership, navigation
 * technical states, straggler flags, need_help commands (historical + live),
 * and meet-time late signals. Handling state is local (AsyncStorage) and does
 * not mutate team phase or another member's personal state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../api/supabase';
import {
  listNavigationMemberStates,
  subscribeSessionMemberStates,
} from '../api/services/NavigationService';
import type { Destination, GroupState, MemberLocation } from '../types';
import type { MemberNavigationState } from '../types/navigation';
import type { Straggler } from '../utils/straggler';
import {
  buildOrganizerExceptions,
  buildRootCauseKey,
  buildSessionKey,
  lateSignalsFromMeetTime,
  mergePriorObservations,
  parseTimeMs,
  type ExceptionAction,
  type ExceptionHandlingMap,
  type NavigationResponseSignal,
  type OrganizerExceptionItem,
  type PriorExceptionObservation,
  type TimedMemberSignal,
} from '../utils/organizerExceptions';
import {
  applyExceptionHandlingAction,
  getCachedExceptionHandling,
  loadExceptionHandling,
  pruneExceptionHandlingForSession,
} from './exceptionHandlingStore';

/** Look back window for seeding need_help commands after cold start. */
export const HELP_SIGNAL_LOOKBACK_HOURS = 12;

export interface UseOrganizerExceptionsOptions {
  enabled?: boolean;
  groupId: string | null;
  groupState: GroupState | null;
  /** Active gathering point (next destination / session target). */
  gatheringPoint: Destination | null | undefined;
  navigationSessionId?: string | null;
  stragglers?: Straggler[];
  /** Destination arrivals for "already arrived" late exclusion. */
  arrivedUserIds?: ReadonlySet<string>;
  leaderUserId?: string;
  /** Optional OTA-02 navigation responses when available. */
  navigationResponses?: NavigationResponseSignal[];
  /** Tick clock for meet-time late (ms). Defaults to live Date.now. */
  nowMs?: number;
}

export interface UseOrganizerExceptionsResult {
  exceptions: OrganizerExceptionItem[];
  openCount: number;
  handling: ExceptionHandlingMap;
  /** rootCauseKeys currently mutating (disable chips in UI). */
  pendingKeys: ReadonlySet<string>;
  markHandled: (
    rootCauseKey: string,
    action: ExceptionAction,
  ) => Promise<boolean>;
  refreshNavStates: () => Promise<void>;
}

function toMemberSnapshots(
  members: MemberLocation[],
  arrivedUserIds: ReadonlySet<string> | undefined,
) {
  return members.map((m) => ({
    userId: m.userId,
    name: m.name,
    role: m.role,
    status: m.status,
    lastUpdated: m.lastUpdated,
    arrived: arrivedUserIds?.has(m.userId) || m.status === 'arrived',
  }));
}

function mapHelpRows(
  rows: Array<{ sender_id?: string; created_at?: string }> | null,
  leaderUserId: string,
): TimedMemberSignal[] {
  if (!rows?.length) return [];
  const byUser = new Map<string, string>();
  for (const row of rows) {
    if (!row.sender_id || row.sender_id === leaderUserId) continue;
    const seenAt = row.created_at ?? new Date().toISOString();
    const seenMs = parseTimeMs(seenAt);
    if (seenMs == null) continue;
    const prev = byUser.get(row.sender_id);
    const prevMs = prev ? parseTimeMs(prev) : null;
    if (prevMs == null || seenMs > prevMs) {
      byUser.set(row.sender_id, seenAt);
    }
  }
  return Array.from(byUser.entries()).map(([userId, seenAt]) => ({
    userId,
    seenAt,
  }));
}

export function useOrganizerExceptions(
  options: UseOrganizerExceptionsOptions,
): UseOrganizerExceptionsResult {
  const {
    enabled = true,
    groupId,
    groupState,
    gatheringPoint,
    navigationSessionId = null,
    stragglers = [],
    arrivedUserIds,
    leaderUserId,
    navigationResponses,
    nowMs,
  } = options;

  const [handling, setHandling] = useState<ExceptionHandlingMap>({});
  const [navStates, setNavStates] = useState<MemberNavigationState[]>([]);
  const [helpSignals, setHelpSignals] = useState<TimedMemberSignal[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const priorRef = useRef<PriorExceptionObservation[]>([]);
  /** Continuous straggler observation start — not rewritten every 30s tick. */
  const stragglerSeenRef = useRef<Map<string, string>>(new Map());
  /** Snapshot of straggler seenAt map for render (updated in effect, not useMemo). */
  const [stragglerSeenMap, setStragglerSeenMap] = useState<Record<string, string>>(
    {},
  );
  const sessionGenRef = useRef(0);

  // External clock override (tests) or soft 30s tick for meet-time late.
  useEffect(() => {
    if (nowMs != null) return;
    if (!enabled || !groupId) return;
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [enabled, groupId, nowMs]);

  const effectiveNowMs = nowMs ?? nowTick;
  const nowIso = new Date(effectiveNowMs).toISOString();

  // Hydrate handling state. Soft prune keeps dest/nav keys for the same stop.
  useEffect(() => {
    if (!enabled || !groupId) {
      setHandling({});
      return;
    }
    let cancelled = false;
    const sessionKey = buildSessionKey({
      groupId,
      navigationSessionId,
      destinationId: gatheringPoint?.id ?? null,
    });
    void (async () => {
      await loadExceptionHandling(groupId);
      const pruned = await pruneExceptionHandlingForSession(groupId, sessionKey, {
        destinationId: gatheringPoint?.id ?? null,
      });
      if (!cancelled) setHandling(pruned);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, groupId, navigationSessionId, gatheringPoint?.id]);

  // Load + subscribe navigation member technical states for the active session.
  const refreshNavStates = useCallback(async () => {
    if (!enabled || !navigationSessionId) {
      setNavStates([]);
      return;
    }
    const gen = sessionGenRef.current;
    const sessionAtStart = navigationSessionId;
    try {
      const rows = await listNavigationMemberStates(sessionAtStart);
      // Invalidate if gen advanced (session end/disable/swap) or session id changed.
      if (sessionGenRef.current !== gen) return;
      if (sessionAtStart !== navigationSessionId) return;
      setNavStates(rows);
    } catch {
      // Soft-fail: exception center is derived; missing nav states just means
      // fewer technical items until the next refresh.
    }
  }, [enabled, navigationSessionId]);

  useEffect(() => {
    // Always bump generation on every dep change — including session→none /
    // disable — so in-flight listNavigationMemberStates cannot repopulate
    // after the intentional clear.
    const gen = ++sessionGenRef.current;
    setNavStates([]);
    if (!enabled || !navigationSessionId) {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void refreshNavStates();
    void subscribeSessionMemberStates(
      navigationSessionId,
      (state) => {
        if (cancelled || sessionGenRef.current !== gen) return;
        setNavStates((prev) => {
          const idx = prev.findIndex((s) => s.userId === state.userId);
          if (idx < 0) return [...prev, state];
          const next = prev.slice();
          next[idx] = state;
          return next;
        });
      },
      {
        onRemove: (userId) => {
          if (cancelled || sessionGenRef.current !== gen) return;
          setNavStates((prev) => prev.filter((s) => s.userId !== userId));
        },
      },
    )
      .then((cleanup) => {
        if (cancelled) cleanup();
        else unsubscribe = cleanup;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      // Bump again on cleanup so a racing refresh from this generation dies.
      if (sessionGenRef.current === gen) {
        sessionGenRef.current += 1;
      }
      unsubscribe?.();
    };
  }, [enabled, navigationSessionId, refreshNavStates]);

  // Seed historical need_help + subscribe to live inserts.
  useEffect(() => {
    // Always clear when deps change so a group switch cannot leak signals.
    setHelpSignals([]);
    if (!enabled || !groupId || !leaderUserId) {
      return;
    }
    let cancelled = false;
    const since = new Date(
      Date.now() - HELP_SIGNAL_LOOKBACK_HOURS * 60 * 60 * 1000,
    ).toISOString();

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('commands')
          .select('sender_id, created_at, type')
          .eq('group_id', groupId)
          .eq('type', 'need_help')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(50);
        if (cancelled || error) return;
        setHelpSignals(
          mapHelpRows(
            data as Array<{ sender_id?: string; created_at?: string }> | null,
            leaderUserId,
          ),
        );
      } catch {
        // Soft-fail: live subscription still covers new help after mount.
      }
    })();

    const channel = supabase
      .channel(`exception-help:${groupId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'commands',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as {
            sender_id?: string;
            type?: string;
            created_at?: string;
          };
          if (row.type !== 'need_help' || !row.sender_id) return;
          if (row.sender_id === leaderUserId) return;
          const seenAt = row.created_at ?? new Date().toISOString();
          setHelpSignals((prev) => {
            const without = prev.filter((s) => s.userId !== row.sender_id);
            return [...without, { userId: row.sender_id!, seenAt }];
          });
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [enabled, groupId, leaderUserId]);

  const members = groupState?.members ?? [];

  const lateSignals = useMemo(() => {
    if (!enabled || !gatheringPoint?.meetAt) return [];
    return lateSignalsFromMeetTime({
      meetAtIso: gatheringPoint.meetAt,
      nowIso,
      members: toMemberSnapshots(members, arrivedUserIds),
    });
  }, [enabled, gatheringPoint?.meetAt, nowIso, members, arrivedUserIds]);

  // Stabilize straggler seenAt outside render: first continuous observation only.
  // Re-entry after leave starts a new episode.
  useEffect(() => {
    const activeIds = new Set(stragglers.map((s) => s.userId));
    let changed = false;
    for (const id of Array.from(stragglerSeenRef.current.keys())) {
      if (!activeIds.has(id)) {
        stragglerSeenRef.current.delete(id);
        changed = true;
      }
    }
    for (const s of stragglers) {
      if (!stragglerSeenRef.current.has(s.userId)) {
        stragglerSeenRef.current.set(s.userId, nowIso);
        changed = true;
      }
    }
    if (changed) {
      const next: Record<string, string> = {};
      stragglerSeenRef.current.forEach((v, k) => {
        next[k] = v;
      });
      setStragglerSeenMap(next);
    }
  }, [stragglers, nowIso]);

  const stragglerSignals = useMemo(
    () =>
      stragglers.map((s) => ({
        userId: s.userId,
        name: s.name,
        distanceM: s.distanceM,
        // Prefer effect-backed map; fall back to now only on the first paint
        // before the effect runs (firstSeen still preserved via prior merge).
        seenAt: stragglerSeenMap[s.userId] ?? nowIso,
      })),
    [stragglers, stragglerSeenMap, nowIso],
  );

  const exceptions = useMemo(() => {
    if (!enabled || !groupId || !groupState) return [];
    // includeResolved: true so mis-tapped resolve can reopen; UI styles muted.
    return buildOrganizerExceptions({
      groupId,
      nowIso,
      gatheringPoint: gatheringPoint
        ? { id: gatheringPoint.id, title: gatheringPoint.title }
        : null,
      navigationSessionId,
      members: toMemberSnapshots(members, arrivedUserIds),
      navigationMemberStates: navStates.map((s) => ({
        userId: s.userId,
        localStatus: s.localStatus,
        updatedAt: s.updatedAt,
      })),
      stragglers: stragglerSignals,
      helpSignals,
      lateSignals,
      navigationResponses,
      handling: Object.keys(handling).length
        ? handling
        : groupId
          ? getCachedExceptionHandling(groupId)
          : {},
      priorItems: priorRef.current,
      leaderUserId,
      includeResolved: true,
    });
  }, [
    enabled,
    groupId,
    groupState,
    gatheringPoint,
    navigationSessionId,
    members,
    arrivedUserIds,
    navStates,
    stragglerSignals,
    helpSignals,
    lateSignals,
    navigationResponses,
    handling,
    leaderUserId,
    nowIso,
  ]);

  // Preserve firstSeen outside render (no side effects inside useMemo).
  useEffect(() => {
    const current: PriorExceptionObservation[] = exceptions.map((i) => ({
      rootCauseKey: i.rootCauseKey,
      firstSeenAt: i.firstSeenAt,
      lastSeenAt: i.lastSeenAt,
    }));
    priorRef.current = mergePriorObservations(
      priorRef.current,
      current,
      Object.keys(handling),
    );
  }, [exceptions, handling]);

  const openCount = useMemo(
    () =>
      exceptions.filter((e) => e.status === 'open' || e.status === 'acknowledged')
        .length,
    [exceptions],
  );

  const markHandled = useCallback(
    async (rootCauseKey: string, action: ExceptionAction): Promise<boolean> => {
      if (!groupId) return false;
      setPendingKeys((prev) => new Set(prev).add(rootCauseKey));
      try {
        const next = await applyExceptionHandlingAction(
          groupId,
          rootCauseKey,
          action,
          new Date().toISOString(),
        );
        setHandling(next);
        return true;
      } catch {
        // Soft-fail: list stays on previous handling; no team state mutated.
        return false;
      } finally {
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(rootCauseKey);
          return next;
        });
      }
    },
    [groupId],
  );

  return {
    exceptions,
    openCount,
    handling,
    pendingKeys,
    markHandled,
    refreshNavStates,
  };
}

/** Pure helper exported for tests — maps seed query rows. */
export function __mapHelpRowsForTests(
  rows: Array<{ sender_id?: string; created_at?: string }> | null,
  leaderUserId: string,
): TimedMemberSignal[] {
  return mapHelpRows(rows, leaderUserId);
}

/** @internal test: root cause key builder re-export */
export { buildRootCauseKey };
