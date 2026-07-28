/**
 * OTA-07 passive companion presentation — pure helpers.
 *
 * Presentation only: reads the same team phase + user-scoped progress as the
 * full MapScreen. Never mutates team state and never emits consent, payment,
 * vote, or safety approval from mode enter/remain/silence.
 */

export type PresentationMode = 'full' | 'passive';

/** Global team journey phase (aligned with OTA-01 semantics). */
export type TeamGatheringPhase = 'staying' | 'en_route';

/** Coarse personal progress buckets — not a second precision model. */
export type CoarseProgressBucket =
  | 'unknown'
  | 'not_started'
  | 'early'
  | 'mid'
  | 'late'
  | 'arrived';

export type PassiveContentStatus = 'ready' | 'loading' | 'empty' | 'error';

/** Explicit user actions allowed while passive. Everything else is forbidden. */
export const PASSIVE_ALLOWED_ACTIONS = [
  'switch_back_full',
  'external_navigation',
  'need_help',
  'quick_command',
] as const;

export type PassiveAllowedAction = (typeof PASSIVE_ALLOWED_ACTIONS)[number];

/** Actions that must never be inferred from passive mode or silence. */
export const PASSIVE_FORBIDDEN_ACTIONS = [
  'consent',
  'payment',
  'vote',
  'safety_approval',
  'announcement_response',
  'team_phase_transition',
] as const;

export type PassiveForbiddenAction = (typeof PASSIVE_FORBIDDEN_ACTIONS)[number];

export interface PassiveCompanionPoint {
  id: string;
  title: string;
}

export interface PassiveCompanionModel {
  mode: PresentationMode;
  contentStatus: PassiveContentStatus;
  /** Same team phase the full UI would show. */
  teamPhase: TeamGatheringPhase;
  currentPoint: PassiveCompanionPoint | null;
  nextPoint: PassiveCompanionPoint | null;
  /** Personal progress 0–1 when known; never written into team state. */
  personalProgress: number | null;
  coarseProgress: CoarseProgressBucket;
  /**
   * GPS sample freshness for personal progress (live/stale/unknown).
   * Optional — older callers omit; UI surfaces stale/unknown when set.
   */
  personalFreshness?: 'live' | 'stale' | 'unknown';
  errorMessage?: string | null;
  /** Always true: switch-back must remain available in every content status. */
  switchBackAvailable: true;
  allowedActions: readonly PassiveAllowedAction[];
  forbiddenActions: readonly PassiveForbiddenAction[];
}

export function teamPhaseFromJourneyGoing(journeyGoing: boolean): TeamGatheringPhase {
  return journeyGoing ? 'en_route' : 'staying';
}

/**
 * Map continuous personal progress to coarse buckets for passive UI.
 * Arrived is sticky when the full UI would treat the viewer as arrived.
 */
export function coarseProgressFromRatio(
  progress: number | null | undefined,
  personallyArrived: boolean,
): CoarseProgressBucket {
  if (personallyArrived) return 'arrived';
  if (progress == null || !Number.isFinite(progress)) return 'unknown';
  const p = Math.min(1, Math.max(0, progress));
  if (p <= 0) return 'not_started';
  if (p < 0.33) return 'early';
  if (p < 0.66) return 'mid';
  if (p < 1) return 'late';
  return 'arrived';
}

export interface BuildPassiveCompanionInput {
  mode: PresentationMode;
  loading: boolean;
  errorMessage?: string | null;
  destinations: ReadonlyArray<{ id: string; title: string }>;
  /**
   * Authoritative current stop: shared nav target when en_route, else the
   * selected / active stop the full UI would highlight.
   */
  currentPointId?: string | null;
  currentPointTitle?: string | null;
  journeyGoing: boolean;
  personalProgress?: number | null;
  personallyArrived?: boolean;
  personalFreshness?: 'live' | 'stale' | 'unknown';
}

/**
 * Derive the passive companion display model from the same inputs the full
 * interface uses. Pure — no I/O, no side effects.
 */
export function buildPassiveCompanionModel(
  input: BuildPassiveCompanionInput,
): PassiveCompanionModel {
  const teamPhase = teamPhaseFromJourneyGoing(input.journeyGoing);
  const destinations = input.destinations ?? [];
  const hasPointData =
    destinations.length > 0 || Boolean(input.currentPointId);

  // Prefer companion fields when cached team data exists. Exclusive `error`
  // only when there is nothing to show (matches full UI: error is non-blocking
  // when itinerary/state is already on screen).
  let contentStatus: PassiveContentStatus = 'ready';
  if (input.loading && !hasPointData) {
    contentStatus = 'loading';
  } else if (!hasPointData && input.errorMessage) {
    contentStatus = 'error';
  } else if (!hasPointData) {
    contentStatus = 'empty';
  } else {
    contentStatus = 'ready';
  }

  let currentPoint: PassiveCompanionPoint | null = null;
  if (input.currentPointId) {
    const fromList = destinations.find((d) => d.id === input.currentPointId);
    currentPoint = {
      id: input.currentPointId,
      title:
        (fromList?.title ?? input.currentPointTitle ?? '').trim() ||
        input.currentPointId,
    };
  } else if (destinations.length > 0) {
    currentPoint = {
      id: destinations[0].id,
      title: destinations[0].title,
    };
  }

  let nextPoint: PassiveCompanionPoint | null = null;
  if (currentPoint && destinations.length > 0) {
    const idx = destinations.findIndex((d) => d.id === currentPoint!.id);
    if (idx >= 0 && idx + 1 < destinations.length) {
      const n = destinations[idx + 1];
      nextPoint = { id: n.id, title: n.title };
    }
  } else if (!currentPoint && destinations.length > 1) {
    nextPoint = { id: destinations[1].id, title: destinations[1].title };
  }

  const personalProgress =
    input.personalProgress != null && Number.isFinite(input.personalProgress)
      ? Math.min(1, Math.max(0, input.personalProgress))
      : null;

  return {
    mode: input.mode,
    contentStatus,
    teamPhase,
    currentPoint,
    nextPoint,
    personalProgress,
    coarseProgress: coarseProgressFromRatio(
      personalProgress,
      Boolean(input.personallyArrived),
    ),
    personalFreshness: input.personalFreshness,
    // Surface as a banner when status is ready-with-cache; exclusive error UI
    // when contentStatus === 'error'.
    errorMessage: input.errorMessage ?? null,
    switchBackAvailable: true,
    allowedActions: PASSIVE_ALLOWED_ACTIONS,
    forbiddenActions: PASSIVE_FORBIDDEN_ACTIONS,
  };
}

/** True when an action may be performed from passive presentation. */
export function isPassiveActionAllowed(action: string): boolean {
  return (PASSIVE_ALLOWED_ACTIONS as readonly string[]).includes(action);
}

/**
 * Contract helper: entering/leaving passive mode is display-only and must not
 * emit forbidden actions. Not a runtime gate — preference setters are pure
 * display toggles; do not call this from production UI handlers.
 */
export function passiveModeTransitionSideEffects(
  _from: PresentationMode,
  _to: PresentationMode,
): readonly string[] {
  return [];
}
