import type { CoreGroupSnapshot, CoreOperation } from '../types/coreData';

const { World } = require('../../test/headless/world.cjs');
const { GROUP_ID, LEADER, PEER, DESTINATION } = require('../../test/headless/backend.cjs');

type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type Observation = {
  presentation: { hosts: { testId?: string; checked?: boolean; text?: string }[];
    mapRoutePoints: { latitude: number; longitude: number }[] | null;
    mapMembers: NonNullable<CoreGroupSnapshot['members']> | null; preferences: { sharingEnabled: boolean } };
  durable: { snapshot: CoreGroupSnapshot; operations: CoreOperation[]; locations: { id: string; actor_id: string }[] };
  external: { watches: number; alerts: number; alertDetails: { message: string }[];
    backgroundTasks: { name: string; options: { timeInterval: number; distanceInterval: number; accuracy: number } }[] };
  native: { location: { running: boolean }; activities: { navigationSessionId: string }[];
    receipts: { method: string; value?: { timeInterval?: number; activityType?: number } }[] };
};
type SyncCall = { name: string; deviceId: string; args: { p_core_operations: { operation_id: string }[];
  p_location_events: { id: string; actorId: string }[]; p_refresh: { requestPeers?: boolean; requestedAt?: string } } };
const has = (value: Observation, id: string) => value.presentation.hosts.some(host => host.testId === id);

