import {
  KmlImportError,
  kmlImportErrorI18nKey,
  normalizeImportBatch,
} from '../utils/kmlBatch';
import { positionForBatchAppendOnDay } from '../utils/tripDay';

describe('normalizeImportBatch', () => {
  it('keeps file order and trims titles', () => {
    const out = normalizeImportBatch([
      { name: '  A ', latitude: 25.1, longitude: 121.1 },
      { name: 'B', latitude: 25.2, longitude: 121.2 },
    ]);
    expect(out).toEqual([
      { title: 'A', latitude: 25.1, longitude: 121.1 },
      { title: 'B', latitude: 25.2, longitude: 121.2 },
    ]);
  });

  it('rejects empty batch and invalid coords without DB I/O', () => {
    expect(() => normalizeImportBatch([])).toThrow(KmlImportError);
    try {
      normalizeImportBatch([{ name: 'x', latitude: 999, longitude: 0 }]);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(KmlImportError);
      expect((e as KmlImportError).stage).toBe('validation');
      expect((e as KmlImportError).code).toBe('invalid_coords');
    }
  });
});

describe('kmlImportErrorI18nKey', () => {
  it('never maps persistence to parseError', () => {
    expect(kmlImportErrorI18nKey(new KmlImportError('persistence', 'x'))).toBe(
      'kml.errPersistence',
    );
    expect(kmlImportErrorI18nKey(new Error('network request failed'))).toBe(
      'kml.errPersistence',
    );
    expect(kmlImportErrorI18nKey(new KmlImportError('permission', '42501'))).toBe(
      'kml.errPermission',
    );
  });
});

describe('positionForBatchAppendOnDay', () => {
  it('computes single shift of +N for later rows', () => {
    const existing = [
      { id: 'a', order: 0, day: 1 },
      { id: 'b', order: 1, day: 1 },
      { id: 'c', order: 2, day: 2 },
    ];
    const plan = positionForBatchAppendOnDay(existing, 1, 3);
    expect(plan.insertStart).toBe(2);
    expect(plan.positions).toEqual([2, 3, 4]);
    expect(plan.shifts).toEqual([{ id: 'c', from: 2, to: 5 }]);
  });
});
