import { getNotificationPreferences } from '../api/services/NotificationService';
import type { TranslationKey } from '../i18n';
import { notifications } from '../native';

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
    const id = await notifications.scheduleLocalNotification({
      title: t(action === 'start' ? 'notif.operatorStartTitle' : 'notif.operatorPauseTitle'),
      body: t(action === 'start' ? 'notif.operatorStartBody' : 'notif.operatorPauseBody'),
      data: { kind: 'operatorJourneyConfirm', destinationId, eventId },
    });
    if (id) {
      delivered.add(eventId);
      if (delivered.size > 400) delivered.delete(delivered.values().next().value!);
    }
  } finally {
    inFlight.delete(eventId);
  }
}
