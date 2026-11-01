const { runTokyoTrip } = require('../../test/headless/tokyo-trip.cjs');

describe('Tokyo full App common-trip acceptance', () => {
  jest.setTimeout(600_000);

  it('preserves mixed-platform receiver notices, exact locations, two-day itinerary and abrupt offline restart', async () => {
    const summary = await runTokyoTrip({ output: process.env.HITHER_HEADLESS_TOKYO_OUTPUT, quiet: true });
    expect(summary.harnessFailure).toBeNull();
    expect(summary.steps).toBeGreaterThan(0);
    expect(summary.checks.filter((check: { pass: boolean }) => !check.pass)).toEqual([]);
  });
});
