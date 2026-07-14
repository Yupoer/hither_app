import { isOwnLocationChange } from '../utils/locationPolicy';

describe('isOwnLocationChange', () => {
  it('returns false without myUserId', () => {
    expect(
      isOwnLocationChange({ new: { user_id: 'u1' } }, null),
    ).toBe(false);
  });

  it('detects own upsert via new.user_id', () => {
    expect(
      isOwnLocationChange({ new: { user_id: 'me' }, old: { user_id: 'me' } }, 'me'),
    ).toBe(true);
  });

  it('does not ignore peer location events', () => {
    expect(
      isOwnLocationChange({ new: { user_id: 'peer' } }, 'me'),
    ).toBe(false);
  });

  it('detects own delete via old.user_id when new is empty', () => {
    expect(
      isOwnLocationChange({ new: null, old: { user_id: 'me' } }, 'me'),
    ).toBe(true);
  });
});
