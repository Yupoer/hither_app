const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID } = require('../../test/headless/backend.cjs');

type Host = { testId?: string; value?: unknown; disabled?: boolean; acceptsInput?: boolean };
type Destination = { id: string; title: string; day: number | null; subgroupId?: string | null;
  coordinates: { latitude: number; longitude: number } };
type Observation = { presentation: { hosts: Host[] }; external: { alertDetails: { title: string; message?: string }[] };
  durable: { snapshot: { destinations: Destination[] }; operations: { operationType: string }[] } };
type TestWorld = InstanceType<typeof World>;
type Device = Awaited<ReturnType<TestWorld['device']>>;
const field = (value: Observation, id: string) => value.presentation.hosts.find(host => host.testId === id);
const has = (value: Observation, id: string) => field(value, id) !== undefined;

describe.each(['ios', 'android'])('actual Map coordinate entry on %s', platform => {
  jest.setTimeout(120000);

  async function map(world: TestWorld, userId = LEADER, id = 'coordinate-map') {
    const device = await world.device({ id, userId, platform, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: Observation) => has(value, 'map-search') && value.durable.snapshot.destinations.length > 0,
      'hydrated actual Map');
    return device;
  }

  async function openCoordinates(world: TestWorld, device: Device) {
    await device.perform('map.search.open');
    await device.input({ kind: 'animation', finished: true });
    await device.host.call({ kind: 'press', testId: 'place-search-coordinates' });
    await device.input({ kind: 'animation', finished: true });
    await world.settle();
  }

  async function fill(device: Device, title: string) {
    await device.perform('map.coordinates.title', { value: title });
    await device.perform('map.coordinates.latitude', { value: '25.031' });
    await device.perform('map.coordinates.longitude', { value: '121.551' });
  }

  function seedToLimit(world: TestWorld) {
    while (world.backend.itinerary.length < 5) {
      const index = world.backend.itinerary.length;
      world.backend.itinerary.push({ ...world.backend.itinerary[0],
        id: `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, '0')}`,
        title: `Existing stop ${index}`, position: index });
    }
    return world.backend.itinerary[4];
  }

  it('Q05 Q06 Map search opens a prefilled coordinate form and invalid submission or cancel writes nothing', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await device.gps(25.032, 121.522, { accuracy: 4 });
      await world.settle();
      await openCoordinates(world, device);
      const opened = await device.observe();
      expect(has(opened, 'coordinate-submit')).toBe(true);
      expect(has(opened, 'place-search-query')).toBe(false);
      expect(field(opened, 'coordinate-latitude')?.value).toBe('25.032');
      expect(field(opened, 'coordinate-longitude')?.value).toBe('121.522');
      await device.perform('map.coordinates.submit');
      await fill(device, 'Canceled coordinate');
      await device.perform('map.coordinates.latitude', { value: '91' });
      await device.perform('map.coordinates.submit');
      const invalid = await device.observe();
      expect(has(invalid, 'coordinate-submit')).toBe(true);
      expect(invalid.durable.snapshot.destinations).toHaveLength(1);
      expect(invalid.durable.operations).toEqual([]);
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'apply_core_operation_v3')).toEqual([]);
      await device.perform('map.coordinates.cancel');
      expect(has(await device.observe(), 'coordinate-submit')).toBe(false);
      expect(world.backend.itinerary).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('Q05 Map leader saves one trimmed coordinate pool stop durably before ACK and converges afterward', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await openCoordinates(world, device);
      await fill(device, '  Coordinate pool stop  ');
      world.hold('apply_core_operation_v3');
      await device.perform('map.coordinates.submit');
      const local = await world.waitFor(device, (value: Observation) => value.durable.operations.some(row => row.operationType === 'add_destination')
        && value.durable.snapshot.destinations.some(row => row.title === 'Coordinate pool stop'), 'coordinate durable add before ACK');
      expect(local.durable.snapshot.destinations.filter((row: Destination) => row.title === 'Coordinate pool stop')).toEqual([
        expect.objectContaining({ title: 'Coordinate pool stop', day: null, coordinates: { latitude: 25.031, longitude: 121.551 } }),
      ]);
      expect(has(local, 'coordinate-submit')).toBe(false);
      expect(world.backend.itinerary).toHaveLength(1);
      await world.release('apply_core_operation_v3');
      expect(world.backend.itinerary.filter((row: { title: string }) => row.title === 'Coordinate pool stop')).toEqual([
        expect.objectContaining({ day: null, latitude: 25.031, longitude: 121.551, subgroup_id: null }),
      ]);
      expect((await device.observe()).durable.operations).toEqual([]);
      await device.restart();
      const restarted = await world.waitFor(device, (value: Observation) => value.durable.snapshot.destinations.some(row => row.title === 'Coordinate pool stop'),
        'coordinate stop after restart');
      expect(restarted.durable.snapshot.destinations.filter((row: Destination) => row.title === 'Coordinate pool stop')).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('Q05 a Map follower submits only a leader suggestion even when the itinerary is at its free limit', async () => {
    const world = new World();
    seedToLimit(world);
    try {
      const device = await map(world, PEER);
      await openCoordinates(world, device);
      await fill(device, '  Member coordinate suggestion  ');
      await device.perform('map.coordinates.submit');
      await world.waitFor(device, () => world.backend.tables.gather_point_requests.length === 1, 'coordinate follower suggestion');
      expect(world.backend.itinerary).toHaveLength(5);
      expect(world.backend.tables.gather_point_requests[0]).toMatchObject({ requester_id: PEER, status: 'pending',
        items: [{ title: 'Member coordinate suggestion', latitude: 25.031, longitude: 121.551, day: null }] });
      expect(has(await device.observe(), 'coordinate-submit')).toBe(false);
    } finally { await world.close(); }
  });

  it('Q05 Map quota preflight opens the existing paywall before collecting a coordinate draft and writes nothing', async () => {
    const world = new World();
    seedToLimit(world);
    try {
      const device = await map(world);
      await openCoordinates(world, device);
      const blocked = await device.observe();
      expect(has(blocked, 'coordinate-submit')).toBe(false);
      expect(has(blocked, 'place-search-query')).toBe(false);
      expect(has(blocked, 'paywall-premium-presentation-purchase')).toBe(true);
      expect(blocked.durable.operations).toEqual([]);
      expect(world.backend.itinerary).toHaveLength(5);
    } finally { await world.close(); }
  });

  it('Q05 quota reached while the Map coordinate form is open explains the rejection and preserves the unsaved draft', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await openCoordinates(world, device);
      await fill(device, 'Keep this coordinate draft');
      await world.advance(1);
      const added = seedToLimit(world);
      world.backend.publish('itinerary_items', added, 'INSERT');
      await world.settle();
      await world.advance(500);
      await world.waitFor(device, (value: Observation) => value.durable.snapshot.destinations.length === 5, 'Map observes the newly exhausted quota');
      await device.perform('map.coordinates.submit');
      const rejected = await world.waitFor(device, (value: Observation) => value.external.alertDetails.some(alert => alert.message === '此操作已達使用上限。'),
        'visible quota rejection');
      expect(field(rejected, 'coordinate-name')?.value).toBe('Keep this coordinate draft');
      expect(field(rejected, 'coordinate-latitude')?.value).toBe('25.031');
      expect(field(rejected, 'coordinate-longitude')?.value).toBe('121.551');
      expect(field(rejected, 'coordinate-submit')?.disabled).toBe(false);
      expect(has(rejected, 'paywall-premium-presentation-purchase')).toBe(false);
      expect(rejected.durable.operations).toEqual([]);
      expect(world.backend.itinerary).toHaveLength(5);
      expect(world.backend.itinerary.some((row: { title: string }) => row.title === 'Keep this coordinate draft')).toBe(false);
    } finally { await world.close(); }
  });
});
