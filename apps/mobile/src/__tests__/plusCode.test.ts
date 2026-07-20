import { decodePlusCode, extractPlusCode } from '../utils/plusCode';

describe('decodePlusCode', () => {
  it('strips a pasted region suffix before decoding', () => {
    expect(extractPlusCode('849V CWC8+Q48, Mountain View, California')).toBe('849VCWC8+Q48');
    expect(decodePlusCode('849V CWC8+Q48, Mountain View, California')?.latitude)
      .toBeCloseTo(37.4219125, 6);
  });

  it('decodes a full Plus Code without a network request', () => {
    const result = decodePlusCode('849VCWC8+Q48');
    expect(result?.latitude).toBeCloseTo(37.4219125, 6);
    expect(result?.longitude).toBeCloseTo(-122.084671875, 6);
  });

  it('resolves a short Plus Code against the visible map region', () => {
    const result = decodePlusCode('CWC8+Q48', {
      latitude: 37.42,
      longitude: -122.08,
    });
    expect(result?.latitude).toBeCloseTo(37.4219125, 6);
    expect(result?.longitude).toBeCloseTo(-122.084671875, 6);
  });

  it('does not treat an unqualified short code as global', () => {
    expect(decodePlusCode('CWC8+Q48')).toBeNull();
  });
});
