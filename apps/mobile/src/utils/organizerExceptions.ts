/**
 * Organizer Exception Center — pure derived view over existing signals.
 *
 * Sources: navigation member technical state, membership/offline, straggler
 * distance flags, need_help commands, late signals / meet-time overdue.
 * Never treats travel mode, ETA drift, or ordinary progress as exceptions.
 *
 * Product rules:
 * - Same member/session/root-cause is one item (dedupe + firstSeen preserve).
 * - Resolved stays hidden unless includeResolved, OR auto-reopens when the
 *   source produces fresher evidence than handling.updatedAt (recurrence).
 * - After arrival, suppress location/sharing/offline noise; keep needs_help
 *   and force_quit_suspected (still actionable).
 * - Straggler freshness is “last continuous observation start” when the
 *   caller reuses prior lastSeen; evaluation ticks should not rewrite it.
 */

import type { MembershipStatus, MemberRole } from '../types';
import type { NavigationMemberStatus } from '../types/navigation';

export type OrganizerExceptionType =
  | 'late'
  | 'needs_help'
  | 'straggler'
  | 'location_disabled'
  | 'sharing_disabled'
  | 'offline'
  | 'force_quit_suspected';

export type ExceptionHandlingStatus = 'open' | 'acknowledged' | 'resolved';

export type ExceptionAction = 'acknowledge' | 'resolve' | 'reopen';

/** Higher number = more urgent. */
export const EXCEPTION_SEVERITY: Record<OrganizerExceptionType, number> = {
  needs_help: 100,
  force_quit_suspected: 90,
  location_disabled: 80,
  offline: 70,
  sharing_disabled: 60,
  straggler: 50,
  late: 40,
};

/** Technical types suppressed once the member has arrived (quiet post-arrival). */
const POST_ARRIVAL_SUPPRESSED: ReadonlySet<OrganizerExceptionType> = new Set([
  'location_disabled',
  'sharing_disabled',
  'offline',
  'late',
  'straggler',
]);

export interface GatheringPointContext {
  id: string;
  title: string;
}

export interface ExceptionMemberSnapshot {
  userId: string;
  name: string;
  role: MemberRole;
  status: MembershipStatus;
  lastUpdated?: string;
  /** True when this member has already arrived at the current gathering point. */
  arrived?: boolean;
}

export interface NavigationExceptionState {
  userId: string;
  localStatus: NavigationMemberStatus;
  updatedAt: string;
}

export interface StragglerSignal {
  userId: string;
  name: string;
  distanceM: number;
  /** When the straggler was last observed over threshold. Defaults to now. */
  seenAt?: string;
}

export interface TimedMemberSignal {
  userId: string;
  seenAt: string;
}

/**
 * Optional OTA-02-style navigation response. When present, late / needs_help
 * come from here rather than inferred signals only.
 */
export interface NavigationResponseSignal {
  userId: string;
  response: 'acknowledged' | 'late' | 'needs_help';
  updatedAt: string;
}

export interface ExceptionHandlingEntry {
  status: ExceptionHandlingStatus;
  updatedAt: string;
}

/** Root-cause key → handling entry. */
export type ExceptionHandlingMap = Record<string, ExceptionHandlingEntry>;

export interface OrganizerExceptionItem {
  id: string;
  rootCauseKey: string;
  type: OrganizerExceptionType;
  memberId: string;
  memberName: string;
  gatheringPointId: string | null;
  gatheringPointTitle: string | null;
  sessionKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
  severity: number;
  status: ExceptionHandlingStatus;
  availableActions: ExceptionAction[];
  detail?: Record<string, unknown>;
}

