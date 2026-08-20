import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '../components/DestinationReorderList.tsx'),
  'utf8',
);

describe('Android itinerary date editing', () => {
  it('opens Android date picker imperatively while keeping the day editor mounted', () => {
    expect(source).toContain('DateTimePickerAndroid.open');
    expect(source).toContain("Platform.OS === 'android'");
    expect(source).toContain('setEditDate');
  });
});

describe('route list handle column + favorites', () => {
  it('aligns day and stop drag handles via fixed HANDLE_SLOT', () => {
    expect(source).toContain('const HANDLE_SLOT = Math.round(28 * REORDER_VISUAL_SCALE)');
    expect(source).toContain('styles.handleSlot');
  });

  it('shows favorites entry without requiring non-empty list', () => {
    expect(source).toContain('canReorder && onPickFavorite');
    expect(source).not.toMatch(
      /onPickFavorite && \(favoritePlaces\?\.length \?\? 0\) > 0/,
    );
  });
});
