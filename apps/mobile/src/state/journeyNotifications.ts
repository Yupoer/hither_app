import AsyncStorage from '@react-native-async-storage/async-storage';
import { APPROACH_FIRED_STORAGE_KEY, approachNotifyKey, approachNotifyCopy, shouldFireApproachNotify, type ApproachNotifyInput } from '../utils/approachNotify';
import { getNotificationPreferences } from '../api/services/NotificationService';
import type { TranslationKey } from '../i18n';
import { notifications } from '../native';
import { deliverJourneyEventOnce } from './journeyNotificationLedger';

const delivered = new Set<string>();
const inFlight = new Set<string>();

/** Only called after a server-confirmed operator action. Failed delivery can retry. */
export async function notifyJourneyOperator(
  action: 'start' | 'pause',
  destinationId: string,
  eventId: string,
  t: (key: TranslationKey) => string,
): Promise<void> {
  if (delivered.has(eventId) || inFlight.has(eventId)) return;
  inFlight.add(eventId);
  try {
    if (!(await getNotificationPreferences()).journey) return;
    await deliverJourneyEventOnce(`operator:${eventId}`, async () => {
      const id = await notifications.scheduleLocalNotification({
        title: t(action === 'start' ? 'notif.operatorStartTitle' : 'notif.operatorPauseTitle'),
        body: t(action === 'start' ? 'notif.operatorStartBody' : 'notif.operatorPauseBody'),
        data: { kind: 'operatorJourneyConfirm', destinationId, eventId },
      });
      if (id) {
        delivered.add(eventId);
        if (delivered.size > 400) delivered.delete(delivered.values().next().value!);
      }
      return id;
    });
  } finally {
    inFlight.delete(eventId);
  }
}

/** Shared foreground/background dedupe; suppressed alerts do not consume delivery. */
export async function notifyJourneyApproach(
  sessionId: string | null | undefined, destinationId: string, title: string, input: ApproachNotifyInput,
): Promise<void> {
  if (!shouldFireApproachNotify(input)) return;
  const key = approachNotifyKey(sessionId, destinationId);
  if (inFlight.has(key) || delivered.has(key)) return;
  inFlight.add(key);
  try {
    const raw = await AsyncStorage.getItem(APPROACH_FIRED_STORAGE_KEY);
    let keys: string[] = [];
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) keys = parsed.filter((value): value is string => typeof value === 'string');
      } catch { /* Legacy cache corruption does not disable the durable ledger. */ }
    }
    if (keys.includes(key)) return;
    await deliverJourneyEventOnce(`approach:${key}`, async () => {
      const id = await notifications.scheduleLocalNotification({
        ...approachNotifyCopy(title), data: { kind: 'approach', destinationId },
      });
      if (!id) return null;
      delivered.add(key);
      if (delivered.size > 400) delivered.delete(delivered.values().next().value!);
      // Read legacy delivery keys for migration only. The shared ledger already
      // persisted this claim before dispatch; a second write after scheduling
      // could fail and incorrectly revoke an already-delivered notification.
      return id;
    });
  } finally { inFlight.delete(key); }
}
