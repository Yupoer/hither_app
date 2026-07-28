import {
  pulsePeakScale,
  reduceMotionEmphasisScale,
  shouldPulseDestination,
  TARGET_PULSE_DURATION_MS,
  TARGET_PULSE_INTERVAL_MS,
} from '../utils/targetMarkerPulse';

describe('target marker pulse', () => {
  it('uses a five-second cadence and short pulse duration', () => {
    expect(TARGET_PULSE_INTERVAL_MS).toBe(5_000);
    expect(TARGET_PULSE_DURATION_MS).toBeLessThan(1_000);
    expect(pulsePeakScale()).toBeGreaterThan(1);
    expect(reduceMotionEmphasisScale()).toBeGreaterThan(1);
  });

  it('pulses only the active non-completed destination', () => {
    expect(
      shouldPulseDestination({
        destId: 'a',
        activeDestinationId: 'a',
        completedDestinationIds: [],
        appActive: true,
        reduceMotion: false,
      }),
    ).toBe(true);
    expect(
      shouldPulseDestination({
        destId: 'b',
        activeDestinationId: 'a',
        appActive: true,
      }),
    ).toBe(false);
    expect(
      shouldPulseDestination({
        destId: 'a',
        activeDestinationId: 'a',
        completedDestinationIds: new Set(['a']),
        appActive: true,
      }),
    ).toBe(false);
  });

  it('stops on background and Reduce Motion', () => {
    expect(
      shouldPulseDestination({
        destId: 'a',
        activeDestinationId: 'a',
        appActive: false,
      }),
    ).toBe(false);
    expect(
      shouldPulseDestination({
        destId: 'a',
        activeDestinationId: 'a',
        appActive: true,
        reduceMotion: true,
      }),
    ).toBe(false);
  });

  it('GroupMap wires pulse props without continuous tracksViewChanges', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const groupMap = fs.readFileSync(
      path.join(__dirname, '../components/GroupMap.tsx'),
      'utf8',
    );
    expect(groupMap).toContain('activeDestinationId');
    expect(groupMap).toContain('TARGET_PULSE_INTERVAL_MS');
    expect(groupMap).toContain('shouldPulseDestination');
    expect(groupMap).toContain('gatherMarkerCompleted');
    // tracksViewChanges is toggled briefly via useTracksViewChanges, not left true.
    expect(groupMap).toContain('useTracksViewChanges');
    expect(groupMap).toContain('setTracksViewChanges(false)');
  });
});
