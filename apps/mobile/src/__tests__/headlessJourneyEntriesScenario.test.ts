import type { CoreGroupSnapshot, CoreOperation } from '../types/coreData';

const { setTimeout: realTimeout, clearTimeout: clearRealTimeout } = require('node:timers');
const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type MapObservation = {
  pid: number;
  actorId: string;
  presentation: { hosts: { testId?: string; label?: string; disabled?: boolean }[] };
  external: { watches: number; alertDetails: unknown[] };
  durable: { snapshot: CoreGroupSnapshot; operations: CoreOperation[] };
};
type CoreCall = {
  deviceId: string;
  name: string;
  args: { p_operation_id: string; p_operation_type: string; p_actor_id: string; p_dependency_ids: string[];
    p_sequence: number; p_payload: Record<string, unknown> };
};

const control = (value: MapObservation, id: string) => value.presentation.hosts.find(host => host.testId === id);

describe.each(['ios', 'android'])('actual Map offline journey parent on %s', platform => {
  jest.setTimeout(120000);

  it('MAP-NAV-02 MAP-NAV-05 replays offline card Start then End with their original identities after abrupt offline restart', async () => {
    const world = new World();
    try {
      const leader: Device = await world.device({ id: 'leader', userId: LEADER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      const peer: Device = await world.device({ id: 'peer', userId: PEER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      for (const device of [leader, peer]) {
        await world.waitFor(device, (value: MapObservation) => !!control(value, `gather-card-${DESTINATION}`), 'rendered Map destination');
        await device.perform('map.card.toggle', { destinationId: DESTINATION });
      }
      const itineraryBefore = structuredClone(world.backend.itinerary);
      const originalPid = (await leader.observe()).pid;
      const peerSyncedAt = (await peer.observe()).durable.snapshot.syncedAt;
      leader.online = false;
      const previousWatches = (await leader.observe()).external.watches;
      await leader.perform('map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(leader, (value: MapObservation) => value.external.watches > previousWatches, 'card Start requests a fresh GPS fix offline');
      await world.advance(1000);
      await leader.gps(25.03, 121.53, { accuracy: 5, timestamp: world.now });
      const started: MapObservation = await world.waitFor(leader, (value: MapObservation) =>
        value.durable.operations.length === 1 && control(value, `gather-nav-${DESTINATION}`)?.label === '結束導航', 'offline Map Start is durable and actionable');
      expect(started.durable.snapshot.activeGathering).toMatchObject({ journeyPhase: 'en_route', activeDestinationId: DESTINATION });
      expect(started.durable.operations[0]).toMatchObject({ actorId: LEADER, groupId: GROUP_ID, operationType: 'start_gathering',
        payload: { activeDestinationId: DESTINATION, navigationRequestId: started.durable.operations[0].id } });
      expect(started.external.alertDetails).toEqual([]);
      await leader.perform('map.journey.command', { destinationId: DESTINATION });
      const ended: MapObservation = await world.waitFor(leader, (value: MapObservation) =>
        value.durable.operations.length === 2 && control(value, `gather-nav-${DESTINATION}`)?.label === '開始', 'offline Map End retains terminal intent');
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
        !!control(value, `gather-card-${DESTINATION}`), 'Map restored from durable storage while offline');
      expect(restored.pid).not.toBe(originalPid);
      expect(restored.actorId).toBe(LEADER);
      expect(leader.online).toBe(false);
      expect(restored.durable.operations.map(row => ({ id: row.id, actorId: row.actorId, sequence: row.sequence,
        dependencyIds: row.dependencyIds, operationType: row.operationType, payload: row.payload }))).toEqual(
        ended.durable.operations.map(row => ({ id: row.id, actorId: row.actorId, sequence: row.sequence,
          dependencyIds: row.dependencyIds, operationType: row.operationType, payload: row.payload })));
      expect(restored.durable.snapshot.activeGathering).toMatchObject({ journeyPhase: 'staying', activeDestinationId: DESTINATION,
        pointStatuses: { [DESTINATION]: 'pending' } });
      await leader.perform('map.card.toggle', { destinationId: DESTINATION });
      expect(control(await leader.observe(), `gather-nav-${DESTINATION}`)?.label).toBe('開始');
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
      if (!control(accepted, `gather-nav-${DESTINATION}`)) await leader.perform('map.card.toggle', { destinationId: DESTINATION });
      expect(control(await leader.observe(), `gather-nav-${DESTINATION}`)?.label).toBe('開始');
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
      const receipts: CoreCall[] = world.backend.trace.filter((call: CoreCall) => call.deviceId === 'leader' && call.name === 'apply_core_operation_v3');
      expect(receipts.map(call => call.args.p_operation_id)).toEqual(ids);
      expect(receipts.map(call => call.args.p_operation_type)).toEqual(['start_gathering', 'end_gathering']);
      expect(receipts.map(call => call.args.p_actor_id)).toEqual([LEADER, LEADER]);
      expect(receipts.map(call => call.args.p_sequence)).toEqual([start.sequence, end.sequence]);
      expect(receipts[1].args.p_dependency_ids).toContain(start.id);
      expect(receipts[1].args.p_payload).toMatchObject({ navigationSessionId: start.id });
      expect([...world.backend.receipts.keys()]).toEqual(ids);
      expect(world.backend.receipts.get(end.id).entity).toMatchObject({ journeyPhase: 'staying', activeDestinationId: null });
    } finally { await world.close(); }
  });
});
