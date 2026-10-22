/**
 * Leader-only Organizer Exception Center.
 *
 * Derives a sorted, deduped exception list from group membership, navigation
 * technical states, straggler flags, need_help commands (historical + live),
 * and meet-time late signals. Handling state is local (AsyncStorage) and does
 * not mutate team phase or another member's personal state.
 */

import { useForegroundReconcile } from './useForegroundReconcile';
import { AppState } from 'react-native';
import { createElement, Fragment, useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
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
  lifecycle: ReactElement;
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
    lastUpdated: m.lastUpdated ?? undefined,
    arrived: arrivedUserIds?.has(m.userId) || m.status === 'arrived',
  }));
}

function mapHelpRows(
  rows: Array<{ sender_id?: string; created_at?: string }> | null,
  leaderUserId: string,
  previous: TimedMemberSignal[] = [],
): TimedMemberSignal[] {
  const byUser = new Map<string, string>();
  for (const row of [...previous.map(signal => ({ sender_id: signal.userId, created_at: signal.seenAt })), ...(rows ?? [])]) {
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

function useOrganizerExceptionsOwner(
  options: UseOrganizerExceptionsOptions,
) {
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

  const effectiveNowMs = nowMs ?? nowTick;
  const nowIso = new Date(effectiveNowMs).toISOString();

  // Hydrate handling state. Soft prune keeps dest/nav keys for the same stop.

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

  const foregroundLifecycle = useForegroundReconcile(enabled && Boolean(navigationSessionId), refreshNavStates);

  // Seed historical need_help + subscribe to live inserts.

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
    enabled, groupId, navigationSessionId, gatheringPoint, leaderUserId, nowMs, nowIso, stragglers, exceptions, handling, priorRef, stragglerSeenRef, sessionGenRef, refreshNavStates, setHandling, setNavStates, setHelpSignals, setNowTick, setStragglerSeenMap, foregroundLifecycle,
    snapshot: {
      exceptions,
      openCount,
      handling,
      pendingKeys,
      markHandled,
      refreshNavStates,
    },
  };
}

/** Pure helper exported for tests — maps seed query rows. */
export function __mapHelpRowsForTests(
  rows: Array<{ sender_id?: string; created_at?: string }> | null,
  leaderUserId: string,
  previous: TimedMemberSignal[] = [],
): TimedMemberSignal[] {
  return mapHelpRows(rows, leaderUserId, previous);
}

/** @internal test: root cause key builder re-export */
export { buildRootCauseKey };

type OrganizerOwner = ReturnType<typeof useOrganizerExceptionsOwner>;

function OrganizerSoftClock({ owner }: { owner: OrganizerOwner }) {
  const { enabled, groupId, nowMs, setNowTick } = owner;
  useMountEffect(() => {
    if (nowMs != null) return;
    if (!enabled || !groupId) return;
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);

  });
  return null;
}

function OrganizerHandlingHydration({ owner }: { owner: OrganizerOwner }) {
  const { enabled, groupId, navigationSessionId, gatheringPoint, setHandling } = owner;
  useMountEffect(() => {
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

  });
  return null;
}

function OrganizerNavigationStates({ owner }: { owner: OrganizerOwner }) {
  const { enabled, navigationSessionId, sessionGenRef, refreshNavStates, setNavStates } = owner;
  useMountEffect(() => {
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
        onReady: () => { if (!cancelled && sessionGenRef.current === gen) void refreshNavStates(); },
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

  });
  return null;
}

function OrganizerHelpSignals({ owner }: { owner: OrganizerOwner }) {
  const { enabled, groupId, leaderUserId, setHelpSignals } = owner;
  useMountEffect(() => {
    // Always clear when deps change so a group switch cannot leak signals.
    setHelpSignals([]);
    if (!enabled || !groupId || !leaderUserId) {
      return;
    }
    let cancelled = false;
    const since = new Date(
      Date.now() - HELP_SIGNAL_LOOKBACK_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const reloadHelp = async () => {
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
        setHelpSignals(previous =>
          mapHelpRows(
            data as Array<{ sender_id?: string; created_at?: string }> | null,
            leaderUserId,
            previous,
          ),
        );
      } catch {
        // Soft-fail: live subscription still covers new help after mount.
      }
    };
    void reloadHelp();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void reloadHelp(); }, 30_000);
    const resumed = AppState.addEventListener('change', state => { if (state === 'active') void reloadHelp(); });

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
          setHelpSignals(prev => mapHelpRows([{ sender_id: row.sender_id, created_at: seenAt }], leaderUserId, prev));
        },
      )
      .subscribe(status => { if (!cancelled && status === 'SUBSCRIBED') void reloadHelp(); });
    return () => {
      cancelled = true;
      clearInterval(timer);
      resumed.remove();
      void supabase.removeChannel(channel);
    };

  });
  return null;
}

