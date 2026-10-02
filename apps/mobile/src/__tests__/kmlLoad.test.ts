import {
  KML_MAX_BYTES,
  isKmzAsset,
  kmlErrorI18nKey,
  loadKmlKmzFromAsset,
  type KmlLoadIo,
} from '../utils/kmlLoad';
import JSZip from 'jszip';

async function kmz(content: string, name = 'doc.kml'): Promise<ArrayBuffer> {
  return new JSZip().file(name, content).generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

function directoryOffset(buffer: ArrayBuffer): number {
  return new DataView(buffer).getUint32(buffer.byteLength - 6, true);
}

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

  it('rejects KMZ declared expanded bytes before loading or inflating the archive', async () => {
    const buffer = await kmz('x'.repeat(5000));
    const loadZip = jest.fn(JSZip.loadAsync);
    const result = await loadKmlKmzFromAsset(
      { uri: 'file://bomb.kmz', name: 'bomb.kmz' },
      makeIo({
        readBinary: async () => buffer,
        loadZip,
      }),
      { maxBytes: 1000 },
    );
    expect(result).toMatchObject({ kind: 'error', code: 'oversize', stage: 'unzipKmz' });
    expect(loadZip).not.toHaveBeenCalled();
  });

  it('rejects KMZ entry tables and compression ratios before JSZip loads them', async () => {
    const zip = new JSZip();
    for (let entry = 0; entry < 257; entry += 1) zip.file(`${entry}.txt`, '');
    const manyEntries = await zip.generateAsync({ type: 'arraybuffer' });
    const highRatio = await kmz('x'.repeat(4 * 1024 * 1024));
    for (const buffer of [manyEntries, highRatio]) {
      const loadZip = jest.fn(JSZip.loadAsync);
      const result = await loadKmlKmzFromAsset({ uri: 'file://bomb.kmz' }, makeIo({
        readBinary: async () => buffer, loadZip,
      }));
      expect(result).toMatchObject({ kind: 'error', code: 'oversize', stage: 'unzipKmz' });
      expect(loadZip).not.toHaveBeenCalled();
    }
  });

  it('rejects the aggregate declared expansion across otherwise small KMZ entries', async () => {
    const buffer = await new JSZip().file('doc.kml', 'a'.repeat(600)).file('photo.txt', 'b'.repeat(600))
      .generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    const loadZip = jest.fn(JSZip.loadAsync);
    const result = await loadKmlKmzFromAsset({ uri: 'file://big.kmz' }, makeIo({
      readBinary: async () => buffer, loadZip,
    }), { maxBytes: 1000 });
    expect(result).toMatchObject({ kind: 'error', code: 'oversize', stage: 'unzipKmz' });
    expect(loadZip).not.toHaveBeenCalled();
  });

  it('hard-aborts KMZ streamed expansion at 8 MiB even when declared sizes lie', async () => {
    const buffer = await kmz('x'.repeat(32 * 1024 * 1024));
    // The forged directory passes size and ratio checks but the DEFLATE body is huge.
    new DataView(buffer).setUint32(directoryOffset(buffer) + 24, KML_MAX_BYTES, true);
    let emitted = 0;
    const loadZip: NonNullable<KmlLoadIo['loadZip']> = async (data) => {
      const zip = await JSZip.loadAsync(data);
      const file = zip.files['doc.kml'] as JSZip.JSZipObject & {
        internalStream: (type: 'string') => JSZip.JSZipStreamHelper<string>;
      };
      const original = file.internalStream.bind(file);
      file.internalStream = (type) => original(type).on('data', (chunk) => { emitted += chunk.length; });
      return zip;
    };
    const result = await loadKmlKmzFromAsset({ uri: 'file://bomb.kmz' }, makeIo({
      readBinary: async () => buffer, loadZip,
    }), { maxBytes: 64 * 1024 * 1024 });
    expect(result).toMatchObject({ kind: 'error', code: 'oversize', stage: 'unzipKmz' });
    expect(emitted).toBeGreaterThan(KML_MAX_BYTES);
    expect(emitted).toBeLessThanOrEqual(KML_MAX_BYTES + 16 * 1024);
  });

  it('rejects a lying entry count before allocating JSZip entries', async () => {
    const buffer = await kmz(GOOD_KML);
    new DataView(buffer).setUint16(buffer.byteLength - 14, 0, true);
    new DataView(buffer).setUint16(buffer.byteLength - 12, 0, true);
    const loadZip = jest.fn(JSZip.loadAsync);
    const result = await loadKmlKmzFromAsset({ uri: 'file://broken.kmz' }, makeIo({
      readBinary: async () => buffer, loadZip,
    }));
    expect(result).toMatchObject({ kind: 'error', code: 'bad_zip' });
    expect(loadZip).not.toHaveBeenCalled();
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
    const buffer = await kmz('hi', 'readme.txt');
    const result = await loadKmlKmzFromAsset(
      { uri: 'file://x.kmz', name: 'x.kmz' },
      makeIo({
        readBinary: async () => buffer,
        loadZip: JSZip.loadAsync,
      }),
    );
    expect(result).toMatchObject({ kind: 'error', code: 'no_kml_in_kmz' });
  });

  it('parses KML inside KMZ', async () => {
    const buffer = await kmz(GOOD_KML);
    const result = await loadKmlKmzFromAsset(
      { uri: 'file://x.kmz', name: 'x.kmz' },
      makeIo({
        readBinary: async () => buffer,
      }),
    );
    expect(result.kind).toBe('preview');
  });

  it('parses stored KMZ Unicode KML without a DEFLATE worker', async () => {
    const buffer = await new JSZip().file('doc.kml', GOOD_KML.replace('<name>A', '<name>路線🍁'))
      .generateAsync({ type: 'arraybuffer', compression: 'STORE' });
    const result = await loadKmlKmzFromAsset({ uri: 'file://stored.kmz' }, makeIo({
      readBinary: async () => buffer,
    }));
    expect(result).toMatchObject({ kind: 'preview', items: [{ name: '路線🍁' }] });
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
