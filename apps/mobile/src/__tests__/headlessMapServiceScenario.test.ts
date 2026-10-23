const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');
type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type CoreState = { group: { dataSource: string }; durable: { snapshot: { destinations: { id: string; day: number | null; kind?: string; providerPlaceId?: string; closedAt?: string }[];
  dailyAccommodations: { id: string; title: string }[] }; operations: unknown[] } };

describe.each(['ios', 'android'])('real Map callable service contracts on %s', platform => {
  jest.setTimeout(120000);
  const service = (device: Device, name: string, ...args: unknown[]) => device.perform(`map.service.${name}`, { args });
  async function device(world: InstanceType<typeof World>, userId = LEADER, id = 'service') {
    const actor = await world.device({ id, userId, platform });
    await actor.perform('group.observe', { groupId: GROUP_ID });
    await world.waitFor(actor, (value: CoreState) => value.group.dataSource === 'remote', 'real core snapshot');
    return actor;
  }

  it('MAP-DEST-04 MAP-DEST-07 MAP-STAY-04 ordinary first-stop accommodation import marker reorder completion and delete preserve real storage semantics', async () => {
    const world = new World();
    try {
      const actor = await device(world);
      expect(await service(actor, 'destination.quota')).toBeGreaterThanOrEqual(0);
      const poolId = await service(actor, 'destination.add', GROUP_ID, { title: 'Pool', coordinates: { latitude: 25.1, longitude: 121.5 }, providerPlaceId: 'provider-pool' });
      const stayId = await service(actor, 'destination.add', GROUP_ID, { title: 'Hotel', coordinates: { latitude: 25.2, longitude: 121.6 }, kind: 'accommodation', day: 0 });
      const firstId = await service(actor, 'destination.add', GROUP_ID, { title: 'First', coordinates: { latitude: 25.3, longitude: 121.7 }, placement: 'firstStop', day: 1 });
      await world.settle();
      const state = (await actor.observe()).durable.snapshot;
      expect(state.destinations.find((row: { id: string }) => row.id === poolId)).toMatchObject({ day: null, providerPlaceId: 'provider-pool' });
      expect(state.destinations.find((row: { id: string }) => row.id === stayId)).toMatchObject({ day: 1, kind: 'accommodation', stayAnchor: false });
      expect(state.destinations.find((row: { id: string }) => row.id === firstId).order).toBeLessThan(state.destinations.find((row: { id: string }) => row.id === DESTINATION).order);
      await service(actor, 'destination.marker', GROUP_ID, poolId, { emoji: '📍', markerColor: '#5E6C84' });
      await service(actor, 'destination.meet-time', poolId, '2026-10-22T02:00:00.000Z', 10, GROUP_ID);
      await world.settle();
      expect(world.backend.itinerary.find((row: { id: string }) => row.id === poolId)).toMatchObject({ meet_at: '2026-10-22T02:00:00.000Z', meet_red_minutes: 10 });
      await service(actor, 'destination.meet-time', poolId, null, null, GROUP_ID);
      await service(actor, 'destination.reorder', GROUP_ID, [
        { id: firstId, position: 0, day: 1 }, { id: DESTINATION, position: 1, day: 1 }, { id: stayId, position: 2, day: 1 }, { id: poolId, position: 3, day: null },
      ]);
      await world.settle();
      expect((await actor.observe()).durable.snapshot.destinations.find((row: { id: string }) => row.id === poolId)).toMatchObject({ emoji: '📍', markerColor: '#5E6C84' });
      expect(world.backend.itinerary.find((row: { id: string }) => row.id === poolId).meet_at).toBeNull();
      const completionSession = await service(actor, 'navigation.start', GROUP_ID, firstId, 'first-stop-completion');
      await world.settle();
      await service(actor, 'destination.complete', GROUP_ID, firstId, completionSession.id);
      await world.settle();
      expect((await actor.observe()).durable.snapshot.destinations.find((row: { id: string }) => row.id === firstId).closedAt).toBeTruthy();
      await service(actor, 'destination.import', GROUP_ID, [{ title: 'Imported', latitude: 25.4, longitude: 121.8 }], { day: 2 });
      await world.settle();
      expect(world.backend.itinerary.find((row: { title: string }) => row.title === 'Imported')).toMatchObject({ day: null });
      const beforeEmpty = world.backend.trace.length;
      await service(actor, 'destination.import', GROUP_ID, []);
      await service(actor, 'destination.reorder', GROUP_ID, []);
      expect(world.backend.trace).toHaveLength(beforeEmpty);
      await service(actor, 'destination.delete', GROUP_ID, poolId);
      await world.settle();
      expect((await actor.observe()).durable.snapshot.destinations.some((row: { id: string }) => row.id === poolId)).toBe(false);
      expect((await actor.observe()).durable.operations).toEqual([]);
    } finally { await world.close(); }
  });

  it('MAP-STAY-04 MAP-STAY-05 MAP-STAY-06 real daily writes retain ID and snapshots while clear retains itinerary accommodation cards', async () => {
    const world = new World();
    try {
      const actor = await device(world);
      const date = '2026-10-22';
      const card = await service(actor, 'destination.add', GROUP_ID, { title: 'Independent hotel card', coordinates: { latitude: 25.2, longitude: 121.6 }, kind: 'accommodation', day: 1 });
      const first = await service(actor, 'stay.set', GROUP_ID, date, { title: 'Night one', coordinates: { latitude: 25.3, longitude: 121.7 }, sourceDestinationId: null, day: 1 });
      await world.settle();
      const second = await service(actor, 'stay.set', GROUP_ID, date, { title: 'Night revised', coordinates: { latitude: 25.4, longitude: 121.8 }, sourceDestinationId: null, day: 1 });
      expect(second.daily.id).toBe(first.daily.id);
      await world.settle();
      expect(await service(actor, 'stay.list', GROUP_ID)).toEqual([expect.objectContaining({ title: 'Night revised' })]);
      expect(await service(actor, 'stay.date', GROUP_ID, date)).toMatchObject({ title: 'Night revised' });
      await service(actor, 'stay.auto-add', GROUP_ID, false);
      expect(world.backend.groups.get(GROUP_ID).accommodation_auto_add).toBe(false);
      await service(actor, 'stay.clear', GROUP_ID, date, 1);
      await world.settle();
      expect((await actor.observe()).durable.snapshot.dailyAccommodations).toEqual([]);
      expect((await actor.observe()).durable.snapshot.destinations.some((row: { id: string }) => row.id === card)).toBe(true);
    } finally { await world.close(); }
  });

  it('F01 F02 F03 F04 owner queries normalization exact deletion and account isolation use real favorite service mapping', async () => {
    const world = new World();
    try {
      const actor = await device(world);
      const peer = await device(world, PEER, 'peer');
      const first = await service(actor, 'favorite.save', { title: '  Station   gate ', address: 'Road', coordinates: { latitude: 25.1234567, longitude: 121.9876543 } });
      const duplicate = await service(actor, 'favorite.save', { title: 'Station gate', coordinates: { latitude: 25.1234567, longitude: 121.9876543 } });
      expect(duplicate.id).toBe(first.id);
      expect(await service(peer, 'favorite.list')).toEqual([]);
      await service(peer, 'favorite.delete', first.id);
      expect(await service(actor, 'favorite.list')).toHaveLength(1);
      expect(await service(actor, 'favorite.exact-delete', 'station GATE', { latitude: 25.1234567, longitude: 121.9876543 })).toBe(true);
      expect(await service(actor, 'favorite.exact-delete', 'Station gate', { latitude: 25.1234567, longitude: 121.9876543 })).toBe(false);
      const saved = await service(actor, 'favorite.save', { title: 'Other', coordinates: { latitude: 25, longitude: 121 } });
      await service(actor, 'favorite.delete', saved.id);
      expect(await service(actor, 'favorite.list')).toEqual([]);
    } finally { await world.close(); }
  });

  it('MAP-COORD-06 MAP-COORD-07 real coordination services keep reads pure and resolve only explicit due commands', async () => {
    const world = new World();
    try {
      const actor = await device(world);
      const peer = await device(world, PEER, 'peer');
      const input = { groupId: GROUP_ID, subject: 'Decision', subjectKind: 'itinerary',
        options: [{ id: 'keep', label: 'Keep', kind: 'keep_current' }, { id: 'change', label: 'Change', kind: 'itinerary' }],
        deadline: new Date(world.now + 60000).toISOString(), policy: 'timeout_default', defaultOutcome: 'keep' };
      const request = await service(actor, 'coordination.create', input);
      expect(request.status).toBe('open');
      await service(peer, 'coordination.respond', request.id, 'change');
      expect(await service(actor, 'coordination.responses', request.id)).toEqual([expect.objectContaining({ userId: PEER, optionId: 'change' })]);
      expect(await service(actor, 'coordination.requests', GROUP_ID, { status: ['open'] })).toHaveLength(1);
      expect(world.backend.trace.filter((call: { name: string }) => call.name.startsWith('resolve_'))).toEqual([]);
      await world.advance(60000);
      await expect(service(actor, 'coordination.resolve-deadline', request.id)).rejects.toThrow(/permission denied/);
      const resolved = require('../../test/headless/backend-requests.cjs').processDue(world.backend);
      expect(resolved).toEqual([expect.objectContaining({ status: 'expired', resolved_outcome: 'keep' })]);
      await world.settle();
      expect(await service(actor, 'coordination.requests', GROUP_ID, { status: 'expired' })).toEqual([expect.objectContaining({ id: request.id, resolvedOutcome: 'keep' })]);
      const due = await service(actor, 'coordination.create', { ...input, subject: 'Due', deadline: new Date(world.now + 1000).toISOString() });
      await world.advance(1000);
      await expect(service(actor, 'coordination.resolve-due', GROUP_ID)).rejects.toThrow(/permission denied/);
      expect(require('../../test/headless/backend-requests.cjs').processDue(world.backend)).toEqual([expect.objectContaining({ id: due.id, status: 'expired' })]);
      const forced = await service(actor, 'coordination.create', { ...input, policy: 'organizer_override', deadline: new Date(world.now + 60000).toISOString() });
      expect(await service(actor, 'coordination.override', forced.id, 'keep')).toMatchObject({ status: 'resolved', resolutionSource: 'organizer_override' });
      await expect(service(peer, 'coordination.respond', forced.id, 'change')).rejects.toThrow();
      const cancelled = await service(actor, 'coordination.create', { ...input, deadline: new Date(world.now + 60000).toISOString() });
      expect(await service(actor, 'coordination.cancel', cancelled.id)).toMatchObject({ status: 'cancelled' });
      expect(await service(actor, 'coordination.operations', GROUP_ID)).toEqual(expect.any(Array));
    } finally { await world.close(); }
  });

  it('MAP-GATHER-03 real navigation session reads aliases ACK privacy background roster and terminal commands remain distinct', async () => {
    const world = new World();
    try {
      const actor = await device(world);
      const session = await service(actor, 'navigation.start', GROUP_ID, DESTINATION, 'service-session-one');
      expect(await service(actor, 'navigation.active', GROUP_ID)).toMatchObject({ id: session.id, destinationId: DESTINATION });
      expect(await service(actor, 'navigation.by-id', GROUP_ID, 'service-session-one')).toMatchObject({ id: session.id });
      const ack = await service(actor, 'navigation.ack', session.id, 'tracking_active', { source: 'headless-service' });
      expect(ack).toMatchObject({ userId: LEADER, localStatus: 'tracking_active' });
      expect(await service(actor, 'navigation.my-state', session.id)).toMatchObject({ userId: LEADER });
      expect(await service(actor, 'navigation.member-states', session.id)).toEqual(expect.arrayContaining([expect.objectContaining({ userId: LEADER })]));
      const context = await service(actor, 'navigation.background-context', GROUP_ID);
      expect(context).toMatchObject({ actorId: LEADER, hasMembership: true, target: { id: DESTINATION }, leaderId: LEADER });
      expect(context.navigationMemberIds).toEqual(expect.arrayContaining([LEADER, PEER]));
      await expect(service(actor, 'navigation.set-sharing', false, PEER)).rejects.toThrow('location_privacy_account_changed');
      await service(actor, 'navigation.set-sharing', false, LEADER);
      expect(await service(actor, 'navigation.get-sharing')).toBe(false);
      expect(await service(actor, 'navigation.background-context', GROUP_ID)).toMatchObject({ sharingEnabled: false, session: null, target: null });
      await service(actor, 'navigation.set-sharing', true, LEADER);
      expect(await service(actor, 'navigation.cancel', session.id, session.version)).toMatchObject({ status: 'cancelled' });
      const second = await service(actor, 'navigation.start', GROUP_ID, DESTINATION, 'service-session-two', true);
      expect(await service(actor, 'navigation.complete', second.id, second.version)).toMatchObject({ status: 'completed' });
      expect(await service(actor, 'navigation.active', GROUP_ID)).toBeNull();
    } finally { await world.close(); }
  });

  it('MAP-NAV-04 the supported follower hook starts and stops a personal route without changing the shared team phase', async () => {
    const world = new World();
    try {
      const actor = await device(world, PEER);
      const before = structuredClone(world.backend.groups.get(GROUP_ID));
      await actor.perform('journey.start', { destinationId: DESTINATION });
      const local = await world.waitFor(actor, (value: { journey: { targetId?: string | null } }) => value.journey.targetId === DESTINATION, 'real personal route hook target');
      expect(local.journey).toMatchObject({ targetId: DESTINATION, sharedTargetId: null, status: 'going' });
      expect(world.backend.sessions.size).toBe(0);
      expect(world.backend.groups.get(GROUP_ID)).toEqual(before);
      expect(local.durable.operations).toEqual([]);
      await actor.perform('journey.stop');
      await world.waitFor(actor, (value: { journey: { targetId?: string | null } }) => !value.journey.targetId, 'personal stop');
      expect(world.backend.groups.get(GROUP_ID)).toEqual(before);
    } finally { await world.close(); }
  });

  it('MAP-GATHER-01 MAP-GATHER-02 MAP-ARRIVAL-01 real suggestions and arrival services keep personal audit separate from history correction', async () => {
    const world = new World();
    try {
      const actor = await device(world);
      const peer = await device(world, PEER, 'peer');
      const requestId = await service(peer, 'gathering.suggest', GROUP_ID, null, [{ title: 'Suggested', coordinates: { latitude: 25.2, longitude: 121.6 }, day: 4 }]);
      await world.settle();
      expect(await service(actor, 'gathering.pending', GROUP_ID)).toEqual([expect.objectContaining({ id: requestId, items: [expect.objectContaining({ day: null })] })]);
      expect(await service(actor, 'gathering.resolve', requestId, false)).toMatchObject({ status: 'rejected' });
      const second = await service(peer, 'gathering.suggest', GROUP_ID, null, [{ title: 'Approved', coordinates: { latitude: 25.3, longitude: 121.7 } }]);
      await world.settle();
      expect(await service(actor, 'gathering.resolve-resilient', second, true, { groupId: GROUP_ID })).toMatchObject({ status: 'approved' });
      await world.settle();
      const session = await service(actor, 'navigation.start', GROUP_ID, DESTINATION, 'arrival-session');
      await service(peer, 'gathering.arrival', DESTINATION, PEER, true, session.id);
      await world.settle();
      expect(await service(actor, 'gathering.arrivals', GROUP_ID)).toEqual(expect.arrayContaining([expect.objectContaining({ userId: PEER, navigationSessionId: session.id })]));
      await service(peer, 'gathering.arrival-at', DESTINATION, PEER, false, null, session.id);
      await world.settle();
      expect(await service(actor, 'gathering.arrivals', GROUP_ID)).toEqual([]);
      await service(actor, 'destination.complete', GROUP_ID, DESTINATION, session.id);
      await world.settle();
      await service(actor, 'gathering.correct-arrival', { destinationId: DESTINATION, targetUserId: PEER, arrived: true, sessionId: session.id });
      await world.settle();
      const correction = world.backend.trace.find((call: { args?: { p_operation_type?: string } }) => call.args?.p_operation_type === 'leader_correct_arrival');
      expect(correction.args.p_payload).toMatchObject({ actorId: LEADER, targetUserId: PEER, arrivedAt: null, source: 'leader_correction', sessionId: session.id });
      await service(actor, 'history.record', GROUP_ID, 'Visited', { latitude: 25.4, longitude: 121.8 });
      const history = await service(actor, 'history.list', GROUP_ID);
      expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Visited', userId: LEADER })]));
      const row = history.find((item: { name: string }) => item.name === 'Visited');
      await service(actor, 'history.delete', row.id);
      expect((await service(actor, 'history.list', GROUP_ID)).some((item: { id: string }) => item.id === row.id)).toBe(false);
    } finally { await world.close(); }
  });
});
