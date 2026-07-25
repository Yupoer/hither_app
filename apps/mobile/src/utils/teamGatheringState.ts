/**
 * OTA-01 team gathering state machine (pure) — map / session projection SoT.
 *
 * Two layers:
 * - Global `journeyPhase`: staying | en_route
 * - Point `pointStatus`: pending → en_route → completed
 *
 * Only two pressable team actions: Start and End. 「前往中」 is display-only.
 * Travel mode / ETA / location / personal arrival / progress stay user-scoped
 * and must never rewrite team phase (see personal overlay helpers).
 *
 * Projection reuses existing authoritative fields:
 * groups.journey_status, groups.active_destination_id, navigation session,
 * itinerary_items.closed_at — no parallel broadcast model.
 *
 * Layering vs `activeGatheringState` (OTA-04 local-first entity):
 * - This module is the live UI projection (session + group + itinerary).
 * - `activeGatheringState` is the offline outbox entity shape.
 * - End semantics are aligned: clear active id, next stays pending, phase staying.
 */

/** Global flock travel phase — no clickable "started" phase. */
export type JourneyPhase = 'staying' | 'en_route';

/** Single gathering-point lifecycle. */
export type PointStatus = 'pending' | 'en_route' | 'completed';

export type TeamGatheringTransition = 'start' | 'end';

export type TeamGatheringRejectReason =
  | 'not_leader'
  | 'invalid_transition'
  | 'duplicate_transition'
  | 'stale_version'
  | 'unknown_point'
  | 'point_not_pending'
  | 'point_not_en_route'
  | 'global_not_staying'
  | 'global_not_en_route'
  | 'another_point_en_route'
  | 'no_active_point';

export interface TeamGatheringPointSnapshot {
  id: string;
  /** Itinerary order (ascending). */
  order: number;
  status: PointStatus;
  closedAt?: string | null;
}

export interface TeamGatheringState {
  journeyPhase: JourneyPhase;
  /** Destination currently en_route, if any. */
  activePointId: string | null;
  /** Next pending point that may receive Start while staying. */
  nextPendingPointId: string | null;
  points: TeamGatheringPointSnapshot[];
  /**
   * Optimistic concurrency token from authoritative server fields only.
   * Prefer active navigation session version; while staying use completed count
   * (re-projection after apply* should re-read server, not local +1).
   */
  version: number;
  phaseChangedAt?: string | null;
  /**
   * True when an active navigation session exists (authoritative for Start block).
   * May disagree with point status when session dest is closed/missing from list.
   */
  hasActiveSession: boolean;
}

export interface ProjectTeamGatheringInput {
  /**
   * Legacy / group row: 'going' | 'paused'.
   * Prefer live navigation session when present.
   */
  journeyStatus?: 'going' | 'paused' | null;
  activeDestinationId?: string | null;
  journeyStartedAt?: string | null;
  /** Active navigation session destination (authoritative when status=active). */
  navigationSession?: {
    destinationId: string;
    status: string;
    version: number;
    startedAt?: string | null;
  } | null;
  destinations: Array<{
    id: string;
    order: number;
    closedAt?: string | null;
  }>;
}

/** Personal (user-scoped) overlay — never written into team state. */
export interface PersonalGatheringProgress {
  userId: string;
  travelMode?: 'walk' | 'drive' | 'transit' | string | null;
  /** Rough hint only; not a completion criterion. */
  etaSeconds?: number | null;
  location?: { latitude: number; longitude: number } | null;
  arrived?: boolean;
  progress?: number | null;
  distanceMeters?: number | null;
}

export interface TeamSurfaceView {
  team: TeamGatheringState;
  /** Personal overlay for the viewer; omitted fields stay undefined. */
  personal?: PersonalGatheringProgress | null;
}

export type TeamPointActionKind =
  | 'start'
  | 'end'
  | 'en_route_display'
  | 'none';

export interface TeamPointAction {
  kind: TeamPointActionKind;
  /** zh display label used by UI contracts. */
  label: string;
  disabled: boolean;
  pressable: boolean;
}

export interface TransitionSuccess {
  ok: true;
  state: TeamGatheringState;
  transition: TeamGatheringTransition;
}

