import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promoteDestinationWithinDay } from '../utils/tripDay';
import {
  carouselScrollX,
  followCarouselIndexAfterPromote,
} from '../utils/journeyStartCarouselIdentity';
import type { Destination } from '../types';

const journey = readFileSync(
  join(__dirname, '../screens/MapScreen/hooks/useJourneyNavigation.ts'),
  'utf8',
);
const carousel = readFileSync(
  join(__dirname, '../screens/MapScreen/hooks/useCarouselSelection.ts'),
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

describe('Start same-day promote + carousel identity (#222)', () => {
  it('promotes target to first of same day without changing day', () => {
    const list = [dest('a', 1, 0), dest('b', 1, 1), dest('c', 1, 2), dest('d', 2, 0)];
    const updates = promoteDestinationWithinDay(list, 'c');
    expect(updates.map((u) => u.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(updates.find((u) => u.id === 'c')?.day).toBe(1);
    expect(updates.find((u) => u.id === 'd')?.day).toBe(2);
  });

  it('waits on stale pre-promote order so follow-effect cannot land on index 1', () => {
    const stale = [dest('a', 1, 0), dest('c', 1, 1), dest('b', 1, 2)];
    expect(stale.findIndex((item) => item.id === 'c')).toBe(1);
    expect(followCarouselIndexAfterPromote({
      destinations: stale,
      sharedTargetId: 'c',
    })).toBeNull();
    const settled = [dest('c', 1, 0), dest('a', 1, 1), dest('b', 1, 2)];
    expect(followCarouselIndexAfterPromote({
      destinations: settled,
      sharedTargetId: 'c',
    })).toBe(0);
  });

  it('scrolls carousel by dest id after reorder (explicit scrollTo)', () => {
    expect(carouselScrollX(0, 390)).toBe(0);
    expect(carouselScrollX(2, 390)).toBe(780);
  });

  it('scrolls with index * windowWidth after order settles', () => {
    expect(carouselScrollX(1, 390)).toBe(390);
    expect(journey).toContain('followCarouselIndexAfterPromote');
    expect(journey).toContain('carouselScrollX');
    expect(journey).toContain('promoteDestinationWithinDay');
    expect(journey).toContain('startedDestId');
    expect(journey).toContain('carouselRef.current?.scrollTo');
    expect(journey).not.toMatch(/carouselRef:\s*_carouselRef/);
  });

  it('projects the clicked destination only after the reordered id appears', () => {
    expect(journey).toContain('pendingCarouselTargetIdRef');
    expect(journey).toContain('navigationDestinations.findIndex((item) => item.id === targetId)');
    expect(journey).toContain('if (index < 0) return');
  });

  it('cold-starts the carousel at sorted index 0 and does not restore a swipe', () => {
    expect(carousel).toContain('useState(0)');
    expect(carousel).not.toMatch(/AsyncStorage|lastIndex|restoreIndex|persistedIndex/);
    expect(map).not.toMatch(/setSelectedIndex\(.*AsyncStorage/);
  });

  it('pagination dots occupy real flex width without an overlay pill', () => {
    expect(map).toContain('indicatorRowGeometry');
    expect(map).toContain('flexShrink: 0');
    expect(map).not.toContain('pillSlot');
    expect(map).not.toMatch(/DOT_PITCH_PX \* Math\.max\(0, displayIndices\.length - 1\) \+ 22/);
  });
});
