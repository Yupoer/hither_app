const { World } = require('../../test/headless/world.cjs');
const { LEADER } = require('../../test/headless/backend.cjs');
type Host = { testId?: string; text?: string; value?: unknown };
type Observed = { presentation: { hosts: Host[]; receipts: { method: string; args?: unknown[] }[] }; maps: { receipts: { method: string; value: { id: string; query?: string } }[]; pending: string[] } };
const hosts = (value: Observed, id: string) => value.presentation.hosts.filter(host => host.testId === id);
const resultKey = (id: string) => JSON.stringify([id, 25.03, 121.55]);
const place = (id: string, name: string) => ({ id, name, coordinates: { latitude: 25.03, longitude: 121.55 } });

describe.each(['ios', 'android'])('actual search and import component operations on %s', platform => {
  jest.setTimeout(120000);
  const KML = '<kml><Document><Placemark><name>A &amp; B</name><Point><coordinates>121.55,25.03,0</coordinates></Point></Placemark><Placemark><name>Second</name><Point><coordinates>121.56,25.04</coordinates></Point></Placemark></Document></kml>';
  it('Q01 Q02 Q03 Q04 debounces actual search retains provider identities ignores an older result and selects the current result', async () => {
    const world = new World();
    try {
      const actor = await world.device({ id: 'search', userId: LEADER, platform, screen: { name: 'DestinationSearch', props: { visible: true } } });
      await world.waitFor(actor, (value: Observed) => hosts(value, 'place-search-query').length === 1, 'actual search input');
      await actor.input({ kind: 'mapsConfigure', patch: { searchResults: [place('old', 'Old')], holdSearch: true } });
      await actor.perform('map.search.query', { value: ' Old ' });
      await world.advance(449);
      expect((await actor.observe()).maps.pending).toEqual([]);
      await world.advance(1);
      const old = (await actor.observe()).maps.pending[0];
      expect(old).toBeTruthy();
      await actor.input({ kind: 'mapsConfigure', patch: { searchResults: [place('new', 'New'), place('new', 'New')] } });
      await actor.perform('map.search.query', { value: 'New' });
      await world.advance(450);
      const latest = (await actor.observe()).maps.pending.find((id: string) => id !== old);
      expect(latest).toBeTruthy();
      await actor.input({ kind: 'mapsResolve', id: latest });
      const current = await world.waitFor(actor, (value: Observed) => hosts(value, `place-search-result-${resultKey('new')}`).length === 1, 'normalized current result');
      expect(hosts(current, `place-search-result-${resultKey('new')}`)).toHaveLength(1);
      await actor.input({ kind: 'mapsResolve', id: old });
      await world.settle();
      expect(hosts(await actor.observe(), `place-search-result-${resultKey('old')}`)).toHaveLength(0);
      await actor.perform('map.search.pick', { resultKey: resultKey('new') });
      await world.settle();
      const final = await actor.observe();
      expect(final.presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onPick')).toEqual([expect.objectContaining({ args: [place('new', 'New')] })]);
      expect(final.presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onClose')).toHaveLength(1);
      expect(world.backend.itinerary).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('Q01 Q06 actual search reopen clears draft and background whitespace never calls a provider', async () => {
    const world = new World();
    try {
      const actor = await world.device({ id: 'search', userId: LEADER, platform, screen: { name: 'DestinationSearch', props: { visible: true } } });
      await world.waitFor(actor, (value: Observed) => hosts(value, 'place-search-query').length === 1, 'search mounted');
      await actor.perform('map.search.query', { value: '   ' });
      await world.advance(450);
      expect((await actor.observe()).maps.receipts.filter((row: { method: string }) => row.method === 'maps.searchPlaces')).toEqual([]);
      await actor.perform('map.search.query', { value: 'Ignored' });
      await actor.input({ kind: 'appState', value: 'background' });
      await world.advance(450);
      expect((await actor.observe()).maps.receipts.filter((row: { method: string }) => row.method === 'maps.searchPlaces')).toEqual([]);
      await actor.host.mount({ name: 'DestinationSearch', props: { visible: false } });
      await actor.input({ kind: 'appState', value: 'active' });
      await actor.host.mount({ name: 'DestinationSearch', props: { visible: true } });
      expect(hosts(await actor.observe(), 'place-search-query')[0].value).toBe('');
    } finally { await world.close(); }
  });

  it('K01 K02 K03 K04 K05 actual KML picker loads real XML and previews only allowed points through filesystem SDK', async () => {
    const world = new World();
    try {
      const actor = await world.device({ id: 'kml', userId: LEADER, platform, screen: { name: 'KmlImportSheet', props: {
        visible: true, currentCount: 0, remainingQuota: 1, isPro: false, canWrite: true,
      } } });
      await world.waitFor(actor, (value: Observed) => hosts(value, 'kml-pick-file').length === 1, 'actual KML intro');
      await actor.input({ kind: 'mapFile', uri: 'content://fixture/route', content: KML });
      await actor.input({ kind: 'mapsConfigure', patch: { picker: { canceled: false, assets: [{ uri: 'content://fixture/route', name: 'route.kml', mimeType: 'application/vnd.google-earth.kml+xml' }] } } });
      await actor.perform('map.kml.pick');
      await world.waitFor(actor, (value: Observed) => hosts(value, 'kml-import-confirm').length === 1, 'parsed KML preview');
      await actor.perform('map.kml.import');
      await world.settle();
      const imported = (await actor.observe()).presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onImport');
      expect(imported).toHaveLength(1);
      expect(imported[0].args[0]).toEqual([{ name: 'A & B', latitude: 25.03, longitude: 121.55 }]);
      expect((await actor.observe()).maps.receipts.some((receipt: { method: string }) => receipt.method === 'file.copyAsync')).toBe(true);
      expect(world.backend.trace.some((call: { name: string }) => call.name === 'import_itinerary_batch')).toBe(false);
      await world.advance(1000);
      expect((await actor.observe()).presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onClose')).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('K01 K03 K06 K07 canceled selection does no I/O and a malformed KMZ exposes reset without importing', async () => {
    const world = new World();
    try {
      const actor = await world.device({ id: 'kml', userId: LEADER, platform, screen: { name: 'KmlImportSheet', props: {
        visible: true, currentCount: 0, remainingQuota: 5, isPro: false,
      } } });
      await world.waitFor(actor, (value: Observed) => hosts(value, 'kml-pick-file').length === 1, 'KML mounted');
      await actor.perform('map.kml.pick');
      expect((await actor.observe()).maps.receipts.filter((receipt: { method: string }) => receipt.method.startsWith('file.'))).toEqual([]);
      await actor.input({ kind: 'mapFile', uri: 'content://fixture/bad', content: 'invalid zip bytes' });
      await actor.input({ kind: 'mapsConfigure', patch: { picker: { canceled: false, assets: [{ uri: 'content://fixture/bad', name: 'bad.kmz' }] } } });
      await actor.perform('map.kml.pick');
      await world.waitFor(actor, (value: Observed) => hosts(value, 'kml-retry').length === 1, 'actual malformed KMZ error');
      expect((await actor.observe()).presentation.receipts.filter((receipt: { method: string }) => receipt.method === 'onImport')).toEqual([]);
      await actor.perform('map.kml.retry');
      expect(hosts(await actor.observe(), 'kml-pick-file')).toHaveLength(1);
    } finally { await world.close(); }
  });
});