export interface TransitionFailure {
  ok: false;
  reason: TeamGatheringRejectReason;
  /** Converged state when a duplicate is treated as already-applied. */
  state: TeamGatheringState;
}

export type TransitionResult = TransitionSuccess | TransitionFailure;

function isActiveSession(
  session: ProjectTeamGatheringInput['navigationSession'],
): session is NonNullable<ProjectTeamGatheringInput['navigationSession']> {
  return Boolean(session && session.status === 'active' && session.destinationId);
}

/**
 * Project authoritative team gathering state from group + session + itinerary.
 * All surfaces (map, broadcast, notification, passive) should use this shape.
 *
 * Active navigation session is authoritative for global phase until it ends —
 * even if the destination is closed or omitted from the filtered itinerary list.
 */
export function projectTeamGatheringState(
  input: ProjectTeamGatheringInput,
): TeamGatheringState {
  const sessionActive = isActiveSession(input.navigationSession);
  const sessionDestId = sessionActive
    ? input.navigationSession!.destinationId
    : null;

  const legacyEnRouteId =
    !sessionActive
    && input.journeyStatus === 'going'
    && input.activeDestinationId
      ? input.activeDestinationId
      : null;

  // Session wins for global en_route identity; never drop phase to staying
  // while a live session still exists.
  const activePointId = sessionDestId ?? legacyEnRouteId;
  const journeyPhase: JourneyPhase = activePointId ? 'en_route' : 'staying';

  const sorted = input.destinations
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const points: TeamGatheringPointSnapshot[] = sorted.map((d) => {
    if (d.closedAt) {
      return {
        id: d.id,
        order: d.order,
        status: 'completed' as const,
        closedAt: d.closedAt,
      };
    }
    if (activePointId && d.id === activePointId) {
      return {
        id: d.id,
        order: d.order,
        status: 'en_route' as const,
        closedAt: d.closedAt ?? null,
      };
    }
    return {
      id: d.id,
      order: d.order,
      status: 'pending' as const,
      closedAt: d.closedAt ?? null,
    };
  });

  // Session destination missing from filtered list (e.g. closed stop dropped):
  // keep a synthetic en_route row so surfaces share one team state.
  if (
    activePointId
    && !points.some((p) => p.id === activePointId)
  ) {
    points.push({
      id: activePointId,
      order: Number.MAX_SAFE_INTEGER,
      status: 'en_route',
      closedAt: null,
    });
  }

  const nextPending =
    points.find((p) => p.status === 'pending')?.id
    ?? null;

  const version = sessionActive
    ? input.navigationSession!.version
    : stayingVersionFromServerFields(points);

  const phaseChangedAt = sessionActive
    ? input.navigationSession!.startedAt ?? input.journeyStartedAt ?? null
    : input.journeyStartedAt ?? null;

  return {
    journeyPhase,
    activePointId: journeyPhase === 'en_route' ? activePointId : null,
    nextPendingPointId: nextPending,
    points,
    version,
    phaseChangedAt,
    hasActiveSession: sessionActive,
  };
}

/**
 * Version while staying: pure function of completed point count only
 * (authoritative server closed_at projection). Do not mix with local +1
 * clocks from apply* — re-project after remote writes.
 */
function stayingVersionFromServerFields(
  points: TeamGatheringPointSnapshot[],
): number {
  return points.filter((p) => p.status === 'completed').length;
}

export function getPointStatus(
  state: TeamGatheringState,
  pointId: string,
): PointStatus | null {
  return state.points.find((p) => p.id === pointId)?.status ?? null;
}

/** Start only for next pending while staying and no active session. */
export function canTeamStart(
  state: TeamGatheringState,
  pointId: string,
): boolean {
  if (state.hasActiveSession) return false;
  if (state.journeyPhase !== 'staying') return false;
  if (state.activePointId) return false;
  if (state.nextPendingPointId !== pointId) return false;
  return getPointStatus(state, pointId) === 'pending';
}

/** End only for the active travelling point (session may outlive closed_at). */
export function canTeamEnd(
  state: TeamGatheringState,
  pointId: string,
): boolean {
  return state.journeyPhase === 'en_route' && state.activePointId === pointId;
}

/**
 * Team actions for one point. Only Start and End are pressable; en_route is
 * display-only (disabled).
 */
