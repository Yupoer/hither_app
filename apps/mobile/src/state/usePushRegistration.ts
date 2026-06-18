import { useEffect } from 'react';
import { notifications } from '../native';
import { savePushToken } from '../api/client';
import { useSession } from './SessionContext';

/**
 * Register this device for APNs once a user is signed in.
 *
 * Requests notification permission, fetches the native device push token
 * (`native/notifications` — backed by the HitherNotifications module on a Dev
 * Build; null in Expo Go), and persists it to `push_tokens` so the server's
 * send-push Edge Function knows where to deliver. Safe everywhere: the token is
 * null off a Dev Build, and `savePushToken(null)` is a no-op.
 *
 * Keyed on the user id so a fresh sign-in re-registers; one-shot per user.
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
        if (active) await savePushToken(token);
      } catch {
        // Best-effort: remote push simply stays unavailable for this session.
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);
}
