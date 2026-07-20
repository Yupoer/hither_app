import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '../native/maps.ts'), 'utf8');
const searchSource = readFileSync(join(__dirname, '../components/DestinationSearch.tsx'), 'utf8');

describe('Plus Code place lookup', () => {
  it('normalizes pasted code before trying to resolve a place name', () => {
    expect(source).toContain('extractPlusCode');
    expect(source).toContain('proxySearchPlaces(plusCode');
    expect(source).toContain('coordinates: plusCodeCoordinates');
    expect(searchSource).toContain('extractPlusCode(value) ?? value');
    expect(searchSource).toContain('onChangeText={(value) => setQuery(normalizeSearchInput(value))}');
  });
});
