/**
 * Stage-aware KML/KMZ load pipeline.
 * Materialize provider/content URIs into a stable cache file before read;
 * never assume fetch(file://|content://) works on every platform.
 */

import type { KmlPlacemark } from './kml';
import { parseKml } from './kml';
import type JSZip from 'jszip';

/** Max uncompressed KML / KMZ payload we will parse (safety). */
export const KML_MAX_BYTES = 8 * 1024 * 1024;
const KMZ_MAX_ENTRIES = 256;
const KMZ_MAX_RATIO = 1000;

/** UTF-8 byte length of a string (decoded KMZ/KML payload size). */
export function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  // Minimal fallback when TextEncoder is missing (should not happen on RN).
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7f) n += 1;
    else if (cp <= 0x7ff) n += 2;
    else if (cp <= 0xffff) n += 3;
    else n += 4;
  }
  return n;
}

export type KmlLoadStage =
  | 'pick'
  | 'materializeReadable'
  | 'unzipKmz'
  | 'parseKml'
  | 'preview';

export type KmlLoadErrorCode =
  | 'cancelled'
  | 'empty_file'
  | 'bad_zip'
  | 'no_kml_in_kmz'
  | 'no_points'
  | 'invalid_coords'
  | 'oversize'
  | 'read_failed'
  | 'unknown';

export class KmlLoadError extends Error {
  readonly code: KmlLoadErrorCode;
  readonly stage: KmlLoadStage;

  constructor(code: KmlLoadErrorCode, stage: KmlLoadStage, message?: string) {
    super(message ?? code);
    this.name = 'KmlLoadError';
    this.code = code;
    this.stage = stage;
  }
}

export interface KmlAssetLike {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

export interface KmlLoadSuccess {
  kind: 'preview';
  items: KmlPlacemark[];
  stage: 'preview';
  meta: KmlLoadDiagnosticMeta;
}

export interface KmlLoadCancelled {
  kind: 'cancelled';
}

export interface KmlLoadFailure {
  kind: 'error';
  code: KmlLoadErrorCode;
  stage: KmlLoadStage;
  meta: KmlLoadDiagnosticMeta;
}

export type KmlLoadResult = KmlLoadSuccess | KmlLoadCancelled | KmlLoadFailure;

/** Diagnostics-safe meta — never paths or file body. */
export interface KmlLoadDiagnosticMeta {
  platform: string;
  extension: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  stage: KmlLoadStage;
  errorCode?: KmlLoadErrorCode;
}

export interface KmlLoadIo {
  /** Copy/move provider URI into app cache; return readable file URI. */
  materializeToCache: (uri: string, suggestedName: string) => Promise<string>;
  /** Read entire file as UTF-8 text (for plain KML). */
  readText: (fileUri: string) => Promise<string>;
  /** Read entire file as ArrayBuffer (for KMZ). */
  readBinary: (fileUri: string) => Promise<ArrayBuffer>;
  /** Optional size probe after materialize. */
  getSize?: (fileUri: string) => Promise<number | null>;
  platform: string;
  /** Inject JSZip factory for tests. */
  loadZip?: (data: ArrayBuffer) => Promise<Pick<JSZip, 'files'>>;
}

/** Bound ZIP metadata before JSZip allocates its entry table or inflates anything. */
function checkKmzDirectory(buffer: ArrayBuffer, maxBytes: number): void {
  const view = new DataView(buffer);
  const bad = () => { throw new KmlLoadError('bad_zip', 'unzipKmz'); };
  const oversize = () => { throw new KmlLoadError('oversize', 'unzipKmz'); };
  let end = buffer.byteLength - 22;
  const first = Math.max(0, end - 65535);
  for (; end >= first; end -= 1) {
    if (view.getUint32(end, true) === 0x06054b50 &&
        end + 22 + view.getUint16(end + 20, true) === buffer.byteLength) break;
  }
  if (end < first) return bad();
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  // Small KMZ files need neither split archives nor ZIP64; reject both.
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
      view.getUint16(end + 8, true) !== count || offset + directorySize !== end) return bad();
  if (count > KMZ_MAX_ENTRIES) return oversize();
  let expanded = 0;
  for (let entry = 0; entry < count; entry += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return bad();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const local = view.getUint32(offset + 42, true);
    if ((flags & 1) || (method !== 0 && method !== 8) || view.getUint16(offset + 34, true) ||
        local + 30 > offset || view.getUint32(local, true) !== 0x04034b50 ||
        (view.getUint16(local + 6, true) & 1) || view.getUint16(local + 8, true) !== method ||
        local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true) + compressed > offset) return bad();
    expanded += uncompressed;
    if (expanded > maxBytes || uncompressed > Math.max(1, compressed) * KMZ_MAX_RATIO) return oversize();
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (offset > end) return bad();
  }
  if (offset !== end) return bad();
}

