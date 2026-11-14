import { d6MeetingDisplay, d6TravelTime } from '../screens/MapScreen/d6GatheringHeader';
import { gatheringParticlesAt } from '../utils/gatheringCardParticles';
import type { Destination } from '../types';

const stop: Destination = { id: 'stop', title: '集合點', coordinates: { latitude: 25, longitude: 121 }, order: 0, day: 1 };
const now = Date.parse('2026-11-14T08:00:00Z');

describe('D6 gathering header', () => {
  it('leaves the title rail free before departure without a meeting time', () => {
    expect(d6MeetingDisplay(stop, 'ready', 4980, now, 'zh-TW')).toEqual({ kind: 'none' });
    expect(d6MeetingDisplay({ ...stop, meetAt: 'invalid' }, 'ready', null, now, 'zh-TW')).toEqual({ kind: 'none' });
  });

  it('keeps a configured meeting time and its approaching countdown', () => {
    const meetAt = new Date(now + 600_000).toISOString();
    expect(d6MeetingDisplay({ ...stop, meetAt }, 'ready', 4980, now, 'zh-TW'))
      .toEqual({ kind: 'time', value: '10', unit: true, hot: true });
    expect(d6MeetingDisplay({ ...stop, meetAt }, 'going', 4980, now, 'zh-TW'))
      .toEqual({ kind: 'duration', hours: 1, minutes: 23 });
  });

  it.each([
    [3540, { kind: 'time', value: '59', unit: true, hot: true }],
    [3541, { kind: 'duration', hours: 1, minutes: 0 }],
    [3600, { kind: 'duration', hours: 1, minutes: 0 }],
    [4980, { kind: 'duration', hours: 1, minutes: 23 }],
    [35940, { kind: 'duration', hours: 9, minutes: 59 }],
    [36000, { kind: 'duration', hours: 10, minutes: 0 }],
  ])('shows a complete duration for an ETA of %s seconds', (eta, expected) => {
    expect(d6MeetingDisplay(stop, 'going', eta, now, 'zh-TW')).toEqual(expected);
  });

  it('separates calculating, arrival and localized travel facts', () => {
    expect(d6MeetingDisplay(stop, 'going', null, now, 'en-GB')).toEqual({ kind: 'status', status: 'calculating' });
    expect(d6MeetingDisplay(stop, 'going', Infinity, now, 'en-GB')).toEqual({ kind: 'status', status: 'calculating' });
    expect(d6MeetingDisplay(stop, 'arrived', 0, now, 'en-GB')).toEqual({ kind: 'time', value: '✓', hot: true });
    expect(d6TravelTime(4980, true)).toBe('1 時 23 分');
    expect(d6TravelTime(4980, false)).toBe('1 h 23 min');
    expect(d6TravelTime(120, true)).toBe('2 分');
    expect(d6TravelTime(null, true)).toBe('—');
  });
});

describe('gathering particle motion', () => {
  it('moves existing particles to the left and keeps emission bounded throughout a long journey', () => {
    const first = gatheringParticlesAt(500, 360, 100)[0];
    const later = gatheringParticlesAt(600, 360, 100)[0];
    expect(later.radius).toBe(first.radius);
    expect(later.x).toBeLessThan(first.x);
    for (const time of [1000, 60_000, 3_600_000]) {
      const particles = gatheringParticlesAt(time, 360, 100);
      expect(particles.length).toBeGreaterThan(0);
      expect(particles.length).toBeLessThanOrEqual(18);
      for (const particle of particles) {
        expect(particle.y).toBeGreaterThanOrEqual(particle.radius);
        expect(particle.y).toBeLessThanOrEqual(100 - particle.radius);
      }
    }
  });
});
