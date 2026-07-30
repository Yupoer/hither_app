/**
 * Destination emoji + palette color validation (no emoji library).
 * Accepts one Unicode emoji grapheme sequence; palette hex only.
 */

/** Spec table of 26 destination presets. */
export const DESTINATION_EMOJI_PRESETS: ReadonlyArray<{
  emoji: string;
  color: string;
  labelZh: string;
  labelEn: string;
}> = [
  { emoji: '🍽️', color: '#F0883E', labelZh: '餐廳', labelEn: 'Restaurant' },
  { emoji: '☕', color: '#A56A43', labelZh: '咖啡', labelEn: 'Cafe' },
  { emoji: '🍜', color: '#E85D4A', labelZh: '麵食', labelEn: 'Noodles' },
  { emoji: '🍣', color: '#E45C7A', labelZh: '日式料理', labelEn: 'Japanese' },
  { emoji: '🍰', color: '#F08BB4', labelZh: '甜點', labelEn: 'Dessert' },
  { emoji: '🛍️', color: '#B565C4', labelZh: '購物', labelEn: 'Shopping' },
  { emoji: '🏨', color: '#596DDE', labelZh: '飯店', labelEn: 'Hotel' },
  { emoji: '🏠', color: '#5B8DEF', labelZh: '住宿／住家', labelEn: 'Home' },
  { emoji: '📍', color: '#E8543F', labelZh: '一般地點', labelEn: 'Place' },
  { emoji: '⭐', color: '#F4C13E', labelZh: '重點', labelEn: 'Highlight' },
  { emoji: '🏛️', color: '#C58A55', labelZh: '博物館／文化', labelEn: 'Museum' },
  { emoji: '⛩️', color: '#D65A5A', labelZh: '寺廟／神社', labelEn: 'Shrine' },
  { emoji: '🏰', color: '#8A6FD1', labelZh: '地標', labelEn: 'Landmark' },
  { emoji: '🎡', color: '#E86AA8', labelZh: '景點', labelEn: 'Attraction' },
  { emoji: '🎢', color: '#D94C68', labelZh: '樂園', labelEn: 'Park ride' },
  { emoji: '🌊', color: '#3D9DD9', labelZh: '水岸', labelEn: 'Waterfront' },
  { emoji: '🏖️', color: '#46B8C8', labelZh: '海灘', labelEn: 'Beach' },
  { emoji: '⛰️', color: '#6F8C62', labelZh: '山區', labelEn: 'Mountain' },
  { emoji: '🌳', color: '#4FAE72', labelZh: '公園', labelEn: 'Park' },
  { emoji: '🌸', color: '#E78AB4', labelZh: '花季', labelEn: 'Blossom' },
  { emoji: '📷', color: '#687CE5', labelZh: '拍照點', labelEn: 'Photo' },
  { emoji: '🚉', color: '#4A90D9', labelZh: '車站', labelEn: 'Station' },
  { emoji: '🚌', color: '#2F9D86', labelZh: '公車', labelEn: 'Bus' },
  { emoji: '✈️', color: '#6574CD', labelZh: '機場', labelEn: 'Airport' },
  { emoji: '🎫', color: '#D69035', labelZh: '活動／票券', labelEn: 'Ticket' },
  { emoji: '🧭', color: '#5E6C84', labelZh: '中繼點', labelEn: 'Waypoint' },
];

/** Stable fallback when emoji/color are null (old rows). */
export const DESTINATION_EMOJI_FALLBACK = '📍';
export const DESTINATION_COLOR_FALLBACK = '#E8543F';

export const DESTINATION_PALETTE_HEX: ReadonlySet<string> = new Set(
  DESTINATION_EMOJI_PRESETS.map((p) => p.color.toUpperCase()),
);

const MAX_EMOJI_CODE_UNITS = 32;

/**
 * Segment into grapheme clusters when Intl.Segmenter is available (Hermes/modern JS).
 * Fallback: treat each code point as a cluster (ZWJ families may fail — tests document).
 */
export function segmentGraphemes(input: string): string[] {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: string },
    ) => { segment: (s: string) => Iterable<{ segment: string }> };
  }).Segmenter;
  if (typeof Segmenter === 'function') {
    try {
      const seg = new Segmenter(undefined, { granularity: 'grapheme' });
      return [...seg.segment(input)].map((s) => s.segment);
    } catch {
      // fall through
    }
  }
  return [...input];
}