type ZipWorker = {
  name: string;
  previous?: ZipWorker;
  error: (error: Error) => void;
  processChunk: (...args: unknown[]) => void;
  flush: (...args: unknown[]) => void;
  push: (...args: unknown[]) => void;
  end: (...args: unknown[]) => void;
};

async function readBoundedKml(file: JSZip.JSZipObject, maxBytes: number): Promise<string> {
  // ponytail: JSZip 3.10 worker API; replace with a public cancellable stream if provided.
  // JSZip 3.10's public pause() cannot interrupt pako's current synchronous push.
  // Guard its worker boundary so overflow unwinds the inflater immediately and
  // error() releases upstream data. This adapter is regression-tested with real ZIPs.
  const stream = (file as JSZip.JSZipObject & {
    internalStream: (type: 'string') => JSZip.JSZipStreamHelper<string> & { _worker: ZipWorker };
  }).internalStream('string');
  let worker = stream._worker;
  if (!worker) throw new KmlLoadError('bad_zip', 'unzipKmz');
  while (worker.previous && worker.name !== 'FlateWorker/Inflate') worker = worker.previous;
  const methods = worker.name === 'FlateWorker/Inflate' ? ['processChunk', 'flush'] as const : ['push', 'end'] as const;
  for (const method of methods) {
    const original = worker[method];
    worker[method] = function (...args: unknown[]) {
      try { original.apply(this, args); } catch (error) {
        // Unwind pako first; cleaning listeners during JSZip's active emit loop
        // corrupts that loop. A microtask cleans up before the next input tick.
        Promise.resolve().then(() => stream._worker.error(error as Error));
      }
    };
  }
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let bytes = 0;
    stream.on('data', (chunk) => {
      bytes += utf8ByteLength(chunk);
      if (bytes > maxBytes) {
        chunks.length = 0;
        throw new KmlLoadError('oversize', 'unzipKmz');
      }
      chunks.push(chunk);
    });
    stream.on('error', (error) => { chunks.length = 0; reject(error); });
    stream.on('end', () => resolve(chunks.join('')));
    stream.resume();
  });
}

function extensionOf(asset: KmlAssetLike): string | null {
  const name = (asset.name ?? asset.uri).split(/[\\/]/).pop() ?? '';
  const q = name.split('?')[0] ?? name;
  const dot = q.lastIndexOf('.');
  if (dot < 0) return null;
  return q.slice(dot + 1).toLowerCase();
}

export function isKmzAsset(asset: KmlAssetLike): boolean {
  const ext = extensionOf(asset);
  if (ext === 'kmz') return true;
  const mime = (asset.mimeType ?? '').toLowerCase();
  if (mime.includes('kmz') || mime === 'application/vnd.google-earth.kmz') return true;
  const uri = asset.uri.toLowerCase();
  return uri.endsWith('.kmz') || uri.includes('.kmz?');
}

function metaOf(
  asset: KmlAssetLike,
  platform: string,
  stage: KmlLoadStage,
  sizeBytes: number | null,
  errorCode?: KmlLoadErrorCode,
): KmlLoadDiagnosticMeta {
  return {
    platform,
    extension: extensionOf(asset),
    mimeType: asset.mimeType ?? null,
    sizeBytes: sizeBytes ?? (typeof asset.size === 'number' ? asset.size : null),
    stage,
    errorCode,
  };
}

