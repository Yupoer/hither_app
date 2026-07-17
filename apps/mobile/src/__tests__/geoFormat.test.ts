import {
  formatCompactDurationFromMinutes,
  formatDistance,
  formatShortEta,
} from '../utils/geo';

describe('formatDistance', () => {
  it('shows metres under 1 km', () => {
    expect(formatDistance(320)).toBe('320 m');
    expect(formatDistance(999.4)).toBe('999 m');
  });

  it('shows km with one decimal at or over 1 km', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1532)).toBe('1.5 km');
  });
});

describe('formatCompactDurationFromMinutes', () => {
  it('formats under an hour as min', () => {
    expect(formatCompactDurationFromMinutes(45)).toBe('45min');
  });

  it('formats hours with optional remaining minutes', () => {
    expect(formatCompactDurationFromMinutes(60)).toBe('1hr');
    expect(formatCompactDurationFromMinutes(90)).toBe('1hr30');
    expect(formatCompactDurationFromMinutes(300)).toBe('5hr');
  });

  it('adds day unit at or over 24 hours and drops remaining minutes', () => {
    expect(formatCompactDurationFromMinutes(24 * 60)).toBe('1d');
    expect(formatCompactDurationFromMinutes(36 * 60)).toBe('1d12hr');
    // 25h30 → 1d1hr (minutes dropped at day scale)
    expect(formatCompactDurationFromMinutes(25 * 60 + 30)).toBe('1d1hr');
  });
});

describe('formatShortEta', () => {
  it('shows now / min under an hour', () => {
    expect(formatShortEta(20)).toBe('now');
    expect(formatShortEta(12 * 60)).toBe('12 min');
  });

  it('uses compact duration for longer ETAs', () => {
    expect(formatShortEta(90 * 60)).toBe('1hr30');
    expect(formatShortEta(36 * 3600)).toBe('1d12hr');
  });
});
