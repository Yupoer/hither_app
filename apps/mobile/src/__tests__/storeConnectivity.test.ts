import {
  getNavigatorOnline,
  isDefinitelyOffline,
} from '../store/connectivity';

describe('store connectivity helpers', () => {
  it('isDefinitelyOffline only true when online === false', () => {
    expect(isDefinitelyOffline(false)).toBe(true);
    expect(isDefinitelyOffline(true)).toBe(false);
    expect(isDefinitelyOffline(null)).toBe(false);
  });

  it('getNavigatorOnline is boolean or null (no throw in node)', () => {
    const v = getNavigatorOnline();
    expect(v === null || typeof v === 'boolean').toBe(true);
  });
});
