const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type Observation = { presentation: { hosts: { testId?: string }[] }; external: { alerts: number };
  durable: { snapshot: { destinations: { id: string }[]; group: { journeyStatus: string } }; operations: unknown[] } };
const has = (value: Observation, id: string) => value.presentation.hosts.some(host => host.testId === id);
const SECOND = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe.each(['ios', 'android'])('actual development Map archive on %s', platform => {
  jest.setTimeout(120000);
  async function map(world: InstanceType<typeof World>) {
    world.backend.itinerary.push({ id: SECOND, group_id: GROUP_ID, title: 'Second stop', latitude: 25.05,
      longitude: 121.54, position: 1, day: 1, kind: 'destination', closed_at: null });
    const device = await world.device({ id: 'map-archive', userId: LEADER, platform, capabilities: { development: true },
      screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: Observation) => has(value, `gather-card-${DESTINATION}`), 'actual archive Map');
    await device.perform('map.card.toggle', { destinationId: DESTINATION });
    await device.perform('map.journey.command', { destinationId: DESTINATION });
    await world.waitFor(device, () => [...world.backend.sessions.values()].some((session: { status: string }) => session.status === 'active'), 'active route before archive');
    await device.perform('map.settings.open');
    await device.input({ kind: 'animation', finished: true });
    await world.waitFor(device, (value: Observation) => has(value, 'settings-archive'), 'development archive control');
    return device;
  }
  async function archived(world: InstanceType<typeof World>, device: Device) {
    const value = await world.waitFor(device, (value: Observation) => world.backend.itinerary.length === 0
      && value.durable.snapshot.destinations.length === 0 && value.durable.operations.length === 0, 'archived destinations and drained operations');
    expect([...world.backend.sessions.values()]).toEqual([expect.objectContaining({ status: 'cancelled' })]);
    expect(world.backend.groups.get(GROUP_ID)).toMatchObject({ journey_status: 'paused', active_destination_id: null });
    const commands = world.backend.trace.filter((call: { name: string }) => call.name === 'apply_core_operation_v3')
      .map((call: { args: { p_operation_type: string; p_payload: { destinationId?: string } } }) => call.args);
    expect(commands.filter((call: { p_operation_type: string }) => call.p_operation_type === 'delete_destination')
      .map((call: { p_payload: { destinationId?: string } }) => call.p_payload.destinationId)).toEqual([DESTINATION, SECOND]);
    expect(commands.some((call: { p_operation_type: string }) => call.p_operation_type === 'end_gathering')).toBe(true);
    expect(has(value, `gather-arrival-${DESTINATION}`)).toBe(false);
    expect(value.external.alerts).toBe(0);
  }

  it('MAP-HISTORY-03 actual development archive waits for history then removes every stop and stops navigation', async () => {
    const world = new World();
    try {
      const device = await map(world);
      world.hold('visited_waypoints');
      await device.perform('map.group.archive');
      await world.settle();
      expect(world.backend.itinerary.map((row: { id: string }) => row.id)).toEqual([DESTINATION, SECOND]);
      expect(world.backend.tables.visited_waypoints).toEqual([]);
      expect(world.held).toHaveLength(1);
      await world.release('visited_waypoints');
      await archived(world, device);
      expect(world.backend.tables.visited_waypoints).toEqual([
        expect.objectContaining({ user_id: LEADER, group_id: GROUP_ID, name: 'Meeting point', latitude: 25.04, longitude: 121.53 }),
        expect.objectContaining({ user_id: LEADER, group_id: GROUP_ID, name: 'Second stop', latitude: 25.05, longitude: 121.54 }),
      ]);
    } finally { await world.close(); }
  });

  it('MAP-HISTORY-03 actual development archive continues after a rejected history write', async () => {
    const world = new World();
    try {
      const device = await map(world);
      world.backend.failNext({ kind: 'table', name: 'visited_waypoints', mode: 'insert', userId: LEADER },
        { message: 'history table unavailable', code: '42P01' });
      await device.perform('map.group.archive');
      await archived(world, device);
      expect(world.backend.failures).toEqual([]);
      expect(world.backend.tables.visited_waypoints).toEqual([
        expect.objectContaining({ user_id: LEADER, group_id: GROUP_ID, name: 'Second stop', latitude: 25.05, longitude: 121.54 }),
      ]);
      expect(world.backend.trace.filter((call: { name: string; result?: { error?: { code?: string } } }) =>
        call.name === 'visited_waypoints' && call.result?.error?.code === '42P01')).toHaveLength(1);
    } finally { await world.close(); }
  });
});
