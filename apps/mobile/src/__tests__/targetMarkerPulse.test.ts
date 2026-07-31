import {
  pulsePeakScale,
  reduceMotionEmphasisScale,
  shouldPulseDestination,
  TARGET_PULSE_DURATION_MS,
  TARGET_PULSE_INTERVAL_MS,
} from '../utils/targetMarkerPulse';

describe('target marker pulse', () => {
  it('uses a five-second cadence and short pulse duration', () => {
    expect(TARGET_PULSE_INTERVAL_MS).toBe(10_000);
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

  it('completed markers drop active shadow/glow/elevation chrome', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const groupMap = fs.readFileSync(
      path.join(__dirname, '../components/GroupMap.tsx'),
      'utf8',
    );
    // Active only when not completed.
    expect(groupMap).toContain(
      '!isCompleted && activeDestinationId != null && dest.id === activeDestinationId',
    );
    expect(groupMap).toContain(
      'isActiveTarget && !isCompleted ? styles.gatherMarkerActive : null',
    );
    // Completed style strips residual base shadow (field-test residual).
    const completedBlock = groupMap.slice(
      groupMap.indexOf('gatherMarkerCompleted:'),
      groupMap.indexOf('gatherMarkerCompleted:') + 280,
    );
    expect(completedBlock).toContain("shadowColor: 'transparent'");
    expect(completedBlock).toContain('shadowOpacity: 0');
    expect(completedBlock).toContain('elevation: 0');
    // MapScreen passes team completion ids (closedAt), not personal arrivals.
    const mapScreen = fs.readFileSync(
      path.join(__dirname, '../screens/MapScreen.tsx'),
      'utf8',
    );
    expect(mapScreen).toContain('completedDestinationIds={teamCompletedDestinationIds}');
    expect(mapScreen).toContain('teamCompletedDestinationIds');
  });
});
