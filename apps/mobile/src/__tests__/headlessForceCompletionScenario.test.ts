const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Observation = {
  presentation: { hosts: { testId?: string; label?: string; disabled?: boolean }[] };
  external: { alertDetails: { title: string; message?: string; buttons: string[] }[] };
  durable: { snapshot: { destinations: { id: string; closedAt?: string }[] }; operations: { operationType: string; payload: { sessionId?: string; reason?: string } }[] };
};
type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
const has = (value: Observation, id: string) => value.presentation.hosts.some(host => host.testId === id);

describe.each(['ios', 'android'])('leader force completion on %s', platform => {
  jest.setTimeout(120000);
  async function map(world: InstanceType<typeof World>, userId: string, id: string) {
    const device = await world.device({ id, userId, platform, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: Observation) => has(value, `gather-card-${DESTINATION}`), 'destination card');
    await device.perform('map.card.toggle', { destinationId: DESTINATION });
    return device;
  }
  const complete = (device: Device) => device.host.call({ kind: 'press', testId: `gather-complete-${DESTINATION}` });

  it('MAP-GATHER-03 manual force completion confirms before closing the original active session without inventing arrivals', async () => {
    const world = new World();
    try {
      const leader = await map(world, LEADER, 'leader');
      expect(has(await leader.observe(), `gather-complete-${DESTINATION}`)).toBe(false);
      await leader.perform('map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(leader, () => [...world.backend.sessions.values()].some((row: { status: string }) => row.status === 'active'), 'active shared session');
      expect(has(await leader.observe(), `gather-complete-${DESTINATION}`)).toBe(true);
      await complete(leader);
      await leader.input({ kind: 'alert', index: 0 });
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      expect([...world.backend.sessions.values()][0].status).toBe('active');
      expect(world.backend.tables.destination_arrivals).toHaveLength(0);
      await complete(leader);
      await leader.input({ kind: 'alert', index: 1 });
      await world.waitFor(leader, () => !!world.backend.itinerary[0].closed_at, 'confirmed forced completion');
      expect([...world.backend.sessions.values()][0].status).toBe('completed');
      expect(world.backend.tables.destination_arrivals).toHaveLength(0);
    } finally { await world.close(); }
  });
});

export {};