/**
 * Load KML/KMZ from a document-picker asset into placemarks or a typed error.
 * Cancel is returned as `{ kind: 'cancelled' }` — not an error.
 */
export async function loadKmlKmzFromAsset(
  asset: KmlAssetLike | null | undefined,
  io: KmlLoadIo,
  options?: { cancelled?: boolean; maxBytes?: number },
): Promise<KmlLoadResult> {
  if (options?.cancelled || !asset?.uri) {
    return { kind: 'cancelled' };
  }

  const maxBytes = Math.min(options?.maxBytes ?? KML_MAX_BYTES, KML_MAX_BYTES);
  const declaredSize =
    typeof asset.size === 'number' && Number.isFinite(asset.size) ? asset.size : null;
  if (declaredSize != null && declaredSize > maxBytes) {
    return {
      kind: 'error',
      code: 'oversize',
      stage: 'pick',
      meta: metaOf(asset, io.platform, 'pick', declaredSize, 'oversize'),
    };
  }

  let readableUri: string;
  try {
    const suggested =
      (asset.name && asset.name.replace(/[^\w.\-]+/g, '_')) ||
      (isKmzAsset(asset) ? 'import.kmz' : 'import.kml');
    readableUri = await io.materializeToCache(asset.uri, suggested);
  } catch {
    return {
      kind: 'error',
      code: 'read_failed',
      stage: 'materializeReadable',
      meta: metaOf(asset, io.platform, 'materializeReadable', declaredSize, 'read_failed'),
    };
  }

  let sizeBytes = declaredSize;
  if (io.getSize) {
    try {
      const probed = await io.getSize(readableUri);
      if (probed != null) sizeBytes = probed;
    } catch {
      // ignore size probe failures
    }
  }
  if (sizeBytes != null && sizeBytes > maxBytes) {
    return {
      kind: 'error',
      code: 'oversize',
      stage: 'materializeReadable',
      meta: metaOf(asset, io.platform, 'materializeReadable', sizeBytes, 'oversize'),
    };
  }
  if (sizeBytes === 0) {
    return {
      kind: 'error',
      code: 'empty_file',
      stage: 'materializeReadable',
      meta: metaOf(asset, io.platform, 'materializeReadable', 0, 'empty_file'),
    };
  }

  let xml: string;
  if (isKmzAsset(asset)) {
    let buffer: ArrayBuffer;
    try {
      buffer = await io.readBinary(readableUri);
    } catch {
      return {
        kind: 'error',
        code: 'read_failed',
        stage: 'materializeReadable',
        meta: metaOf(asset, io.platform, 'materializeReadable', sizeBytes, 'read_failed'),
      };
    }
    if (buffer.byteLength === 0) {
      return {
        kind: 'error',
        code: 'empty_file',
        stage: 'materializeReadable',
        meta: metaOf(asset, io.platform, 'materializeReadable', 0, 'empty_file'),
      };
    }
    if (buffer.byteLength > maxBytes) {
      return {
        kind: 'error',
        code: 'oversize',
        stage: 'materializeReadable',
        meta: metaOf(asset, io.platform, 'materializeReadable', buffer.byteLength, 'oversize'),
      };
    }

    let zip: Pick<JSZip, 'files'>;
    try {
      checkKmzDirectory(buffer, maxBytes);
      if (io.loadZip) {
        zip = await io.loadZip(buffer);
      } else {
        const JSZip = (await import('jszip')).default;
        zip = await JSZip.loadAsync(buffer);
      }
    } catch (error) {
      const code = error instanceof KmlLoadError ? error.code : 'bad_zip';
      return {
        kind: 'error',
        code,
        stage: 'unzipKmz',
        meta: metaOf(asset, io.platform, 'unzipKmz', buffer.byteLength, code),
      };
    }

    const kmlFile = Object.values(zip.files).find(
      (f) => f.name.toLowerCase().endsWith('.kml') && !f.dir,
    );
    if (!kmlFile) {
      return {
        kind: 'error',
        code: 'no_kml_in_kmz',
        stage: 'unzipKmz',
        meta: metaOf(asset, io.platform, 'unzipKmz', buffer.byteLength, 'no_kml_in_kmz'),
      };
    }
    try {
      xml = await readBoundedKml(kmlFile, maxBytes);
    } catch (error) {
      const code = error instanceof KmlLoadError ? error.code : 'bad_zip';
      return {
        kind: 'error',
        code,
        stage: 'unzipKmz',
        meta: metaOf(asset, io.platform, 'unzipKmz', buffer.byteLength, code),
      };
    }
    // Compressed size may be tiny; enforce limit on *uncompressed* KML.
    const decodedBytes = utf8ByteLength(xml);
    if (decodedBytes > maxBytes) {
      return {
        kind: 'error',
        code: 'oversize',
        stage: 'unzipKmz',
        meta: metaOf(asset, io.platform, 'unzipKmz', decodedBytes, 'oversize'),
      };
    }
    sizeBytes = decodedBytes;
  } else {
    try {
      xml = await io.readText(readableUri);
    } catch {
      return {
        kind: 'error',
        code: 'read_failed',
        stage: 'materializeReadable',
        meta: metaOf(asset, io.platform, 'materializeReadable', sizeBytes, 'read_failed'),
      };
    }
    const decodedBytes = utf8ByteLength(xml);
    if (decodedBytes > maxBytes) {
      return {
        kind: 'error',
        code: 'oversize',
        stage: 'parseKml',
        meta: metaOf(asset, io.platform, 'parseKml', decodedBytes, 'oversize'),
      };
    }
    if (sizeBytes == null) sizeBytes = decodedBytes;
  }

  if (!xml || xml.trim().length === 0) {
    return {
      kind: 'error',
      code: 'empty_file',
      stage: 'parseKml',
      meta: metaOf(asset, io.platform, 'parseKml', sizeBytes, 'empty_file'),
    };
  }

  let items: KmlPlacemark[];
  try {
    items = parseKml(xml);
  } catch {
    return {
      kind: 'error',
      code: 'unknown',
      stage: 'parseKml',
      meta: metaOf(asset, io.platform, 'parseKml', sizeBytes, 'unknown'),
    };
  }

  if (items.length === 0) {
    // Distinguish "had coordinates but all invalid" only when document looks like KML with placemarks.
    const looksLikeKml = /<Placemark\b/i.test(xml) || /<kml\b/i.test(xml);
    const hadCoords = /<coordinates>/i.test(xml);
    const code: KmlLoadErrorCode =
      looksLikeKml && hadCoords ? 'invalid_coords' : 'no_points';
    return {
      kind: 'error',
      code,
      stage: 'parseKml',
      meta: metaOf(asset, io.platform, 'parseKml', sizeBytes, code),
    };
  }

  // Drop non-finite (parser already filters most); belt-and-suspenders.
  const finite = items.filter(
    (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
  if (finite.length === 0) {
    return {
      kind: 'error',
      code: 'invalid_coords',
      stage: 'parseKml',
      meta: metaOf(asset, io.platform, 'parseKml', sizeBytes, 'invalid_coords'),
    };
  }

  return {
    kind: 'preview',
    items: finite,
    stage: 'preview',
    meta: metaOf(asset, io.platform, 'preview', sizeBytes),
  };
}

/** Map error code to i18n key (caller translates). */
export function kmlErrorI18nKey(code: KmlLoadErrorCode): string {
  switch (code) {
    case 'empty_file':
      return 'kml.errEmpty';
    case 'bad_zip':
      return 'kml.errBadZip';
    case 'no_kml_in_kmz':
      return 'kml.errNoKmlInKmz';
    case 'no_points':
      return 'kml.errNoPoints';
    case 'invalid_coords':
      return 'kml.errInvalidCoords';
    case 'oversize':
      return 'kml.errOversize';
    case 'read_failed':
      return 'kml.errRead';
    case 'cancelled':
      return 'kml.errCancelled';
    default:
      return 'kml.parseError';
  }
}
