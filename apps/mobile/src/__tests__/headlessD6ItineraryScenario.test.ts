const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type Observation = {
  presentation: {
    hosts: { testId?: string; text?: string; label?: string; checked?: boolean; disabled?: boolean }[];
    preferences: { dayColors: Record<number, string> };
  };
  durable: {
    snapshot: {
      group: { tripDays: number; departureDate: string };
      destinations: { id: string; title: string; day: number | null; closedAt?: string }[];
    };
    operations: { operationType: string }[];
  };
  external: { alerts: number };
};

const laterId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const closedId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const host = (observation: Observation, testId: string) => observation.presentation.hosts.find((field) => field.testId === testId);

async function press(device: Device, testId: string) {
  expect(await device.host.call({ kind: 'press', testId })).toEqual({ invoked: true });
}

async function map(world: InstanceType<typeof World>, userId: string, id = 'd6-itinerary') {
  world.backend.profiles.get(userId).preferences = {
    groupFeatureTourCompleted: true, addPlaceTourCompleted: true, routeReorderTourCompleted: true,
  };
  const device = await world.device({
    id, userId, platform: 'ios', screen: { name: 'Map', params: { groupId: GROUP_ID } },
  });
  await world.waitFor(device, (value: Observation) => !!host(value, 'home-itinerary-grabber'), 'D6 route entry');
  await press(device, 'home-itinerary-grabber');
  await world.waitFor(device, (value: Observation) => !!host(value, `d6-route-row-${DESTINATION}`), 'D6 itinerary rows');
  return device;
}

