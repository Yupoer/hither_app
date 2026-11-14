import AsyncStorage from '@react-native-async-storage/async-storage';

export const INVITE_CODE_LENGTH = 6;

export function normalizeInviteCode(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, INVITE_CODE_LENGTH);
}

export function readInviteLink(value: string, trustedOrigin: string | undefined): string | null {
  try {
    const url = new URL(value);
    const appLink = url.protocol === 'hither:' && url.hostname === 'join'
      && (url.pathname === '' || url.pathname === '/');
    const webLink = url.protocol === 'https:' && url.origin === trustedOrigin
      && (url.pathname === '/join' || url.pathname === '/join/');
    if ((!appLink && !webLink) || url.username || url.password || url.port || url.hash) return null;
    const codes = url.searchParams.getAll('code');
    const code = codes[0]?.replace(/-/g, '');
    return code && codes.length === 1 && /^[A-Z0-9]{6}$/i.test(code) ? code.toUpperCase() : null;
  } catch {
    return null;
  }
}

const lastTeamKey = (actorId: string) => `hither.last-active-team:${actorId}`;

export function readLastActiveTeam(actorId: string): Promise<string | null> {
  return AsyncStorage.getItem(lastTeamKey(actorId));
}

export function writeLastActiveTeam(actorId: string, groupId: string | null): Promise<void> {
  const key = lastTeamKey(actorId);
  return groupId === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, groupId);
}
