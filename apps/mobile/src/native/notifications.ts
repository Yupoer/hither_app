/**
 * Notifications boundary.
 *
 * The ONLY module that imports `expo-notifications`. Phase A: local
 * notifications + permission work in Expo Go. Remote push (APNs/FCM device
 * token) is NOT available in Android Expo Go — skip before calling remote
 * token APIs and warn once to use a development build.
 *
 * Deciding WHEN to push / WHO to push is server-side (Supabase Edge Function
 * + APNs/FCM), out of this client boundary's scope.
 *
 * Phase B seam: the custom native module `HitherNotifications`
 * (`apps/mobile/modules/hither-notifications`) backs {@link getDevicePushToken}
 * on a Dev Build; absent in Expo Go, where it returns null.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Custom native module; `null` in Expo Go / when not built. */
const HitherNotifications = requireOptionalNativeModule<{
  getDevicePushToken?: () => Promise<string | null>;
}>('HitherNotifications');

let warnedAndroidExpoGoRemotePush = false;

function isAndroidExpoGo(): boolean {
  if (Platform.OS !== 'android') return false;
  return (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    Constants.appOwnership === 'expo'
  );
}

function warnAndroidExpoGoRemotePushOnce(): void {
  if (warnedAndroidExpoGoRemotePush) return;
  warnedAndroidExpoGoRemotePush = true;
  console.warn(
    '[native/notifications] Android Expo Go does not support remote push notifications. ' +
      'Use an Android development build (expo run:android / EAS dev client).',
  );
}

export interface LocalNotificationInput {
  title: string;
  body?: string;
  /** Arbitrary payload delivered with the notification. */
  data?: Record<string, unknown>;
}

// Foreground presentation: without a handler, iOS suppresses notifications
// while the app is open. The interim local-notification flow (realtime event ->
// local notification) needs them visible in-app too, so always show a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Request notification permission. Returns true if granted. */
export async function requestPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Native device push token (APNs/FCM). Returns null in Expo Go or when
 * unavailable, so callers must treat remote push as best-effort until a
 * Dev Build with the native module ships.
 *
 * Optional `HitherNotifications` is used only when it returns a non-empty
 * string. null / empty / missing methods fall through to expo-notifications
 * (FCM on Android, APNs on iOS). Android 13+ notification permission is
 * requested once via requestPermission(); denial returns null without retry
 * loops in this function.
 */
export async function getDevicePushToken(): Promise<string | null> {
  if (isAndroidExpoGo()) {
    warnAndroidExpoGoRemotePushOnce();
    return null;
  }

  if (HitherNotifications) {
    try {
      const fromNative = await HitherNotifications.getDevicePushToken?.();
      if (typeof fromNative === 'string' && fromNative.trim().length > 0) {
        return fromNative.trim();
      }
      // null / empty: fall through to Expo (FCM/APNs).
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
 * Fire a local notification immediately (null trigger). Requests permission
 * first (same as scheduleLocalNotificationAt) so denied OS settings soft-fail
 * instead of throwing. Returns the scheduled id, or null if permission denied
 * / schedule failed. Callers must not block critical work on notify success.
 */
export async function scheduleLocalNotification(
  input: LocalNotificationInput,
): Promise<string | null> {
  try {
    if (!(await requestPermission())) {
      return null;
    }
    return await Notifications.scheduleNotificationAsync({
      content: { title: input.title, body: input.body, data: input.data ?? {} },
      trigger: null,
    });
  } catch {
    console.warn('[native/notifications] scheduleLocalNotification failed');
    return null;
  }
}

/**
 * This-device alert when the leader auto-completes a gathering stop.
 *
 * Spec:
 * - Android → always local notification
 * - iOS → APNs / existing push path when a device token is registered
 *   (`complete_gathering_stop` notifies the acting leader via `target_user_id`);
 *   local notification only as fallback when no token (Expo Go / permission)
 *
 * Platform branching lives in this native boundary — UI screens must not call
 * `Platform.OS` for this decision.
 *
 * @returns which path was used (for contracts / diagnostics)
 */
export async function notifyThisDeviceAutoComplete(
  input: LocalNotificationInput,
): Promise<'local' | 'remote_expected' | 'none'> {
  try {
    if (Platform.OS === 'android') {
      const id = await scheduleLocalNotification(input);
      return id ? 'local' : 'none';
    }

    // iOS: prefer remote APNs when the device already registered a push token.
    const token = await getDevicePushToken();
    if (token) {
      // Remote path is owned by complete_gathering_stop → notify_push → APNs.
      // Do not also schedule local (avoids double banners).
      return 'remote_expected';
    }

    // No token (Expo Go / denied): local fallback so the leader still gets feedback.
    const id = await scheduleLocalNotification(input);
    return id ? 'local' : 'none';
  } catch {
    console.warn('[native/notifications] notifyThisDeviceAutoComplete failed');
    return 'none';
  }
}

/**
 * Schedule a local notification to fire AT a future date (OS-scheduled, so it
 * fires even if the app is backgrounded or closed — the OS also vibrates per
 * the user's notification settings). Returns the id, or null if the date is
 * already past / permission was denied. Used for gathering-point meet times.
 */
export async function scheduleLocalNotificationAt(
  input: LocalNotificationInput,
  date: Date,
): Promise<string | null> {
  if (date.getTime() <= Date.now()) {
    return null;
  }
  try {
    if (!(await requestPermission())) {
      return null;
    }
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
  } catch {
    console.warn('[native/notifications] scheduleLocalNotificationAt failed');
    return null;
  }
}

/** Cancel a previously-scheduled local notification. Safe to call with a stale id. */
export async function cancelScheduledNotification(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // already fired / unknown id — nothing to do
  }
}

/**
 * Subscribe to notifications arriving while the app is foregrounded. Returns an
 * unsubscribe function. Lets the UI add an in-app buzz on top of the OS banner.
 */
export function addForegroundListener(
  handler: (data: Record<string, unknown>) => void,
): () => void {
  const sub = Notifications.addNotificationReceivedListener((n) => {
    handler((n.request.content.data ?? {}) as Record<string, unknown>);
  });
  return () => sub.remove();
}
