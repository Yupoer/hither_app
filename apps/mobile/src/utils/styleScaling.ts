/**
 * Apply app Settings textScale to design fontSize only.
 * Do NOT multiply by full layout scale here — RN allowFontScaling still
 * applies system Dynamic Type (would double-count system otherwise).
 * Emoji styles are skipped so avatar glyphs stay fixed in their shells.
 */
export function applyAppTextScale<T extends Record<string, any>>(
  defs: T,
  textScale: number,
  emojiKeys: ReadonlySet<string>,
): T {
  if (!Number.isFinite(textScale) || textScale === 1 || textScale <= 0) return defs;
  const out = { ...defs } as T;
  for (const key of Object.keys(defs)) {
    if (emojiKeys.has(key)) continue;
    const entry = defs[key];
    if (entry && typeof entry === 'object' && typeof entry.fontSize === 'number') {
      (out as any)[key] = {
        ...entry,
        fontSize: Math.round(entry.fontSize * textScale),
      };
    }
  }
  return out;
}

/**
 * When system Bold Text is on, drop design-time 700/bold to 600 so SF Pro
 * doesn't render double-thick (OS bold + explicit heavy weight) and clip
 * short labels in pills / command chrome.
 */
export function applyBoldTextWeights<T extends Record<string, any>>(
  defs: T,
  boldText: boolean,
  emojiKeys: ReadonlySet<string>,
): T {
  if (!boldText) return defs;
  const out = { ...defs } as T;
  for (const key of Object.keys(defs)) {
    if (emojiKeys.has(key)) continue;
    const entry = defs[key];
    if (!entry || typeof entry !== 'object') continue;
    const w = entry.fontWeight;
    if (w === '700' || w === 'bold' || w === 700) {
      (out as any)[key] = { ...entry, fontWeight: '600' };
    }
  }
  return out;
}
