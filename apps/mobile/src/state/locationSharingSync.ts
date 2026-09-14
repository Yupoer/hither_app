import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocationSharingEnabled, setLocationSharingEnabled } from '../api/services/NavigationService';
import { LOCATION_SHARING_KEY, locationConsentRevision } from './locationPrivacy';

const KEY = '@hither/pending-location-sharing';
let serial = Promise.resolve();

export async function rememberLocationSharing(userId: string, enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify({ userId, enabled, version: Date.now() }));
}

/** Retry after foreground recovery / successful network sync, without a timer. */
export function syncLocationSharing(userId: string): Promise<void> {
  const run = serial.then(async () => {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const pending = JSON.parse(raw) as { userId: string; enabled: boolean };
    if (pending.userId !== userId) return;
    await setLocationSharingEnabled(pending.enabled, userId);
    if (await AsyncStorage.getItem(KEY) === raw) await AsyncStorage.removeItem(KEY);
  });
  serial = run.catch(() => undefined);
  return run;
}

export async function hydrateLocationSharing(userId: string): Promise<boolean | null> {
  const revision = locationConsentRevision();
  await syncLocationSharing(userId);
  const before = await AsyncStorage.getItem(LOCATION_SHARING_KEY);
  const remote = await getLocationSharingEnabled();
  // A remote snapshot must not undo a local stop (including an in-flight stop).
  const local = await AsyncStorage.getItem(LOCATION_SHARING_KEY);
  if (revision !== locationConsentRevision()) return null;
  if (before === 'false' || local === 'false') return false;
  if (remote == null) await setLocationSharingEnabled(true, userId);
  return remote !== false;
}
