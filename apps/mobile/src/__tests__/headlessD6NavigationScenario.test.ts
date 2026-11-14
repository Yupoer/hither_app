import type { CoreGroupSnapshot, CoreOperation } from '../types/coreData';

const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type Observation = {
  presentation: { hosts: { testId?: string; label?: string; text?: string }[];
    receipts: { host: string; method: string; url?: string }[] };
  external: { watches: number };
  durable: { snapshot: CoreGroupSnapshot; operations: CoreOperation[] };
};
const host = (value: Observation, testId: string) => value.presentation.hosts.find(row => row.testId === testId);
const press = (device: Device, testId: string) => device.host.call({ kind: 'press', testId });

describe('actual D6 iOS navigation and import safety', () => {
  jest.setTimeout(120_000);
  async function map(world: InstanceType<typeof World>, userId = LEADER) {
    const device = await world.device({ id: `d6-safety-${userId}`, userId, platform: 'ios',
      screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: Observation) => host(value, 'home-journey-action') && value.external.watches > 0, 'D6 controls and GPS watcher');
    await device.perform('preferences.setLanguage', { args: ['en'] });
    return device;
  }
  async function sample(world: InstanceType<typeof World>, device: Device, latitude: number, accuracy = 5) {
    await world.advance(1000);
    await device.gps(latitude, 121.53, { accuracy, timestamp: world.now });
    await world.settle();
  }
  async function start(world: InstanceType<typeof World>, device: Device) {
    await sample(world, device, 25.03);
    expect(await press(device, 'home-journey-action')).toEqual({ invoked: true });
    await world.waitFor(device, () => [...world.backend.sessions.values()].some((row: { status: string }) => row.status === 'active'), 'shared start committed');
  }

  it('shows over-one-hour directions and distance from fresh GPS and opens the selected stop in Maps', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await device.input({ kind: 'mapsConfigure', patch: { route: { distanceMeters: 65000, expectedTravelTimeSeconds: 4980,
        points: [{ latitude: 25.03, longitude: 121.53 }, { latitude: 25.04, longitude: 121.53 }] } } });
      await start(world, device);
      const routed: Observation = await world.waitFor(device, (value: Observation) => host(value, 'd6-home-meeting-time')?.label === '1 hours 23 minutes', 'hour and minute display');
      expect(routed.presentation.hosts.some(row => row.text === '65.0 km')).toBe(true);
      await press(device, 'home-itinerary-grabber');
      await press(device, `d6-route-row-${DESTINATION}`);
      expect(await device.host.call({ kind: 'press', label: 'Maps' })).toEqual({ invoked: true });
      expect((await device.observe()).presentation.receipts).toContainEqual(expect.objectContaining({
        host: 'Linking', method: 'openURL', url: 'https://maps.apple.com/?daddr=25.04,121.53&dirflg=d',
      }));
      expect(world.backend.itinerary[0].closed_at).toBeNull();
    } finally { await world.close(); }
  });

  it('rejects poor arrival fixes, deduplicates valid GPS and enables Finish only after both members arrive', async () => {
    const world = new World();
    try {
      const leader = await map(world);
      await start(world, leader);
      const session = [...world.backend.sessions.values()][0];
      await sample(world, leader, 25.04, 200);
      expect(world.backend.tables.destination_arrivals).toEqual([]);
      await sample(world, leader, 25.04);
      await world.waitFor(leader, () => world.backend.tables.destination_arrivals.length === 1, 'first automatic arrival');
      const first = { ...world.backend.tables.destination_arrivals[0] };
      expect(first).toMatchObject({ user_id: LEADER, navigation_session_id: session.id, source: 'automatic' });
      await sample(world, leader, 25.04);
      expect(world.backend.tables.destination_arrivals).toEqual([first]);
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      const peer = await map(world, PEER);
      await sample(world, peer, 25.04);
      await world.waitFor(peer, () => world.backend.tables.destination_arrivals.length === 2, 'peer automatic arrival');
      await world.advance(2500);
      const arrived: Observation = await world.waitFor(leader, (value: Observation) => host(value, 'home-journey-action')?.label === 'Finish', 'all-arrived Finish action');
      expect(arrived.durable.snapshot.destinations.find(row => row.id === DESTINATION)?.closedAt).toBeUndefined();
      expect(session.status).toBe('active');
      await press(leader, 'home-journey-action');
      await world.waitFor(leader, (value: Observation) => !!value.durable.snapshot.destinations.find(row => row.id === DESTINATION)?.closedAt, 'all-arrived history');
      expect(world.backend.itinerary[0].closed_by_session_id).toBe(session.id);
      expect(session.status).toBe('completed');
      expect(world.backend.tables.destination_arrivals).toHaveLength(2);
      expect(world.backend.tables.destination_arrivals.find((row: { user_id: string }) => row.user_id === PEER))
        .toMatchObject({ navigation_session_id: session.id, source: 'automatic' });
    } finally { await world.close(); }
  });

  it('imports a selected KML batch from the D6 menu and closes without duplicate writes', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await press(device, 'home-itinerary-grabber');
      await press(device, 'd6-route-options');
      await press(device, 'd6-route-menu-kml');
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: Observation) => host(value, 'kml-pick-file'), 'D6 KML sheet');
      const uri = 'file:///headless/d6-route.kml';
      await device.input({ kind: 'mapFile', uri, content: '<kml><Placemark><name>North &amp; South</name><Point><coordinates>121.55,25.03</coordinates></Point></Placemark><Placemark><name>East</name><Point><coordinates>121.56,25.04</coordinates></Point></Placemark></kml>' });
      await device.input({ kind: 'mapsConfigure', patch: { picker: { canceled: false, assets: [{ uri, name: 'd6-route.kml' }] } } });
      await device.perform('map.kml.pick');
      await device.perform('map.kml.import');
      await world.waitFor(device, () => world.backend.itinerary.length === 3, 'selected batch committed');
      expect(world.backend.itinerary)
        .toEqual(expect.arrayContaining([expect.objectContaining({ title: 'North & South', day: null }), expect.objectContaining({ title: 'East', day: null })]));
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'import_itinerary_batch')).toHaveLength(1);
      await world.advance(1000);
      expect(host(await device.observe(), 'kml-import-confirm')).toBeUndefined();
    } finally { await world.close(); }
  });

  it('keeps subgroup reorder confined to its lane through the D6 accessible drag handle', async () => {
    const world = new World();
    const subgroupId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const mainId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    try {
      world.backend.groups.get(GROUP_ID).trip_days = 2;
      world.backend.tables.subgroups.push({ id: subgroupId, group_id: GROUP_ID, name: 'Side route', leader_id: PEER, created_at: new Date(world.now).toISOString() });
      world.backend.memberships.find((row: { user_id: string }) => row.user_id === PEER).subgroup_id = subgroupId;
      world.backend.itinerary[0].subgroup_id = subgroupId;
      world.backend.itinerary.push(
        { ...world.backend.itinerary[0], id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', position: 1, title: 'Second subgroup stop' },
        { ...world.backend.itinerary[0], id: mainId, subgroup_id: null, title: 'Main stop' },
      );
      const device = await map(world, PEER);
      await press(device, 'home-itinerary-grabber');
      expect(await device.host.call({ kind: 'nativeEvent', testId: `d6-route-drag-${DESTINATION}`,
        value: { event: 'onAccessibilityAction', nativeEvent: { actionName: 'increment' } } })).toEqual({ invoked: true });
      await world.waitFor(device, () => world.backend.itinerary.find((row: { id: string }) => row.id === DESTINATION).position === 1, 'subgroup order committed');
      expect(world.backend.itinerary.find((row: { id: string }) => row.id === mainId)).toMatchObject({ day: 1, position: 0, subgroup_id: null });
    } finally { await world.close(); }
  });
});
