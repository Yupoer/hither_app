import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

describe('foreground arrival feedback', () => {
  it('starts visual arrival feedback before waiting for the database ACK', () => {
    const effect = source.slice(
      source.indexOf('if (arrivedNow && user?.id)'),
      source.indexOf('  }, [', source.indexOf('if (arrivedNow && user?.id)')),
    );
    expect(effect.indexOf('afterPersonalArrivalRef.current(navTarget')).toBeGreaterThanOrEqual(0);
    expect(effect.indexOf('afterPersonalArrivalRef.current(navTarget')).toBeLessThan(
      effect.indexOf('setDestinationArrival(navTarget.id'),
    );
    expect(source).toMatch(
      /const personallyArrived = myCompletedDestinationIds\.has\(dest\.id\) \|\| \(\s*autoArrivedDestId === dest\.id/,
    );
    expect(source).toContain('arrivalDimOverlay');
  });
});
