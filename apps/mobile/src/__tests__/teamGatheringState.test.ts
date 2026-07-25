import {
  applyTeamGatheringTransition,
  canTeamStart,
  getPointStatus,
  journeyPhaseFromLegacy,
  legacyJourneyStatusFromPhase,
  projectTeamGatheringState,
  resolveTeamPointActions,
  type TeamGatheringState,
} from '../utils/teamGatheringState';
import { resolveNavCommand } from '../utils/gatherCommand';

function baseDests() {
  return [
    { id: 'p1', order: 0 },
    { id: 'p2', order: 1 },
    { id: 'p3', order: 2 },
  ];
}

function initialState(): TeamGatheringState {
  return projectTeamGatheringState({
    journeyStatus: 'paused',
    activeDestinationId: null,
    destinations: baseDests(),
  });
}

describe('projectTeamGatheringState', () => {
  it('initial pending: global staying, Start enabled, no active en-route', () => {
    const state = initialState();
    expect(state.journeyPhase).toBe('staying');
    expect(state.activePointId).toBeNull();
    expect(state.nextPendingPointId).toBe('p1');
    expect(getPointStatus(state, 'p1')).toBe('pending');
    expect(state.points.every((p) => p.status !== 'en_route')).toBe(true);

    const actions = resolveTeamPointActions(state, 'p1', { isLeader: true });
    expect(actions.primary).toMatchObject({
      kind: 'start',
      label: '開始',
      disabled: false,
      pressable: true,
    });
  });

  it('prefers active navigation session over legacy journey_status', () => {
    const state = projectTeamGatheringState({
      journeyStatus: 'paused',
      activeDestinationId: null,
      navigationSession: {
        destinationId: 'p2',
        status: 'active',
        version: 3,
        startedAt: '2026-07-25T10:00:00.000Z',
      },
      destinations: baseDests(),
    });
    expect(state.journeyPhase).toBe('en_route');
    expect(state.activePointId).toBe('p2');
    expect(getPointStatus(state, 'p2')).toBe('en_route');
    expect(state.version).toBe(3);
  });

  it('maps completed closed_at points and keeps history when next is pending', () => {
    const state = projectTeamGatheringState({
      journeyStatus: 'paused',
      destinations: [
        { id: 'p1', order: 0, closedAt: '2026-07-25T09:00:00.000Z' },
        { id: 'p2', order: 1 },
      ],
    });
    expect(getPointStatus(state, 'p1')).toBe('completed');
    expect(getPointStatus(state, 'p2')).toBe('pending');
    expect(state.journeyPhase).toBe('staying');
    expect(state.nextPendingPointId).toBe('p2');
  });

  it('keeps en_route while active session exists even if dest is closed or missing', () => {
    // closedAt on session dest (race: complete closed but session not yet cancelled)
    const closedRace = projectTeamGatheringState({
      journeyStatus: 'paused',
      navigationSession: {
        destinationId: 'p1',
        status: 'active',
        version: 4,
      },
      destinations: [
        { id: 'p1', order: 0, closedAt: '2026-07-25T11:00:00.000Z' },
        { id: 'p2', order: 1 },
      ],
    });
    expect(closedRace.journeyPhase).toBe('en_route');
    expect(closedRace.activePointId).toBe('p1');
    expect(closedRace.hasActiveSession).toBe(true);
    expect(canTeamStart(closedRace, 'p2')).toBe(false);

    // Filtered list drops closed stop entirely (MapScreen filterActiveDestinations)
    const missingDest = projectTeamGatheringState({
      journeyStatus: 'paused',
      navigationSession: {
        destinationId: 'p1',
        status: 'active',
        version: 5,
      },
      destinations: [{ id: 'p2', order: 1 }],
    });
    expect(missingDest.journeyPhase).toBe('en_route');
    expect(missingDest.activePointId).toBe('p1');
    expect(canTeamStart(missingDest, 'p2')).toBe(false);
    expect(resolveTeamPointActions(missingDest, 'p1', { isLeader: true }).primary.kind).toBe(
      'end',
    );
  });

  it('reload projection after End retains completed history when full list supplied', () => {
    const afterEnd = projectTeamGatheringState({
      journeyStatus: 'paused',
      activeDestinationId: null,
      destinations: [
        { id: 'p1', order: 0, closedAt: '2026-07-25T11:00:00.000Z' },
        { id: 'p2', order: 1 },
        { id: 'p3', order: 2 },
      ],
    });
    expect(afterEnd.journeyPhase).toBe('staying');
    expect(getPointStatus(afterEnd, 'p1')).toBe('completed');
    expect(afterEnd.nextPendingPointId).toBe('p2');
    expect(canTeamStart(afterEnd, 'p2')).toBe(true);
    expect(canTeamStart(afterEnd, 'p3')).toBe(false);
  });
});

