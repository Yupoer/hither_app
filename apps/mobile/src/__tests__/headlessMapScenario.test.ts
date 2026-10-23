const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Host = { testId?: string; label?: string; text?: string; value?: unknown; disabled?: boolean };
type Presentation = { hosts: Host[]; receipts: { host: string; method: string; args?: unknown[] }[];
  preferences: { sharingEnabled: boolean; passiveCompanionMode: boolean; travelMode: string } };
type MapObservation = { presentation: Presentation; external: { alerts: number; watches: number };
  durable: { snapshot: { destinations: { id: string; title: string; day: number | null; closedAt?: string; kind?: string }[];
    dailyAccommodations: { title: string; sourceDestinationId?: string | null; stayDate: string }[] };
    locations: unknown[]; operations: { operationType: string; entityId: string }[] } };
type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
const has = (value: { presentation: Presentation }, id: string) => value.presentation.hosts.some(host => host.testId === id);
const field = (value: { presentation: Presentation }, id: string) => value.presentation.hosts.find(host => host.testId === id);

describe.each(['ios', 'android'])('actual Map screen operations on %s', platform => {
  jest.setTimeout(120000);
  const run = (device: Device, name: string, input = {}) => device.perform(name, input);
  async function map(world: InstanceType<typeof World>, userId = LEADER, id = 'map') {
    const device = await world.device({ id, userId, platform, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: MapObservation) => has(value, 'map-search'), 'actual MapScreen controls');
    await world.waitFor(device, (value: MapObservation) => has(value, `gather-card-${DESTINATION}`), 'actual destination card');
    await run(device, 'map.card.toggle', { destinationId: DESTINATION });
    return device;
  }
  async function drop(device: Device, title: string, latitude = 25.05) {
    await run(device, 'map.pin.drop', { latitude, longitude: 121.54 });
    await device.world.advance(0);
    await run(device, 'map.place.rename', { value: title });
  }
  async function expand(world: InstanceType<typeof World>, device: Device) {
    await device.input({ kind: 'gesture', testId: 'map-bottom-sheet', phase: 'onBegin', value: {} });
    await device.input({ kind: 'gesture', testId: 'map-bottom-sheet', phase: 'onUpdate', value: { translationY: -250, velocityY: 0 } });
    await device.input({ kind: 'gesture', testId: 'map-bottom-sheet', phase: 'onEnd', value: { translationY: -250, velocityY: 0 }, success: true });
    await world.settle();
  }
  async function route(world: InstanceType<typeof World>, device: Device) {
    await expand(world, device);
    await run(device, 'map.tab', { index: 1 });
    await run(device, 'map.route.open');
    await device.input({ kind: 'animation', finished: true });
    await world.settle();
  }
  async function done(world: InstanceType<typeof World>, device: Device) {
    await run(device, 'map.overlay.done', { label: '完成' });
    await world.settle();
  }

  it('Q05 runs real coordinate validation, normalized submission and reopen initialization', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'coordinates', userId: LEADER, platform,
        screen: { name: 'CoordinateDestinationSheet', props: { visible: true } } });
      await world.waitFor(device, (value: MapObservation) => has(value, 'coordinate-submit'), 'real coordinate form');
      await run(device, 'map.coordinates.submit');
      expect((await device.observe()).presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onSubmit')).toEqual([]);
      await run(device, 'map.coordinates.title', { value: '  Library  ' });
      await run(device, 'map.coordinates.latitude', { value: '91' });
      await run(device, 'map.coordinates.longitude', { value: '121.55' });
      await run(device, 'map.coordinates.submit');
      expect((await device.observe()).presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onSubmit')).toEqual([]);
      await run(device, 'map.coordinates.latitude', { value: '25.03' });
      await run(device, 'map.coordinates.submit');
      const submitted = (await device.observe()).presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onSubmit');
      expect(submitted).toHaveLength(1);
      expect(submitted[0].args[0]).toEqual({ title: 'Library', coordinates: { latitude: 25.03, longitude: 121.55 } });
      expect((await device.observe()).presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onClose')).toHaveLength(1);
      await device.host.mount({ name: 'CoordinateDestinationSheet', props: { visible: false } });
      await device.host.mount({ name: 'CoordinateDestinationSheet', props: { visible: true, initialCoordinates: { latitude: 24.1, longitude: 120.2 } } });
      const reopened = await device.observe();
      expect(field(reopened, 'coordinate-name')?.value).toBe('');
      expect(field(reopened, 'coordinate-latitude')?.value).toBe('24.1');
      expect(field(reopened, 'coordinate-longitude')?.value).toBe('120.2');
      await run(device, 'map.coordinates.cancel');
      expect((await device.observe()).presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onSubmit')).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('MAP-DEST-02 MAP-DEST-03 MAP-DEST-04 cancel writes nothing and real confirmation durably adds one trimmed pool stop before ACK', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await drop(device, 'Canceled');
      await run(device, 'map.place.cancel');
      expect((await device.observe()).durable.snapshot.destinations).toHaveLength(1);
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'apply_core_operation_v3')).toEqual([]);
      world.hold('apply_core_operation_v3');
      await drop(device, '  Local pool stop  ');
      await run(device, 'map.place.pool');
      const local = await world.waitFor(device, (value: MapObservation) => value.durable.operations.some(row => row.operationType === 'add_destination'), 'real Map durable add');
      expect(local.durable.snapshot.destinations.find((row: { title: string }) => row.title === 'Local pool stop')).toMatchObject({ day: null });
      expect(has(local, 'confirm-place-name')).toBe(false);
      expect(world.backend.itinerary).toHaveLength(1);
      await world.release('apply_core_operation_v3');
      expect(world.backend.itinerary.filter((row: { title: string }) => row.title === 'Local pool stop')).toHaveLength(1);
      expect((await device.observe()).durable.operations).toEqual([]);
    } finally { await world.close(); }
  });

  it('MAP-DEST-05 a follower confirm persists a suggestion and never directly adds an itinerary point', async () => {
    const world = new World();
    try {
      const device = await map(world, PEER);
      await drop(device, 'Member suggestion');
      await run(device, 'map.place.pool');
      await world.settle();
      expect(world.backend.itinerary).toHaveLength(1);
      expect(world.backend.tables.gather_point_requests).toHaveLength(1);
      expect(world.backend.tables.gather_point_requests[0]).toMatchObject({ requester_id: PEER, status: 'pending' });
      expect(world.backend.tables.gather_point_requests[0].items[0].title).toBe('Member suggestion');
    } finally { await world.close(); }
  });

  it('MAP-ROUTE-02 MAP-ROUTE-03 the actual move-to-day control builds and persists reorder while leaving closed history untouched', async () => {
    const world = new World();
    try {
      world.backend.groups.get(GROUP_ID).trip_days = 2;
      world.backend.itinerary.push({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', group_id: GROUP_ID, title: 'History', latitude: 25.01, longitude: 121.51,
        position: 8, day: 1, kind: 'destination', closed_at: new Date(world.now - 60000).toISOString() });
      const device = await map(world);
      await route(world, device);
      await run(device, 'map.route.move.open', { destinationId: DESTINATION });
      await run(device, 'map.route.move.day', { day: 2 });
      await world.settle();
      expect((await device.observe()).durable.snapshot.destinations.find((row: { id: string }) => row.id === DESTINATION).day).toBe(2);
      expect(world.backend.itinerary.find((row: { id: string }) => row.id === DESTINATION).day).toBe(2);
      expect(world.backend.itinerary.find((row: { title: string }) => row.title === 'History')).toMatchObject({ position: 8, day: 1 });
    } finally { await world.close(); }
  });

  it('MAP-STAY-02 MAP-ROUTE-05 actual stay selection removes its source stop only when the route draft flushes', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await route(world, device);
      await run(device, 'map.route.stay.set', { day: 1 });
      await run(device, 'map.route.stay.select', { destinationId: DESTINATION });
      await run(device, 'map.route.stay.set', { day: 1 });
      expect(world.backend.itinerary.some((row: { id: string }) => row.id === DESTINATION)).toBe(true);
      expect(world.backend.tables.daily_accommodations).toEqual([]);
      await done(world, device);
      const saved = await device.observe();
      expect(saved.durable.snapshot.destinations.some((row: { id: string }) => row.id === DESTINATION)).toBe(false);
      expect(saved.durable.snapshot.dailyAccommodations).toHaveLength(1);
      expect(saved.durable.snapshot.dailyAccommodations[0]).toMatchObject({ title: 'Meeting point', sourceDestinationId: null });
      expect(world.backend.tables.daily_accommodations[0].source_destination_id).toBeNull();
      expect(world.backend.itinerary.some((row: { id: string }) => row.id === DESTINATION)).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-DEST-10 F02 F04 the actual star normalizes identity and toggles the same owner favorite', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await drop(device, '  Library   entrance  ');
      await run(device, 'map.place.favorite');
      await world.settle();
      expect(world.backend.tables.account_favorite_places).toHaveLength(1);
      expect(world.backend.tables.account_favorite_places[0]).toMatchObject({ user_id: LEADER, title: 'Library entrance', title_norm: 'library entrance' });
      await run(device, 'map.place.favorite');
      await world.settle();
      expect(world.backend.tables.account_favorite_places).toEqual([]);
      expect(world.backend.itinerary).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('MAP-LOC-05 confirmation cancel preserves sharing and accepted disable persists actual local consent before network retry', async () => {
    const world = new World();
    try {
      const device = await map(world);
      const before = await device.observe();
      expect(before.presentation.preferences.sharingEnabled).toBe(true);
      await expand(world, device);
      await run(device, 'map.sharing.toggle');
      await device.input({ kind: 'alert', index: 0 });
      expect((await device.observe()).presentation.preferences.sharingEnabled).toBe(true);
      device.online = false;
      await run(device, 'map.sharing.toggle');
      await device.input({ kind: 'alert', index: 1 });
      const disabled = await world.waitFor(device, (value: MapObservation) => value.presentation.preferences.sharingEnabled === false, 'actual privacy confirmation');
      expect(disabled.durable.locations).toEqual([]);
      expect(world.backend.tables.member_privacy_settings.some((row: { sharing_enabled: boolean }) => row.sharing_enabled === false)).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-COORD-02 MAP-COORD-03 MAP-COORD-04 actual create respond and override controls retain the resolved request', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await expand(world, device);
      await run(device, 'map.tab', { index: 1 });
      await run(device, 'map.ops.open');
      await run(device, 'map.coordination.create.open');
      expect(await run(device, 'map.coordination.create.submit')).toMatchObject({ invoked: false });
      await run(device, 'map.coordination.subject', { value: '  Choose lunch  ' });
      await run(device, 'map.coordination.option-a', { value: ' Stay ' });
      await run(device, 'map.coordination.option-b', { value: ' Move ' });
      await run(device, 'map.coordination.policy', { policy: 'organizer_override' });
      await run(device, 'map.coordination.create.submit');
      await world.waitFor(device, (value: MapObservation) => has(value, 'coordination-detail'), 'created request detail');
      const request = world.backend.tables.coordination_requests[0];
      expect(request.subject).toBe('Choose lunch');
      expect(request.options).toEqual([{ id: 'opt_a', label: 'Stay', kind: 'keep_current' }, { id: 'opt_b', label: 'Move', kind: 'itinerary' }]);
      await run(device, 'map.coordination.respond', { optionId: 'opt_b' });
      await world.settle();
      expect(world.backend.tables.coordination_responses[0]).toMatchObject({ user_id: LEADER, option_id: 'opt_b' });
      await run(device, 'map.coordination.override', { optionId: 'opt_a' });
      await world.settle();
      expect(request.status).toBe('resolved');
      expect(request.resolved_outcome).toBe('opt_a');
      expect(has(await device.observe(), 'coordination-option-opt_b')).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-MEET-01 MAP-MEET-02 actual card clock preserves its three-argument remote update path for save and clear', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await run(device, 'map.meet.open', { destinationId: DESTINATION });
      await run(device, 'map.meet.shortcut', { minutes: 30 });
      await run(device, 'map.meet.threshold', { minutes: 5 });
      await run(device, 'map.meet.save');
      await world.settle();
      expect(world.backend.itinerary[0].meet_at).toBeTruthy();
      expect(world.backend.itinerary[0].meet_red_minutes).toBe(5);
      expect(world.backend.trace.some((call: { name: string; steps: unknown[][] }) => call.name === 'itinerary_items' && call.steps.some(step => step[0] === 'update'))).toBe(true);
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'apply_core_operation_v3')).toEqual([]);
      await run(device, 'map.meet.open', { destinationId: DESTINATION });
      await run(device, 'map.meet.clear');
      await world.settle();
      expect(world.backend.itinerary[0].meet_at).toBeNull();
    } finally { await world.close(); }
  });
});
