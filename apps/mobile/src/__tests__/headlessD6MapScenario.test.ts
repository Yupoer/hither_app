const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type MapHost = { testId?: string; label?: string; text?: string; value?: unknown; disabled?: boolean; acceptsInput: boolean };
type Observation = {
  presentation: { hosts: MapHost[] };
  external: { watches: number; alerts: number };
};
type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
const field = (value: Observation, testId: string) => value.presentation.hosts.find(node => node.testId === testId);
const press = (device: Device, testId: string) => device.host.call({ kind: 'press', testId });
const pressLabel = (device: Device, label: string) => device.host.call({ kind: 'press', label });
const textOf = (value: Observation) => value.presentation.hosts.map(node => node.text).filter(Boolean);

describe('iOS D6 Map', () => {
  jest.setTimeout(120_000);

  async function openMap(world: InstanceType<typeof World>) {
    const device = await world.device({ id: 'd6-map', userId: LEADER, platform: 'ios',
      screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: Observation) => field(value, 'home-journey-action'), 'D6 map journey controls');
    await device.perform('preferences.setLanguage', { args: ['en'] });
    return device;
  }

  it('adds a renamed map pin on the chosen date after the selected stop', async () => {
    const world = new World();
    try {
      Object.assign(world.backend.groups.get(GROUP_ID), { trip_days: 3 });
      const template = world.backend.itinerary[0];
      world.backend.itinerary.push(
        { ...template, id: 'a1111111-1111-4111-8111-111111111111', title: 'First stop on day two', position: 1, day: 2 },
        { ...template, id: 'a2222222-2222-4222-8222-222222222222', title: 'Last stop on day two', position: 2, day: 2 },
      );
      const device = await openMap(world);
      await world.waitFor(device, (value: Observation) => field(value, 'home-itinerary-grabber'), 'route tab');
      await press(device, 'home-itinerary-grabber');
      expect(await press(device, 'd6-route-add-place')).toEqual({ invoked: true });
      expect(field(await device.observe(), 'map-search-input')).toBeTruthy();
      await device.perform('map.pin.drop', { latitude: 25.05, longitude: 121.54 });
      const draft = await world.waitFor(device, (value: Observation) => field(value, 'd6-place-rename'), 'staged place title');
      expect(field(draft, 'confirm-place-name')).toBeUndefined();
      await press(device, 'd6-place-rename');
      await device.perform('map.place.rename', { value: '  Coffee stop  ' });
      expect(await press(device, 'd6-place-day')).toEqual({ invoked: true });
      await press(device, 'd6-place-day-2');
      expect(await press(device, 'd6-place-position')).toEqual({ invoked: true });
      await press(device, 'd6-place-after-a1111111-1111-4111-8111-111111111111');
      expect(world.backend.itinerary).toHaveLength(3);
      expect(await press(device, 'confirm-place-add')).toEqual({ invoked: true });
      await world.waitFor(device, () => world.backend.itinerary.filter((row: { day?: number }) => row.day === 2)
        .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
        .map((row: { title: string }) => row.title).join('|') === 'First stop on day two|Coffee stop|Last stop on day two',
      'new stop saved after selected stop on day two');
      const row = world.backend.itinerary.find((item: { title: string }) => item.title === 'Coffee stop');
      await world.waitFor(device, (value: Observation) => field(value, `d6-route-row-${row.id}`), 'new stop row');
      await press(device, `d6-route-row-${row.id}`);
      const details = await world.waitFor(device, (value: Observation) => textOf(value).includes('Meeting time'), 'stop details');
      expect(textOf(details)).toContain('Coffee stop');
    } finally { await world.close(); }
  });

  it('saves and clears the meeting time in the actual stop details', async () => {
    const world = new World();
    try {
      const device = await openMap(world);
      await press(device, 'home-itinerary-grabber');
      await world.waitFor(device, (value: Observation) => field(value, `d6-route-row-${DESTINATION}`), 'current stop row');
      await press(device, `d6-route-row-${DESTINATION}`);
      await world.waitFor(device, (value: Observation) => textOf(value).includes('Meeting time'), 'meeting time row');
      await pressLabel(device, 'Meeting time');
      expect(await pressLabel(device, 'Add 15 minutes')).toEqual({ invoked: true });
      expect(await press(device, 'd6-stop-time-save')).toEqual({ invoked: true });
      await world.waitFor(device, () => Boolean(world.backend.itinerary.find((row: { id: string }) =>
        row.id === DESTINATION)?.meet_at), 'saved meeting time');
      const stored = world.backend.itinerary.find((row: { id: string }) => row.id === DESTINATION);
      expect(stored.meet_red_minutes).toBe(10);
      const updated = await world.waitFor(device, (value: Observation) => field(value, 'd6-stop-time-save')?.acceptsInput === false, 'time editor closes');
      const stopTime = textOf(updated).find(text => /\d:\d{2}/.test(text ?? ''));
      expect(stopTime).toBeTruthy();
      await pressLabel(device, 'Meeting time');
      expect(await pressLabel(device, 'Clear')).toEqual({ invoked: true });
      await world.waitFor(device, () => world.backend.itinerary.find((row: { id: string }) =>
        row.id === DESTINATION)?.meet_at === null, 'cleared meeting time');
    } finally { await world.close(); }
  });

  it('drags both panels through half and full and can reverse before release', async () => {
    const world = new World();
    try {
      const device = await openMap(world);
      const handle = (testId: string, phase: string, translationY = 0) =>
        device.host.call({ kind: 'gesture', testId, phase, value: { translationY, velocityY: 0 } });
      const move = async (testId: string, offsets: number[], detent: number) => {
        await handle(testId, 'onStart');
        for (const y of offsets) await handle(testId, 'onUpdate', y);
        await handle(testId, 'onEnd', offsets.at(-1));
        await world.waitFor(device, (value: Observation) => field(value, testId)?.value === detent, `detent ${detent}`);
      };
      const itinerary = 'home-itinerary-grabber';
      const team = 'home-team-toggle';
      await press(device, itinerary);
      expect(field(await device.observe(), itinerary)?.value).toBe(1);
      await move(itinerary, [265], 2);
      await move(itinerary, [-400, -235], 1);
      await move(itinerary, [-240], 0);
      await move(team, [-170], 1);
      await move(team, [-260], 2);
      await move(team, [390, 240], 1);
      await move(itinerary, [250], 1);
      const result = await device.observe();
      expect(field(result, team)?.value).toBe(0);
      expect(field(result, 'd6-members-pane')).toBeUndefined();
    } finally { await world.close(); }
  });

  it('keeps a stop on the selected day and keeps the detail open after undoing accommodation', async () => {
    const world = new World();
    try {
      const device = await openMap(world);
      await press(device, 'home-itinerary-grabber');
      await world.waitFor(device, (value: Observation) => field(value, `d6-route-row-${DESTINATION}`), 'stop to convert');
      await press(device, `d6-route-row-${DESTINATION}`);
      const setStay = (value: boolean) => device.host.call({ kind: 'toggle', testId: 'd6-stop-stay', value });
      await world.waitFor(device, (value: Observation) => field(value, 'd6-stop-stay'), 'accommodation toggle');
      await setStay(true);
      await world.waitFor(device, () => world.backend.tables.daily_accommodations.some(
        (row: { source_destination_id?: string }) => row.source_destination_id === DESTINATION), 'assigned accommodation');
      await world.waitFor(device, (value: Observation) => field(value, 'd6-stop-stay') && !field(value, 'd6-stop-stay')?.disabled, 'assignment finished');
      await setStay(false);
      await world.waitFor(device, () => world.backend.tables.daily_accommodations.length === 0, 'cleared accommodation');
      const details = await world.waitFor(device, (value: Observation) => !field(value, 'd6-stop-stay')?.disabled && textOf(value).includes('Icon'), 'open regular stop');
      expect(field(details, 'd6-stop-close')).toBeDefined();
      expect(world.backend.itinerary.find((row: { id: string }) => row.id === DESTINATION)?.day).toBe(1);
    } finally { await world.close(); }
  });

  it('starts from the floating control and ends navigation without completing the stop', async () => {
    const world = new World();
    try {
      const device = await openMap(world);
      await world.waitFor(device, (value: Observation) => field(value, 'home-journey-action')?.label === 'Start'
        && value.external.watches > 0, 'start with device location');
      await device.gps(25.029, 121.53, { accuracy: 5, timestamp: world.now });
      await press(device, 'home-journey-action');
      await world.waitFor(device, (value: Observation) => field(value, 'home-journey-action')?.label === 'On the way, hold to end navigation', 'active navigation');
      expect(world.backend.sessions.size).toBe(1);
      const touch = (event: 'onPressIn' | 'onPressOut' | 'onLongPress') =>
        device.host.call({ kind: 'nativeEvent', testId: 'home-journey-action', value: { event } });
      await touch('onPressIn');
      await touch('onPressOut');
      expect([...world.backend.sessions.values()][0]).toMatchObject({ status: 'active' });
      await touch('onPressIn');
      await touch('onLongPress');
      await touch('onPressOut');
      await world.waitFor(device, (value: Observation) => field(value, 'home-journey-action')?.label === 'Start', 'return to ready');
      await press(device, 'home-journey-action');
      expect(world.backend.itinerary.find((stop: { id: string }) => stop.id === DESTINATION)?.closed_at ?? null).toBeNull();
      expect(world.backend.sessions.size).toBe(1);
      expect([...world.backend.sessions.values()][0]).toMatchObject({ status: 'cancelled' });
    } finally { await world.close(); }
  });
});
