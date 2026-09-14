/** Stable device preference key. */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LOCATION_SHARING_KEY = 'pref.sharingEnabled';

/** Pre-navigation-session builds used this key; keep it for one-way migration. */
export const LEGACY_LOCATION_SHARING_KEY = 'pref.locationSharing';

// Process-local on purpose: a background cold launch must never resurrect GPS.
let foregroundSeen = false;
let group: string | null = null;
let consent = false;
let generation = 0;
let cancellation = new AbortController();
const listeners = new Set<() => void>();
const consentListeners = new Set<(enabled: boolean) => void>();

function invalidateAccess() {
  generation += 1;
  cancellation.abort();
  cancellation = new AbortController();
  for (const listener of listeners) listener();
}

export function setLocationSharingConsent(enabled: boolean): void {
  if (consent === enabled) return;
  consent = enabled;
  invalidateAccess();
  for (const listener of consentListeners) listener(enabled);
}

export function subscribeLocationSharingConsent(listener: (enabled: boolean) => void): () => void {
  consentListeners.add(listener);
  return () => { consentListeners.delete(listener); };
}

export function locationConsentRevision(): number { return generation; }

/** Called only by a mounted, authenticated foreground/team screen. */
export function setLocationAccessContext(groupId: string | null, enabled: boolean, foreground = false): void {
  if (foreground) foregroundSeen = true;
  const changed = group !== groupId || consent !== enabled;
  group = groupId;
  consent = enabled;
  if (changed) invalidateAccess();
}

export function subscribeLocationAccessChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export interface LocationAccess {
  generation: number;
  groupId: string;
  signal: AbortSignal;
}

export function isLocationAccessEnabled(): boolean {
  return foregroundSeen && consent && group !== null;
}

export function isLocationAccessCurrent(access: LocationAccess): boolean {
  return foregroundSeen && consent && group === access.groupId
    && generation === access.generation && !access.signal.aborted;
}

export async function captureLocationAccess(groupId?: string, requirePermission = false): Promise<LocationAccess | null> {
  if (!foregroundSeen || !consent || !group || (groupId && groupId !== group)) return null;
  const access = { generation, groupId: group, signal: cancellation.signal };
  try {
    const stored = await AsyncStorage.getItem(LOCATION_SHARING_KEY);
    if (requirePermission) {
      const { getForegroundPermissionsAsync } = await import('expo-location');
      if ((await getForegroundPermissionsAsync()).status !== 'granted') return null;
    }
    return stored !== 'false' && isLocationAccessCurrent(access) ? access : null;
  } catch {
    return null;
  }
}
