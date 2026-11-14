const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID } = require('../../test/headless/backend.cjs');

type Host = { testId?: string; label?: string; value?: unknown; disabled?: boolean; acceptsInput?: boolean };
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
  const d6 = platform === 'ios';

  async function press(device: Device, testId: string) {
    expect(await device.host.call({ kind: 'press', testId })).toEqual({ invoked: true });
  }

  async function map(world: TestWorld, userId = LEADER, id = 'coordinate-map') {
    if (d6) world.backend.profiles.get(userId).preferences = {
      groupFeatureTourCompleted: true, addPlaceTourCompleted: true, routeReorderTourCompleted: true,
    };
    const device = await world.device({ id, userId, platform, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: Observation) => has(value, d6 ? 'home-itinerary-grabber' : 'map-search') && value.durable.snapshot.destinations.length > 0,
      'hydrated actual Map');
    if (d6) await device.perform('preferences.setLanguage', { args: ['en'] });
    return device;
  }

  async function openCoordinates(world: TestWorld, device: Device, day?: number) {
    if (d6) {
      await press(device, 'home-itinerary-grabber');
      if (day !== undefined) await press(device, `d6-route-day-${day}`);
      await press(device, 'd6-route-add-place');
      await press(device, 'd6-add-coordinates');
    } else {
      await device.perform('map.search.open');
      await device.input({ kind: 'animation', finished: true });
      await press(device, 'place-search-coordinates');
      await device.input({ kind: 'animation', finished: true });
    }
    await world.settle();
  }

  async function fill(device: Device, title: string) {
    if (d6) {
      await device.perform('map.pin.drop', { latitude: 25.031, longitude: 121.551 });
      return;
    }
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

  it('Q05 Q06 opens the platform coordinate flow and rejects a bad location or cancel without writing', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await device.gps(25.032, 121.522, { accuracy: 4 });
      await world.settle();
      await openCoordinates(world, device);
      const opened = await device.observe();
      if (d6) {
        expect(has(opened, 'd6-coordinate-pin-hint')).toBe(true);
        expect(has(opened, 'coordinate-submit')).toBe(false);
        await device.perform('map.pin.drop', { latitude: Infinity, longitude: 121.551 });
        expect(has(await device.observe(), 'confirm-place-add')).toBe(false);
        await fill(device, '');
        const pinned = await world.waitFor(device, (value: Observation) => has(value, 'confirm-place-add'), 'valid map pin');
        expect(has(pinned, 'confirm-place-name')).toBe(false);
        expect(pinned.durable.operations).toEqual([]);
        await press(device, 'd6-add-close');
        expect(has(await device.observe(), 'confirm-place-add')).toBe(false);
        expect(world.backend.itinerary).toHaveLength(1);
        return;
      }
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
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'sync_group')
        .flatMap((call: { args: { p_core_operations: unknown[] } }) => call.args.p_core_operations)).toEqual([]);
      await device.perform('map.coordinates.cancel');
      expect(has(await device.observe(), 'coordinate-submit')).toBe(false);
      expect(world.backend.itinerary).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('Q05 Map leader saves one trimmed coordinate stop durably before ACK and converges afterward', async () => {
    const world = new World();
    const title = d6 ? 'New gathering point' : 'Coordinate stop';
    const expectedDay = d6 ? 2 : null;
    try {
      if (d6) world.backend.groups.get(GROUP_ID).trip_days = 2;
      const device = await map(world);
      await openCoordinates(world, device, expectedDay ?? undefined);
      await fill(device, `  ${title}  `);
      world.hold('sync_group', { matches: (operation: { args: { p_core_operations: unknown[] } }) => operation.args.p_core_operations.length > 0 });
      if (d6) {
        const staged = await world.waitFor(device, (value: Observation) => has(value, 'confirm-place-add'), 'coordinate staged in D6 Add');
        expect(has(staged, 'confirm-place-name')).toBe(false);
        expect(staged.durable.operations).toEqual([]);
        expect(staged.durable.snapshot.destinations).toHaveLength(1);
        await press(device, 'confirm-place-add');
      } else await device.perform('map.coordinates.submit');
      const local = await world.waitFor(device, (value: Observation) => value.durable.operations.some(row => row.operationType === 'add_destination')
        && value.durable.snapshot.destinations.some(row => row.title === title), 'coordinate durable add before ACK');
      expect(local.durable.snapshot.destinations.filter((row: Destination) => row.title === title)).toEqual([
        expect.objectContaining({ title, day: expectedDay, coordinates: { latitude: 25.031, longitude: 121.551 } }),
      ]);
      expect(has(local, 'coordinate-submit')).toBe(false);
      expect(world.backend.itinerary).toHaveLength(1);
      await world.release('sync_group');
      expect(world.backend.itinerary.filter((row: { title: string }) => row.title === title)).toEqual([
        expect.objectContaining({ day: expectedDay, latitude: 25.031, longitude: 121.551, subgroup_id: null }),
      ]);
      expect((await device.observe()).durable.operations).toEqual([]);
      await device.restart();
      const restarted = await world.waitFor(device, (value: Observation) => value.durable.snapshot.destinations.some(row => row.title === title),
        'coordinate stop after restart');
      expect(restarted.durable.snapshot.destinations.filter((row: Destination) => row.title === title)).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('Q05 a Map follower submits only a leader suggestion even when the itinerary is at its free limit', async () => {
    const world = new World();
    seedToLimit(world);
    try {
      const device = await map(world, PEER);
      await openCoordinates(world, device);
      await fill(device, '  Member coordinate suggestion  ');
      if (d6) await press(device, 'confirm-place-add');
      else await device.perform('map.coordinates.submit');
      await world.waitFor(device, () => world.backend.tables.gather_point_requests.length === 1, 'coordinate follower suggestion');
      expect(world.backend.itinerary).toHaveLength(5);
      expect(world.backend.tables.gather_point_requests[0]).toMatchObject({ requester_id: PEER, status: 'pending',
        items: [{ title: d6 ? 'New gathering point' : 'Member coordinate suggestion', latitude: 25.031, longitude: 121.551, day: null }] });
      expect(has(await device.observe(), 'coordinate-submit')).toBe(false);
    } finally { await world.close(); }
  });

  it('Q05 Map quota opens the purchase entry and writes nothing', async () => {
    const world = new World();
    seedToLimit(world);
    try {
      const device = await map(world);
      await openCoordinates(world, device);
      if (d6) {
        expect(has(await device.observe(), 'd6-coordinate-pin-hint')).toBe(true);
        await fill(device, '');
        const staged = await world.waitFor(device, (value: Observation) => field(value, 'confirm-place-add')?.label === 'Unlock more stops', 'D6 quota action');
        expect(has(staged, 'confirm-place-name')).toBe(false);
        await press(device, 'confirm-place-add');
        await device.input({ kind: 'animation', finished: true });
        await world.waitFor(device, (value: Observation) => has(value, 'store-premium-restore'), 'D6 Shop after quota action');
      }
      const blocked = await device.observe();
      expect(has(blocked, 'coordinate-submit')).toBe(false);
      expect(has(blocked, 'place-search-query')).toBe(false);
      expect(has(blocked, d6 ? 'store-premium-restore' : 'paywall-premium-presentation-purchase')).toBe(true);
      expect(blocked.durable.operations).toEqual([]);
      expect(world.backend.itinerary).toHaveLength(5);
      if (d6) {
        await press(device, 'settings-root-close');
        await device.input({ kind: 'animation', finished: true });
        await world.waitFor(device, (value: Observation) => field(value, 'confirm-place-add')?.label === 'Unlock more stops'
          && !has(value, 'store-premium-restore'), 'coordinate draft after closing Shop');
      }
    } finally { await world.close(); }
  });

  it('Q05 quota reached while the Map coordinate form is open prevents a write and preserves the unsaved draft', async () => {
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
      if (!d6) await device.perform('map.coordinates.submit');
      const rejected = await world.waitFor(device, (value: Observation) => d6
        ? field(value, 'confirm-place-add')?.label === 'Unlock more stops'
        : value.external.alertDetails.some(alert => alert.message === '此操作已達使用上限。'), 'visible quota rejection');
      if (d6) {
        expect(has(rejected, 'confirm-place-name')).toBe(false);
        expect(field(rejected, 'confirm-place-add')?.disabled).toBe(false);
        expect(rejected.external.alertDetails).toEqual([]);
        expect(has(rejected, 'store-premium-restore')).toBe(false);
      } else {
        expect(field(rejected, 'coordinate-name')?.value).toBe('Keep this coordinate draft');
        expect(field(rejected, 'coordinate-latitude')?.value).toBe('25.031');
        expect(field(rejected, 'coordinate-longitude')?.value).toBe('121.551');
        expect(field(rejected, 'coordinate-submit')?.disabled).toBe(false);
      }
      expect(has(rejected, 'paywall-premium-presentation-purchase')).toBe(false);
      expect(rejected.durable.operations).toEqual([]);
      expect(world.backend.itinerary).toHaveLength(5);
      expect(world.backend.itinerary.some((row: { title: string }) => row.title === (d6 ? 'New gathering point' : 'Keep this coordinate draft'))).toBe(false);
      if (d6) {
        await world.advance(1);
        world.backend.itinerary.pop();
        world.backend.publish('itinerary_items', {}, 'DELETE', added);
        await world.advance(500);
        await device.input({ kind: 'appState', value: 'background' });
        await device.input({ kind: 'appState', value: 'active' });
        await world.waitFor(device, (value: Observation) => field(value, 'confirm-place-add')?.label === 'Add', 'restored destination quota');
        await press(device, 'confirm-place-add');
        await world.waitFor(device, () => world.backend.itinerary.some((row: { title: string }) => row.title === (d6 ? 'New gathering point' : 'Keep this coordinate draft')),
          'preserved coordinate draft can be saved');
        expect(world.backend.itinerary.find((row: { title: string }) => row.title === (d6 ? 'New gathering point' : 'Keep this coordinate draft')))
          .toMatchObject({ day: 1, latitude: 25.031, longitude: 121.551 });
      }
    } finally { await world.close(); }
  });
});
