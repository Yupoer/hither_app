import { AVATAR_EMOJI, avatarForGroup, avatarForUser, displayMemberAvatar } from '../constants/avatars';

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

describe('displayMemberAvatar', () => {
  it('uses stored catalogue emoji and otherwise hashes the userId', () => {
    expect(displayMemberAvatar('🐑', 'user-abc').emoji).toBe('🐑');
    expect(displayMemberAvatar('', 'user-abc').emoji).toBe(avatarForUser('user-abc'));
    expect(displayMemberAvatar(null, 'user-abc').emoji).toBe(avatarForUser('user-abc'));
    expect(displayMemberAvatar('not-an-emoji', 'user-abc').emoji).toBe(avatarForUser('user-abc'));
  });

  it('does not use initials for a known userId', () => {
    const shown = displayMemberAvatar(undefined, 'user-abc').emoji;
    expect(shown).not.toBe('U');
    expect(AVATAR_EMOJI).toContain(shown);
  });
});

describe('avatarForGroup', () => {
  it('is stable per group and independent of a user id', () => {
    expect(avatarForGroup('group-a')).toBe(avatarForGroup('group-a'));
    expect(AVATAR_EMOJI).toContain(avatarForGroup('group-a'));
    expect(avatarForGroup('group-a')).not.toBe(avatarForUser('group-a'));
  });
});
