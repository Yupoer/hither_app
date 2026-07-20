import { useEffect } from 'react';
import { Platform } from 'react-native';
import { notifications } from '../native';
import { savePushToken } from '../api/client';
import { useSession } from './SessionContext';

export type PushPlatform = 'ios' | 'android';

/**
 * Register this device for remote push once a user is signed in.
 *
 * Requests notification permission, fetches the native device push token
 * (APNs on iOS / FCM on Android via expo-notifications, with optional native
 * module fall-through), and upserts it to `push_tokens` with `platform` so
 * send-push can fan out to APNs or FCM. Safe everywhere: null token is a no-op.
 *
 * Keyed on the user id so a fresh sign-in re-registers; one-shot per user.
 * Logout does not delete server tokens — dead tokens are pruned by provider
 * responses in send-push.
 */
export function usePushRegistration(): void {
  const { user } = useSession();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      try {
        await notifications.requestPermission();
        const token = await notifications.getDevicePushToken();
        const platform: PushPlatform =
          Platform.OS === 'android' ? 'android' : 'ios';
        if (active) await savePushToken(token, platform);
      } catch {
        // Best-effort: remote push simply stays unavailable for this session.
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);
}
