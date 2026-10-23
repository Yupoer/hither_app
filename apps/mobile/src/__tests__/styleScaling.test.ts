import { applyAppTextScale, applyBoldTextWeights } from '../utils/styleScaling';

const emojiKeys = new Set(['avatar']);

it('scales text without changing emoji glyphs, layout dimensions, or the original styles', () => {
  const defs = { title: { fontSize: 15, padding: 8 }, avatar: { fontSize: 24 }, shell: { width: 40 } };
  const scaled = applyAppTextScale(defs, 1.25, emojiKeys);
  expect(scaled.title).toEqual({ fontSize: 19, padding: 8 });
  expect(scaled.avatar).toBe(defs.avatar);
  expect(scaled.shell).toBe(defs.shell);
  expect(defs.title.fontSize).toBe(15);
});

it.each([1, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('keeps style identity for unusable or unchanged text scale %s', scale => {
  const defs = { title: { fontSize: 15 } };
  expect(applyAppTextScale(defs, scale, emojiKeys)).toBe(defs);
});

it('reduces heavy text weights for system Bold Text and preserves emoji and normal text', () => {
  const defs = {
    heading: { fontWeight: '700', fontSize: 18 }, strong: { fontWeight: 'bold' },
    numeric: { fontWeight: 700 }, body: { fontWeight: '500' }, avatar: { fontWeight: '700' },
    empty: null,
  };
  const weighted = applyBoldTextWeights(defs, true, emojiKeys);
  expect(weighted.heading).toEqual({ fontWeight: '600', fontSize: 18 });
  expect(weighted.strong.fontWeight).toBe('600');
  expect(weighted.numeric.fontWeight).toBe('600');
  expect(weighted.body).toBe(defs.body);
  expect(weighted.avatar).toBe(defs.avatar);
  expect(weighted.empty).toBeNull();
  expect(defs.heading.fontWeight).toBe('700');
});

it('keeps style identity when system Bold Text is off', () => {
  const defs = { title: { fontWeight: '700' } };
  expect(applyBoldTextWeights(defs, false, emojiKeys)).toBe(defs);
});
