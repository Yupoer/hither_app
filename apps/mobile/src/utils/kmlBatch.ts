import type { KmlPlacemark } from './kml';

export type KmlImportStage = 'parse' | 'validation' | 'persistence' | 'permission';

export class KmlImportError extends Error {
  readonly stage: KmlImportStage;
  readonly code: string;

  constructor(stage: KmlImportStage, code: string, message?: string) {
    super(message ?? code);
    this.name = 'KmlImportError';
    this.stage = stage;
    this.code = code;
  }
}

export interface NormalizedImportItem {
  title: string;
  latitude: number;
  longitude: number;
  address?: string;
}

/** Client-side full-batch validation before any DB I/O. */
export function normalizeImportBatch(
  items: readonly KmlPlacemark[],
): NormalizedImportItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new KmlImportError('validation', 'no_points', 'empty import batch');
  }
  const out: NormalizedImportItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const title = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!title) {
      throw new KmlImportError('validation', 'invalid_title', `item ${i} missing title`);
    }
    const latitude = Number(item.latitude);
    const longitude = Number(item.longitude);
    if (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
    ) {
      throw new KmlImportError(
        'validation',
        'invalid_coords',
        `item ${i} has invalid coordinates`,
      );
    }
    out.push({ title, latitude, longitude });
  }
  return out;
}

/** Map typed import error to i18n key (caller translates). */
export function kmlImportErrorI18nKey(error: unknown): string {
  if (error instanceof KmlImportError) {
    switch (error.stage) {
      case 'permission':
        return 'kml.errPermission';
      case 'persistence':
        return 'kml.errPersistence';
      case 'validation':
        if (error.code === 'invalid_coords') return 'kml.errInvalidCoords';
        if (error.code === 'no_points') return 'kml.errNoPoints';
        return 'kml.errValidation';
      case 'parse':
      default:
        return 'kml.parseError';
    }
  }
  const code = (error as { code?: string } | null)?.code;
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (code === '42501' || /leader membership|permission|row-level security|not authorized/.test(msg)) {
    return 'kml.errPermission';
  }
  if (code === 'P0004' || /itinerary_point_limit/.test(msg)) {
    return 'kml.errPersistence';
  }
  // Downstream write failures must never look like parse errors.
  return 'kml.errPersistence';
}
