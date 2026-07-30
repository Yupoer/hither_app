/**
 * Stage-aware KML/KMZ load pipeline.
 * Materialize provider/content URIs into a stable cache file before read;
 * never assume fetch(file://|content://) works on every platform.
 */

import type { KmlPlacemark } from './kml';
import { parseKml } from './kml';

/** Max uncompressed KML / KMZ payload we will parse (safety). */
export const KML_MAX_BYTES = 8 * 1024 * 1024;

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
  loadZip?: (data: ArrayBuffer) => Promise<{
    files: Record<string, { name: string; dir: boolean; async: (type: 'string') => Promise<string> }>;
  }>;
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

  const maxBytes = options?.maxBytes ?? KML_MAX_BYTES;
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

    let zip: {
      files: Record<string, { name: string; dir: boolean; async: (type: 'string') => Promise<string> }>;
    };
    try {
      if (io.loadZip) {
        zip = await io.loadZip(buffer);
      } else {
        const JSZip = (await import('jszip')).default;
        zip = await JSZip.loadAsync(buffer);
      }
    } catch {
      return {
        kind: 'error',
        code: 'bad_zip',
        stage: 'unzipKmz',
        meta: metaOf(asset, io.platform, 'unzipKmz', buffer.byteLength, 'bad_zip'),
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
      xml = await kmlFile.async('string');
    } catch {
      return {
        kind: 'error',
        code: 'bad_zip',
        stage: 'unzipKmz',
        meta: metaOf(asset, io.platform, 'unzipKmz', buffer.byteLength, 'bad_zip'),
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
