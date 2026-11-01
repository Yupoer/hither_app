// Frozen foreground handler from master 1e59472809f67f8bbc4b4156ab8b0c707546f631.
// The notification SDK and OS are supplied by the behavior test.
import { shouldDeliverOnce } from '../../utils/notificationDeliveryPolicy';

export function legacyForegroundHandler(Notifications: { setNotificationHandler: (handler: { handleNotification: (notification: { request: { identifier: string; content: { data: Record<string, unknown>; title?: string; body?: string } } }) => Promise<unknown> }) => void }, Platform: { OS: string }, AppState: { currentState: string }, showAppNotice: (notice: unknown) => void) {
const presentedEvents = new Set<string>();
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    if (data?.category === 'arrival') {
      // Old-account tokens may still receive delayed push. Never present an
      // arrival without a recipient matching the current authenticated actor.
      const { requireLocalActorId } = await import('../../api/services/_helpers');
      const actor = await requireLocalActorId().catch(() => null);
      if (!actor || data.recipientId !== actor) return {
        shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
      };
    }
    const eventId = data?.eventId;
    const show = !(Platform.OS === 'ios' && notification.request.content.data?.kind === 'approach') && shouldDeliverOnce(
      presentedEvents, typeof eventId === 'string' ? eventId : null, 'device',
    );
    const content = notification.request.content;
    const arrivalInApp = show && AppState.currentState === 'active'
      && content.data?.category === 'arrival';
    if (arrivalInApp) showAppNotice({
      id: `arrival:${typeof eventId === 'string' ? eventId : notification.request.identifier}`,
      title: content.title ?? '', message: content.body ?? undefined,
    });
    return {
      shouldShowBanner: show && !arrivalInApp,
      shouldShowList: show && !arrivalInApp,
      shouldPlaySound: show,
      shouldSetBadge: false,
    };
  },
});

}