describe('composition with resolveNavCommand', () => {
  it('projects team state into Start/End labels matching resolveTeamPointActions', () => {
    const staying = initialState();
    const teamStart = resolveTeamPointActions(staying, 'p1', { isLeader: true });
    const navStart = resolveNavCommand({
      isLeader: true,
      personallyArrived: false,
      flockNavigatingThis: false,
      localRouteThis: false,
      isNextTeamPending: canTeamStart(staying, 'p1'),
      teamStartBlocked: !canTeamStart(staying, 'p1'),
    });
    expect(teamStart.primary.label).toBe('開始');
    expect(navStart).toMatchObject({ label: '開始', action: 'start_nav', disabled: false });

    const started = applyTeamGatheringTransition(staying, {
      transition: 'start',
      pointId: 'p1',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const teamEnd = resolveTeamPointActions(started.state, 'p1', { isLeader: true });
    const navEnd = resolveNavCommand({
      isLeader: true,
      personallyArrived: false,
      flockNavigatingThis: true,
      localRouteThis: false,
      teamStartBlocked: true,
    });
    expect(teamEnd.primary).toMatchObject({ kind: 'end', label: '結束' });
    expect(navEnd).toMatchObject({ kind: 'leader_stop', label: '結束', action: 'end_point' });
  });
});

describe('Start / End transitions', () => {
  it('Start: point en_route, global en_route, Start disabled, End enabled', () => {
    const before = initialState();
    const result = applyTeamGatheringTransition(before, {
      transition: 'start',
      pointId: 'p1',
      expectedVersion: before.version,
      nowIso: '2026-07-25T10:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.journeyPhase).toBe('en_route');
    expect(result.state.activePointId).toBe('p1');
    expect(getPointStatus(result.state, 'p1')).toBe('en_route');
    expect(result.state.version).toBe(before.version + 1);

    const actions = resolveTeamPointActions(result.state, 'p1', { isLeader: true });
    expect(actions.primary).toMatchObject({
      kind: 'end',
      label: '結束',
      disabled: false,
      pressable: true,
    });
    expect(actions.secondary).toMatchObject({
      kind: 'en_route_display',
      label: '前往中',
      disabled: true,
      pressable: false,
    });
  });

  it('en_route cannot trigger another Start / duplicate transition converges', () => {
    const started = applyTeamGatheringTransition(initialState(), {
      transition: 'start',
      pointId: 'p1',
      nowIso: '2026-07-25T10:00:00.000Z',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const dup = applyTeamGatheringTransition(started.state, {
      transition: 'start',
      pointId: 'p1',
      expectedVersion: started.state.version,
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.reason).toBe('duplicate_transition');
    expect(dup.state).toEqual(started.state);

    const other = applyTeamGatheringTransition(started.state, {
      transition: 'start',
      pointId: 'p2',
      expectedVersion: started.state.version,
    });
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.reason).toBe('global_not_staying');
  });

  it('End: point completed, global staying, next remains pending', () => {
    const started = applyTeamGatheringTransition(initialState(), {
      transition: 'start',
      pointId: 'p1',
      nowIso: '2026-07-25T10:00:00.000Z',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const ended = applyTeamGatheringTransition(started.state, {
      transition: 'end',
      pointId: 'p1',
      expectedVersion: started.state.version,
      nowIso: '2026-07-25T11:00:00.000Z',
    });
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;

    expect(ended.state.journeyPhase).toBe('staying');
    expect(ended.state.activePointId).toBeNull();
    expect(getPointStatus(ended.state, 'p1')).toBe('completed');
    expect(getPointStatus(ended.state, 'p2')).toBe('pending');
    expect(ended.state.nextPendingPointId).toBe('p2');
    // History retained: p1 stays completed after next is selected as pending.
    expect(ended.state.points.find((p) => p.id === 'p1')?.closedAt).toBe(
      '2026-07-25T11:00:00.000Z',
    );

    const nextActions = resolveTeamPointActions(ended.state, 'p2', { isLeader: true });
    expect(nextActions.primary.kind).toBe('start');
  });

  it('rejects End when staying / wrong point', () => {
    const state = initialState();
    const r = applyTeamGatheringTransition(state, {
      transition: 'end',
      pointId: 'p1',
      expectedVersion: state.version,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('global_not_en_route');
  });

  it('rejects stale-version transitions', () => {
    const state = initialState();
    const r = applyTeamGatheringTransition(state, {
      transition: 'start',
      pointId: 'p1',
      expectedVersion: state.version - 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('stale_version');
    expect(r.state.version).toBe(state.version);
  });

  it('rejects non-leader transitions', () => {
    const state = initialState();
    const r = applyTeamGatheringTransition(state, {
      transition: 'start',
      pointId: 'p1',
      isLeader: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_leader');
  });

  it('rejects Start on non-next pending point', () => {
    const state = initialState();
    const r = applyTeamGatheringTransition(state, {
      transition: 'start',
      pointId: 'p2',
      expectedVersion: state.version,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_transition');
  });

  it('concurrent duplicate End converges without rewriting history', () => {
    let state = initialState();
    const s1 = applyTeamGatheringTransition(state, {
      transition: 'start',
      pointId: 'p1',
      nowIso: '2026-07-25T10:00:00.000Z',
    });
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    state = s1.state;

    const e1 = applyTeamGatheringTransition(state, {
      transition: 'end',
      pointId: 'p1',
      expectedVersion: state.version,
      nowIso: '2026-07-25T11:00:00.000Z',
    });
    expect(e1.ok).toBe(true);
    if (!e1.ok) return;

    const e2 = applyTeamGatheringTransition(e1.state, {
      transition: 'end',
      pointId: 'p1',
      expectedVersion: e1.state.version,
    });
    expect(e2.ok).toBe(false);
    if (e2.ok) return;
    expect(e2.reason).toBe('duplicate_transition');
    expect(getPointStatus(e2.state, 'p1')).toBe('completed');
    expect(e2.state.journeyPhase).toBe('staying');
  });
});

describe('member display + legacy mapping', () => {
  it('members see disabled 前往中 while team is en_route', () => {
    const started = applyTeamGatheringTransition(initialState(), {
      transition: 'start',
      pointId: 'p1',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const actions = resolveTeamPointActions(started.state, 'p1', { isLeader: false });
    expect(actions.primary).toMatchObject({
      kind: 'en_route_display',
      label: '前往中',
      disabled: true,
      pressable: false,
    });
  });

  it('maps legacy journey_status ↔ journeyPhase', () => {
    expect(journeyPhaseFromLegacy('paused', false)).toBe('staying');
    expect(journeyPhaseFromLegacy('going', false)).toBe('en_route');
    expect(journeyPhaseFromLegacy('paused', true)).toBe('en_route');
    expect(legacyJourneyStatusFromPhase('staying')).toBe('paused');
    expect(legacyJourneyStatusFromPhase('en_route')).toBe('going');
  });
});
