import {
  DESTINATION_EMOJI_PRESETS,
  DESTINATION_EMOJI_FALLBACK,
  DESTINATION_COLOR_FALLBACK,
  DESTINATION_PALETTE_LIST,
  resolveDestinationColor,
  resolveDestinationEmoji,
  validateDestinationColor,
  validateDestinationEmoji,
} from '../utils/destinationEmojiColor';

describe('destination emoji/color presets', () => {
  it('exposes 25 presets (🧭 removed; no custom entry)', () => {
    expect(DESTINATION_EMOJI_PRESETS).toHaveLength(25);
    expect(DESTINATION_EMOJI_PRESETS.some((p) => p.emoji === '🧭')).toBe(false);
  });

  it('keeps legacy #5E6C84 on independent palette after 🧭 removal', () => {
    expect(DESTINATION_PALETTE_LIST.map((c) => c.toUpperCase())).toContain('#5E6C84');
    expect(validateDestinationColor('#5E6C84')).toEqual({ ok: true, color: '#5E6C84' });
    expect(resolveDestinationColor('#5e6c84')).toBe('#5E6C84');
  });
});

describe('validateDestinationEmoji', () => {
  it.each([
    ['📍', true],
    ['⭐', true],
    ['🍽️', true],
    ['👨‍👩‍👧‍👦', true], // ZWJ family
    ['🏳️‍🌈', true], // flag + ZWJ
    ['1️⃣', true], // keycap
    ['👍🏾', true], // skin tone
  ])('accepts %s', (emoji, ok) => {
    const v = validateDestinationEmoji(emoji);
    expect(v.ok).toBe(ok);
  });

  it.each([
    ['', 'empty'],
    // Multi-letter Latin → multi graphemes (Segmenter) or text (fallback).
    ['hello', 'multi'],
    ['x', 'text'],
    ['📍⭐', 'multi'],
    ['https://evil', 'url'],
    ['a'.repeat(40), 'oversize'],
  ])('rejects %s → %s', (raw, reason) => {
    const v = validateDestinationEmoji(raw);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      // 'hello' may be multi (Segmenter) or text depending on runtime.
      if (raw === 'hello') {
        expect(['multi', 'text']).toContain(v.reason);
      } else {
        expect(v.reason).toBe(reason);
      }
    }
  });

  it.each(['中', 'é', 'あ', '한', 'Ñ'])(
    'rejects ordinary non-ASCII text %s (not emoji)',
    (raw) => {
      const v = validateDestinationEmoji(raw);
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(['text', 'not_emoji']).toContain(v.reason);
      }
    },
  );
});

describe('validateDestinationColor', () => {
  it('accepts palette hex case-insensitively', () => {
    expect(validateDestinationColor('#f0883e')).toEqual({ ok: true, color: '#F0883E' });
    expect(validateDestinationColor('#E8543F')).toEqual({ ok: true, color: '#E8543F' });
  });

  it('rejects non-palette and garbage', () => {
    expect(validateDestinationColor('#FFFFFF').ok).toBe(false);
    expect(validateDestinationColor('red').ok).toBe(false);
    expect(validateDestinationColor('rgb(1,2,3)').ok).toBe(false);
    expect(validateDestinationColor(null).ok).toBe(false);
  });
});

describe('stable fallback', () => {
  it('null emoji/color resolve to stable defaults without requiring backfill', () => {
    expect(resolveDestinationEmoji(null)).toBe(DESTINATION_EMOJI_FALLBACK);
    expect(resolveDestinationColor(undefined)).toBe(DESTINATION_COLOR_FALLBACK);
  });

  it('maps non-preset emoji (valid Unicode) to safe display fallback', () => {
    // 🧭 removed from list; 😀 is valid emoji but not a destination preset
    expect(resolveDestinationEmoji('🧭')).toBe(DESTINATION_EMOJI_FALLBACK);
    expect(resolveDestinationEmoji('😀')).toBe(DESTINATION_EMOJI_FALLBACK);
    expect(resolveDestinationEmoji('📍')).toBe('📍');
  });
});
