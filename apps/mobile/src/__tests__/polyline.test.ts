import { decodePolyline } from '../utils/polyline';

describe('decodePolyline', () => {
  it('returns empty array for empty or non-string input', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(null as unknown as string)).toEqual([]);
  });

  it('decodes a known Google polyline (precision 1e-5)', () => {
    // Encoded polyline for (38.5, -120.2) → (40.7, -120.95) → (43.252, -126.453)
    // Classic sample from Google polyline algorithm docs.
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const points = decodePolyline(encoded);
    expect(points.length).toBe(3);
    expect(points[0].latitude).toBeCloseTo(38.5, 4);
    expect(points[0].longitude).toBeCloseTo(-120.2, 4);
    expect(points[1].latitude).toBeCloseTo(40.7, 4);
    expect(points[1].longitude).toBeCloseTo(-120.95, 4);
    expect(points[2].latitude).toBeCloseTo(43.252, 4);
    expect(points[2].longitude).toBeCloseTo(-126.453, 4);
  });

  it('returns empty array for truncated input (no partial route)', () => {
    const full = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const truncated = full.slice(0, 5);
    expect(decodePolyline(truncated)).toEqual([]);
  });

  it('handles negative deltas', () => {
    // Single point at origin after encode of 0,0
    const points = decodePolyline('??');
    expect(points.length).toBe(1);
    expect(points[0].latitude).toBeCloseTo(0, 5);
    expect(points[0].longitude).toBeCloseTo(0, 5);
  });
});
