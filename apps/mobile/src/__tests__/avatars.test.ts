import { AVATAR_EMOJI, avatarForUser } from '../constants/avatars';

describe('avatarForUser', () => {
  it('is deterministic for the same id', () => {
    expect(avatarForUser('user-abc')).toBe(avatarForUser('user-abc'));
  });

  it('always returns one of the catalogue emoji', () => {
    for (const id of ['', 'a', 'user-123', 'zzzzzzzz', '🙂', 'uuid-xyz']) {
      expect(AVATAR_EMOJI).toContain(avatarForUser(id));
    }
  });

  it('spreads different ids across the catalogue (not all one emoji)', () => {
    const picks = new Set(
      Array.from({ length: 60 }, (_, i) => avatarForUser(`user-${i}`)),
    );
    expect(picks.size).toBeGreaterThan(1);
  });
});
