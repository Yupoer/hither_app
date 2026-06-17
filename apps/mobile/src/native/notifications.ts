/**
 * Notifications boundary.
 *
 * The ONLY module that imports `expo-notifications`. Phase A: local
 * notifications + permission work in Expo Go. Remote push (APNs device
 * token) is NOT reliably available in Expo Go and is the native module's
 * job (`apps/mobile/modules/hither-notifications`, Phase B) — here
 * {@link getDevicePushToken} returns null and warns instead of throwing.
 *
 * Deciding WHEN to push / WHO to push is server-side (Supabase Edge Function
 * + APNs), out of this client boundary's scope.
 *
 * Phase B seam: the custom native module `HitherNotifications`
 * (`apps/mobile/modules/hither-notifications`) backs {@link getDevicePushToken}
 * on a Dev Build; absent in Expo Go, where it returns null.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Notifications from 'expo-notifications';

/** Custom native module; `null` in Expo Go / when not built. */
const HitherNotifications = requireOptionalNativeModule<{
  getDevicePushToken(): Promise<string | null>;
}>('HitherNotifications');

export interface LocalNotificationInput {
  title: string;
  body?: string;
  /** Arbitrary payload delivered back to {@link onNotificationReceived}. */
  data?: Record<string, unknown>;
}

export type NotificationSubscription = { remove: () => void };

/** Request notification permission. Returns true if granted. */
export async function requestPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Native device push token (APNs/FCM). Returns null in Expo Go or when
 * unavailable, so callers must treat remote push as best-effort until a
 * Dev Build with the native module ships.
 */
export async function getDevicePushToken(): Promise<string | null> {
  if (HitherNotifications) {
    try {
      return await HitherNotifications.getDevicePushToken();
    } catch {
      // fall through to the Expo implementation
    }
  }
  try {
    const granted = await requestPermission();
    if (!granted) {
      return null;
    }
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' ? token.data : String(token.data);
  } catch {
    console.warn(
      '[native/notifications] device push token unavailable (expected in Expo Go)',
    );
    return null;
  }
}

/**
 * Subscribe to notifications received while the app is foregrounded.
 * Returns a handle whose `.remove()` ends the subscription.
 */
export function onNotificationReceived(
  callback: (notification: Notifications.Notification) => void,
): NotificationSubscription {
  return Notifications.addNotificationReceivedListener(callback);
}

/**
 * Fire a local notification immediately (null trigger). Returns the
 * scheduled notification id.
 */
export async function scheduleLocalNotification(
  input: LocalNotificationInput,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: { title: input.title, body: input.body, data: input.data ?? {} },
    trigger: null,
  });
}
