// ponytail: regex-based KML extraction — handles Google My Maps exports (Point
// placemarks, first coordinate of geometries). Folders flatten; styles ignored.
// Upgrade to a real XML parser if other producers matter.

export interface KmlPlacemark {
  name: string;
  latitude: number;
  longitude: number;
}

const PLACEMARK_RE = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/g;
const NAME_RE = /<name>([\s\S]*?)<\/name>/;
const CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/;
const COORDINATES_RE = /<coordinates>([\s\S]*?)<\/coordinates>/;

function extractName(block: string, fallbackIndex: number): string {
  const match = NAME_RE.exec(block);
  if (!match) return `Unnamed ${fallbackIndex}`;
  const raw = match[1].trim();
  const cdata = CDATA_RE.exec(raw);
  const text = (cdata ? cdata[1] : raw).trim();
  return text.length > 0 ? text : `Unnamed ${fallbackIndex}`;
}

function extractFirstCoordinate(block: string): { latitude: number; longitude: number } | null {
  const match = COORDINATES_RE.exec(block);
  if (!match) return null;
  // <coordinates> may hold one "lon,lat[,alt]" (Point) or a whitespace-
  // separated list (LineString/Polygon) — we only want the first tuple.
  const firstTuple = match[1].trim().split(/\s+/)[0];
  if (!firstTuple) return null;
  const parts = firstTuple.split(',');
  if (parts.length < 2) return null;
  const longitude = parseFloat(parts[0]);
  const latitude = parseFloat(parts[1]);
  if (
    Number.isNaN(longitude) ||
    Number.isNaN(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }
  return { latitude, longitude };
}

/** Extract Point-like placemarks (name + first coordinate) from a KML document. */
export function parseKml(xml: string): KmlPlacemark[] {
  const results: KmlPlacemark[] = [];
  let index = 0;
  let match: RegExpExecArray | null;
  PLACEMARK_RE.lastIndex = 0;
  while ((match = PLACEMARK_RE.exec(xml)) !== null) {
    index += 1;
    const block = match[1];
    const coord = extractFirstCoordinate(block);
    if (!coord) continue;
    results.push({ name: extractName(block, index), ...coord });
  }
  return results;
}
