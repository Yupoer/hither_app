import type { Coordinates } from '../types';

// Open Location Code (Plus Code) uses a fixed alphabet and can decode a
// complete code locally without a Google API request.
const CODE_ALPHABET = '23456789CFGHJMPQRVWX';
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125] as const;

const PLUS_CODE_TOKEN = /(?:[23456789CFGHJMPQRVWX]\s*){2,10}\+\s*(?:[23456789CFGHJMPQRVWX]\s*){1,7}/i;

/** Extract only the Plus Code from clipboard text that also contains a region. */
export function extractPlusCode(input: string): string | null {
  const match = PLUS_CODE_TOKEN.exec(input.trim());
  if (!match) return null;
  return match[0].replace(/\s+/g, '').toUpperCase();
}

function codeIndex(char: string): number {
  return CODE_ALPHABET.indexOf(char);
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

/** Encode enough of a reference coordinate to recover a short code prefix. */
function encodeReference(coordinates: Coordinates): string {
  const latitude = Math.min(90 - PAIR_RESOLUTIONS[4], Math.max(-90, coordinates.latitude));
  const longitude = normalizeLongitude(coordinates.longitude);
  let lat = latitude + 90;
  let lng = longitude + 180;
  let resolution = PAIR_RESOLUTIONS[0];
  let compact = '';

  for (let i = 0; i < PAIR_RESOLUTIONS.length; i += 1) {
    const latDigit = Math.min(19, Math.floor(lat / resolution));
    const lngDigit = Math.min(19, Math.floor(lng / resolution));
    compact += CODE_ALPHABET[latDigit] + CODE_ALPHABET[lngDigit];
    lat -= latDigit * resolution;
    lng -= lngDigit * resolution;
    resolution /= 20;
  }
  return compact;
}

function decodeCompact(compact: string): Coordinates | null {
  if (compact.length < 8 || compact.length > 15) return null;

  const pairLength = Math.min(compact.length, 10);
  let latitude = -90;
  let longitude = -180;
  for (let i = 0; i < pairLength; i += 2) {
    const resolution = PAIR_RESOLUTIONS[i / 2];
    const latDigit = codeIndex(compact[i]);
    const lngDigit = codeIndex(compact[i + 1]);
    if (latDigit < 0 || lngDigit < 0 || !resolution) return null;
    latitude += latDigit * resolution;
    longitude += lngDigit * resolution;
  }

  let latitudeResolution = PAIR_RESOLUTIONS[pairLength / 2 - 1];
  let longitudeResolution = latitudeResolution;
  for (let i = pairLength; i < compact.length; i += 1) {
    const value = codeIndex(compact[i]);
    if (value < 0) return null;
    latitudeResolution /= 5;
    longitudeResolution /= 4;
    latitude += Math.floor(value / 4) * latitudeResolution;
    longitude += (value % 4) * longitudeResolution;
  }

  return {
    latitude: latitude + latitudeResolution / 2,
    longitude: longitude + longitudeResolution / 2,
  };
}

/** Decode a full or region-relative short Google Plus Code without an API call. */
export function decodePlusCode(
  input: string,
  reference?: Coordinates,
): Coordinates | null {
  const normalized = extractPlusCode(input);
  if (!normalized) return null;
  const separator = normalized.indexOf('+');
  if (
    separator < 2 ||
    separator !== normalized.lastIndexOf('+') ||
    separator > 10
  ) {
    return null;
  }

  const before = normalized.slice(0, separator);
  const after = normalized.slice(separator + 1);
  if (before.length < 8 && !reference) return null;
  if (before.length > 10 || before.length < 2) return null;

  const fullPrefix = before.length >= 8
    ? before
    : `${encodeReference(reference as Coordinates).slice(0, 8 - before.length)}${before}`;
  const compact = `${fullPrefix}${after}`;
  if (fullPrefix.length < 8 || compact.length > 15) return null;
  if ([...compact].some((char) => codeIndex(char) < 0)) return null;
  return decodeCompact(compact);
}
