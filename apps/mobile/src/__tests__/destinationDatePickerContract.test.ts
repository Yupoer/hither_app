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