function OrganizerStragglerObservation({ owner }: { owner: OrganizerOwner }) {
  const { nowIso, stragglers, stragglerSeenRef, setStragglerSeenMap } = owner;
  useMountEffect(() => {
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

  });
  return null;
}

function OrganizerPriorObservation({ owner }: { owner: OrganizerOwner }) {
  const { exceptions, handling, priorRef } = owner;
  useMountEffect(() => {
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

  });
  return null;
}

function OrganizerLifecycle({ owner }: { owner: OrganizerOwner }) {
  const destinationId = owner.gatheringPoint?.id;
  const [clockInput, setClockInput] = useState({ enabled: owner.enabled, groupId: owner.groupId, nowMs: owner.nowMs, generation: 0 });
  if (!Object.is(clockInput.enabled, owner.enabled) || !Object.is(clockInput.groupId, owner.groupId) || !Object.is(clockInput.nowMs, owner.nowMs)) {
    setClockInput({ enabled: owner.enabled, groupId: owner.groupId, nowMs: owner.nowMs, generation: clockInput.generation + 1 });
  }
  const [handlingInput, setHandlingInput] = useState({ enabled: owner.enabled, groupId: owner.groupId, navigationSessionId: owner.navigationSessionId, destinationId: destinationId, generation: 0 });
  if (!Object.is(handlingInput.enabled, owner.enabled) || !Object.is(handlingInput.groupId, owner.groupId) || !Object.is(handlingInput.navigationSessionId, owner.navigationSessionId) || !Object.is(handlingInput.destinationId, destinationId)) {
    setHandlingInput({ enabled: owner.enabled, groupId: owner.groupId, navigationSessionId: owner.navigationSessionId, destinationId: destinationId, generation: handlingInput.generation + 1 });
  }
  const [navigationInput, setNavigationInput] = useState({ enabled: owner.enabled, navigationSessionId: owner.navigationSessionId, refreshNavStates: owner.refreshNavStates, generation: 0 });
  if (!Object.is(navigationInput.enabled, owner.enabled) || !Object.is(navigationInput.navigationSessionId, owner.navigationSessionId) || !Object.is(navigationInput.refreshNavStates, owner.refreshNavStates)) {
    setNavigationInput({ enabled: owner.enabled, navigationSessionId: owner.navigationSessionId, refreshNavStates: owner.refreshNavStates, generation: navigationInput.generation + 1 });
  }
  const [helpInput, setHelpInput] = useState({ enabled: owner.enabled, groupId: owner.groupId, leaderUserId: owner.leaderUserId, generation: 0 });
  if (!Object.is(helpInput.enabled, owner.enabled) || !Object.is(helpInput.groupId, owner.groupId) || !Object.is(helpInput.leaderUserId, owner.leaderUserId)) {
    setHelpInput({ enabled: owner.enabled, groupId: owner.groupId, leaderUserId: owner.leaderUserId, generation: helpInput.generation + 1 });
  }
  const [stragglersInput, setStragglersInput] = useState({ stragglers: owner.stragglers, nowIso: owner.nowIso, generation: 0 });
  if (!Object.is(stragglersInput.stragglers, owner.stragglers) || !Object.is(stragglersInput.nowIso, owner.nowIso)) {
    setStragglersInput({ stragglers: owner.stragglers, nowIso: owner.nowIso, generation: stragglersInput.generation + 1 });
  }
  const [priorInput, setPriorInput] = useState({ exceptions: owner.exceptions, handling: owner.handling, generation: 0 });
  if (!Object.is(priorInput.exceptions, owner.exceptions) || !Object.is(priorInput.handling, owner.handling)) {
    setPriorInput({ exceptions: owner.exceptions, handling: owner.handling, generation: priorInput.generation + 1 });
  }
  return createElement(Fragment, null,
    createElement(Fragment, { key: 'organizer-foreground' }, owner.foregroundLifecycle),
    createElement(OrganizerSoftClock, { key: 'clock:' + clockInput.generation, owner }),
    createElement(OrganizerHandlingHydration, { key: 'handling:' + handlingInput.generation, owner }),
    createElement(OrganizerNavigationStates, { key: 'navigation:' + navigationInput.generation, owner }),
    createElement(OrganizerHelpSignals, { key: 'help:' + helpInput.generation, owner }),
    createElement(OrganizerStragglerObservation, { key: 'stragglers:' + stragglersInput.generation, owner }),
    createElement(OrganizerPriorObservation, { key: 'prior:' + priorInput.generation, owner }),
  );
}

export function useOrganizerExceptions(options: UseOrganizerExceptionsOptions): UseOrganizerExceptionsResult {
  const owner = useOrganizerExceptionsOwner(options);
  return { ...owner.snapshot, lifecycle: createElement(OrganizerLifecycle, { owner }) };
}