/** Prior observation used only to preserve firstSeen across rebuilds. */
export interface PriorExceptionObservation {
  rootCauseKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface BuildOrganizerExceptionsInput {
  groupId: string;
  nowIso: string;
  gatheringPoint: GatheringPointContext | null;
  /** Active navigation session id when present. */
  navigationSessionId?: string | null;
  members: ExceptionMemberSnapshot[];
  navigationMemberStates?: NavigationExceptionState[];
  stragglers?: StragglerSignal[];
  helpSignals?: TimedMemberSignal[];
  lateSignals?: TimedMemberSignal[];
  navigationResponses?: NavigationResponseSignal[];
  handling?: ExceptionHandlingMap;
  priorItems?: PriorExceptionObservation[];
  /**
   * When true, resolved items with an active source stay in the list.
   * Default false so the leader's workload list stays quiet.
   * Note: fresher evidence after resolve auto-reopens regardless.
   */
  includeResolved?: boolean;
  /**
   * Leader user id — never treated as a straggler subject; still may appear
   * for self-reported technical issues only if present in states (usually not).
   */
  leaderUserId?: string;
}

/** Parse ISO timestamps; invalid values yield null (never NaN comparisons). */
export function parseTimeMs(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Prefer the earlier of two ISO timestamps; fall back when either is invalid. */
export function earlierIso(a: string, b: string, fallback: string): string {
  const ma = parseTimeMs(a);
  const mb = parseTimeMs(b);
  if (ma == null && mb == null) return fallback;
  if (ma == null) return b;
  if (mb == null) return a;
  return ma <= mb ? a : b;
}

/** Prefer the later of two ISO timestamps; fall back when either is invalid. */
export function laterIso(a: string, b: string, fallback: string): string {
  const ma = parseTimeMs(a);
  const mb = parseTimeMs(b);
  if (ma == null && mb == null) return fallback;
  if (ma == null) return b;
  if (mb == null) return a;
  return ma >= mb ? a : b;
}

/** Session-scoped key for dedupe within a gathering / navigation episode. */
export function buildSessionKey(input: {
  groupId: string;
  navigationSessionId?: string | null;
  destinationId?: string | null;
}): string {
  if (input.navigationSessionId) return `nav:${input.navigationSessionId}`;
  if (input.destinationId) return `dest:${input.destinationId}`;
  return `group:${input.groupId}`;
}

export function buildRootCauseKey(
  sessionKey: string,
  memberId: string,
  type: OrganizerExceptionType,
): string {
  return `${sessionKey}|${memberId}|${type}`;
}

export function availableActionsFor(
  status: ExceptionHandlingStatus,
): ExceptionAction[] {
  switch (status) {
    case 'open':
      return ['acknowledge', 'resolve'];
    case 'acknowledged':
      return ['resolve', 'reopen'];
    case 'resolved':
      // Reopen only surfaces when includeResolved keeps the row visible.
      return ['reopen'];
    default:
      return ['acknowledge', 'resolve'];
  }
}

/** Map navigation technical status → exception type (or null if not exceptional). */
export function exceptionTypeFromNavStatus(
  status: NavigationMemberStatus,
): OrganizerExceptionType | null {
  switch (status) {
    case 'location_disabled':
    case 'permission_denied':
      return 'location_disabled';
    case 'sharing_disabled':
      return 'sharing_disabled';
    case 'offline':
      return 'offline';
    case 'app_force_quit_suspected':
      return 'force_quit_suspected';
    // Normal progress / terminal — never exceptions.
    case 'pending':
    case 'activity_started':
    case 'tracking_active':
    case 'push_unavailable':
    case 'arriving':
    case 'arrived':
    case 'missed':
    case 'cancelled':
      return null;
    default:
      return null;
  }
}

interface RawCandidate {
  type: OrganizerExceptionType;
  memberId: string;
  memberName: string;
  lastSeenAt: string;
  /**
   * When true, lastSeen is wall-clock rebuild noise (e.g. offline without
   * lastUpdated). Dedupe freezes lastSeen after first observation so resolve
   * is not undone by a 30s tick. Discrete source timestamps leave this false.
   */
  clockDerived?: boolean;
  detail?: Record<string, unknown>;
}

function memberNameMap(
  members: ExceptionMemberSnapshot[],
): Map<string, ExceptionMemberSnapshot> {
  return new Map(members.map((m) => [m.userId, m]));
}

function shouldSuppressAfterArrival(
  type: OrganizerExceptionType,
  arrived: boolean | undefined,
): boolean {
  return !!arrived && POST_ARRIVAL_SUPPRESSED.has(type);
}

/**
 * Collect raw exception candidates from every supported source.
 * Travel mode / ETA / ordinary progress are intentionally absent.
 */
export function collectExceptionCandidates(
  input: BuildOrganizerExceptionsInput,
): RawCandidate[] {
  const {
    members,
    navigationMemberStates = [],
    stragglers = [],
    helpSignals = [],
    lateSignals = [],
    navigationResponses = [],
    nowIso,
    leaderUserId,
  } = input;
  const byId = memberNameMap(members);
  const out: RawCandidate[] = [];

  // 1) Navigation technical states
  for (const state of navigationMemberStates) {
    const type = exceptionTypeFromNavStatus(state.localStatus);
    if (!type) continue;
    const member = byId.get(state.userId);
    if (shouldSuppressAfterArrival(type, member?.arrived)) continue;
    out.push({
      type,
      memberId: state.userId,
      memberName: member?.name ?? state.userId,
      lastSeenAt: state.updatedAt || nowIso,
      detail: { localStatus: state.localStatus },
    });
  }

  // 2) Membership offline (group presence)
  for (const member of members) {
    if (member.status !== 'offline') continue;
    if (shouldSuppressAfterArrival('offline', member.arrived)) continue;
    const hasSourceTs = !!member.lastUpdated && parseTimeMs(member.lastUpdated) != null;
    out.push({
      type: 'offline',
      memberId: member.userId,
      memberName: member.name,
      lastSeenAt: hasSourceTs ? (member.lastUpdated as string) : nowIso,
      // Without lastUpdated, wall-clock must not count as new evidence after resolve.
      clockDerived: !hasSourceTs,
      detail: { source: 'membership' },
    });
  }

  // 3) Stragglers (leader distance judgment)
  for (const s of stragglers) {
    if (leaderUserId && s.userId === leaderUserId) continue;
    const member = byId.get(s.userId);
    if (shouldSuppressAfterArrival('straggler', member?.arrived)) continue;
    out.push({
      type: 'straggler',
      memberId: s.userId,
      memberName: member?.name ?? s.name,
      lastSeenAt: s.seenAt ?? nowIso,
      detail: { distanceM: s.distanceM },
    });
  }

  // 4) Navigation responses (OTA-02) — late / needs_help
  for (const r of navigationResponses) {
    if (r.response === 'late') {
      const member = byId.get(r.userId);
      if (shouldSuppressAfterArrival('late', member?.arrived)) continue;
      out.push({
        type: 'late',
        memberId: r.userId,
        memberName: member?.name ?? r.userId,
        lastSeenAt: r.updatedAt,
        detail: { source: 'navigation_response' },
      });
    } else if (r.response === 'needs_help') {
      // needs_help always surfaces — arrival does not cancel a help request.
      out.push({
        type: 'needs_help',
        memberId: r.userId,
        memberName: byId.get(r.userId)?.name ?? r.userId,
        lastSeenAt: r.updatedAt,
        detail: { source: 'navigation_response' },
      });
    }
    // 'acknowledged' is not an exception
  }

  // 5) Quick-command help signals — always actionable
  for (const h of helpSignals) {
    out.push({
      type: 'needs_help',
      memberId: h.userId,
      memberName: byId.get(h.userId)?.name ?? h.userId,
      lastSeenAt: h.seenAt,
      detail: { source: 'command_need_help' },
    });
  }

  // 6) Explicit late signals (meet-time overdue not arrived, or push)
  for (const late of lateSignals) {
    const member = byId.get(late.userId);
    if (shouldSuppressAfterArrival('late', member?.arrived)) continue;
    out.push({
      type: 'late',
      memberId: late.userId,
      memberName: member?.name ?? late.userId,
      lastSeenAt: late.seenAt,
      detail: { source: 'late_signal' },
    });
  }

  return out;
}

/**
 * Dedupe by root-cause key: keep earliest firstSeen, latest lastSeen,
 * merge detail shallowly. Malformed timestamps fall back safely.
 */
export function dedupeExceptionCandidates(
  candidates: RawCandidate[],
  sessionKey: string,
  prior: PriorExceptionObservation[] = [],
  nowIsoFallback = new Date().toISOString(),
): Array<RawCandidate & { rootCauseKey: string; firstSeenAt: string }> {
  const priorFirst = new Map(prior.map((p) => [p.rootCauseKey, p.firstSeenAt]));
  const priorLast = new Map(prior.map((p) => [p.rootCauseKey, p.lastSeenAt]));
  const map = new Map<
    string,
    RawCandidate & { rootCauseKey: string; firstSeenAt: string }
  >();

  for (const c of candidates) {
    const key = buildRootCauseKey(sessionKey, c.memberId, c.type);
    const parsedLast = parseTimeMs(c.lastSeenAt) != null ? c.lastSeenAt : nowIsoFallback;
    // Clock-derived signals freeze lastSeen after first observation so pure
    // wall-clock ticks are not "new evidence" for auto-reopen.
    const frozenPrior = priorLast.get(key);
    const safeLast =
      c.clockDerived && frozenPrior && parseTimeMs(frozenPrior) != null
        ? frozenPrior
        : parsedLast;
    const existing = map.get(key);
    if (!existing) {
      const priorFirstSeen = priorFirst.get(key);
      const firstSeenAt = priorFirstSeen
        ? earlierIso(priorFirstSeen, safeLast, safeLast)
        : safeLast;
      map.set(key, {
        ...c,
        lastSeenAt: safeLast,
        rootCauseKey: key,
        firstSeenAt,
      });
      continue;
    }
    const nextLast = c.clockDerived
      ? existing.lastSeenAt
      : laterIso(safeLast, existing.lastSeenAt, safeLast);
    map.set(key, {
      ...existing,
      memberName: c.memberName || existing.memberName,
      lastSeenAt: nextLast,
      firstSeenAt: earlierIso(safeLast, existing.firstSeenAt, existing.firstSeenAt),
      detail: { ...existing.detail, ...c.detail },
      clockDerived: existing.clockDerived || c.clockDerived,
    });
  }

  return Array.from(map.values());
}

/**
 * Sort by severity desc, then lastSeen desc, then rootCauseKey asc (stable ties).
 * Invalid timestamps sort as older than any valid time (stable string fallback).
 */
export function sortOrganizerExceptions<
  T extends { severity: number; lastSeenAt: string; rootCauseKey: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    const tb = parseTimeMs(b.lastSeenAt);
    const ta = parseTimeMs(a.lastSeenAt);
    if (tb != null && ta != null && tb !== ta) return tb - ta;
    if (tb != null && ta == null) return 1;
    if (tb == null && ta != null) return -1;
    return a.rootCauseKey.localeCompare(b.rootCauseKey);
  });
}