export function resolveTeamPointActions(
  state: TeamGatheringState,
  pointId: string,
  options?: { isLeader?: boolean },
): { primary: TeamPointAction; secondary?: TeamPointAction } {
  const isLeader = options?.isLeader ?? true;
  const status = getPointStatus(state, pointId);

  // Active session on this point (even if list marks completed / synthetic).
  const isActiveTravel =
    state.journeyPhase === 'en_route' && state.activePointId === pointId;

  if (status === 'completed' && !isActiveTravel) {
    return {
      primary: { kind: 'none', label: '已完成', disabled: true, pressable: false },
    };
  }

  if (isActiveTravel) {
    const enRouteDisplay: TeamPointAction = {
      kind: 'en_route_display',
      label: '前往中',
      disabled: true,
      pressable: false,
    };
    if (!isLeader) {
      return { primary: enRouteDisplay };
    }
    return {
      primary: {
        kind: 'end',
        label: '結束',
        disabled: false,
        pressable: true,
      },
      secondary: enRouteDisplay,
    };
  }

  if (!status) {
    return {
      primary: { kind: 'none', label: '', disabled: true, pressable: false },
    };
  }

  if (canTeamStart(state, pointId) && isLeader) {
    return {
      primary: {
        kind: 'start',
        label: '開始',
        disabled: false,
        pressable: true,
      },
    };
  }

  return {
    primary: {
      kind: 'none',
      label: status === 'pending' ? '待開始' : '',
      disabled: true,
      pressable: false,
    },
  };
}

/**
 * Apply a leader/server team transition.
 * Invalid, duplicate, or stale-version ops are rejected or converged.
 */
export function applyTeamGatheringTransition(
  state: TeamGatheringState,
  input: {
    transition: TeamGatheringTransition;
    pointId: string;
    /** Required for optimistic concurrency; omit only in pure unit fixtures. */
    expectedVersion?: number;
    isLeader?: boolean;
    /** ISO timestamp for phaseChangedAt (defaults to fixed test-friendly value only when provided). */
    nowIso?: string;
  },
): TransitionResult {
  const isLeader = input.isLeader ?? true;
  if (!isLeader) {
    return { ok: false, reason: 'not_leader', state };
  }

  if (
    input.expectedVersion != null
    && input.expectedVersion !== state.version
  ) {
    return { ok: false, reason: 'stale_version', state };
  }

  const point = state.points.find((p) => p.id === input.pointId);
  if (!point && input.transition === 'start') {
    return { ok: false, reason: 'unknown_point', state };
  }
  // End may target active session id even when point row is synthetic/missing.
  if (!point && input.transition === 'end') {
    if (state.activePointId !== input.pointId || state.journeyPhase !== 'en_route') {
      return { ok: false, reason: 'unknown_point', state };
    }
  }

  if (input.transition === 'start') {
    return applyStart(state, point!, input.nowIso);
  }
  return applyEnd(
    state,
    point ?? {
      id: input.pointId,
      order: 0,
      status: 'en_route',
      closedAt: null,
    },
    input.nowIso,
  );
}

function applyStart(
  state: TeamGatheringState,
  point: TeamGatheringPointSnapshot,
  nowIso?: string,
): TransitionResult {
  // Duplicate Start while already en_route on this point → converge.
  if (
    state.journeyPhase === 'en_route'
    && state.activePointId === point.id
  ) {
    return { ok: false, reason: 'duplicate_transition', state };
  }

  if (state.hasActiveSession || state.journeyPhase !== 'staying') {
    return { ok: false, reason: 'global_not_staying', state };
  }
  if (state.activePointId) {
    return { ok: false, reason: 'another_point_en_route', state };
  }
  if (point.status !== 'pending') {
    return { ok: false, reason: 'point_not_pending', state };
  }
  if (state.nextPendingPointId !== point.id) {
    return { ok: false, reason: 'invalid_transition', state };
  }

  const points = state.points.map((p) =>
    p.id === point.id ? { ...p, status: 'en_route' as const } : p,
  );
  const next: TeamGatheringState = {
    journeyPhase: 'en_route',
    activePointId: point.id,
    nextPendingPointId: points.find((p) => p.status === 'pending')?.id ?? null,
    points,
    // Local optimistic bump; live UI should re-project from session version after write.
    version: state.version + 1,
    phaseChangedAt: nowIso ?? state.phaseChangedAt ?? null,
    hasActiveSession: true,
  };
  return { ok: true, state: next, transition: 'start' };
}

