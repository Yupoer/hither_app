import {
  applyTeamGatheringTransition,
  isPersonalOnlyField,
  overlayPersonalOnTeamState,
  projectTeamGatheringState,
  updatePersonalProgressOnly,
  type PersonalGatheringProgress,
  type TeamGatheringState,
} from '../utils/teamGatheringState';

function teamWithTwoPoints(): TeamGatheringState {
  return projectTeamGatheringState({
    journeyStatus: 'paused',
    destinations: [
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
    ],
  });
}

describe('personal / team state separation contract', () => {
  it('lets each member own different travel mode, ETA, location, arrival', () => {
    const team = teamWithTwoPoints();
    const alice: PersonalGatheringProgress = {
      userId: 'alice',
      travelMode: 'walk',
      etaSeconds: 600,
      location: { latitude: 25.0, longitude: 121.5 },
      arrived: false,
      progress: 0.2,
    };
    const bob: PersonalGatheringProgress = {
      userId: 'bob',
      travelMode: 'drive',
      etaSeconds: 120,
      location: { latitude: 25.1, longitude: 121.6 },
      arrived: true,
      progress: 1,
    };

    const aliceView = overlayPersonalOnTeamState(team, alice);
    const bobView = overlayPersonalOnTeamState(team, bob);

    // Same authoritative team state object for every surface.
    expect(aliceView.team).toBe(team);
    expect(bobView.team).toBe(team);
    expect(aliceView.team.journeyPhase).toBe('staying');
    expect(bobView.team.journeyPhase).toBe('staying');

    expect(aliceView.personal?.travelMode).toBe('walk');
    expect(bobView.personal?.travelMode).toBe('drive');
    expect(aliceView.personal?.etaSeconds).toBe(600);
    expect(bobView.personal?.etaSeconds).toBe(120);
    expect(aliceView.personal?.arrived).toBe(false);
    expect(bobView.personal?.arrived).toBe(true);
  });

  it('updates personal progress without team phase transition', () => {
    const started = applyTeamGatheringTransition(teamWithTwoPoints(), {
      transition: 'start',
      pointId: 'a',
      nowIso: '2026-07-25T10:00:00.000Z',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const team = started.state;
    const phaseBefore = team.journeyPhase;
    const versionBefore = team.version;
    const activeBefore = team.activePointId;
    const pointsBefore = team.points.map((p) => ({ ...p }));

    const view = updatePersonalProgressOnly(team, { userId: 'm1' }, {
      travelMode: 'transit',
      etaSeconds: 900,
      progress: 0.55,
      distanceMeters: 400,
      location: { latitude: 1, longitude: 2 },
      arrived: false,
    });

    // Team reference and fields unchanged.
    expect(view.team).toBe(team);
    expect(view.team.journeyPhase).toBe(phaseBefore);
    expect(view.team.version).toBe(versionBefore);
    expect(view.team.activePointId).toBe(activeBefore);
    expect(view.team.points).toEqual(pointsBefore);
    expect(view.personal).toMatchObject({
      userId: 'm1',
      travelMode: 'transit',
      etaSeconds: 900,
      progress: 0.55,
      arrived: false,
    });
  });

  it('personal ETA is a rough hint only — never completes a team point', () => {
    const started = applyTeamGatheringTransition(teamWithTwoPoints(), {
      transition: 'start',
      pointId: 'a',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // Even ETA=0 and arrived=true must not flip team point to completed.
    const view = updatePersonalProgressOnly(started.state, { userId: 'm1' }, {
      etaSeconds: 0,
      arrived: true,
      progress: 1,
      distanceMeters: 0,
    });

    expect(view.team.journeyPhase).toBe('en_route');
    expect(view.team.activePointId).toBe('a');
    expect(view.team.points.find((p) => p.id === 'a')?.status).toBe('en_route');
    expect(view.personal?.etaSeconds).toBe(0);
    expect(view.personal?.arrived).toBe(true);
  });

  it('team surfaces may overlay personal info without rewriting team state', () => {
    const team = teamWithTwoPoints();
    const originalJson = JSON.stringify(team);

    const view1 = overlayPersonalOnTeamState(team, {
      userId: 'x',
      travelMode: 'walk',
      etaSeconds: 60,
    });
    const view2 = updatePersonalProgressOnly(view1.team, view1.personal, {
      etaSeconds: 30,
      progress: 0.8,
    });

    expect(JSON.stringify(view2.team)).toBe(originalJson);
    expect(view2.team).toBe(team);
  });

  it('classifies personal-only fields for the separation contract', () => {
    for (const field of [
      'travelMode',
      'etaSeconds',
      'location',
      'arrived',
      'progress',
      'distanceMeters',
    ]) {
      expect(isPersonalOnlyField(field)).toBe(true);
    }
    expect(isPersonalOnlyField('journeyPhase')).toBe(false);
    expect(isPersonalOnlyField('pointStatus')).toBe(false);
    expect(isPersonalOnlyField('activePointId')).toBe(false);
  });
});
