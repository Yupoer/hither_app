import { resolveMascot } from '../onboarding/content';

describe('resolveMascot', () => {
  const cases: Array<[string, string]> = [
    ['AAA', 'collie'],
    ['BAA', 'collie'],
    ['AAB', 'retriever'],
    ['ABB', 'retriever'],
    ['BBA', 'koala'],
    ['BBB', 'koala'],
    ['ABA', 'cat'],
    ['BAB', 'cat'],
  ];

  it.each(cases)('maps %s -> %s', (combo, expected) => {
    const [F1, F2, F3] = combo.split('') as ('A' | 'B')[];
    expect(resolveMascot({ F1, F2, F3 })).toBe(expected);
  });

  it('throws when an answer is missing', () => {
    expect(() => resolveMascot({ F1: 'A', F2: 'A' })).toThrow();
  });
});
