const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Observation = {
  presentation: { hosts: { testId?: string; label?: string; disabled?: boolean }[] };
  external: { watches: number; alertDetails: { title: string; message?: string; buttons: string[] }[] };
  durable: { snapshot: { destinations: { id: string; closedAt?: string }[] }; operations: { operationType: string; payload: { sessionId?: string; reason?: string } }[] };
};
type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
const has = (value: Observation, id: string) => value.presentation.hosts.some(host => host.testId === id);
const press = (device: Device, testId: string) => device.host.call({ kind: 'press', testId });

describe.each(['ios', 'android'])('leader force completion on %s', platform => {
  jest.setTimeout(120000);
  async function map(world: InstanceType<typeof World>, userId: string, id: string) {
    const device = await world.device({ id, userId, platform, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    const readyId = platform === 'ios' ? 'home-journey-action' : `gather-card-${DESTINATION}`;
    await world.waitFor(device, (value: Observation) => has(value, readyId), 'destination card');
    await device.perform('preferences.setLanguage', { args: ['zh'] });
    if (platform === 'android') await device.perform('map.card.toggle', { destinationId: DESTINATION });
    return device;
  }
  const visibleAction = platform === 'ios' ? 'd6-route-complete-early' : `gather-complete-${DESTINATION}`;
  async function readActions(device: Device) {
    if (platform === 'ios') {
      const value = await device.observe();
      if (!has(value, 'd6-route-options')) await press(device, 'home-itinerary-grabber');
      const opened = await device.observe();
      if (!has(opened, 'd6-route-options')) return false;
      expect(await press(device, 'd6-route-options')).toEqual({ invoked: true });
    }
    const available = has(await device.observe(), visibleAction);
    if (platform === 'ios') {
      await press(device, 'd6-route-close-options');
      await press(device, 'home-itinerary-grabber');
    }
    return available;
  }
  async function complete(device: Device) {
    if (platform === 'android') {
      await device.perform('map.journey.complete', { destinationId: DESTINATION });
    } else {
      const value = await device.observe();
      if (!has(value, 'd6-route-options')) await press(device, 'home-itinerary-grabber');
      expect(await press(device, 'd6-route-options')).toEqual({ invoked: true });
      expect(await press(device, visibleAction)).toEqual({ invoked: true });
    }
  }
  async function start(device: Device) {
    if (platform === 'ios') {
      for (const event of ['onPressIn', 'onPressOut']) {
        await device.host.call({ kind: 'nativeEvent', testId: 'home-journey-action', value: { event } });
      }
      expect(await press(device, 'home-journey-action')).toEqual({ invoked: true });
    } else await device.perform('map.journey.command', { destinationId: DESTINATION });
  }
  async function stop(device: Device) {
    if (platform === 'ios') {
      for (const event of ['onPressIn', 'onLongPress', 'onPressOut']) {
        await device.host.call({ kind: 'nativeEvent', testId: 'home-journey-action', value: { event } });
      }
    } else await device.perform('map.journey.command', { destinationId: DESTINATION });
  }

  it('MAP-GATHER-03 manual force completion confirms before closing the original active session without inventing arrivals', async () => {
    const world = new World();
    try {
      const leader = await map(world, LEADER, 'leader');
      expect(await readActions(leader)).toBe(false);
      await start(leader);
      await world.waitFor(leader, () => [...world.backend.sessions.values()].some((row: { status: string }) => row.status === 'active'), 'active shared session');
      const sessionId = [...world.backend.sessions.values()][0].id;
      const peer = await map(world, PEER, 'peer');
      expect(await readActions(peer)).toBe(false);
      expect(await readActions(leader)).toBe(true);
      await complete(leader);
      const prompt = (await leader.observe()).external.alertDetails.at(-1);
      expect(prompt).toMatchObject({ title: '完成集合點', message: '已抵達成員（0/2），是否要完成此集合點？' });
      await leader.input({ kind: 'alert', index: 0 });
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      expect([...world.backend.sessions.values()][0].status).toBe('active');
      expect(world.backend.tables.destination_arrivals).toHaveLength(0);
      expect((await leader.observe()).durable.operations).toEqual([]);
      world.hold('sync_group', { deviceId: 'leader', phase: 'execution', matches: (operation: { args: { p_core_operations: unknown[] } }) => operation.args.p_core_operations.length > 0 });
      await complete(leader);
      await leader.input({ kind: 'alert', index: 1 });
      const local = await world.waitFor(leader, (value: Observation) => value.durable.operations.some(row => row.operationType === 'complete_destination'), 'durable completion before transport');
      expect(local.durable.operations.find((row: { operationType: string }) => row.operationType === 'complete_destination').payload).toMatchObject({ sessionId, reason: 'forced' });
      expect(local.durable.snapshot.destinations.find((row: { id: string }) => row.id === DESTINATION).closedAt).toBeTruthy();
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      expect([...world.backend.sessions.values()][0].status).toBe('active');
      await world.release('sync_group');
      await world.waitFor(leader, () => !!world.backend.itinerary[0].closed_at, 'confirmed forced completion');
      expect([...world.backend.sessions.values()][0].status).toBe('completed');
      expect(world.backend.itinerary[0].closed_by_session_id).toBe(sessionId);
      expect(world.backend.tables.destination_arrivals).toHaveLength(0);
      await world.advance(300);
      await world.waitFor(peer, (value: Observation) => !!value.durable.snapshot.destinations.find(row => row.id === DESTINATION)?.closedAt, 'peer sees completed destination');
      await leader.restart();
      await world.waitFor(leader, (value: Observation) => !!value.durable.snapshot.destinations.find(row => row.id === DESTINATION)?.closedAt, 'completion survives restart');
      expect(has(await leader.observe(), visibleAction)).toBe(false);
      expect([...world.backend.sessions.values()]).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('MAP-GATHER-03 stale force confirmation cannot complete a replacement session after End and Start', async () => {
    const world = new World();
    try {
      const leader = await map(world, LEADER, 'leader');
      await start(leader);
      await world.waitFor(leader, () => [...world.backend.sessions.values()].some((row: { status: string }) => row.status === 'active'), 'first active session');
      const originalId = [...world.backend.sessions.values()][0].id;
      await complete(leader);
      await stop(leader);
      await world.waitFor(leader, () => world.backend.sessions.get(originalId).status === 'cancelled', 'End only cancels original session');
      await start(leader);
      await world.waitFor(leader, () => [...world.backend.sessions.values()].some((row: { id: string; status: string }) => row.id !== originalId && row.status === 'active'), 'replacement session');
      await leader.input({ kind: 'alert', index: 1 });
      await world.settle();
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      expect(world.backend.sessions.get(originalId).status).toBe('cancelled');
      expect([...world.backend.sessions.values()].filter((row: { status: string }) => row.status === 'active')).toHaveLength(1);
      expect(world.backend.tables.destination_arrivals).toHaveLength(0);
      expect((await leader.observe()).durable.operations).toEqual([]);
    } finally { await world.close(); }
  });

  it('MAP-GATHER-03 a subgroup leader can force complete only their active scoped destination', async () => {
    const world = new World();
    try {
      const subgroupId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      world.backend.tables.subgroups.push({ id: subgroupId, group_id: GROUP_ID, name: 'Peer subgroup', mode: 'led', leader_id: PEER, parent_subgroup_id: null });
      world.backend.memberships.find((row: { user_id: string }) => row.user_id === PEER).subgroup_id = subgroupId;
      world.backend.itinerary[0].subgroup_id = subgroupId;
      const started = world.backend.execute('fixture', { kind: 'rpc', name: 'apply_core_operation_v3', userId: PEER, steps: [],
        args: { p_operation_id: 'subgroup-start', p_group_id: GROUP_ID, p_actor_id: PEER, p_entity_type: 'active_gathering',
          p_entity_id: GROUP_ID, p_entity_version: 0, p_operation_type: 'start_gathering', p_sequence: 1,
          p_dependency_ids: [], p_created_at: new Date(world.now).toISOString(),
          p_payload: { action: 'start', subgroupId, activeDestinationId: DESTINATION, navigationRequestId: 'subgroup-session', navigationSessionId: null } } });
      expect(started.error).toBeNull();
      expect(started.data.status).toBe('accepted');
      const sessionId = [...world.backend.sessions.values()][0].id;
      const leader = await map(world, PEER, 'subgroup-leader');
      expect(await readActions(leader)).toBe(true);
      await complete(leader);
      expect((await leader.observe()).external.alertDetails.at(-1)?.message).toBe('已抵達成員（0/1），是否要完成此集合點？');
      await leader.input({ kind: 'alert', index: 1 });
      await world.waitFor(leader, () => !!world.backend.itinerary[0].closed_at, 'subgroup completion accepted');
      expect(world.backend.itinerary[0].closed_by_session_id).toBe(sessionId);
      expect(world.backend.sessions.get(sessionId)).toMatchObject({ status: 'completed', scope_subgroup_id: subgroupId });
      expect(world.backend.tables.destination_arrivals).toHaveLength(0);
    } finally { await world.close(); }
  });
});

export {};
