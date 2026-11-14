const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type ItineraryObservation = {
  presentation: { hosts: { testId?: string; text?: string; label?: string; value?: unknown }[] };
  durable: {
    snapshot: { destinations: { id: string; title: string; day: number | null; order: number }[] };
    operations: { operationType: string }[];
  };
};
type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
const has = (value: ItineraryObservation, testId: string) => value.presentation.hosts.some(host => host.testId === testId);

describe('actual itinerary entry variants on Android', () => {
  jest.setTimeout(120000);
  const run = (device: Device, name: string, input = {}) => device.perform(name, input);

  async function map(world: InstanceType<typeof World>, userId = LEADER) {
    const device = await world.device({ id: 'itinerary', userId, platform: 'android',
      screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: ItineraryObservation) => has(value, `gather-card-${DESTINATION}`), 'actual Map destination');
    await run(device, 'map.card.toggle', { destinationId: DESTINATION });
    return device;
  }

  async function itinerary(world: InstanceType<typeof World>, device: Device, edit = true) {
    await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase: 'onBegin', value: {} });
    await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase: 'onUpdate', value: { translationY: -250, velocityY: 0 } });
    await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase: 'onEnd', value: { translationY: -250, velocityY: 0 }, success: true });
    await world.settle();
    await run(device, 'map.tab', { index: 1 });
    if (edit) {
      await run(device, 'map.route.open');
      await device.input({ kind: 'animation', finished: true });
      await world.settle();
    }
  }

  it('MAP-DEST-05 MAP-DEST-12 actual follower search and read-only favorite picker submit distinct pool suggestions', async () => {
    const world = new World();
    const favoriteId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    try {
      world.backend.tables.account_favorite_places.push({ id: favoriteId, user_id: PEER,
        title: 'Saved garden', address: 'Garden entrance', latitude: 25.05, longitude: 121.56,
        lat_norm: 25.05, lng_norm: 121.56, title_norm: 'saved garden', created_at: new Date(world.now).toISOString() });
      const device = await map(world, PEER);
      await device.input({ kind: 'mapsConfigure', patch: { searchResults: [{ id: 'museum', name: 'Search museum',
        address: 'Museum entrance', coordinates: { latitude: 25.03, longitude: 121.55 } }] } });
      await run(device, 'map.search.open');
      await device.input({ kind: 'animation', finished: true });
      await run(device, 'map.search.query', { value: 'museum' });
      await world.advance(450);
      const resultKey = JSON.stringify(['museum', 25.03, 121.55]);
      await world.waitFor(device, (value: ItineraryObservation) => has(value, `place-search-result-${resultKey}`), 'follower search result');
      await run(device, 'map.search.pick', { resultKey });
      await world.waitFor(device, () => world.backend.tables.gather_point_requests.length === 1, 'search suggestion');
      expect(has(await device.observe(), 'confirm-place-name')).toBe(false);
      await device.input({ kind: 'animation', finished: true });
      await itinerary(world, device, false);
      expect(has(await device.observe(), 'map-edit-itinerary')).toBe(false);
      await run(device, 'map.route.favorites');
      await world.waitFor(device, (value: ItineraryObservation) => has(value, `route-favorite-${favoriteId}`), 'follower favorite picker');
      await run(device, 'map.route.favorite.pick', { favoriteId });
      await world.waitFor(device, () => world.backend.tables.gather_point_requests.length === 2, 'favorite suggestion');
      expect(world.backend.tables.gather_point_requests).toEqual([
        expect.objectContaining({ requester_id: PEER, status: 'pending', subgroup_id: null,
          items: [expect.objectContaining({ title: 'Search museum', address: 'Museum entrance', latitude: 25.03, longitude: 121.55, day: null })] }),
        expect.objectContaining({ requester_id: PEER, status: 'pending', subgroup_id: null,
          items: [expect.objectContaining({ title: 'Saved garden', address: 'Garden entrance', latitude: 25.05, longitude: 121.56, day: null })] }),
      ]);
      expect(world.backend.itinerary.map((row: { id: string }) => row.id)).toEqual([DESTINATION]);
      expect((await device.observe()).durable.snapshot.destinations.map((row: { id: string }) => row.id)).toEqual([DESTINATION]);
      expect(world.backend.tables.account_favorite_places).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('MAP-DEST-11 F03 actual editable favorite deletion persists for its owner and survives reopening', async () => {
    const world = new World();
    const favoriteId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const otherFavoriteId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    try {
      world.backend.tables.account_favorite_places.push(...[
        { id: favoriteId, user_id: LEADER }, { id: otherFavoriteId, user_id: PEER },
      ].map(owner => ({ ...owner, title: 'Shared place name', address: null, latitude: 25.05, longitude: 121.56,
        lat_norm: 25.05, lng_norm: 121.56, title_norm: 'shared place name', created_at: new Date(world.now).toISOString() })));
      const device = await map(world);
      await itinerary(world, device);
      await run(device, 'map.route.favorites');
      await world.waitFor(device, (value: ItineraryObservation) => has(value, `route-favorite-${favoriteId}`), 'owner favorite');
      expect(has(await device.observe(), `route-favorite-${otherFavoriteId}`)).toBe(false);
      await run(device, 'map.route.favorite.delete', { favoriteId });
      await world.waitFor(device, (value: ItineraryObservation) => !has(value, `route-favorite-${favoriteId}`), 'deleted favorite removed from picker');
      expect(world.backend.tables.account_favorite_places).toEqual([expect.objectContaining({ id: otherFavoriteId, user_id: PEER })]);
      await device.restart();
      await world.waitFor(device, (value: ItineraryObservation) => has(value, 'map-search'), 'restarted Map');
      await itinerary(world, device);
      await run(device, 'map.route.favorites');
      expect(has(await device.observe(), `route-favorite-${favoriteId}`)).toBe(false);
      expect(world.backend.itinerary.map((row: { id: string }) => row.id)).toEqual([DESTINATION]);
    } finally { await world.close(); }
  });

  it('MAP-ROUTE-02 MAP-ROUTE-03 actual move-to-pool persists an unscheduled stop', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await itinerary(world, device);
      await run(device, 'map.route.move.open', { destinationId: DESTINATION });
      await run(device, 'map.route.move.day', { day: null });
      await world.waitFor(device, (value: ItineraryObservation) => value.durable.snapshot.destinations.find(row => row.id === DESTINATION)?.day === null, 'pool move persisted locally');
      expect(world.backend.itinerary).toEqual([expect.objectContaining({ id: DESTINATION, day: null, position: 0 })]);
      await run(device, 'map.overlay.done', { label: '完成' });
      await world.settle();
      expect((await device.observe()).durable.operations).toEqual([]);
    } finally { await world.close(); }
  });

  it('K07 MAP-DEST-07 actual Map import retries a malformed file and imports only the replacement', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await itinerary(world, device);
      await run(device, 'map.kml.open');
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: ItineraryObservation) => has(value, 'kml-pick-file'), 'Map import intro');
      await device.input({ kind: 'mapFile', uri: 'content://itinerary/broken', content: '<kml><Placemark><name>Broken' });
      await device.input({ kind: 'mapsConfigure', patch: { picker: { canceled: false, assets: [{ uri: 'content://itinerary/broken', name: 'broken.kml' }] } } });
      await run(device, 'map.kml.pick');
      await world.waitFor(device, (value: ItineraryObservation) => has(value, 'kml-retry'), 'malformed-file error');
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'import_itinerary_batch')).toEqual([]);
      expect(world.backend.itinerary).toHaveLength(1);
      await run(device, 'map.kml.retry');
      expect(has(await device.observe(), 'kml-pick-file')).toBe(true);
      await device.input({ kind: 'mapFile', uri: 'content://itinerary/replacement',
        content: '<kml><Placemark><name>Replacement stop</name><Point><coordinates>121.56,25.04</coordinates></Point></Placemark></kml>' });
      await device.input({ kind: 'mapsConfigure', patch: { picker: { canceled: false, assets: [{ uri: 'content://itinerary/replacement', name: 'replacement.kml' }] } } });
      await run(device, 'map.kml.pick');
      await world.waitFor(device, (value: ItineraryObservation) => has(value, 'kml-import-confirm'), 'replacement preview');
      await run(device, 'map.kml.import');
      await world.waitFor(device, (value: ItineraryObservation) => value.durable.snapshot.destinations.some(row => row.title === 'Replacement stop'), 'replacement import');
      expect(world.backend.itinerary).toHaveLength(2);
      expect(world.backend.itinerary.find((row: { title: string }) => row.title === 'Replacement stop')).toMatchObject({ day: null, latitude: 25.04, longitude: 121.56 });
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'import_itinerary_batch')).toHaveLength(1);
      await world.advance(1000);
      expect(has(await device.observe(), 'kml-import-confirm')).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-ROUTE-10 actual departure selector changes the draft and saves its calendar date on Done', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await itinerary(world, device);
      await run(device, 'map.route.trip.open');
      await device.host.call({ kind: 'press', testId: 'route-trip-date' });
      const timestamp = new Date(2026, 9, 25, 12).getTime();
      await device.input({ kind: 'datePicker', type: 'set', timestamp });
      await run(device, 'map.overlay.done', { label: 'commit' });
      expect(world.backend.groups.get(GROUP_ID).departure_date).toBe('2026-10-22');
      await run(device, 'map.overlay.done', { label: '完成' });
      await world.settle();
      expect(world.backend.groups.get(GROUP_ID).departure_date).toBe('2026-10-25');
      expect(world.backend.groups.get(GROUP_ID).trip_days).toBe(1);
      expect((await device.observe()).durable.operations).toEqual([]);
      await itinerary(world, device);
      await run(device, 'map.route.trip.open');
      await device.host.call({ kind: 'press', testId: 'route-trip-date' });
      await device.input({ kind: 'datePicker', type: 'dismissed' });
      await run(device, 'map.overlay.done', { label: 'commit' });
      await run(device, 'map.overlay.done', { label: '完成' });
      await world.settle();
      expect(world.backend.groups.get(GROUP_ID).departure_date).toBe('2026-10-25');
    } finally { await world.close(); }
  });

  it('MAP-ROUTE-12 MAP-ROUTE-02 locked presentation hides selection and drag mode reorders through real PanResponder callbacks', async () => {
    const world = new World();
    const secondId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    try {
      world.backend.itinerary.push({ ...world.backend.itinerary[0], id: secondId, title: 'Second stop', position: 1 });
      const device = await map(world);
      await itinerary(world, device);
      await run(device, 'map.route.interaction-mode');
      expect(has(await device.observe(), `route-select-${DESTINATION}`)).toBe(true);
      await run(device, 'map.route.interaction-mode');
      const locked = await device.observe();
      expect(has(locked, `route-select-${DESTINATION}`)).toBe(false);
      expect(locked.presentation.hosts.some((host: { text?: string }) => host.text === '≡')).toBe(false);
      expect(locked.durable.snapshot.destinations.map((row: { id: string }) => row.id)).toEqual([DESTINATION, secondId]);
      await run(device, 'map.route.interaction-mode');
      const startValue = { event: { nativeEvent: { pageX: 375, pageY: 330 } }, gestureState: { dx: 0, dy: 0, moveX: 375, moveY: 330 } };
      const value = { event: { nativeEvent: { pageX: 375, pageY: 450 } }, gestureState: { dx: 0, dy: 120, moveX: 375, moveY: 450 } };
      const start = await device.host.call({ kind: 'panResponder', testId: `route-drag-${DESTINATION}`,
        phase: 'onStartShouldSetPanResponder', value: startValue });
      expect(start).toEqual({ invoked: true, result: true });
      await device.host.call({ kind: 'panResponder', testId: `route-drag-${DESTINATION}`, phase: 'onPanResponderGrant', value: startValue });
      await world.settle();
      expect(has(await device.observe(), 'route-drag-preview')).toBe(false);
      await device.host.call({ kind: 'panResponder', testId: `route-drag-${DESTINATION}`, phase: 'onPanResponderMove', value });
      expect(has(await device.observe(), 'route-insertion-line')).toBe(true);
      expect(world.backend.itinerary.map((row: { id: string }) => row.id)).toEqual([DESTINATION, secondId]);
      await device.host.call({ kind: 'panResponder', testId: `route-drag-${DESTINATION}`, phase: 'onPanResponderTerminate', value });
      await world.settle();
      expect(has(await device.observe(), 'route-drag-preview')).toBe(false);
      expect(has(await device.observe(), 'route-insertion-line')).toBe(false);
      expect(world.backend.itinerary.map((row: { id: string }) => row.id)).toEqual([DESTINATION, secondId]);
      await device.host.call({ kind: 'panResponder', testId: `route-drag-${DESTINATION}`, phase: 'onStartShouldSetPanResponder', value: startValue });
      await device.host.call({ kind: 'panResponder', testId: `route-drag-${DESTINATION}`, phase: 'onPanResponderGrant', value: startValue });
      await device.host.call({ kind: 'panResponder', testId: `route-drag-${DESTINATION}`, phase: 'onPanResponderMove', value });
      await device.host.call({ kind: 'panResponder', testId: `route-drag-${DESTINATION}`, phase: 'onPanResponderRelease', value });
      await world.waitFor(device, (result: ItineraryObservation) => !has(result, 'route-insertion-line') && result.durable.snapshot.destinations.find(row => row.id === DESTINATION)?.order === 1, 'drag release persisted reorder and removed insertion line');
      expect(world.backend.itinerary.map((row: { id: string }) => row.id)).toEqual([secondId, DESTINATION]);
      expect(world.backend.itinerary.map((row: { day: number }) => row.day)).toEqual([1, 1]);
      expect((await device.observe()).durable.operations).toEqual([]);
    } finally { await world.close(); }
  });
});
