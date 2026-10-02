import * as Crypto from 'expo-crypto';
import { supabaseAuthStorage } from './authStorage';
import { supabase } from './supabase';
import { getSharedLiveActivityTokenGate } from '../utils/liveActivityTokenGate';

let deviceIdPromise: Promise<string> | null = null;
let writes: Promise<unknown> = Promise.resolve();
let generation = 0;
let blocked = false;
let authChanges: Promise<unknown> = Promise.resolve();

export function changeAuthSession<T>(operation: () => Promise<T>, revoke = true, signOutOnFailure = true): Promise<T> {
  const pending = authChanges.then(async () => {
    if (revoke) await revokeInstallationCapabilities();
    const finishFailedTransition = async () => {
      if (!revoke || !signOutOnFailure) return;
      const ended = await supabase.auth.signOut({ scope: 'local' });
      if (ended.error) throw new Error('Authentication failed. Device notifications were revoked; retry sign-out or sign in again.');
    };
    let result: T;
    try { result = await operation(); }
    catch (error) { await finishFailedTransition(); throw error; }
    if ((result as { error?: unknown } | null)?.error) await finishFailedTransition();
    return result;
  });
  authChanges = pending.catch(() => undefined);
  return pending;
}

export function getInstallationId(): Promise<string> {
  if (!deviceIdPromise) deviceIdPromise = (async () => {
    const stored = await supabaseAuthStorage.getItem('hither.live-activity-device-id');
    if (stored) return stored;
    const created = Crypto.randomUUID();
    await supabaseAuthStorage.setItem('hither.live-activity-device-id', created);
    return created;
  })().catch(error => { deviceIdPromise = null; throw error; });
  return deviceIdPromise;
}

export function resumeInstallationCapabilities(): void { blocked = false; }

export function writeInstallationCapability<T>(actorId: string, write: (deviceId: string) => Promise<T>): Promise<T | undefined> {
  const epoch = generation;
  const pending = writes.then(async () => {
    if (blocked || epoch !== generation) return undefined;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id !== actorId || blocked || epoch !== generation) return undefined;
    const id = await getInstallationId();
    if (blocked || epoch !== generation) return undefined;
    return write(id);
  });
  writes = pending.catch(() => undefined);
  return pending;
}

export async function revokeInstallationCapabilities(): Promise<void> {
  blocked = true;
  generation += 1;
  await writes;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) return;
  const deviceId = await getInstallationId();
  const { notifications, liveActivity } = await import('../native');
  // Legacy rows predate installation IDs. Match only this device's native tokens/handles.
  const token = await notifications.getDevicePushToken();
  const activities = await liveActivity.listGroupActivities();
  const revoked = await supabase.rpc('revoke_installation_capabilities', {
    p_device_id: deviceId, p_push_token: token,
    p_activity_ids: activities.map(activity => activity.activityId),
  });
  if (revoked.error) throw revoked.error;
  const gate = getSharedLiveActivityTokenGate();
  await gate.ready();
  gate.reset();
}
