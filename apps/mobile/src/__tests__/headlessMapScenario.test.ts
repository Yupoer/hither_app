const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Host = { testId?: string; label?: string; text?: string; value?: unknown; disabled?: boolean };
type Presentation = { hosts: Host[]; receipts: { host: string; method: string; args?: unknown[] }[];
  preferences: { sharingEnabled: boolean; passiveCompanionMode: boolean; travelMode: string; dayColors: Record<string, string> } };
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
    await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase: 'onBegin', value: {} });
    await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase: 'onUpdate', value: { translationY: -250, velocityY: 0 } });
    await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase: 'onEnd', value: { translationY: -250, velocityY: 0 }, success: true });
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
      await run(device, 'map.place.center');
      await run(device, 'map.place.cancel');
      expect((await device.observe()).durable.snapshot.destinations).toHaveLength(1);
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'apply_core_operation_v3')).toEqual([]);
      world.hold('apply_core_operation_v3');
      await drop(device, '  Local pool stop  ');
      await run(device, 'map.place.pool');
      const local = await world.waitFor(device, (value: MapObservation) => value.durable.operations.some(row => row.operationType === 'add_destination') && value.durable.snapshot.destinations.some(row => row.title === 'Local pool stop'), 'real Map durable add');
      expect(local.durable.snapshot.destinations.find((row: { title: string }) => row.title === 'Local pool stop')).toMatchObject({ day: null });
      expect(has(local, 'confirm-place-name')).toBe(false);
      expect(world.backend.itinerary).toHaveLength(1);
      await world.release('apply_core_operation_v3');
      expect(world.backend.itinerary.filter((row: { title: string }) => row.title === 'Local pool stop')).toHaveLength(1);
      expect((await device.observe()).durable.operations).toEqual([]);
      const addedId = world.backend.itinerary.find((row: { title: string }) => row.title === 'Local pool stop').id;
      await route(world, device);
      await run(device, 'map.route.swipe.open', { destinationId: addedId });
      await run(device, 'map.route.delete', { destinationId: addedId });
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.itinerary.some((row: { id: string }) => row.id === addedId)).toBe(true);
      await run(device, 'map.route.swipe.open', { destinationId: addedId });
      await run(device, 'map.route.delete', { destinationId: addedId });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: MapObservation) => !value.durable.snapshot.destinations.some(row => row.id === addedId), 'confirmed single-row deletion');
      expect(world.backend.itinerary).toHaveLength(1);
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
      await run(device, 'map.route.stay.cancel', { day: 1 });
      expect(has(await device.observe(), `route-select-stay-${DESTINATION}`)).toBe(false);
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

  it('MAP-ROUTE-01 actual subgroup editor captures its own lane and never reorders the main itinerary', async () => {
    const world = new World();
    const subgroupId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const mainId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    try {
      world.backend.groups.get(GROUP_ID).trip_days = 2;
      world.backend.tables.subgroups.push({ id: subgroupId, group_id: GROUP_ID, name: 'Side route', leader_id: PEER, created_at: new Date(world.now).toISOString() });
      world.backend.memberships.find((row: { user_id: string }) => row.user_id === PEER).subgroup_id = subgroupId;
      world.backend.itinerary[0].subgroup_id = subgroupId;
      world.backend.itinerary.push({ ...world.backend.itinerary[0], id: mainId, subgroup_id: null, title: 'Main stop' });
      const device = await map(world, PEER);
      await expand(world, device);
      await run(device, 'map.tab', { index: 1 });
      expect(has(await device.observe(), 'map-edit-itinerary')).toBe(false);
      await run(device, 'map.route.open-subgroup');
      await device.input({ kind: 'animation', finished: true });
      await run(device, 'map.route.move.open', { destinationId: DESTINATION });
      await run(device, 'map.route.move.day', { day: 2 });
      await world.settle();
      expect(world.backend.itinerary.find((row: { id: string }) => row.id === DESTINATION)).toMatchObject({ day: 2, subgroup_id: subgroupId });
      expect(world.backend.itinerary.find((row: { id: string }) => row.id === mainId)).toMatchObject({ day: 1, position: 0, subgroup_id: null });
      expect((await device.observe()).durable.snapshot.destinations.find((row: { id: string }) => row.id === mainId).day).toBe(1);
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

  it('MAP-DEST-01 MAP-DEST-14 actual search stages an editor confirmation and materializes a provider stop only on first-stop submit', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await device.input({ kind: 'mapsConfigure', patch: { searchResults: [{ id: 'station', providerPlaceId: 'mapkit:station', name: 'Provider station', coordinates: { latitude: 25.03, longitude: 121.55 } }] } });
      await run(device, 'map.search.open');
      await device.input({ kind: 'animation', finished: true });
      await run(device, 'map.search.query', { value: ' Station ' });
      await world.advance(450);
      const resultKey = JSON.stringify(['station', 25.03, 121.55]);
      await world.waitFor(device, (value: MapObservation) => has(value, `place-search-result-${resultKey}`), 'Map-owned search result');
      await run(device, 'map.search.pick', { resultKey });
      await world.advance(0);
      await device.input({ kind: 'animation', finished: true });
      expect(field(await device.observe(), 'confirm-place-name')?.value).toBe('Provider station');
      expect(world.backend.itinerary).toHaveLength(1);
      await run(device, 'map.place.first-stop');
      await world.settle();
      expect(world.backend.itinerary.find((row: { title: string }) => row.title === 'Provider station')).toMatchObject({ provider_place_id: 'mapkit:station', day: 1 });
      expect(world.backend.itinerary.find((row: { title: string }) => row.title === 'Provider station').position).toBeLessThan(world.backend.itinerary.find((row: { id: string }) => row.id === DESTINATION).position);
      expect(has(await device.observe(), 'confirm-place-name')).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-DEST-11 MAP-DEST-12 MAP-STAY-03 MAP-ROUTE-06 actual favorite and quick hotel remain drafts until Done and retry restores failed favorite deletion', async () => {
    const world = new World();
    try {
      world.backend.tables.daily_accommodations.push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', group_id: GROUP_ID,
        stay_date: '2026-10-22', title: 'Night stay', latitude: 25.03, longitude: 121.55, source_destination_id: null });
      const device = await map(world);
      await drop(device, 'Favorite stop');
      await run(device, 'map.place.favorite');
      await world.settle();
      const favoriteId = world.backend.tables.account_favorite_places[0].id;
      await run(device, 'map.place.cancel');
      await route(world, device);
      await run(device, 'map.route.favorites');
      device.online = false;
      await run(device, 'map.route.favorite.delete', { favoriteId });
      await world.waitFor(device, (value: MapObservation) => has(value, `route-favorite-${favoriteId}`), 'failed favorite deletion restored');
      expect(world.backend.tables.account_favorite_places).toHaveLength(1);
      device.online = true;
      await run(device, 'map.route.favorite.pick', { favoriteId });
      await device.input({ kind: 'animation', finished: true });
      await run(device, 'map.route.stay.quick-add', { day: 1 });
      expect(world.backend.itinerary).toHaveLength(1);
      await done(world, device);
      expect(world.backend.itinerary.filter((row: { title: string }) => row.title === 'Favorite stop')).toEqual([expect.objectContaining({ day: null })]);
      expect(world.backend.itinerary.filter((row: { kind: string }) => row.kind === 'accommodation')).toEqual([expect.objectContaining({ title: 'Night stay', day: 1, stay_anchor: false, latitude: 25.03, longitude: 121.55 })]);
      await route(world, device);
      await run(device, 'map.route.stay.remove', { day: 1 });
      expect(world.backend.tables.daily_accommodations).toHaveLength(1);
      await done(world, device);
      expect(world.backend.tables.daily_accommodations).toEqual([]);
      expect(world.backend.itinerary.some((row: { kind: string }) => row.kind === 'accommodation')).toBe(true);
      expect((await device.observe()).durable.operations).toEqual([]);
    } finally { await world.close(); }
  });

  it('MAP-DEST-07 MAP-DEST-08 MAP-DEST-09 actual Map KML opener reads quota and commits the selected batch atomically', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await route(world, device);
      await run(device, 'map.kml.open');
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: MapObservation) => has(value, 'kml-pick-file'), 'Map-owned KML sheet');
      const content = '<kml><Placemark><name>North &amp; South</name><Point><coordinates>121.55,25.03</coordinates></Point></Placemark><Placemark><name>East</name><Point><coordinates>121.56,25.04</coordinates></Point></Placemark></kml>';
      await device.input({ kind: 'mapFile', uri: 'content://map/route', content });
      await device.input({ kind: 'mapsConfigure', patch: { picker: { canceled: false, assets: [{ uri: 'content://map/route', name: 'route.kml' }] } } });
      await run(device, 'map.kml.pick');
      await run(device, 'map.kml.import');
      await world.settle();
      expect(world.backend.itinerary.filter((row: { title: string }) => ['North & South', 'East'].includes(row.title))).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: 'North & South', day: null }), expect.objectContaining({ title: 'East', day: null }),
      ]));
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'import_itinerary_batch')).toHaveLength(1);
      expect((await device.observe()).durable.operations).toEqual([]);
      await world.advance(1000);
      expect(has(await device.observe(), 'kml-import-confirm')).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-ROUTE-08 MAP-ROUTE-09 MAP-ROUTE-10 MAP-ROUTE-12 actual marker trip and multi-selection controls save edits and honor delete cancellation', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await route(world, device);
      await run(device, 'map.route.emoji.open', { destinationId: DESTINATION });
      await run(device, 'map.route.emoji.category', { category: 'food' });
      expect(has(await device.observe(), 'route-emoji-preset-🚉')).toBe(false);
      await run(device, 'map.route.emoji.preset', { emoji: '☕' });
      await run(device, 'map.route.emoji.save');
      await world.settle();
      expect(world.backend.itinerary[0]).toMatchObject({ emoji: '☕', marker_color: null });
      await run(device, 'map.route.day-color.open', { day: 1 });
      await run(device, 'map.route.day-color', { color: '#6FA8FF' });
      expect((await device.observe()).presentation.preferences.dayColors['1']).toBe('#6FA8FF');
      await run(device, 'map.route.trip.open');
      await run(device, 'map.route.trip.more-days');
      await run(device, 'map.route.trip.fewer-days');
      await run(device, 'map.route.trip.fewer-days');
      await run(device, 'map.route.trip.more-days');
      await run(device, 'map.overlay.done', { label: 'commit' });
      expect(world.backend.groups.get(GROUP_ID).trip_days).toBe(1);
      await done(world, device);
      expect(world.backend.groups.get(GROUP_ID).trip_days).toBe(2);
      await route(world, device);
      await run(device, 'map.route.interaction-mode');
      await run(device, 'map.route.select', { destinationId: DESTINATION });
      await run(device, 'map.route.delete-selected');
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.itinerary).toHaveLength(1);
      await run(device, 'map.route.delete-selected');
      await device.input({ kind: 'alert', index: 1 });
      await world.settle();
      expect(world.backend.itinerary).toEqual([]);
      expect((await device.observe()).durable.snapshot.destinations).toEqual([]);
    } finally { await world.close(); }
  });

  it('MAP-DEST-05 MAP-GATHER-01 MAP-GATHER-02 actual follower KML submits a request and leader inbox approval materializes its pool stops', async () => {
    const world = new World();
    try {
      const follower = await map(world, PEER, 'follower');
      await expand(world, follower);
      await run(follower, 'map.tab', { index: 1 });
      await run(follower, 'map.kml.open');
      await follower.input({ kind: 'animation', finished: true });
      await follower.input({ kind: 'mapFile', uri: 'content://member/route', content: '<kml><Placemark><name>Suggested KML</name><Point><coordinates>121.56,25.04</coordinates></Point></Placemark></kml>' });
      await follower.input({ kind: 'mapsConfigure', patch: { picker: { canceled: false, assets: [{ uri: 'content://member/route', name: 'member.kml' }] } } });
      await run(follower, 'map.kml.pick');
      await run(follower, 'map.kml.import');
      await world.settle();
      expect(world.backend.itinerary).toHaveLength(1);
      const request = world.backend.tables.gather_point_requests[0];
      expect(request).toMatchObject({ requester_id: PEER, status: 'pending', items: [expect.objectContaining({ title: 'Suggested KML', day: null })] });
      const leader = await map(world, LEADER, 'leader');
      await expand(world, leader);
      await run(leader, 'map.tab', { index: 1 });
      await world.advance(2500);
      await world.waitFor(leader, (value: MapObservation) => has(value, `gather-request-approve-${request.id}`), 'actual leader inbox');
      await run(leader, 'map.suggestion.approve', { requestId: request.id });
      await world.advance(2500);
      await world.waitFor(leader, (value: MapObservation) => !has(value, `gather-request-approve-${request.id}`), 'approved request leaves inbox');
      expect(request.status).toBe('approved');
      expect(world.backend.itinerary.find((row: { title: string }) => row.title === 'Suggested KML')).toMatchObject({ day: null });
      await world.advance(300);
      expect((await follower.observe()).durable.snapshot.destinations.some((row: { title: string }) => row.title === 'Suggested KML')).toBe(true);
      const rejected = await run(follower, 'map.service.gathering.suggest', { args: [GROUP_ID, null, [{ title: 'Rejected suggestion', coordinates: { latitude: 25.06, longitude: 121.57 } }]] });
      await world.advance(2500);
      await world.waitFor(leader, (value: MapObservation) => has(value, `gather-request-reject-${rejected}`), 'next coalesced inbox request');
      await run(leader, 'map.suggestion.reject', { requestId: rejected });
      await world.advance(2500);
      await world.waitFor(leader, (value: MapObservation) => !has(value, `gather-request-reject-${rejected}`), 'rejected request leaves inbox');
      expect(world.backend.tables.gather_point_requests.find((row: { id: string }) => row.id === rejected).status).toBe('rejected');
      expect(world.backend.itinerary.some((row: { title: string }) => row.title === 'Rejected suggestion')).toBe(false);
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

  it('MAP-ROUTE-11 actual read-only scope collapse persists for the same account and group after restart', async () => {
    const world = new World();
    try {
      const device = await map(world, PEER);
      await expand(world, device);
      await run(device, 'map.tab', { index: 1 });
      expect(has(await device.observe(), 'map-edit-itinerary')).toBe(false);
      const titles = (value: MapObservation) => value.presentation.hosts.filter(host => host.text === 'Meeting point').length;
      const expandedCount = titles(await device.observe());
      expect(expandedCount).toBeGreaterThan(0);
      await run(device, 'map.route.scope', { scope: 'main' });
      const collapsedCount = titles(await device.observe());
      expect(collapsedCount).toBeLessThan(expandedCount);
      await device.restart();
      await world.waitFor(device, (value: MapObservation) => has(value, 'map-search'), 'restarted real Map');
      await expand(world, device);
      await run(device, 'map.tab', { index: 1 });
      expect(titles(await device.observe())).toBe(collapsedCount);
      await run(device, 'map.route.scope', { scope: 'main' });
      expect(titles(await device.observe())).toBe(expandedCount);
    } finally { await world.close(); }
  });

  it('MAP-ROUTES-01 MAP-PROGRESS-01 MAP-PROGRESS-02 MAP-NAV-06 MAP-NAV-07 actual GPS directions feed card metrics and external provider choice respects travel mode', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await device.input({ kind: 'mapsConfigure', patch: { route: { distanceMeters: 1000, expectedTravelTimeSeconds: 600,
        points: [{ latitude: 25.03, longitude: 121.53 }, { latitude: 25.04, longitude: 121.53 }] } } });
      const sample = async (latitude: number) => {
        await world.advance(1000);
        if (platform === 'ios') await run(device, 'map.location.native-sample', { latitude, longitude: 121.53, accuracy: 5, timestamp: world.now });
        else await device.input({ kind: 'gps', latitude, longitude: 121.53, accuracy: 5, timestamp: world.now });
        await world.settle();
      };
      await sample(25.03);
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(device, (value: MapObservation) => field(value, `gather-travel-mode-${DESTINATION}`)?.label?.includes('10 min') === true, 'real route metrics');
      expect(field(await device.observe(), `gather-travel-mode-${DESTINATION}`)?.label).toContain('1.0 km');
      await world.settle();
      const receipts = (await device.observe()).presentation.receipts;
      expect(receipts.some((receipt: { host: string; method: string }) => receipt.host === 'MapView' && receipt.method === 'fitToCoordinates')).toBe(true);
      await run(device, 'map.external-navigation', { destinationId: DESTINATION });
      await device.input({ kind: 'alert', index: 2 });
      expect((await device.observe()).presentation.receipts.filter((receipt: { host: string }) => receipt.host === 'Linking')).toEqual([]);
      await run(device, 'map.travel-mode', { destinationId: DESTINATION });
      expect((await device.observe()).presentation.preferences.travelMode).toBe('bicycle');
      await run(device, 'map.external-navigation', { destinationId: DESTINATION });
      await device.input({ kind: 'alert', index: 0 });
      expect((await device.observe()).presentation.receipts.filter((receipt: { host: string }) => receipt.host === 'Linking')).toEqual([
        expect.objectContaining({ method: 'openURL', url: 'https://www.google.com/maps/dir/?api=1&destination=25.04%2C121.53&travelmode=bicycling' }),
      ]);
      await run(device, 'map.external-navigation', { destinationId: DESTINATION });
      await device.input({ kind: 'alert', index: 1 });
      expect((await device.observe()).presentation.receipts.filter((receipt: { host: string }) => receipt.host === 'Linking')).toEqual(expect.arrayContaining([
        expect.objectContaining({ url: 'https://maps.apple.com/directions?destination=25.04%2C121.53&mode=cycling' }),
      ]));
      await sample(25.035);
      const near = field(await device.observe(), `gather-travel-mode-${DESTINATION}`)?.label;
      expect(near).toBeTruthy();
      await device.input({ kind: 'appState', value: 'background' });
      await device.input({ kind: 'appState', value: 'active' });
      expect((await device.observe()).presentation.preferences.travelMode).toBe('bicycle');
      expect(world.backend.itinerary[0].closed_at).toBeNull();
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
      await run(device, 'map.coordination.back');
      await run(device, 'map.coordination.select', { requestId: request.id });
      expect(has(await device.observe(), 'coordination-option-opt_b')).toBe(false);
      await run(device, 'map.coordination.back');
      await run(device, 'map.coordination.create.open');
      await run(device, 'map.coordination.subject', { value: 'Discard draft' });
      await run(device, 'map.coordination.create.cancel');
      await run(device, 'map.coordination.create.open');
      expect(field(await device.observe(), 'coordination-subject-input')?.value).toBe('');
      await run(device, 'map.coordination.subject', { value: 'Cancel me' });
      await run(device, 'map.coordination.option-a', { value: 'One' });
      await run(device, 'map.coordination.option-b', { value: 'Two' });
      await run(device, 'map.coordination.create.submit');
      await world.waitFor(device, (value: MapObservation) => has(value, 'coordination-cancel'), 'second actual request detail');
      const cancellable = world.backend.tables.coordination_requests.find((row: { subject: string }) => row.subject === 'Cancel me');
      device.online = false;
      await run(device, 'map.coordination.cancel');
      await world.settle();
      expect(cancellable.status).toBe('open');
      expect(has(await device.observe(), 'coordination-detail')).toBe(true);
      device.online = true;
      await run(device, 'map.coordination.cancel');
      await world.waitFor(device, (value: MapObservation) => !has(value, 'coordination-detail'), 'successful cancel leaves detail');
      expect(cancellable.status).toBe('cancelled');
    } finally { await world.close(); }
  });

  it('MAP-NAV-01 MAP-NAV-03 actual Start then End pauses the shared session without completing the itinerary stop', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(device, () => [...world.backend.sessions.values()].some((session: { status: string }) => session.status === 'active'), 'actual shared Start');
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      expect(field(await device.observe(), `gather-nav-${DESTINATION}`)?.disabled).toBe(false);
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(device, () => [...world.backend.sessions.values()].every((session: { status: string }) => session.status !== 'active'), 'actual shared End');
      expect([...world.backend.sessions.values()]).toEqual([expect.objectContaining({ status: 'cancelled' })]);
      expect((await device.observe()).durable.snapshot.destinations.find((row: { id: string }) => row.id === DESTINATION).closedAt).toBeFalsy();
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      expect(has(await device.observe(), `gather-arrival-${DESTINATION}`)).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-GATHER-07 actual follower request-start sends a command without creating a leader session', async () => {
    const world = new World();
    try {
      const device = await map(world, PEER);
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      await world.settle();
      expect(world.backend.notificationOutbox).toEqual([expect.objectContaining({ sender_id: PEER, target_user_id: LEADER,
        payload: expect.objectContaining({ type: 'request_start', groupId: GROUP_ID }) })]);
      expect(world.backend.sessions.size).toBe(0);
      expect(world.backend.itinerary[0].closed_at).toBeNull();
    } finally { await world.close(); }
  });

  it('MAP-NAV-02 MAP-NAV-05 actual held Start then End keeps terminal intent authoritative across ACK and restart', async () => {
    const world = new World();
    try {
      const device = await map(world);
      world.hold('apply_core_operation_v3', { phase: 'delivery' });
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(device, (value: MapObservation) => value.durable.operations.length === 1, 'durable Start before ACK');
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      const ended = await world.waitFor(device, (value: MapObservation) => value.durable.operations.length === 2, 'durable End follows Start');
      expect(ended.durable.operations.map((row: { operationType: string }) => row.operationType)).toEqual(['start_gathering', 'end_gathering']);
      expect(ended.durable.operations[1].dependencyIds).toContain(ended.durable.operations[0].id);
      expect(field(ended, `gather-nav-${DESTINATION}`)?.label).toBe('開始');
      await world.release('apply_core_operation_v3');
      await world.advance(300);
      await world.waitFor(device, (value: MapObservation) => value.durable.operations.length === 0, 'terminal intents accepted');
      expect([...world.backend.sessions.values()]).toEqual([expect.objectContaining({ status: 'cancelled' })]);
      await device.restart();
      await world.waitFor(device, (value: MapObservation) => has(value, `gather-card-${DESTINATION}`), 'Map restarted');
      await run(device, 'map.card.toggle', { destinationId: DESTINATION });
      expect(field(await device.observe(), `gather-nav-${DESTINATION}`)?.label).toBe('開始');
      expect(has(await device.observe(), `gather-arrival-${DESTINATION}`)).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-ROUTE-04 MAP-NAV-02 actual switch confirmation preserves old session on cancel and promotes the accepted target within its day', async () => {
    const world = new World();
    const secondId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    try {
      world.backend.itinerary.push({ ...world.backend.itinerary[0], id: secondId, title: 'Second stop', position: 1, latitude: 25.06 });
      const device = await map(world);
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      await world.settle();
      await run(device, 'map.carousel.begin');
      await run(device, 'map.carousel.end', { x: 390 });
      await run(device, 'map.card.toggle', { destinationId: secondId });
      const cameraCalls = (value: MapObservation) => value.presentation.receipts.filter(receipt => receipt.host === 'MapView' && receipt.method === 'animateCamera');
      const selectedCameraCount = cameraCalls(await device.observe()).length;
      expect(selectedCameraCount).toBeGreaterThan(0);
      await run(device, 'map.carousel.end', { x: 0 });
      expect(cameraCalls(await device.observe())).toHaveLength(selectedCameraCount);
      await run(device, 'map.journey.command', { destinationId: secondId });
      await device.input({ kind: 'alert', index: 0 });
      expect([...world.backend.sessions.values()].find((row: { status: string }) => row.status === 'active').destination_id).toBe(DESTINATION);
      await run(device, 'map.journey.command', { destinationId: secondId });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, () => [...world.backend.sessions.values()].some((row: { status: string; destination_id: string }) => row.status === 'active' && row.destination_id === secondId), 'accepted switch target');
      expect([...world.backend.sessions.values()].find((row: { status: string }) => row.status === 'active').destination_id).toBe(secondId);
      expect(world.backend.itinerary.find((row: { id: string }) => row.id === secondId).position).toBeLessThan(world.backend.itinerary.find((row: { id: string }) => row.id === DESTINATION).position);
      expect(world.backend.itinerary.every((row: { closed_at: string | null }) => row.closed_at === null)).toBe(true);
    } finally { await world.close(); }
  });

  it('MAP-ARRIVAL-02 MAP-ARRIVAL-03 MAP-ARRIVAL-05 actual GPS arrival ignores poor fixes and manual undo suppresses inside-radius reentry until exit', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      await world.settle();
      const sample = async (latitude: number, accuracy: number) => {
        await world.advance(1000);
        if (platform === 'ios') await run(device, 'map.location.native-sample', { latitude, longitude: 121.53, accuracy, timestamp: world.now });
        else await device.input({ kind: 'gps', latitude, longitude: 121.53, accuracy, timestamp: world.now });
        await world.settle();
      };
      await sample(25.04, 200);
      expect(world.backend.tables.destination_arrivals).toEqual([]);
      await sample(25.04, 5);
      await world.waitFor(device, (value: MapObservation) => has(value, `gather-arrival-undo-${DESTINATION}`), 'automatic personal arrival');
      expect(world.backend.tables.destination_arrivals).toHaveLength(1);
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      await run(device, 'map.arrival.undo', { destinationId: DESTINATION });
      await device.input({ kind: 'alert', index: 1 });
      await world.settle();
      await sample(25.04, 5);
      expect(world.backend.tables.destination_arrivals).toEqual([]);
      await sample(25.05, 5);
      await sample(25.04, 5);
      await world.waitFor(device, (value: MapObservation) => has(value, `gather-arrival-undo-${DESTINATION}`), 'reentry after leaving radius');
      expect(world.backend.tables.destination_arrivals).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('MAP-ARRIVAL-01 MAP-ARRIVAL-03 MAP-ARRIVAL-04 MAP-GATHER-04 MAP-GATHER-05 real self arrival undo confirmation and forced completion preserve session audit', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(device, (value: MapObservation) => has(value, `gather-arrival-${DESTINATION}`), 'active self-arrival control');
      await run(device, 'map.arrival.mark', { destinationId: DESTINATION });
      await world.waitFor(device, (value: MapObservation) => has(value, `gather-arrival-undo-${DESTINATION}`), 'personal arrival reflected');
      const session = [...world.backend.sessions.values()][0];
      expect(world.backend.tables.destination_arrivals[0]).toMatchObject({ user_id: LEADER, navigation_session_id: session.id, arrived_at: new Date(world.now).toISOString() });
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      await run(device, 'map.arrival.undo', { destinationId: DESTINATION });
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.tables.destination_arrivals).toHaveLength(1);
      await run(device, 'map.arrival.undo', { destinationId: DESTINATION });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: MapObservation) => has(value, `gather-arrival-${DESTINATION}`), 'confirmed undo reflected');
      expect(world.backend.tables.destination_arrivals).toEqual([]);
      await run(device, 'map.arrival.mark', { destinationId: DESTINATION });
      await world.waitFor(device, (value: MapObservation) => has(value, `gather-arrival-undo-${DESTINATION}`), 'second personal arrival reflected');
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      expect((await device.observe()).external.alerts).toBe(1);
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.itinerary[0].closed_at).toBeNull();
      await run(device, 'map.journey.command', { destinationId: DESTINATION });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: MapObservation) => !!value.durable.snapshot.destinations.find(row => row.id === DESTINATION)?.closedAt, 'forced completion local history');
      expect(world.backend.itinerary[0]).toMatchObject({ closed_by_session_id: session.id });
      expect(session.status).toBe('completed');
      expect(has(await device.observe(), `gather-card-${DESTINATION}`)).toBe(true);
      await world.advance(3200);
      expect(has(await device.observe(), `gather-card-${DESTINATION}`)).toBe(true);
      await world.advance(440);
      expect(has(await device.observe(), `gather-card-${DESTINATION}`)).toBe(false);
      await expand(world, device);
      await run(device, 'map.tab', { index: 1 });
      await run(device, 'map.arrival.manage');
      await device.input({ kind: 'animation', finished: true });
      await run(device, 'map.arrival.correct', { destinationId: DESTINATION, userId: PEER });
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.tables.destination_arrivals.some((row: { user_id: string }) => row.user_id === PEER)).toBe(false);
      await run(device, 'map.arrival.correct', { destinationId: DESTINATION, userId: PEER });
      await device.input({ kind: 'alert', index: 1 });
      await world.settle();
      expect(world.backend.tables.destination_arrivals.find((row: { user_id: string }) => row.user_id === PEER)).toMatchObject({ arrived_at: null, navigation_session_id: session.id });
      const correction = world.backend.trace.find((call: { args?: { p_operation_type: string } }) => call.args?.p_operation_type === 'leader_correct_arrival');
      expect(correction.args.p_payload).toMatchObject({ actorId: LEADER, targetUserId: PEER, sessionId: session.id, arrivedAt: null, source: 'leader_correction' });
    } finally { await world.close(); }
  });

  it('MAP-HISTORY-01 MAP-HISTORY-02 actual history cancel retains a waypoint and confirmed deletion reloads the real list', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await run(device, 'map.service.history.record', { args: [GROUP_ID, 'Historic gate', { latitude: 25.04, longitude: 121.53 }] });
      const rows = await run(device, 'map.service.history.list', { args: [GROUP_ID] });
      const historyId = rows.find((row: { name: string }) => row.name === 'Historic gate').id;
      await expand(world, device);
      await run(device, 'map.tab', { index: 1 });
      await run(device, 'map.history.open');
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: MapObservation) => has(value, `history-delete-${historyId}`), 'real history waypoint row');
      await run(device, 'map.history.delete', { historyId });
      await device.input({ kind: 'alert', index: 0 });
      expect(await run(device, 'map.service.history.list', { args: [GROUP_ID] })).toHaveLength(1);
      await run(device, 'map.history.delete', { historyId });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: MapObservation) => !has(value, `history-delete-${historyId}`), 'deleted waypoint reload');
      expect(await run(device, 'map.service.history.list', { args: [GROUP_ID] })).toEqual([]);
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
