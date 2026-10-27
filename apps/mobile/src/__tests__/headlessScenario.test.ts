const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');
const SUBSCRIBED_GROUP_POLL_MS = 120_000;

describe.each(['ios', 'android'])('headless multiplayer scenarios on %s', platform => {
  jest.setTimeout(90000);

  it('publishes an Expo GPS fix through real durable storage and services into the peer hook', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.state?.members.length === 2, 'leader recovery');
      await world.waitFor(b, (value: any) => value.group.state?.members.length === 2, 'peer recovery');
      world.hold('ingest_location_batch');
      await a.gps(25.033, 121.565);
      const pending = await world.waitFor(a, (value: any) => value.durable.locations.length === 1, 'persisted GPS before ACK');
      expect(pending.location.coordinates).toEqual({ latitude: 25.033, longitude: 121.565 });
      await world.release('ingest_location_batch');
      await world.advance(250);
      const peer = await world.waitFor(b, (value: any) => value.group.state?.members.find((m: any) => m.userId === LEADER)?.coordinates?.latitude === 25.033,
        'peer location projection');
      expect(peer.group.state.members.find((m: any) => m.userId === LEADER).coordinates.longitude).toBe(121.565);
      expect((await a.observe()).durable.locations).toEqual([]);
      expect(world.backend.trace.some((call: any) => call.name === 'ingest_location_batch' && call.userId === LEADER)).toBe(true);
    } finally { await world.close(); }
  });

  it('repairs missed Realtime at the subscribed 120 second poll and restores an offline peer snapshot after restart', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(b, (value: any) => value.group.dataSource === 'remote', 'initial remote peer');
      b.realtime = false;
      await a.gps(25.1, 121.5);
      await world.settle();
      const before = world.backend.trace.filter((call: any) => call.deviceId === 'peer' && call.name === 'get_group_recovery_snapshot').length;
      await world.advance(29999);
      expect(world.backend.trace.filter((call: any) => call.deviceId === 'peer' && call.name === 'get_group_recovery_snapshot')).toHaveLength(before);
      await world.advance(1);
      expect(world.backend.trace.filter((call: any) => call.deviceId === 'peer' && call.name === 'get_group_recovery_snapshot')).toHaveLength(before);
      await world.advance(SUBSCRIBED_GROUP_POLL_MS - 30001);
      // Keep the missed sample fresh while waiting for the subscribed fallback.
      await a.gps(25.1, 121.5);
      expect((await b.observe()).group.state.members.find((m: any) => m.userId === LEADER).coordinates).toBeUndefined();
      expect(world.backend.trace.filter((call: any) => call.deviceId === 'peer' && call.name === 'get_group_recovery_snapshot')).toHaveLength(before);
      await world.advance(1);
      const recovered = await world.waitFor(b, (value: any) => value.group.state?.members.find((m: any) => m.userId === LEADER)?.coordinates?.latitude === 25.1, 'poll repair');
      expect(recovered.group.dataSource).toBe('remote');
      expect(world.backend.trace.filter((call: any) => call.deviceId === 'peer' && call.name === 'get_group_recovery_snapshot')).toHaveLength(before + 1);
      expect(world.backend.trace.some((call: any) => call.deviceId === 'peer' && call.name === 'daily_accommodations' && call.at === world.now)).toBe(true);
      b.online = false;
      const oldPid = recovered.pid;
      await b.restart();
      const cached = await world.waitFor(b, (value: any) => value.group.dataSource === 'local_cache', 'offline cache');
      expect(cached.pid).not.toBe(oldPid);
      expect(cached.group.state.members.find((m: any) => m.userId === LEADER).coordinates.latitude).toBe(25.1);
      expect(cached.group.snapshotFreshness.unit).not.toBe('missing');
    } finally { await world.close(); }
  });

  it('persists offline GPS across a real process restart and retries with the original actor', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'initial leader');
      a.online = false;
      await a.gps(24.9, 121.4);
      const pending = await world.waitFor(a, (value: any) => value.durable.locations.length === 1 && value.durable.locations[0].attempts > 0, 'offline retry persisted');
      const id = pending.durable.locations[0].id;
      expect((await b.observe()).group.state.members.find((m: any) => m.userId === LEADER).coordinates).toBeUndefined();
      await a.restart();
      expect((await a.observe()).durable.locations[0].id).toBe(id);
      a.online = true;
      await world.advance(30000);
      await world.advance(250);
      await world.waitFor(b, (value: any) => value.group.state?.members.find((m: any) => m.userId === LEADER)?.coordinates?.latitude === 24.9, 'replayed fix');
      expect((await a.observe()).durable.locations).toEqual([]);
      const receipt = world.backend.trace.find((call: any) => call.name === 'ingest_location_batch' && call.args.p_events.some((event: any) => event.id === id));
      expect(receipt.userId).toBe(LEADER);
      expect(receipt.args.p_events[0].actorId).toBe(LEADER);
    } finally { await world.close(); }
  });

  it('fences stale samples and revoked consent at the real privacy seam while preserving device isolation', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'same-account', userId: LEADER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'leader ready');
      await a.gps(25.01, 121.51);
      await world.settle();
      const timestamp = (await a.observe()).location.acceptedAt;
      const sent = world.backend.trace.filter((call: any) => call.name === 'ingest_location_batch').length;
      await a.gps(22, 120, { timestamp: timestamp - 1 });
      await world.settle();
      expect((await a.observe()).location.coordinates.latitude).toBe(25.01);
      expect(world.backend.trace.filter((call: any) => call.name === 'ingest_location_batch')).toHaveLength(sent);
      await world.advance(60000);
      world.hold('ingest_location_batch', { deviceId: 'leader' });
      await a.gps(25.2, 121.7);
      await world.waitFor(a, (value: any) => value.pending.length === 1, 'held upload');
      await a.input({ kind: 'consentContext', enabled: false });
      await a.input({ kind: 'retiredGps', latitude: 23, longitude: 120, timestamp: world.now + 1 });
      await world.release('ingest_location_batch');
      expect(world.backend.trace.filter((call: any) => call.name === 'ingest_location_batch')).toHaveLength(sent);
      expect((await a.observe()).location.coordinates.latitude).toBe(25.2);
      expect((await a.observe()).external.watches).toBe(0);
      expect((await b.observe()).external.watches).toBeGreaterThan(0);
      expect((await b.observe()).location.coordinates).toBeNull();
    } finally { await world.close(); }
  });

  it('ignores an old recovery delivered after a newer peer fix and reconnects after background', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(b, (value: any) => value.group.dataSource === 'remote', 'peer ready');
      await a.gps(25.01, 121.51);
      await world.settle();
      await world.advance(250);
      world.hold('get_group_recovery_snapshot', { phase: 'delivery', deviceId: 'peer' });
      const refresh = b.perform('group.refresh').catch((error: Error) => error);
      await world.settle();
      await world.advance(5000);
      await a.gps(25.1, 121.6);
      await world.settle();
      await world.advance(250);
      await world.waitFor(b, (value: any) => value.group.state?.members.find((m: any) => m.userId === LEADER)?.coordinates?.latitude === 25.1, 'newer Realtime fix');
      await world.release('get_group_recovery_snapshot');
      expect(await refresh).not.toBeInstanceOf(Error);
      expect((await b.observe()).group.state.members.find((m: any) => m.userId === LEADER).coordinates.latitude).toBe(25.1);
      await b.input({ kind: 'appState', value: 'background' });
      expect((await b.observe()).external.channels).toBe(0);
      await b.input({ kind: 'appState', value: 'active' });
      await world.waitFor(b, (value: any) => value.external.channels > 0 && value.group.dataSource === 'remote', 'foreground recovery');
      expect((await a.observe()).location.coordinates.latitude).toBe(25.1);
    } finally { await world.close(); }
  });

  it('does not replay an offline location under a replacement account', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'switching', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'initial owner');
      a.online = false;
      await a.gps(25.03, 121.55);
      await world.waitFor(a, (value: any) => value.durable.locations.length === 1 && value.durable.locations[0].attempts > 0, 'owned offline row');
      await a.input({ kind: 'account', userId: PEER, platform });
      expect((await a.observe()).actorId).toBe(PEER);
      a.online = true;
      await world.advance(30000);
      expect((await a.observe()).durable.locations).toEqual([]);
      expect(world.backend.trace.filter((call: any) => call.name === 'ingest_location_batch')).toEqual([]);
      expect((await b.observe()).group.state.members.find((m: any) => m.userId === LEADER).coordinates).toBeUndefined();
      expect((await b.observe()).actorId).toBe(PEER);
    } finally { await world.close(); }
  });

  it('runs real public journey Start and End hooks through the durable lane into the peer', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'leader ready');
      world.hold('apply_core_operation_v3');
      await a.perform('journey.start', { destinationId: DESTINATION });
      const optimistic = await world.waitFor(a, (value: any) => value.journey.targetId === DESTINATION && value.durable.operations.length > 0, 'durable optimistic Start');
      expect(optimistic.durable.snapshot.activeGathering.journeyPhase).toBe('en_route');
      expect(optimistic.durable.operations[0].actorId).toBe(LEADER);
      await a.perform('journey.start', { destinationId: DESTINATION });
      expect((await a.observe()).durable.operations.filter((row: any) => row.operationType === 'start_gathering')).toHaveLength(1);
      await world.release('apply_core_operation_v3');
      await world.advance(300);
      await world.waitFor(b, (value: any) => value.journey.targetId === DESTINATION, 'peer Start');
      expect((await a.observe()).durable.operations).toEqual([]);
      await a.perform('journey.end');
      await world.settle();
      await world.advance(300);
      await world.waitFor(b, (value: any) => !value.journey.targetId, 'peer End');
      const finished = await a.observe();
      expect(finished.journey.targetId).toBeNull();
      expect(finished.durable.snapshot.activeGathering.journeyPhase).toBe('staying');
      expect(finished.durable.operations).toEqual([]);
      const operations = world.backend.trace.filter((call: any) => call.name === 'apply_core_operation_v3');
      expect(operations.map((call: any) => call.args.p_operation_type)).toEqual(['start_gathering', 'end_gathering']);
      expect(operations[1].args.p_payload.navigationSessionId).toBe(operations[0].args.p_operation_id);
    } finally { await world.close(); }
  });

  it('uses the real destination service lazy import for add reorder and delete observed by both hooks', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'leader ready');
      const id = await a.perform('destination.add', { args: [GROUP_ID, {
        title: 'Second stop', coordinates: { latitude: 25.1, longitude: 121.6 }, day: 1,
      }] });
      await world.settle();
      await world.advance(300);
      await world.waitFor(b, (value: any) => value.group.state?.destinations.some((d: any) => d.id === id), 'peer added destination');
      await a.perform('destination.reorder', { args: [GROUP_ID, [
        { id, position: 0, day: 1 }, { id: DESTINATION, position: 1, day: 1 },
      ]] });
      await world.settle();
      await world.advance(300);
      await world.waitFor(b, (value: any) => value.group.state?.destinations[0]?.id === id, 'peer reordered destination');
      expect((await a.observe()).group.state.destinations[0].id).toBe(id);
      await a.perform('destination.delete', { args: [GROUP_ID, id] });
      await world.settle();
      await world.advance(300);
      await world.waitFor(b, (value: any) => value.group.state?.destinations.length === 1, 'peer deleted destination');
      expect((await a.observe()).group.state.destinations).toHaveLength(1);
      const operations = world.backend.trace.filter((call: any) => call.name === 'apply_core_operation_v3');
      expect(operations.map((call: any) => call.args.p_operation_type)).toEqual(['add_destination', 'reorder_destinations', 'delete_destination']);
      expect(operations.every((call: any) => call.userId === LEADER)).toBe(true);
      expect((await a.observe()).durable.operations).toEqual([]);
    } finally { await world.close(); }
  });

  it('keeps End authoritative when the earlier Start acknowledgement is held', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'leader ready');
      world.hold('apply_core_operation_v3', { phase: 'delivery' });
      await a.perform('journey.start', { destinationId: DESTINATION });
      await world.waitFor(a, (value: any) => value.journey.targetId === DESTINATION && value.pending.length > 0, 'held Start acceptance');
      await a.perform('journey.stop');
      const ended = await world.waitFor(a, (value: any) => !value.journey.targetId && value.durable.operations.length === 2, 'durable End after Start');
      expect(ended.durable.operations.map((row: any) => row.operationType)).toEqual(['start_gathering', 'end_gathering']);
      expect(ended.durable.operations[1].dependencyIds).toContain(ended.durable.operations[0].id);
      await world.release('apply_core_operation_v3');
      await world.advance(300);
      await world.waitFor(a, (value: any) => !value.journey.targetId && value.durable.operations.length === 0, 'accepted terminal state');
      await world.waitFor(b, (value: any) => !value.journey.targetId && value.group.state?.group.journeyStatus === 'paused', 'peer terminal state');
      const receipts = world.backend.trace.filter((call: any) => call.name === 'apply_core_operation_v3');
      expect(receipts.map((call: any) => call.args.p_operation_type)).toEqual(['start_gathering', 'end_gathering']);
    } finally { await world.close(); }
  });

  it('denies GPS acquisition at the external permission boundary and resumes after permission is granted', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      await a.input({ kind: 'permission', status: 'denied' });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'group without GPS permission');
      expect(await a.perform('location.refresh')).toBeNull();
      await a.gps(25, 121);
      await world.settle();
      const denied = await a.observe();
      expect(denied.external.watches).toBe(0);
      expect(denied.location.coordinates).toBeNull();
      expect(denied.durable.locations).toEqual([]);
      expect(world.backend.trace.filter((call: any) => call.name === 'ingest_location_batch')).toEqual([]);
      await a.input({ kind: 'permission', status: 'granted' });
      await a.input({ kind: 'appState', value: 'background' });
      await a.input({ kind: 'appState', value: 'active' });
      await world.waitFor(a, (value: any) => value.external.watches > 0, 'restored GPS observer');
      await a.gps(25, 121);
      const granted = await world.waitFor(a, (value: any) => value.location.coordinates?.latitude === 25, 'granted fix');
      expect(granted.location.coordinates.longitude).toBe(121);
    } finally { await world.close(); }
  });

  it('restores offline Start and End after restart and accepts their original durable FIFO identities', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'leader ready');
      a.online = false;
      await a.perform('journey.start', { destinationId: DESTINATION });
      await world.waitFor(a, (value: any) => value.journey.targetId === DESTINATION && value.durable.operations.length === 1, 'offline Start');
      await a.perform('journey.end');
      const pending = await world.waitFor(a, (value: any) => !value.journey.targetId && value.durable.operations.length === 2, 'offline terminal intent');
      const ids = pending.durable.operations.map((row: any) => row.id);
      await a.restart();
      const restored = await a.observe();
      expect(restored.durable.operations.map((row: any) => row.id)).toEqual(ids);
      expect(restored.journey.targetId).toBeNull();
      expect(restored.durable.snapshot.activeGathering.journeyPhase).toBe('staying');
      a.online = true;
      await world.advance(SUBSCRIBED_GROUP_POLL_MS);
      await world.advance(300);
      await world.waitFor(a, (value: any) => value.durable.operations.length === 0 && !value.journey.targetId, 'replayed FIFO');
      const peer = await world.waitFor(b, (value: any) => value.group.state?.group.journeyStatus === 'paused' && !value.journey.targetId, 'peer after replay');
      expect(peer.navigation.session).toBeNull();
      const receipts = world.backend.trace.filter((call: any) => call.name === 'apply_core_operation_v3');
      expect(receipts.map((call: any) => call.args.p_operation_id)).toEqual(ids);
      expect(receipts.map((call: any) => call.args.p_operation_type)).toEqual(['start_gathering', 'end_gathering']);
    } finally { await world.close(); }
  });

  it('keeps an offline GPS draft durable when a delivery hold captures the network failure', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'leader ready');
      a.online = false;
      world.hold('ingest_location_batch', { phase: 'delivery', deviceId: 'leader' });
      await a.gps(25.08, 121.58);
      await world.waitFor(a, (value: any) => value.pending.length === 1 && value.durable.locations.length === 1, 'held offline failure');
      expect(world.backend.trace.filter((call: any) => call.name === 'ingest_location_batch')).toEqual([]);
      await world.release('ingest_location_batch');
      const failed = await world.waitFor(a, (value: any) => value.durable.locations[0]?.attempts > 0, 'offline retry row');
      expect(failed.durable.locations).toHaveLength(1);
      expect((await b.observe()).group.state.members.find((m: any) => m.userId === LEADER).coordinates).toBeUndefined();
      a.online = true;
      await world.advance(30000);
      await world.advance(250);
      await world.waitFor(b, (value: any) => value.group.state?.members.find((m: any) => m.userId === LEADER)?.coordinates?.latitude === 25.08, 'normal reconnect replay');
      expect((await a.observe()).durable.locations).toEqual([]);
    } finally { await world.close(); }
  });

  it('keeps the first same-tick sample from independent devices of one account', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'first', userId: LEADER, platform });
      const b = await world.device({ id: 'second', userId: LEADER, platform });
      const peer = await world.device({ id: 'peer', userId: PEER, platform });
      for (const device of [a, b, peer]) await device.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(peer, (value: any) => value.group.dataSource === 'remote', 'peer ready');
      await a.gps(25.01, 121.51);
      await world.settle();
      await b.gps(25.02, 121.52);
      await world.settle();
      await world.advance(250);
      const observed = await world.waitFor(peer, (value: any) => value.group.state?.members.find((m: any) => m.userId === LEADER)?.coordinates?.latitude === 25.01, 'first fix retained');
      expect(observed.group.state.members.find((m: any) => m.userId === LEADER).coordinates.longitude).toBe(121.51);
      expect((await b.observe()).location.coordinates.latitude).toBe(25.02);
      expect((await b.observe()).durable.locations).toEqual([]);
      const calls = world.backend.trace.filter((call: any) => call.name === 'ingest_location_batch');
      expect(calls).toHaveLength(2);
      expect(calls[1].result.data.acceptedIds).toEqual([]);
      expect(calls[1].result.data.rejected).toEqual([{ id: calls[1].args.p_events[0].id, reason: 'stale_sample' }]);
      expect(world.realtimeTrace.filter((entry: any) => entry.deviceId === 'peer' && entry.event.table === 'member_locations')).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('acknowledges the same event after lost ACK and restart without publishing a second location event', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(b, (value: any) => value.group.dataSource === 'remote', 'peer ready');
      world.hold('ingest_location_batch', { phase: 'delivery', deviceId: 'leader' });
      await a.gps(25.03, 121.53);
      const pending = await world.waitFor(a, (value: any) => value.pending.length === 1 && value.durable.locations.length === 1, 'accepted event before ACK');
      const eventId = pending.durable.locations[0].id;
      await world.advance(250);
      const first = await world.waitFor(b, (value: any) => value.group.state?.members.find((m: any) => m.userId === LEADER)?.coordinates?.latitude === 25.03, 'first delivery');
      await a.restart();
      await world.release('ingest_location_batch');
      await world.advance(3000);
      await world.waitFor(a, (value: any) => value.durable.locations.length === 0, 'duplicate ACK');
      const final = await b.observe();
      expect(final.group.state.members.find((m: any) => m.userId === LEADER)).toEqual(first.group.state.members.find((m: any) => m.userId === LEADER));
      const calls = world.backend.trace.filter((call: any) => call.name === 'ingest_location_batch');
      expect(calls).toHaveLength(2);
      expect(calls.map((call: any) => call.args.p_events[0].id)).toEqual([eventId, eventId]);
      expect(calls[1].result.data.acceptedIds).toEqual([eventId]);
      expect(world.realtimeTrace.filter((entry: any) => entry.deviceId === 'peer' && entry.event.table === 'member_locations')).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('resolves manual refresh after its fresh fix is accepted by the continuous watcher first', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'leader', userId: LEADER, platform });
      const b = await world.device({ id: 'peer', userId: PEER, platform });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'leader ready');
      const refresh = a.perform('location.refresh').catch((error: Error) => error);
      await world.waitFor(a, (value: any) => value.external.watches >= 3, 'one-shot plus continuous observers');
      await a.gps(25.06, 121.56);
      const outcome = await refresh;
      expect(outcome).toEqual({ latitude: 25.06, longitude: 121.56 });
      await world.settle();
      await world.advance(250);
      const peer = await world.waitFor(b, (value: any) => value.group.state?.members.find((m: any) => m.userId === LEADER)?.coordinates?.latitude === 25.06, 'watch publication and refresh confirmation');
      expect(peer.group.state.members.find((m: any) => m.userId === LEADER).coordinates.longitude).toBe(121.56);
      expect((await a.observe()).location.coordinates.latitude).toBe(25.06);
      expect((await a.observe()).durable.locations).toEqual([]);
      expect(world.backend.trace.filter((call: any) => call.name === 'ingest_location_batch')).toHaveLength(1);
    } finally { await world.close(); }
  });
});
export {};

describe('headless mixed platform scenario', () => {
  jest.setTimeout(90000);

  it('publishes iOS GPS into an Android peer hook with independent app storage', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'ios', userId: LEADER, platform: 'ios' });
      const b = await world.device({ id: 'android', userId: PEER, platform: 'android' });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await b.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(b, (value: any) => value.group.dataSource === 'remote', 'Android peer');
      await a.gps(25.04, 121.54);
      await world.settle();
      await world.advance(250);
      const peer = await world.waitFor(b, (value: any) => value.group.state?.members.find((m: any) => m.userId === LEADER)?.coordinates?.latitude === 25.04, 'mixed platform fix');
      expect(peer.group.state.members.find((m: any) => m.userId === LEADER).coordinates.longitude).toBe(121.54);
      expect((await a.observe()).durable.locations).toEqual([]);
      expect((await b.observe()).durable.locations).toEqual([]);
      expect((await a.observe()).pid).not.toBe(peer.pid);
    } finally { await world.close(); }
  });
});
