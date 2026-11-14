const { runTokyoTrip } = require('../../test/headless/tokyo-trip.cjs');
const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID } = require('../../test/headless/backend.cjs');

type ClockObservation = { presentation: {
  route: { route: string };
  hosts: { testId?: string; acceptsInput: boolean; disabled: boolean }[];
  flockRows: { userId: string; lastUpdated: string; serverTimeOffsetMs: number; text: string }[];
} };

describe('Tokyo full App common-trip acceptance', () => {
  jest.setTimeout(600_000);

  it('preserves mixed-platform receiver notices, exact locations, two-day itinerary and abrupt offline restart', async () => {
    const summary = await runTokyoTrip({ output: process.env.HITHER_HEADLESS_TOKYO_OUTPUT, quiet: true });
    expect(summary.harnessFailure).toBeNull();
    expect(summary.steps).toBeGreaterThan(0);
    expect(summary.checks.filter((check: { pass: boolean }) => !check.pass)).toEqual([]);
  });

  it('renders the Android roster peer age from synchronized server time', async () => {
    const world = new World();
    try {
      const capturedAt = new Date(world.now - 150_000).toISOString();
      world.backend.locations.set(`${GROUP_ID}:${PEER}`, {
        group_id: GROUP_ID, user_id: PEER, latitude: 25.03, longitude: 121.53,
        captured_at: capturedAt, updated_at: capturedAt,
      });
      world.hold('memberships', { deviceId: 'clock' });
      const device = await world.device({ id: 'clock', userId: LEADER, platform: 'android', mode: 'app' });
      const press = (testId: string) => device.host.call({ kind: 'press', testId });
      const loading = await world.waitFor(device, (value: ClockObservation) =>
        value.presentation.route.route === 'RoleSelect', 'loading joined teams');
      expect(loading.presentation.hosts.some((host: ClockObservation['presentation']['hosts'][number]) =>
        host.testId === `team-card-${GROUP_ID}`)).toBe(false);
      await Promise.all([
        world.waitFor(device, (value: ClockObservation) => value.presentation.hosts.some(host =>
          host.testId === `team-card-${GROUP_ID}` && host.acceptsInput && !host.disabled), 'joined team card'),
        world.release('memberships'),
      ]);
      await press(`team-card-${GROUP_ID}`);
      await world.waitFor(device, (value: ClockObservation) => value.presentation.route.route === 'Map', 'restored team Map');
      for (const phase of ['onBegin', 'onUpdate', 'onEnd']) {
        await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase,
          value: { translationY: -250, velocityY: 0 }, success: true });
      }
      await device.perform('map.tab', { index: 0 });
      const local = await world.waitFor(device, (value: ClockObservation) =>
        value.presentation.flockRows.some(row => row.userId === PEER), 'peer freshness row');
      expect(local.presentation.flockRows.find((row: { userId: string }) => row.userId === PEER).text).toMatch(/(?:^|\s)2 分鐘前更新(?:\s|$)/);

      const snapshot = world.backend.snapshot.bind(world.backend);
      world.backend.snapshot = (groupId: string) => ({ ...snapshot(groupId),
        generated_at: new Date(world.now + 3_600_000).toISOString() });
      await device.input({ kind: 'appState', value: 'background' });
      await device.input({ kind: 'appState', value: 'active' });
      const synchronized = await world.waitFor(device, (value: ClockObservation) =>
        value.presentation.flockRows.some(row => row.userId === PEER && row.serverTimeOffsetMs === 3_600_000), 'authoritative recovery clock');
      const peer = synchronized.presentation.flockRows.find((row: { userId: string }) => row.userId === PEER);
      expect(peer.lastUpdated).toBe(capturedAt);
      expect(peer.text).toMatch(/(?:^|\s)1 小時前更新(?:\s|$)/);
      expect(synchronized.now).toBe(world.now);
    } finally { await world.close(); }
  });
});
