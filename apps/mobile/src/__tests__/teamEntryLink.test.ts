import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeInviteCode, readInviteLink, readLastActiveTeam, writeLastActiveTeam } from '../navigation/teamEntry';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const origin = 'https://hither-legal.test';

describe('team entry boundaries', () => {
  it('normalizes additions and pasted invite codes once', () => {
    expect(normalizeInviteCode(' test4-2abcde-fghjklmnp! ')).toBe('TEST42ABCDEFGHJKLMNP');
    expect(normalizeInviteCode('ABCDE')).toBe('ABCDE');
    expect(normalizeInviteCode('TEST42ABCDEFGHJKLMNPQ')).toBe('TEST42ABCDEFGHJKLMNP');
  });

  it('opens exact invite destinations, leaving OAuth callbacks and unknown hosts alone', () => {
    expect(readInviteLink('hither://join?code=TEST4-2ABCD-EFGHJ-KLMNP', origin)).toBe('TEST42ABCDEFGHJKLMNP');
    expect(readInviteLink(`${origin}/join?code=TEST42ABCDEFGHJKLMNP`, origin)).toBe('TEST42ABCDEFGHJKLMNP');
    expect(readInviteLink(`${origin}/auth/callback?code=TEST42ABCDEFGHJKLMNP`, origin)).toBeNull();
    expect(readInviteLink('https://unknown.test/join?code=TEST42ABCDEFGHJKLMNP', origin)).toBeNull();
    expect(readInviteLink('hither://join?code=TEST42ABCDEFGHJKLMNP&code=TEST42ABCDEFGHJKLMNQ', origin)).toBeNull();
    expect(readInviteLink('hither://join?code=TEST42ABCDEFGHJKLMNP#x', origin)).toBeNull();
    expect(readInviteLink('hither://join?code=TEST', origin)).toBeNull();
  });

  it('persists the active team for the selected account and clears it when the user returns to entry', async () => {
    await AsyncStorage.clear();
    await writeLastActiveTeam('a', 'team-a');
    await writeLastActiveTeam('b', 'team-b');
    await expect(readLastActiveTeam('a')).resolves.toBe('team-a');
    await expect(readLastActiveTeam('b')).resolves.toBe('team-b');
    await writeLastActiveTeam('a', null);
    await expect(readLastActiveTeam('a')).resolves.toBeNull();
    await expect(readLastActiveTeam('b')).resolves.toBe('team-b');
  });
});