function applyEnd(
  state: TeamGatheringState,
  point: TeamGatheringPointSnapshot,
  nowIso?: string,
): TransitionResult {
  // Duplicate End on already-completed point with no active travel → converge.
  if (
    point.status === 'completed'
    && state.journeyPhase === 'staying'
    && !state.hasActiveSession
  ) {
    return { ok: false, reason: 'duplicate_transition', state };
  }

  if (state.journeyPhase !== 'en_route') {
    return { ok: false, reason: 'global_not_en_route', state };
  }
  if (state.activePointId !== point.id) {
    return { ok: false, reason: 'point_not_en_route', state };
  }

  const closedAt = nowIso ?? new Date().toISOString();
  const points = state.points.map((p) =>
    p.id === point.id
      ? { ...p, status: 'completed' as const, closedAt }
      : p,
  );
  // Ensure completed row exists when synthetic.
  if (!points.some((p) => p.id === point.id)) {
    points.push({
      id: point.id,
      order: point.order,
      status: 'completed',
      closedAt,
    });
  }
  const nextPending = points.find((p) => p.status === 'pending')?.id ?? null;
  const next: TeamGatheringState = {
    journeyPhase: 'staying',
    // Server complete_gathering_stop nulls active_destination_id.
    activePointId: null,
    nextPendingPointId: nextPending,
    points,
    version: stayingVersionFromServerFields(points),
    phaseChangedAt: nowIso ?? closedAt,
    hasActiveSession: false,
  };
  return { ok: true, state: next, transition: 'end' };
}

/**
 * Overlay personal progress onto a team surface without rewriting team state.
 * Returns a new view object; `team` reference is preserved when unchanged.
 */
export function overlayPersonalOnTeamState(
  team: TeamGatheringState,
  personal: PersonalGatheringProgress | null | undefined,
): TeamSurfaceView {
  return { team, personal: personal ?? null };
}

/**
 * Prove / apply personal field updates without touching team phase.
 * Always returns the original team reference.
 */
export function updatePersonalProgressOnly(
  team: TeamGatheringState,
  previous: PersonalGatheringProgress | null | undefined,
  patch: Partial<Omit<PersonalGatheringProgress, 'userId'>> & {
    userId?: string;
  },
): TeamSurfaceView {
  const userId = patch.userId ?? previous?.userId ?? '';
  const personal: PersonalGatheringProgress = {
    userId,
    travelMode: patch.travelMode !== undefined ? patch.travelMode : previous?.travelMode,
    etaSeconds: patch.etaSeconds !== undefined ? patch.etaSeconds : previous?.etaSeconds,
    location: patch.location !== undefined ? patch.location : previous?.location,
    arrived: patch.arrived !== undefined ? patch.arrived : previous?.arrived,
    progress: patch.progress !== undefined ? patch.progress : previous?.progress,
    distanceMeters:
      patch.distanceMeters !== undefined
        ? patch.distanceMeters
        : previous?.distanceMeters,
  };
  // Personal ETA / arrival is never a team completion criterion.
  return { team, personal };
}

/** Map legacy journey_status to OTA-01 journeyPhase. */
export function journeyPhaseFromLegacy(
  journeyStatus: 'going' | 'paused' | null | undefined,
  hasActiveSession: boolean,
): JourneyPhase {
  if (hasActiveSession || journeyStatus === 'going') return 'en_route';
  return 'staying';
}

/** Map OTA-01 phase back to legacy groups.journey_status for existing writers. */
export function legacyJourneyStatusFromPhase(
  phase: JourneyPhase,
): 'going' | 'paused' {
  return phase === 'en_route' ? 'going' : 'paused';
}

/**
 * Whether a personal progress change is allowed without a team transition.
 * Always true for personal-only fields — documents the separation contract.
 */
export function isPersonalOnlyField(
  field: keyof PersonalGatheringProgress | string,
): boolean {
  return (
    field === 'userId'
    || field === 'travelMode'
    || field === 'etaSeconds'
    || field === 'location'
    || field === 'arrived'
    || field === 'progress'
    || field === 'distanceMeters'
  );
}
