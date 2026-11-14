import type { CoreGroupSnapshot, CoreOperation } from '../types/coreData';

const { setTimeout: realTimeout, clearTimeout: clearRealTimeout } = require('node:timers');
const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type MapObservation = {
  pid: number;
  actorId: string;
  presentation: { mapRoutePoints: unknown[] | null; receipts: { host: string; method?: string; action?: string }[]; hosts: { testId?: string; label?: string; text?: string; disabled?: boolean }[] };
  external: { watches: number; alertDetails: unknown[] };
  durable: { snapshot: CoreGroupSnapshot; operations: CoreOperation[] };
};
type CoreCall = {
  deviceId: string;
  name: string;
  userId: string;
  args: { p_actor_id: string; p_core_operations: { operation_id: string; operation_type: string; dependency_ids: string[];
    sequence: number; payload: Record<string, unknown> }[] };
};

const control = (value: MapObservation, id: string) => value.presentation.hosts.find(host => host.testId === id);

describe.each(['ios', 'android'])('actual Map offline journey parent on %s', platform => {
  jest.setTimeout(120000);
  const ios = platform === 'ios';
  const journeyId = ios ? 'home-journey-action' : `gather-nav-${DESTINATION}`;
  const readyLabel = ios ? 'Start' : '開始';
  const activeLeaderLabel = ios ? 'On the way, hold to end navigation' : '結束導航';
  const activeMemberLabel = ios ? 'On the way' : '前往中';
  const requestLabel = ios ? 'Ask leader to start' : '向隊長發送要求開始';

  async function prepare(world: InstanceType<typeof World>, device: Device) {
    const cardId = ios ? 'home-itinerary-toggle' : `gather-card-${DESTINATION}`;
    await world.waitFor(device, (value: MapObservation) => Boolean(control(value, cardId)), 'rendered Map destination');
    if (!ios) await device.perform('map.card.toggle', { destinationId: DESTINATION });
  }

  async function pressStart(device: Device) {
    if (ios) {
      for (const event of ['onPressIn', 'onPressOut']) {
        expect(await device.host.call({ kind: 'nativeEvent', testId: journeyId, value: { event } })).toEqual({ invoked: true });
      }
    }
    expect(await device.host.call({ kind: 'press', testId: journeyId })).toEqual({ invoked: true });
  }

  async function pressEnd(device: Device) {
    if (!ios) {
      await pressStart(device);
      return;
    }
    for (const event of ['onPressIn', 'onLongPress', 'onPressOut']) {
      expect(await device.host.call({ kind: 'nativeEvent', testId: journeyId, value: { event } })).toEqual({ invoked: true });
    }
  }

  it.each(['missing', 'inaccurate'])('MAP-NAV-01 starts offline with %s GPS and follows on the peer only after receipt', async signal => {
    const world = new World();
    try {
      const leader: Device = await world.device({ id: 'leader', userId: LEADER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      const peer: Device = await world.device({ id: 'peer', userId: PEER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      for (const device of [leader, peer]) await prepare(world, device);
      leader.online = false;
      if (signal === 'inaccurate') await leader.gps(25.03, 121.53, { accuracy: 500, timestamp: world.now });
      await pressStart(leader);
      await world.advance(1000);
      const started: MapObservation = await leader.observe();
      expect(control(started, journeyId)?.label).toBe(activeLeaderLabel);
      expect(started.external.alertDetails).toEqual([]);
      if (!ios) expect(control(started, `gather-route-status-${DESTINATION}`)?.text).toBe('等待定位');
      expect(started.presentation.mapRoutePoints).toBeNull();
      expect(started.durable.operations).toEqual([expect.objectContaining({ operationType: 'start_gathering' })]);
      expect(world.backend.sessions.size).toBe(0);
      expect(control(await peer.observe(), journeyId)?.label).not.toBe(activeMemberLabel);

      leader.online = true;
      await world.advance(120000);
      await world.waitFor(leader, (value: MapObservation) => value.durable.operations.length === 0, 'offline Start acknowledged');
      const followed: MapObservation = await world.waitFor(peer, (value: MapObservation) =>
        value.durable.snapshot.activeGathering.activeDestinationId === DESTINATION
        && value.durable.snapshot.activeGathering.journeyPhase === 'en_route', 'peer follows acknowledged Start');
      if (!control(followed, journeyId)) {
        await peer.perform('map.card.toggle', { destinationId: DESTINATION });
      }
      expect(control(await peer.observe(), journeyId)?.label).toBe(activeMemberLabel);
      expect([...world.backend.sessions.values()]).toEqual([expect.objectContaining({
        id: started.durable.operations[0].id, status: 'active', started_by: LEADER,
      })]);
    } finally { await world.close(); }
  });

  it.each(['permission', 'services'])('MAP-NAV-01 gives distinct Settings guidance when %s blocks location', async blocker => {
    const world = new World();
    try {
      const device: Device = await world.device({ id: 'leader', userId: LEADER, platform,
        capabilities: { locationServices: blocker !== 'services' }, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      await prepare(world, device);
      if (blocker === 'permission') {
        await device.input({ kind: 'appState', value: 'background' });
        await device.input({ kind: 'permission', status: 'denied' });
        await device.input({ kind: 'appState', value: 'active' });
        await world.settle();
      }
      await pressStart(device);
      await world.settle();
      const blocked: MapObservation = await device.observe();
      if (blocker === 'permission' && ios) {
        expect(blocked.external.alertDetails[0]).toMatchObject({
          message: 'Location has not started. Enable location access in Settings.',
          buttons: ['Cancel', 'Open Settings'],
        });
      }
      expect(blocked.external.alertDetails.at(-1)).toEqual(expect.objectContaining({
        message: blocker === 'permission'
          ? ios ? 'Location permission is unavailable. Enable it in Settings.' : '目前無法取得定位權限，請至設定開啟。'
          : ios ? 'Turn on Location Services in your device settings.' : '請在裝置設定中開啟定位服務。',
        buttons: ios ? blocker === 'services' ? ['OK'] : ['OK', 'Open Settings'] : ['好', '前往設定'],
      }));
      if (blocker === 'permission' || platform === 'android') {
        await device.input({ kind: 'alert', index: 1 });
        const opened: MapObservation = await device.observe();
        expect(opened.presentation.receipts).toContainEqual(blocker === 'permission'
          ? { host: 'Linking', method: 'openSettings' }
          : { host: 'Linking', method: 'sendIntent', action: 'android.settings.LOCATION_SOURCE_SETTINGS' });
      }
      expect(blocked.durable.operations).toEqual([]);
      expect(world.backend.sessions.size).toBe(0);
    } finally { await world.close(); }
  });

  it('MAP-NAV-01 starts and ends locally while the first team sync is held', async () => {
    const world = new World();
    try {
      const leader: Device = await world.device({ id: 'leader', userId: LEADER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      await prepare(world, leader);
      await world.settle();
      world.hold('sync_group', {
        deviceId: 'leader',
        matches: ({ args }: CoreCall) => args.p_core_operations.some(row => row.operation_type === 'start_gathering'),
      });
      await leader.input({ kind: 'permissionRead', action: 'holdNext' });
      await pressStart(leader);
      await world.advance(1000);
      const started: MapObservation = await leader.observe();
      expect(control(started, journeyId)).toMatchObject({ label: activeLeaderLabel, disabled: false });
      expect(started.durable.snapshot.activeGathering.journeyPhase).toBe('en_route');
      expect(started.durable.operations).toEqual([expect.objectContaining({ operationType: 'start_gathering' })]);
      expect(world.held).toHaveLength(1);
      expect(world.backend.sessions.size).toBe(0);

      await pressEnd(leader);
      const ended: MapObservation = await world.waitFor(leader, (value: MapObservation) =>
        value.durable.operations.length === 2, 'End is saved while Start is still waiting for transport');
      expect(control(ended, journeyId)?.label).toBe(readyLabel);
      const [start, end] = ended.durable.operations;
      expect(end).toMatchObject({ operationType: 'end_gathering', dependencyIds: [start.id] });
      expect(world.backend.sessions.size).toBe(0);
      await world.release('sync_group');
      await world.advance(1000);
      await world.waitFor(leader, (value: MapObservation) => value.durable.operations.length === 0, 'both commands acknowledged');
      expect([...world.backend.sessions.values()]).toEqual([expect.objectContaining({ id: start.id, status: 'cancelled' })]);
    } finally { await world.close(); }
  });

  it('MAP-NAV-01 restores the local journey when the server rejects a revoked leader', async () => {
    const world = new World();
    try {
      const leader: Device = await world.device({ id: 'leader', userId: LEADER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      await prepare(world, leader);
      world.hold('sync_group', {
        deviceId: 'leader',
        matches: ({ args }: CoreCall) => args.p_core_operations.some(row => row.operation_type === 'start_gathering'),
      });
      await pressStart(leader);
      await world.advance(1000);
      const started: MapObservation = await leader.observe();
      expect(control(started, journeyId)?.label).toBe(activeLeaderLabel);
      expect(started.durable.snapshot.activeGathering.journeyPhase).toBe('en_route');
      expect(world.held).toHaveLength(1);

      await pressEnd(leader);
      await world.waitFor(leader, (value: MapObservation) =>
        control(value, journeyId)?.label === readyLabel, 'local End');
      await pressStart(leader);
      const restarted: MapObservation = await world.waitFor(leader, (value: MapObservation) =>
        value.durable.operations.length === 3, 'local restart while the first Start is held');
      expect(restarted.durable.operations.map(row => row.operationType)).toEqual(['start_gathering', 'end_gathering', 'start_gathering']);
      expect(restarted.durable.snapshot.activeGathering.journeyPhase).toBe('en_route');

      const membership = world.backend.memberships.find((row: { user_id: string }) => row.user_id === LEADER);
      membership.role = 'member';
      await world.release('sync_group');
      const rejected: MapObservation = await world.waitFor(leader, (value: MapObservation) =>
        value.durable.operations.some(row => row.conflictResult?.code === 'unauthorized'), 'server refusal recorded');
      expect(rejected.durable.operations.map(row => row.status)).toEqual(['conflict', 'conflict', 'conflict']);
      expect(rejected.durable.snapshot.activeGathering.journeyPhase).toBe('staying');
      await world.waitFor(leader, (value: MapObservation) =>
        control(value, journeyId)?.label === requestLabel, 'revoked leader sees the member action');
      expect(world.backend.sessions.size).toBe(0);
    } finally { await world.close(); }
  });

  it('MAP-NAV-02 MAP-NAV-05 replays offline card Start then End with their original identities after abrupt offline restart', async () => {
    const world = new World();
    try {
      const leader: Device = await world.device({ id: 'leader', userId: LEADER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      const peer: Device = await world.device({ id: 'peer', userId: PEER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      for (const device of [leader, peer]) await prepare(world, device);
      const itineraryBefore = structuredClone(world.backend.itinerary);
      const originalPid = (await leader.observe()).pid;
      const peerSyncedAt = (await peer.observe()).durable.snapshot.syncedAt;
      leader.online = false;
      await pressStart(leader);
      const started: MapObservation = await world.waitFor(leader, (value: MapObservation) =>
        value.durable.operations.length === 1 && control(value, journeyId)?.label === activeLeaderLabel, 'offline Map Start is durable and actionable');
      expect(started.durable.snapshot.activeGathering).toMatchObject({ journeyPhase: 'en_route', activeDestinationId: DESTINATION });
      expect(started.durable.operations[0]).toMatchObject({ actorId: LEADER, groupId: GROUP_ID, operationType: 'start_gathering',
        payload: { activeDestinationId: DESTINATION, navigationRequestId: started.durable.operations[0].id } });
      expect(started.external.alertDetails).toEqual([]);
      await pressEnd(leader);
      const ended: MapObservation = await world.waitFor(leader, (value: MapObservation) =>
        value.durable.operations.length === 2 && control(value, journeyId)?.label === readyLabel, 'offline Map End retains terminal intent');
      const [start, end] = ended.durable.operations;
      const ids = [start.id, end.id];
      expect(ids[0]).not.toBe(ids[1]);
      expect(ended.durable.operations.map(row => row.operationType)).toEqual(['start_gathering', 'end_gathering']);
      expect(end).toMatchObject({ actorId: LEADER, groupId: GROUP_ID,
        payload: { navigationSessionId: start.id }, dependencyIds: expect.arrayContaining([start.id]) });
      expect(end.sequence).toBeGreaterThan(start.sequence!);
      expect(ended.durable.snapshot.activeGathering).toMatchObject({ journeyPhase: 'staying', activeDestinationId: DESTINATION,
        pointStatuses: { [DESTINATION]: 'pending' } });
      expect(world.backend.sessions.size).toBe(0);
      expect(world.backend.receipts.size).toBe(0);
      expect(world.backend.itinerary).toEqual(itineraryBefore);

      await world.settle();
      expect(leader.pending.size).toBe(0);
      leader.child.kill();
      let exitTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([leader.exited, new Promise((_, reject) => {
          exitTimer = realTimeout(() => reject(new Error('Intentional process stop deadline')), 5000);
        })]);
      } finally { clearRealTimeout(exitTimer); }
      leader.child = null;
      await leader.boot();
      const restored: MapObservation = await world.waitFor(leader, (value: MapObservation) =>
        Boolean(control(value, ios ? 'home-itinerary-toggle' : `gather-card-${DESTINATION}`)), 'Map restored from durable storage while offline');
      expect(restored.pid).not.toBe(originalPid);
      expect(restored.actorId).toBe(LEADER);
      expect(leader.online).toBe(false);
      expect(restored.durable.operations.map(row => ({ id: row.id, actorId: row.actorId, sequence: row.sequence,
        dependencyIds: row.dependencyIds, operationType: row.operationType, payload: row.payload }))).toEqual(
        ended.durable.operations.map(row => ({ id: row.id, actorId: row.actorId, sequence: row.sequence,
          dependencyIds: row.dependencyIds, operationType: row.operationType, payload: row.payload })));
      expect(restored.durable.snapshot.activeGathering).toMatchObject({ journeyPhase: 'staying', activeDestinationId: DESTINATION,
        pointStatuses: { [DESTINATION]: 'pending' } });
      if (!ios) await leader.perform('map.card.toggle', { destinationId: DESTINATION });
      expect(control(await leader.observe(), journeyId)?.label).toBe(readyLabel);
      expect(world.backend.sessions.size).toBe(0);

      leader.online = true;
      await world.advance(120000);
      await world.advance(300);
      const accepted: MapObservation = await world.waitFor(leader, (value: MapObservation) =>
        value.durable.operations.length === 0 && value.durable.snapshot.group.journeyStatus === 'paused'
          && value.durable.snapshot.activeGathering.activeDestinationId === null, 'FIFO replay retains End after both ACKs');
      const peerResult: MapObservation = await world.waitFor(peer, (value: MapObservation) =>
        value.durable.snapshot.syncedAt > peerSyncedAt && value.durable.snapshot.group.journeyStatus === 'paused'
          && value.durable.snapshot.activeGathering.journeyPhase === 'staying'
          && value.durable.snapshot.activeGathering.activeDestinationId === null, 'peer Map receives final paused journey');
      expect(accepted.durable.snapshot.activeGathering.pointStatuses[DESTINATION]).toBe('pending');
      if (!control(accepted, journeyId)) await leader.perform('map.card.toggle', { destinationId: DESTINATION });
      expect(control(await leader.observe(), journeyId)?.label).toBe(readyLabel);
      const peerDestination = peerResult.durable.snapshot.destinations.find(row => row.id === DESTINATION);
      expect(peerDestination).toMatchObject({ id: DESTINATION, title: 'Meeting point' });
      expect(peerDestination?.closedAt).toBeUndefined();
      expect(control(peerResult, `gather-complete-${DESTINATION}`)).toBeUndefined();
      expect(world.realtimeTrace).toContainEqual(expect.objectContaining({ deviceId: 'peer',
        event: expect.objectContaining({ table: 'navigation_sessions', new: expect.objectContaining({ id: start.id, status: 'cancelled' }) }) }));
      expect([...world.backend.sessions.values()]).toEqual([expect.objectContaining({ id: start.id, request_id: start.id,
        destination_id: DESTINATION, started_by: LEADER, status: 'cancelled' })]);
      expect(world.backend.groups.get(GROUP_ID)).toMatchObject({ journey_status: 'paused', active_destination_id: null });
      expect(world.backend.itinerary).toEqual(itineraryBefore);
      expect(world.backend.tables.destination_arrivals).toEqual([]);
      const exchanges: CoreCall[] = world.backend.trace.filter((call: CoreCall) => call.deviceId === 'leader' && call.name === 'sync_group' && call.args.p_core_operations.length > 0);
      const receipts = exchanges.flatMap(call => call.args.p_core_operations);
      expect(receipts.map(call => call.operation_id)).toEqual(ids);
      expect(receipts.map(call => call.operation_type)).toEqual(['start_gathering', 'end_gathering']);
      expect(exchanges.every(call => call.userId === LEADER && call.args.p_actor_id === LEADER)).toBe(true);
      expect(receipts.map(call => call.sequence)).toEqual([start.sequence, end.sequence]);
      expect(receipts[1].dependency_ids).toContain(start.id);
      expect(receipts[1].payload).toMatchObject({ navigationSessionId: start.id });
      expect([...world.backend.receipts.keys()]).toEqual(ids);
      expect(world.backend.receipts.get(end.id).entity).toMatchObject({ journeyPhase: 'staying', activeDestinationId: null });
    } finally { await world.close(); }
  });
});