/**
 * Apply handling status. Resolving does not mutate team phase or member state —
 * only the handling map overlay.
 */
export function applyHandlingStatus(
  status: ExceptionHandlingStatus | undefined,
): ExceptionHandlingStatus {
  return status ?? 'open';
}

/**
 * Effective handling for an active candidate:
 * - missing → open
 * - resolved + fresher source evidence than handling.updatedAt → open (recurrence)
 * - otherwise stored status
 */
export function resolveEffectiveHandling(
  entry: ExceptionHandlingEntry | undefined,
  lastSeenAt: string,
): ExceptionHandlingStatus {
  if (!entry) return 'open';
  if (entry.status !== 'resolved') return entry.status;
  const seenMs = parseTimeMs(lastSeenAt);
  const handledMs = parseTimeMs(entry.updatedAt);
  if (seenMs != null && handledMs != null && seenMs > handledMs) {
    return 'open';
  }
  return 'resolved';
}

/**
 * Pure merge for marking acknowledge / resolve / reopen.
 * Does not touch group journey, arrivals, or navigation member rows.
 */
export function transitionExceptionHandling(
  map: ExceptionHandlingMap,
  rootCauseKey: string,
  action: ExceptionAction,
  nowIso: string,
): ExceptionHandlingMap {
  const nextStatus: ExceptionHandlingStatus =
    action === 'acknowledge'
      ? 'acknowledged'
      : action === 'resolve'
        ? 'resolved'
        : 'open';
  return {
    ...map,
    [rootCauseKey]: { status: nextStatus, updatedAt: nowIso },
  };
}