/**
 * True when a single grapheme is an emoji sequence — not CJK, accented Latin,
 * or other ordinary non-ASCII text (Ticket 07 / Code Review P1).
 *
 * Accepts Extended_Pictographic, regional indicators (flags), keycaps, and
 * sequences with VS16 / skin tone / ZWJ.
 */
function graphemeLooksLikeEmoji(g: string): boolean {
  if (!g || g.trim().length === 0) return false;
  if (/^\s+$/u.test(g)) return false;
  if (/https?:|www\./i.test(g)) return false;
  // Keycap: 1️⃣ #️⃣ *️⃣
  if (/^[0-9#*]\uFE0F?\u20E3$/u.test(g)) return true;
  try {
    // Preferred: Unicode property escapes (Hermes / modern engines).
    if (/\p{Extended_Pictographic}/u.test(g)) return true;
    if (/\p{Regional_Indicator}{2}/u.test(g)) return true;
    // Lone RI or combining marks without pictographic base → not emoji.
    if (/^[\p{L}\p{N}\p{M}\p{P}\p{Z}]+$/u.test(g)) return false;
  } catch {
    // Fallback without Unicode properties: emoji block ranges + ZWJ/VS.
    // Explicitly reject CJK unified ideographs and Latin-1 letters.
    if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(g)) return false;
    if (/^[A-Za-z0-9\u00C0-\u024F]+$/u.test(g)) return false;
    // Common emoji ranges (misc symbols, emoticons, transport, symbols, flags)
    if (
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u.test(g)
      || g.includes('\u200D')
      || g.includes('\uFE0F')
    ) {
      return true;
    }
    return false;
  }
  return false;
}

export type EmojiValidation =
  | { ok: true; emoji: string }
  | { ok: false; reason: 'empty' | 'multi' | 'not_emoji' | 'oversize' | 'url' | 'text' };

export function validateDestinationEmoji(raw: string | null | undefined): EmojiValidation {
  if (raw == null) return { ok: false, reason: 'empty' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed.length > MAX_EMOJI_CODE_UNITS) return { ok: false, reason: 'oversize' };
  if (/https?:\/\/|www\./i.test(trimmed)) return { ok: false, reason: 'url' };

  const clusters = segmentGraphemes(trimmed).filter((g) => g.length > 0);
  if (clusters.length === 0) return { ok: false, reason: 'empty' };
  if (clusters.length > 1) return { ok: false, reason: 'multi' };

  const emoji = clusters[0];
  if (!graphemeLooksLikeEmoji(emoji)) {
    // Distinguish plain text vs empty-ish
    if (/^[\p{L}\p{N}\s]+$/u.test(emoji)) return { ok: false, reason: 'text' };
    return { ok: false, reason: 'not_emoji' };
  }
  return { ok: true, emoji };
}

export type ColorValidation =
  | { ok: true; color: string }
  | { ok: false; reason: 'empty' | 'not_palette' };

/** Normalize and accept only product palette hex (case-insensitive). */
export function validateDestinationColor(raw: string | null | undefined): ColorValidation {
  if (raw == null || !String(raw).trim()) return { ok: false, reason: 'empty' };
  let hex = String(raw).trim();
  if (!hex.startsWith('#')) hex = `#${hex}`;
  hex = hex.toUpperCase();
  // Expand #RGB → #RRGGBB
  if (/^#[0-9A-F]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (!/^#[0-9A-F]{6}$/.test(hex)) return { ok: false, reason: 'not_palette' };
  if (!DESTINATION_PALETTE_HEX.has(hex)) return { ok: false, reason: 'not_palette' };
  return { ok: true, color: hex };
}

export function resolveDestinationEmoji(emoji: string | null | undefined): string {
  const v = validateDestinationEmoji(emoji ?? null);
  return v.ok ? v.emoji : DESTINATION_EMOJI_FALLBACK;
}

export function resolveDestinationColor(color: string | null | undefined): string {
  const v = validateDestinationColor(color ?? null);
  return v.ok ? v.color : DESTINATION_COLOR_FALLBACK;
}

/** Display string when glyph may be missing on old OS — data stays standard Unicode. */
export function destinationEmojiDisplay(
  emoji: string | null | undefined,
  missingGlyphFallback = DESTINATION_EMOJI_FALLBACK,
): string {
  if (emoji == null || !String(emoji).trim()) return missingGlyphFallback;
  return resolveDestinationEmoji(emoji);
}
