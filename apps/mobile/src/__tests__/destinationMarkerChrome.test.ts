import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  destinationMarkerColor,
  destinationMarkerEmoji,
} from '../utils/destinationMarkerChrome';
import {
  DESTINATION_COLOR_FALLBACK,
  DESTINATION_EMOJI_FALLBACK,
} from '../utils/destinationEmojiColor';

describe('destinationMarkerColor / emoji (map projection)', () => {
  const dayColors: Record<number, string> = {
    1: '#E5575C',
    2: '#6FA8FF',
  };

  it('prefers per-stop palette color when set', () => {
    expect(
      destinationMarkerColor({ markerColor: '#F0883E', day: 1 }, dayColors),
    ).toBe('#F0883E');
  });

  it('falls back to day color when markerColor is null', () => {
    expect(destinationMarkerColor({ markerColor: null, day: 2 }, dayColors)).toBe(
      '#6FA8FF',
    );
  });

  it('rejects non-palette color via stable fallback', () => {
    expect(
      destinationMarkerColor({ markerColor: '#FFFFFF', day: 1 }, dayColors),
    ).toBe(DESTINATION_COLOR_FALLBACK);
  });

  it('renders destination emoji with stable fallback', () => {
    expect(destinationMarkerEmoji({ emoji: '🍜' })).toBe('🍜');
    expect(destinationMarkerEmoji({ emoji: null })).toBe(DESTINATION_EMOJI_FALLBACK);
  });
});

describe('GroupMap destination marker wiring contract', () => {
  const source = readFileSync(
    join(__dirname, '../components/GroupMap.tsx'),
    'utf8',
  );

  it('consumes dest.emoji / dest.markerColor for marker chrome', () => {
    expect(source).toContain('destinationMarkerColor');
    expect(source).toContain('destinationMarkerEmoji');
    expect(source).toContain('dest.emoji');
    expect(source).toContain('dest.markerColor');
    expect(source).toContain('gatherMarkerEmoji');
  });
});
