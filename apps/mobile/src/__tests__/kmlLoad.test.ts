import {
  isKmzAsset,
  kmlErrorI18nKey,
  loadKmlKmzFromAsset,
  type KmlLoadIo,
} from '../utils/kmlLoad';

function makeIo(overrides: Partial<KmlLoadIo> = {}): KmlLoadIo {
  return {
    platform: 'ios',
    materializeToCache: async (uri) => uri,
    readText: async () => '',
    readBinary: async () => new ArrayBuffer(0),
    ...overrides,
  };
}

const GOOD_KML = `<?xml version="1.0"?>
<kml><Document>
  <Placemark><name>A</name><Point><coordinates>121.1,25.1,0</coordinates></Point></Placemark>
</Document></kml>`;

describe('loadKmlKmzFromAsset', () => {
  it('treats cancel / missing asset as cancelled (not error)', async () => {
    await expect(loadKmlKmzFromAsset(null, makeIo(), { cancelled: true })).resolves.toEqual({
      kind: 'cancelled',
    });
    await expect(loadKmlKmzFromAsset(undefined, makeIo())).resolves.toEqual({
      kind: 'cancelled',
    });
  });

  it('materializes then parses KML into preview', async () => {
    const materializeToCache = jest.fn(async () => 'file://cache/import.kml');
    const result = await loadKmlKmzFromAsset(
      { uri: 'content://provider/doc', name: 'trip.kml', mimeType: 'application/vnd.google-earth.kml+xml' },
      makeIo({
        materializeToCache,
        readText: async () => GOOD_KML,
        getSize: async () => GOOD_KML.length,
      }),
    );
    expect(materializeToCache).toHaveBeenCalled();
    expect(result.kind).toBe('preview');
    if (result.kind === 'preview') {
      expect(result.items).toEqual([{ name: 'A', latitude: 25.1, longitude: 121.1 }]);
      expect(result.meta.extension).toBe('kml');
      expect(result.meta.platform).toBe('ios');
    }
  });

  it('returns empty_file for zero-length content', async () => {
    const result = await loadKmlKmzFromAsset(
      { uri: 'file://x.kml', name: 'x.kml', size: 0 },
      makeIo(),
    );
    expect(result).toMatchObject({ kind: 'error', code: 'empty_file' });
  });

  it('returns oversize when declared size exceeds max', async () => {
    const result = await loadKmlKmzFromAsset(
      { uri: 'file://big.kml', name: 'big.kml', size: 99_000_000 },
      makeIo(),
      { maxBytes: 1000 },
    );
    expect(result).toMatchObject({ kind: 'error', code: 'oversize', stage: 'pick' });
  });

  it('returns oversize when KMZ expands past max after unzip', async () => {
    const huge = `${'x'.repeat(5000)}`;
    const result = await loadKmlKmzFromAsset(
      { uri: 'file://bomb.kmz', name: 'bomb.kmz', size: 10 },
      makeIo({
        readBinary: async () => new Uint8Array([1, 2, 3]).buffer,
        loadZip: async () => ({
          files: {
            doc: {
              name: 'doc.kml',
              dir: false,
              async: async () => huge,
            },
          },
        }),
      }),
      { maxBytes: 100 },
    );
    expect(result).toMatchObject({ kind: 'error', code: 'oversize', stage: 'unzipKmz' });
  });

  it('returns bad_zip when KMZ unzip fails', async () => {
    const result = await loadKmlKmzFromAsset(
      { uri: 'file://x.kmz', name: 'x.kmz' },
      makeIo({
        readBinary: async () => new Uint8Array([1, 2, 3]).buffer,
        loadZip: async () => {
          throw new Error('bad');
        },
      }),
    );
    expect(result).toMatchObject({ kind: 'error', code: 'bad_zip', stage: 'unzipKmz' });
  });

  it('returns no_kml_in_kmz when zip has no kml entry', async () => {
    const result = await loadKmlKmzFromAsset(
      { uri: 'file://x.kmz', name: 'x.kmz' },
      makeIo({
        readBinary: async () => new Uint8Array([1, 2, 3]).buffer,
        loadZip: async () => ({
          files: {
            a: { name: 'readme.txt', dir: false, async: async () => 'hi' },
          },
        }),
      }),
    );
    expect(result).toMatchObject({ kind: 'error', code: 'no_kml_in_kmz' });
  });

  it('parses KML inside KMZ', async () => {
    const result = await loadKmlKmzFromAsset(
      { uri: 'file://x.kmz', name: 'x.kmz' },
      makeIo({
        readBinary: async () => new Uint8Array([1, 2, 3]).buffer,
        loadZip: async () => ({
          files: {
            doc: {
              name: 'doc.kml',
              dir: false,
              async: async () => GOOD_KML,
            },
          },
        }),
      }),
    );
    expect(result.kind).toBe('preview');
  });

  it('returns no_points / invalid_coords for empty placemarks', async () => {
    const noPoint = await loadKmlKmzFromAsset(
      { uri: 'file://x.kml', name: 'x.kml' },
      makeIo({ readText: async () => '<kml><Document></Document></kml>' }),
    );
    expect(noPoint).toMatchObject({ kind: 'error', code: 'no_points' });

    const badCoords = await loadKmlKmzFromAsset(
      { uri: 'file://x.kml', name: 'x.kml' },
      makeIo({
        readText: async () =>
          '<kml><Placemark><name>B</name><Point><coordinates>999,999</coordinates></Point></Placemark></kml>',
      }),
    );
    expect(badCoords).toMatchObject({ kind: 'error', code: 'invalid_coords' });
  });

  it('detects kmz by extension and mime', () => {
    expect(isKmzAsset({ uri: 'file://a.kmz' })).toBe(true);
    expect(isKmzAsset({ uri: 'file://a', mimeType: 'application/vnd.google-earth.kmz' })).toBe(true);
    expect(isKmzAsset({ uri: 'file://a.kml' })).toBe(false);
  });

  it('maps error codes to i18n keys', () => {
    expect(kmlErrorI18nKey('empty_file')).toBe('kml.errEmpty');
    expect(kmlErrorI18nKey('bad_zip')).toBe('kml.errBadZip');
  });

  it('never includes file paths in diagnostic meta', async () => {
    const result = await loadKmlKmzFromAsset(
      {
        uri: 'content://com.google.android.apps.docs.storage/document/acc%3D1',
        name: 'secret-path.kml',
      },
      makeIo({
        materializeToCache: async () => {
          throw new Error('fail');
        },
      }),
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      const json = JSON.stringify(result.meta);
      expect(json).not.toContain('content://');
      expect(json).not.toContain('secret-path');
      expect(result.meta.extension).toBe('kml');
    }
  });
});