/**
 * Merge prior observations so firstSeen survives temporary hide (resolve,
 * straggler hysteresis). Keeps keys still active or still in handling map.
 */
export function mergePriorObservations(
  previous: PriorExceptionObservation[],
  current: PriorExceptionObservation[],
  handlingKeys: Iterable<string> = [],
): PriorExceptionObservation[] {
  const byKey = new Map(previous.map((p) => [p.rootCauseKey, p]));
  for (const c of current) {
    const prev = byKey.get(c.rootCauseKey);
    if (!prev) {
      byKey.set(c.rootCauseKey, c);
      continue;
    }
    byKey.set(c.rootCauseKey, {
      rootCauseKey: c.rootCauseKey,
      firstSeenAt: earlierIso(prev.firstSeenAt, c.firstSeenAt, c.firstSeenAt),
      lastSeenAt: laterIso(prev.lastSeenAt, c.lastSeenAt, c.lastSeenAt),
    });
  }
  const retain = new Set<string>([
    ...current.map((c) => c.rootCauseKey),
    ...handlingKeys,
  ]);
  return Array.from(byKey.values()).filter((p) => retain.has(p.rootCauseKey));
}

/**
 * Build the leader-facing exception list from active source signals + handling.
 */
export function buildOrganizerExceptions(
  input: BuildOrganizerExceptionsInput,
): OrganizerExceptionItem[] {
  const sessionKey = buildSessionKey({
    groupId: input.groupId,
    navigationSessionId: input.navigationSessionId,
    destinationId: input.gatheringPoint?.id ?? null,
  });
  const candidates = collectExceptionCandidates(input);
  const deduped = dedupeExceptionCandidates(
    candidates,
    sessionKey,
    input.priorItems,
    input.nowIso,
  );
  const handling = input.handling ?? {};
  const includeResolved = input.includeResolved ?? false;
  const gp = input.gatheringPoint;

  const items: OrganizerExceptionItem[] = [];
  for (const c of deduped) {
    const status = resolveEffectiveHandling(handling[c.rootCauseKey], c.lastSeenAt);
    if (!includeResolved && status === 'resolved') continue;
    items.push({
      id: c.rootCauseKey,
      rootCauseKey: c.rootCauseKey,
      type: c.type,
      memberId: c.memberId,
      memberName: c.memberName,
      gatheringPointId: gp?.id ?? null,
      gatheringPointTitle: gp?.title ?? null,
      sessionKey,
      firstSeenAt: c.firstSeenAt,
      lastSeenAt: c.lastSeenAt,
      severity: EXCEPTION_SEVERITY[c.type],
      status,
      availableActions: availableActionsFor(status),
      detail: c.detail,
    });
  }

  // Workload first: open/ack before resolved; within band use severity/freshness.
  const ranked = sortOrganizerExceptions(items);
  return ranked.sort((a, b) => {
    const band = (s: ExceptionHandlingStatus) =>
      s === 'open' ? 0 : s === 'acknowledged' ? 1 : 2;
    const d = band(a.status) - band(b.status);
    if (d !== 0) return d;
    return 0; // preserve severity/freshness order from prior sort (stable)
  });
}

