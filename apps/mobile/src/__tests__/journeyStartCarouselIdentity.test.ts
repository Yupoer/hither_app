import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promoteDestinationWithinDay } from '../utils/tripDay';
import type { Destination } from '../types';

const journey = readFileSync(
  join(__dirname, '../screens/MapScreen/hooks/useJourneyNavigation.ts'),
  'utf8',
);
const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

function dest(id: string, day: number, order: number): Destination {
  return {
    id,
    title: id,
    day,
    order,
    coordinates: { latitude: 0, longitude: 0 },
  } as Destination;
}

describe('Start same-day promote + carousel identity (#174)', () => {
  it('promotes target to first of same day without changing day', () => {
    const list = [dest('a', 1, 0), dest('b', 1, 1), dest('c', 1, 2), dest('d', 2, 0)];
    const updates = promoteDestinationWithinDay(list, 'c');
    expect(updates.map((u) => u.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(updates.find((u) => u.id === 'c')?.day).toBe(1);
    expect(updates.find((u) => u.id === 'd')?.day).toBe(2);
  });

  it('scrolls carousel by dest id after reorder (explicit scrollTo)', () => {
    expect(journey).toContain('promoteDestinationWithinDay');
    expect(journey).toContain('startedDestId');
    expect(journey).toContain('carouselRef.current?.scrollTo');
    // Must not discard carouselRef as _carouselRef unused.
    expect(journey).not.toMatch(/carouselRef:\s*_carouselRef/);
  });

  it('pagination dots use fixed non-clipping width', () => {
    expect(map).toContain('overflow: \'visible\'');
    expect(map).toContain('flexShrink: 0');
    expect(map).toMatch(/DOT_PITCH_PX \* Math\.max\(0, displayIndices\.length - 1\) \+ 22/);
  });
});