describe.each(['ios', 'android'])('changed location exchange on %s', platform => {
  jest.setTimeout(120000);
  async function map(world: InstanceType<typeof World>, id: string, userId: string) {
    const device = await world.device({ id, userId, platform, capabilities: { nativeLocation: true },
      screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: Observation) => has(value, `gather-card-${DESTINATION}`), 'mounted Map destination');
    await device.gps(userId === LEADER ? 25.02 : 25.01, 121.52, { accuracy: 5 });
    await world.settle();
    return device;
  }
  async function expand(world: InstanceType<typeof World>, device: Device) {
    for (const phase of ['onBegin', 'onUpdate', 'onEnd']) await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase,
      value: phase === 'onBegin' ? {} : { translationY: -250, velocityY: 0 }, success: true });
    await world.settle();
  }

  it('MAP-LOC-01 MAP-ARRIVAL-02 shows SDK interruption until a new fix and stops only the arrived personal route', async () => {
    const world = new World();
    try {
      const leader = await map(world, 'health-arrival', LEADER);
      await leader.input({ kind: 'mapsConfigure', patch: { route: { distanceMeters: 1000, expectedTravelTimeSeconds: 600,
        points: [{ latitude: 25.031, longitude: 121.53 }, { latitude: 25.04, longitude: 121.53 }] } } });
      const interrupted = (value: Observation) => value.presentation.hosts.some(host =>
        /Location updates interrupted|定位更新已中斷/.test(host.text ?? ''));
      expect(interrupted(await leader.observe())).toBe(false);
      await leader.input({ kind: 'locationError', message: 'Location provider unavailable' });
      await world.waitFor(leader, interrupted, 'visible SDK interruption');
      await world.advance(1000);
      await leader.gps(25.03, 121.53, { accuracy: 5 });
      await world.waitFor(leader, (value: Observation) => !interrupted(value), 'new fix clears interruption');
      await leader.perform('map.card.toggle', { destinationId: DESTINATION });
      const watches = (await leader.observe()).external.watches;
      await leader.perform('map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(leader, (value: Observation) => value.external.watches > watches, 'Start fresh-fix watcher');
      await world.advance(1000);
      await leader.gps(25.031, 121.53, { accuracy: 5 });
      await world.waitFor(leader, (value: Observation) => Boolean(value.presentation.mapRoutePoints?.length), 'active self route rendered');
      await world.advance(1000);
      await leader.gps(25.04, 121.53, { accuracy: 5 });
      await world.waitFor(leader, (value: Observation) => value.presentation.mapRoutePoints === null
        && world.backend.tables.destination_arrivals.some((row: { user_id: string }) => row.user_id === LEADER), 'arrival clears only personal route');
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      const routeRequests = (value: { maps: { receipts: { method: string; value?: { action?: string } }[] } }) =>
        value.maps.receipts.filter(receipt => receipt.method === 'maps.getDirections'
          || receipt.method === 'maps.proxy' && receipt.value?.action === 'route').length;
      const requestsAtArrival = routeRequests(await leader.observe());
      await world.advance(60000);
      await leader.gps(25.041, 121.531, { accuracy: 5 });
      const sharing: Observation = await world.waitFor(leader, () =>
        world.backend.locations.get(`${GROUP_ID}:${LEADER}`)?.latitude === 25.041, 'sharing continues after personal arrival');
      expect(sharing.presentation.preferences.sharingEnabled).toBe(true);
      expect(sharing.presentation.mapRoutePoints).toBeNull();
      expect(routeRequests(await leader.observe())).toBe(requestsAtArrival);
    } finally { await world.close(); }
  });

  it('MAP-NAV-02 MAP-LOC-03 exchanges offline Start and GPS once and consumes the returned peer snapshot', async () => {
    const world = new World();
    try {
      const leader = await map(world, 'mixed-leader', LEADER);
      const peer = await map(world, 'mixed-peer', PEER);
      await world.advance(300000);
      leader.online = false;
      leader.realtime = false;
      await leader.perform('map.card.toggle', { destinationId: DESTINATION });
      const watches = (await leader.observe()).external.watches;
      await leader.perform('map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(leader, (value: Observation) => value.external.watches > watches, 'actual Start fresh-fix watcher');
      await world.advance(1000);
      await leader.gps(25.025, 121.525, { accuracy: 5 });
      const pending: Observation = await world.waitFor(leader, (value: Observation) =>
        value.durable.operations.some(row => row.operationType === 'start_gathering') && value.durable.locations.length > 0, 'both durable offline queues');
      const operation = pending.durable.operations.find(row => row.operationType === 'start_gathering');
      if (!operation) throw new Error('Expected durable Start operation');
      const operationId = operation.id;
      const locationIds = pending.durable.locations.map(row => row.id);
      await peer.gps(25.015, 121.515, { accuracy: 5 });
      await world.waitFor(peer, () => world.backend.locations.get(`${GROUP_ID}:${PEER}`)?.latitude === 25.015, 'peer upload while leader disconnected');
      await world.settle();
      expect((await leader.observe()).durable.locations.map((row: { id: string }) => row.id).sort()).toEqual([...locationIds].sort());
      world.check();
      expect(leader.pending.size).toBe(0);
      expect(leader.child.kill()).toBe(true);
      let exitTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([leader.exited, new Promise((_, reject) => {
          exitTimer = setTimeout(() => reject(new Error('Intentional process stop deadline')), 5000);
        })]);
      } finally { clearTimeout(exitTimer); }
      leader.child = null;
      await leader.boot();
      await world.settle();
      const restored: Observation = await leader.observe();
      expect(restored.durable.operations.some(row => row.id === operationId)).toBe(true);
      expect(restored.durable.locations.map(row => row.id).sort()).toEqual([...locationIds].sort());
      leader.online = true;
      for (let attempt = 0; attempt < 12; attempt++) {
        await world.advance(30000);
        const progress: Observation = await leader.observe();
        if (progress.durable.operations.length === 0 && progress.durable.locations.length === 0) break;
      }
      const settled: Observation = await world.waitFor(leader, (value: Observation) => value.durable.operations.length === 0
        && value.durable.locations.length === 0 && value.durable.snapshot.members?.some(member => member.userId === PEER && member.coordinates?.latitude === 25.015), 'mixed ACK and returned peer state');
      const mixed = world.backend.trace.filter((call: SyncCall) => call.deviceId === 'mixed-leader' && call.name === 'sync_group'
        && call.args.p_core_operations.some(row => row.operation_id === operationId) && call.args.p_location_events.some(row => locationIds.includes(row.id)));
      expect(mixed).toHaveLength(1);
      expect(mixed[0].args.p_location_events.every((row: { actorId: string }) => row.actorId === LEADER)).toBe(true);
      expect(settled.durable.snapshot.activeGathering.activeDestinationId).toBe(DESTINATION);
      await world.advance(300);
      await world.waitFor(peer, (value: Observation) => value.durable.snapshot.activeGathering.activeDestinationId === DESTINATION, 'recipient shared Start');
    } finally { await world.close(); }
  });

  it('MAP-LOC-03 actual members refresh reads without self GPS and handles the peer command without a push hint', async () => {
    const world = new World();
    try {
      const leader = await map(world, 'refresh-leader', LEADER);
      const peer = await map(world, 'refresh-peer', PEER);
      await world.advance(300000);
      await leader.input({ kind: 'permission', status: 'denied' });
      await expand(world, leader);
      const before = world.backend.trace.length;
      await leader.perform('map.location.refresh');
      await world.waitFor(leader, () => world.backend.locationRefreshes.length === 1, 'peer refresh ledger without self GPS');
      const request = world.backend.locationRefreshes[0];
      expect(request.recipient_ids).toEqual([PEER]);
      expect(request.acknowledgements).toEqual([]);
      expect(world.backend.trace.slice(before).some((call: SyncCall) => call.deviceId === 'refresh-leader' && call.name === 'sync_group')).toBe(true);
      const watches = (await peer.observe()).external.watches;
      await world.advance(1);
      await peer.gps(25.033, 121.533, { accuracy: 5 });
      await world.waitFor(peer, (value: Observation) => value.external.watches > watches, 'ordinary exchange command starts peer refresh without a push');
      expect(request.acknowledgements).toEqual([]);
      await world.advance(1);
      await peer.gps(25.034, 121.534, { accuracy: 5 });
      await world.waitFor(peer, () => request.acknowledgements.includes(PEER), 'peer accepted sample and exact request ACK');
      await world.advance(2000);
      const result: Observation = await world.waitFor(leader, (value: Observation) => value.external.alertDetails.some(alert =>
        /已讀取伺服器|Server data refreshed/.test(alert.message)), 'members refresh result');
      expect(result.external.alertDetails.some(alert => /1\s*\/\s*1|1 of 1/.test(alert.message))).toBe(true);
      expect(result.external.alertDetails.some(alert => /已讀取伺服器|Server data refreshed/.test(alert.message))).toBe(true);
      expect(result.external.alertDetails.some(alert => /尚未確認上傳|not confirmed/.test(alert.message))).toBe(true);
      expect(result.durable.snapshot.members?.find(member => member.userId === PEER)?.coordinates?.latitude).toBe(25.034);
      await leader.input({ kind: 'alert', index: 0 });
      await leader.perform('map.location.refresh');
      await world.settle();
      expect(world.backend.locationRefreshes).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('MAP-LOC-07 MAP-MEET-01 passive background callback uploads at 600 seconds and explicit captain schedule starts shared navigation once', async () => {
    const world = new World();
    world.backend.groups.get(GROUP_ID).straggler_alerts = true;
    world.backend.liveUnlocks = new Set([LEADER]);
    try {
      const leader = await map(world, 'scheduled-leader', LEADER);
      const peer = await map(world, 'scheduled-peer', PEER);
      await expand(world, leader);
      await leader.perform('map.tab', { index: 2 });
      await leader.perform('map.live-activity.toggle', { enabled: true });
      await world.waitFor(leader, (value: Observation) => value.presentation.hosts.some(host => host.testId === 'tools-live-activity-toggle' && host.checked), 'entitled Live Activity preference');
      await leader.perform('map.tab', { index: 0 });
      await leader.input({ kind: 'appState', value: 'background' });
      const passive: Observation = await world.waitFor(leader, (value: Observation) => value.external.backgroundTasks.length === 1, 'idle sharing background owner');
      expect(passive.external.backgroundTasks[0].options).toMatchObject({ timeInterval: 600000, distanceInterval: 300, accuracy: 3 });
      await world.advance(600000);
      const sample = { timestamp: world.now, coords: { latitude: 25.021, longitude: 121.511, accuracy: 5 }, stationary: false };
      await leader.input({ kind: 'task', name: passive.external.backgroundTasks[0].name, value: { data: { locations: [sample] }, error: null } });
      await world.settle();
      await world.advance(250);
      await world.waitFor(peer, (value: Observation) => value.presentation.mapMembers?.some(member => member.userId === LEADER
        && member.coordinates?.latitude === sample.coords.latitude && member.coordinates.longitude === sample.coords.longitude
        && member.capturedAt === new Date(sample.timestamp).toISOString() && member.locationSource === 'background_task'), 'passive callback renders for recipient');
      const acceptedEventId = [...world.backend.locationEvents.values()].find((event: {
        id: string; actorId: string; capturedAt: number; source: string;
      }) => event.actorId === LEADER && event.capturedAt === sample.timestamp && event.source === 'background_task')?.id;
      expect(world.backend.locationReceipts.get(acceptedEventId)).toMatchObject({
        groupId: GROUP_ID, capturedAt: sample.timestamp, receivedAt: new Date(sample.timestamp).toISOString(),
      });
      expect(world.backend.tables.group_alerts.filter((row: { kind: string }) => row.kind === 'straggler')).toEqual([]);
      await leader.input({ kind: 'appState', value: 'active' });
      await leader.perform('map.card.toggle', { destinationId: DESTINATION });
      await leader.perform('map.meet.open', { destinationId: DESTINATION });
      await leader.perform('map.meet.shortcut', { minutes: 10 });
      await leader.perform('map.meet.save');
      await world.waitFor(leader, () => Boolean(world.backend.itinerary[0].meet_schedule_occurrence_id), 'captain persisted schedule occurrence');
      const destination = world.backend.itinerary[0];
      const due = Date.parse(destination.meet_at);
      await world.advance(due - world.now - 1);
      await world.processMeetTimes();
      expect(world.backend.sessions.size).toBe(0);
      await world.advance(1);
      expect(world.backend.sessions.size).toBe(0);
      await world.processMeetTimes();
      await world.advance(300);
      const session = world.backend.sessions.get(destination.meet_schedule_occurrence_id);
      expect(session).toMatchObject({ origin: 'scheduled', started_by: LEADER, destination_id: DESTINATION });
      for (const device of [leader, peer]) await world.waitFor(device, (value: Observation) =>
        value.durable.snapshot.activeGathering.activeDestinationId === DESTINATION && value.durable.snapshot.group.journeyStatus === 'going', 'scheduled shared navigation projection');
      if (platform === 'ios') await world.waitFor(leader, (value: Observation) => value.native.activities.some(activity => activity.navigationSessionId === session.id), 'supported scheduled Live Activity intent');
      expect(await world.processMeetTimes()).toBe(0);
      expect(world.backend.sessions.size).toBe(1);
      expect(world.backend.scheduledPushes.some((push: { category: string; entity_id: string; sender_id: string }) =>
        push.category === 'navigation_session' && push.entity_id === session.id && push.sender_id === LEADER)).toBe(true);
      await leader.input({ kind: 'appState', value: 'background' });
      const active: Observation = await world.waitFor(leader, (value: Observation) => platform === 'ios'
        ? value.native.location.running : value.external.backgroundTasks.some(task => task.options.timeInterval < 600000), 'active background owner cadence');
      if (platform === 'ios') expect(active.native.receipts.some(receipt => receipt.method === 'nativeLocation.start'
        && receipt.value?.timeInterval !== undefined && receipt.value.timeInterval < 600000 && receipt.value.activityType === 1)).toBe(true);
      else {
        expect(active.external.backgroundTasks[0].options.timeInterval).toBeLessThan(600000);
        expect(active.external.backgroundTasks[0].options.accuracy).toBe(4);
      }
    } finally { await world.close(); }
  });
});
