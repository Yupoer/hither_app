import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCoordinatePair,
  validateCoordinateDestination,
} from '../utils/coordinateDestination';

describe('parseCoordinatePair', () => {
  it('accepts Google Maps comma-separated coordinates', () => {
    expect(parseCoordinatePair('25.068330191151723, 121.59711154017673')).toEqual({
      latitude: 25.068330191151723,
      longitude: 121.59711154017673,
    });
  });

  it('rejects out-of-range pairs', () => {
    expect(parseCoordinatePair('91, 121')).toBeNull();
  });
});

describe('validateCoordinateDestination', () => {
  it.each([
    ['91', '121', false],
    ['25.0339', '181', false],
    ['25.0339', '121.5645', true],
    ['-90', '-180', true],
    ['90', '180', true],
    ['-90.1', '0', false],
    ['0', '180.1', false],
    ['abc', '121', false],
  ])('validates latitude %s and longitude %s → valid=%s', (lat, lng, valid) => {
    const result = validateCoordinateDestination('集合點', lat, lng);
    expect(result.ok).toBe(valid);
    if (!valid) {
      expect(result).toEqual({ ok: false, error: 'invalid_coords' });
    } else if (result.ok) {
      expect(result.input.coordinates.latitude).toBe(Number.parseFloat(lat));
      expect(result.input.coordinates.longitude).toBe(Number.parseFloat(lng));
      expect(result.input.title).toBe('集合點');
    }
  });

  it('rejects empty title even with valid coordinates', () => {
    expect(validateCoordinateDestination('   ', '25', '121')).toEqual({
      ok: false,
      error: 'empty_title',
    });
  });

  it('trims title on success', () => {
    const result = validateCoordinateDestination('  台北 101  ', '25.0339', '121.5645');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.title).toBe('台北 101');
  });

  it('accepts a pasted pair in the latitude field', () => {
    expect(
      validateCoordinateDestination(
        '集合點',
        '25.068330191151723, 121.59711154017673',
        '',
      ),
    ).toMatchObject({
      ok: true,
      input: {
        coordinates: {
          latitude: 25.068330191151723,
          longitude: 121.59711154017673,
        },
      },
    });
  });
});

describe('CoordinateDestinationSheet wiring contract', () => {
  const sheet = readFileSync(
    join(__dirname, '../components/CoordinateDestinationSheet.tsx'),
    'utf8',
  );
  const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
  const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
  const kml = readFileSync(join(__dirname, '../components/KmlImportSheet.tsx'), 'utf8');

  it('disables submit while submitting and shows invalid-coords copy key', () => {
    expect(sheet).toContain('disabled={submitting}');
    expect(sheet).toContain("t('coord.invalidCoords')");
    expect(sheet).toContain('validateCoordinateDestination');
  });

  it('wires long-press and manual entry into the same addDestination path', () => {
    expect(groupMap).toContain('onLongPressCoordinate');
    expect(mapScreen).toContain('handleLongPressCoordinate');
    expect(mapScreen).toContain('handleCoordinateDestination');
    expect(mapScreen).toContain('CoordinateDestinationSheet');
    expect(mapScreen).toContain("source: 'coordinates'");
    expect(mapScreen).toContain('addDestination(');
  });

  it('keeps KML picker copyToCacheDirectory for Android content:// URIs', () => {
    expect(kml).toContain('copyToCacheDirectory: true');
    expect(kml).toContain('parseKml');
  });
});
