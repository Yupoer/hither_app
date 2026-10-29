const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID } = require('../../test/headless/backend.cjs');

describe.each(['ios', 'android'])('actual disconnection tolerance on %s', platform => {
  jest.setTimeout(90_000);

  it('retains offline GPS until the 24-hour boundary and expires it on restart without upload', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'ttl', userId: LEADER, platform });
      await device.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(device, (value: { group: { dataSource: string } }) => value.group.dataSource === 'remote');
      device.online = false;
      await device.gps(35.7148, 139.7967);
      const queued = await world.waitFor(device, (value: { durable: { locations: { id: string }[] } }) => value.durable.locations.length === 1);
      const row = queued.durable.locations[0];
      expect(row.expires_at - row.captured_at).toBe(24 * 60 * 60 * 1000);
      const ingestions = () => world.backend.trace.filter((call: { name: string }) => call.name === 'ingest_location_batch');
      const before = ingestions().length;
      for (const now of [row.expires_at - 1, row.expires_at]) {
        await device.dispose();
        world.now = now;
        world.backend.now = now;
        await device.boot();
        await device.perform('group.observe', { groupId: GROUP_ID });
        await world.settle();
        const retained = (await device.observe()).durable.locations.some((pending: { id: string }) => pending.id === row.id);
        expect(retained).toBe(now < row.expires_at);
      }
      device.online = true;
      await world.advance(60_000);
      expect(ingestions()).toHaveLength(before);
      expect([...world.backend.locations.values()].some((location: { user_id: string; group_id: string }) => location.user_id === LEADER && location.group_id === GROUP_ID)).toBe(false);
      expect((await device.observe()).durable.locations).toEqual([]);
    } finally { await world.close(); }
  });
});