/**
 * Derive late signals for members who have not arrived when meet time is overdue.
 * This is a meet-time gate, not ETA drift — ordinary progress never produces late.
 *
 * `seenAt` is the overdue threshold moment (meetAt + grace), not wall-clock
 * `nowIso`. Pure clock ticks must not look like new evidence after resolve.
 */
export function lateSignalsFromMeetTime(input: {
  meetAtIso: string | null | undefined;
  nowIso: string;
  members: ExceptionMemberSnapshot[];
  /** Grace minutes after meetAt before counting as late. Default 0. */
  graceMinutes?: number;
}): TimedMemberSignal[] {
  const { meetAtIso, nowIso, members, graceMinutes = 0 } = input;
  if (!meetAtIso) return [];
  const meetMs = parseTimeMs(meetAtIso);
  const nowMs = parseTimeMs(nowIso);
  if (meetMs == null || nowMs == null) return [];
  const overdueAtMs = meetMs + graceMinutes * 60_000;
  if (nowMs < overdueAtMs) return [];

  // Stable for the whole overdue episode — advances only when meetAt/grace change.
  const overdueAtIso = new Date(overdueAtMs).toISOString();

  return members
    .filter((m) => m.role !== 'leader' && !m.arrived && m.status !== 'arrived')
    .map((m) => ({
      userId: m.userId,
      seenAt: overdueAtIso,
    }));
}
