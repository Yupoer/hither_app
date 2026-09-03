import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  destinationMarkerColor,
  destinationMarkerEmoji,
} from '../utils/destinationMarkerChrome';
import { DESTINATION_EMOJI_FALLBACK } from '../utils/destinationEmojiColor';

describe('destinationMarkerColor / emoji (map projection)', () => {
  const dayColors: Record<number, string> = {
    1: '#E5575C',
    2: '#6FA8FF',
  };

  it('always uses the current day color even when a legacy per-stop markerColor exists', () => {
    const destination = { markerColor: '#F0883E', day: 1 } as const;
    expect(destinationMarkerColor(destination, { 1: '#AABBCC' })).toBe('#AABBCC');
    expect(destinationMarkerColor(destination, { 1: '#DDEEFF' })).toBe('#DDEEFF');
  });

  it('uses day color when markerColor is null', () => {
    expect(destinationMarkerColor({ markerColor: null, day: 2 }, dayColors)).toBe(
      '#6FA8FF',
    );
  });

  it('falls back to palette day slot when dayColors missing that day', () => {
    expect(
      destinationMarkerColor({ markerColor: '#FFFFFF', day: 3 }, {}),
    ).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('renders destination emoji with stable fallback', () => {
    expect(destinationMarkerEmoji({ emoji: '🍜' })).toBe('🍜');
    expect(destinationMarkerEmoji({ emoji: null })).toBe(DESTINATION_EMOJI_FALLBACK);
  });

  it('forces bed emoji for accommodation cards', () => {
    expect(
      destinationMarkerEmoji({ emoji: '🍜', kind: 'accommodation' }),
    ).toBe('🛏️');
  });
});

describe('GroupMap destination marker wiring contract', () => {
  const source = readFileSync(
    join(__dirname, '../components/GroupMap.tsx'),
    'utf8',
  );

  it('consumes dest.emoji / destinationMarkerColor for marker chrome', () => {
    expect(source).toContain('destinationMarkerColor');
    expect(source).toContain('destinationMarkerEmoji');
    expect(source).toContain('dest.emoji');
    expect(source).toContain('gatherMarkerEmoji');
  });
});