describe('D6 itinerary on the actual iOS Map screen', () => {
  jest.setTimeout(120_000);

  it('MAP-ROUTE-03 MAP-ROUTE-10 saves the reverse-picked trip range, preserves history, and reschedules a trimmed stop', async () => {
    const world = new World();
    try {
      world.backend.groups.get(GROUP_ID).trip_days = 3;
      const archivedAt = new Date(world.now - 60_000).toISOString();
      world.backend.itinerary.push(
        { ...world.backend.itinerary[0], id: laterId, title: 'Day three museum', position: 1, day: 3 },
        { ...world.backend.itinerary[0], id: closedId, title: 'Completed day three stop', position: 2, day: 3, closed_at: archivedAt },
      );
      const device = await map(world, LEADER);
      await press(device, 'd6-route-options');
      await press(device, 'd6-route-menu-dates');
      await press(device, 'd6-date-2026-10-23');
      expect(world.backend.groups.get(GROUP_ID).trip_days).toBe(3);
      await press(device, 'd6-date-2026-10-22');
      await world.waitFor(device, (value: Observation) => value.durable.snapshot.group.tripDays === 2
        && value.durable.snapshot.destinations.some(row => row.id === laterId && row.day === null), 'durable trimmed range');
      await press(device, 'd6-color-day-2');
      await press(device, 'd6-day-color-#D9578F');
      await press(device, 'd6-route-dates-done');
      await press(device, 'd6-route-day-2');
      await press(device, 'd6-route-pool');
      await press(device, `d6-route-assign-${laterId}`);
      const ordered: Observation = await world.waitFor(device, (value: Observation) => !!host(value, `d6-route-row-${laterId}`)
        && value.durable.snapshot.destinations.some(row => row.id === laterId && row.day === 2), 'stop rescheduled to second day');
      expect(ordered.durable.snapshot.destinations.find(row => row.id === closedId)).toMatchObject({ day: 3, closedAt: archivedAt });
      expect(world.backend.groups.get(GROUP_ID)).toMatchObject({ trip_days: 2, departure_date: '2026-10-22' });
      expect(world.backend.itinerary.find((row: { id: string }) => row.id === laterId)).toMatchObject({ day: 2 });
      await device.restart();
      await world.waitFor(device, (value: Observation) => !!host(value, 'home-itinerary-grabber'), 'restored iOS Map');
      await press(device, 'home-itinerary-grabber');
      await press(device, 'd6-route-day-2');
      const reopened = await world.waitFor(device, (value: Observation) => !!host(value, `d6-route-row-${laterId}`), 'restored second day');
      expect(reopened.presentation.preferences.dayColors[2]).toBe('#D9578F');
      expect(reopened.durable.snapshot.group.tripDays).toBe(2);
    } finally { await world.close(); }
  });

  it('MAP-ROUTE-08 MAP-ROUTE-12 deletes selected stops from the iOS island without a confirmation alert', async () => {
    const world = new World();
    try {
      world.backend.itinerary.push({ ...world.backend.itinerary[0], id: laterId, title: 'Second stop', position: 1 });
      const device = await map(world, LEADER);
      await press(device, 'd6-route-options');
      await press(device, 'd6-route-menu-select');
      await press(device, 'd6-route-select-all');
      const selection = await device.observe() as Observation;
      expect(host(selection, `d6-route-row-${DESTINATION}`)?.checked).toBe(true);
      expect(host(selection, `d6-route-row-${laterId}`)?.checked).toBe(true);
      await press(device, 'd6-route-selection-delete');
      await world.advance(220);
      const emptied = await world.waitFor(device, (value: Observation) => value.durable.snapshot.destinations.length === 0,
        'local batch delete');
      expect(emptied.external.alerts).toBe(0);
      expect(world.backend.itinerary).toEqual([]);
      expect(host(emptied, 'd6-route-selection-delete')).toBeUndefined();
    } finally { await world.close(); }
  });

  it('MAP-DEST-05 keeps editing controls hidden and lets a leader approve a member suggestion from the real add flow', async () => {
    const world = new World();
    try {
      const device = await map(world, PEER);
      const rendered = await device.observe() as Observation;
      expect(host(rendered, 'd6-route-options')).toBeUndefined();
      expect(host(rendered, `d6-route-drag-${DESTINATION}`)).toBeUndefined();
      expect(host(rendered, 'd6-route-add-day')).toBeUndefined();
      expect(host(rendered, 'map-search-input')).toBeUndefined();
      await device.perform('map.pin.drop', { latitude: 25.05, longitude: 121.54 });
      const opened = await world.waitFor(device, (value: Observation) => !!host(value, 'map-search-input'), 'member place search');
      expect(host(opened, 'home-journey-action')).toBeUndefined();
      await world.waitFor(device, (value: Observation) => !!host(value, 'd6-place-rename'), 'member place confirmation');
      await press(device, 'd6-place-rename');
      expect(await device.host.call({ kind: 'changeText', testId: 'confirm-place-name', value: 'Garden' })).toEqual({ invoked: true });
      await press(device, 'confirm-place-add');
      await world.waitFor(device, () => world.backend.tables.gather_point_requests.length === 1, 'durable member suggestion receipt');
      expect(world.backend.tables.gather_point_requests[0]).toMatchObject({
        requester_id: PEER, status: 'pending',
        items: [{ title: 'Garden', day: null, latitude: 25.05, longitude: 121.54 }],
      });
      expect(world.backend.itinerary).toHaveLength(1);
      const leader = await map(world, LEADER, 'd6-itinerary-leader');
      await world.advance(2500);
      const approval = await world.waitFor(leader, (value: Observation) => value.presentation.hosts.some(
        field => field.label === 'Add suggestion' || field.label === '加入建議'), 'suggestion action in D6 itinerary');
      const label = approval.presentation.hosts.find((field: Observation['presentation']['hosts'][number]) =>
        field.label === 'Add suggestion' || field.label === '加入建議')?.label;
      expect(await leader.host.call({ kind: 'press', label })).toEqual({ invoked: true });
      await world.waitFor(leader, () => world.backend.tables.gather_point_requests[0]?.status === 'approved', 'approved suggestion');
      const created = world.backend.itinerary.find((row: { title: string }) => row.title === 'Garden');
      expect(created).toMatchObject({ day: null, latitude: 25.05, longitude: 121.54 });
      await world.waitFor(leader, (value: Observation) => !!host(value, 'd6-route-pool'), 'pool containing approved suggestion');
      await press(leader, 'd6-route-pool');
      await press(leader, `d6-route-assign-${created.id}`);
      await world.waitFor(leader, (value: Observation) => value.durable.snapshot.destinations.some(row => row.id === created.id && row.day === 1),
        'approved suggestion scheduled by leader');
    } finally { await world.close(); }
  });

  it('opens the original arrival sheet from the iOS itinerary menu', async () => {
    const world = new World();
    try {
      const leader = await map(world, LEADER);
      await press(leader, 'd6-route-options');
      await press(leader, 'map-arrival-manage');
      const opened = await world.waitFor(leader, (value: Observation) => !!host(value, 'overlay-header-close'), 'arrival sheet shown');
      expect(opened.presentation.hosts.some((entry: Observation['presentation']['hosts'][number]) => entry.text === 'Mark arrivals')).toBe(true);
      await press(leader, 'overlay-header-close');
      await leader.input({ kind: 'animation', finished: true });
      await world.waitFor(leader, (value: Observation) => !host(value, 'overlay-header-close'), 'arrival sheet closed');
    } finally { await world.close(); }
  });
});
