/**
 * Pure decision for ActivityKit push-token events (#146).
 *
 * Accept only the exact active handle, or a verified current navigation session
 * when no handle is bound yet. Never persist a foreign activity id with another
 * activity's token.
 */

export type PushTokenAdoptionAction =
  | {
      action: 'adopt';
      activityId: string;
      pushToken: string;
      /** true when binding a recovered activity with no prior handle */
      observeExisting: boolean;
    }
  | { action: 'ignore'; reason: string };

export function decidePushTokenAdoption(opts: {
  eventActivityId: string;
  eventPushToken?: string | null;
  eventNavigationSessionId?: string | null;
  currentHandle: string | null;
  currentNavigationSessionId?: string | null;
}): PushTokenAdoptionAction {
  const activityId = opts.eventActivityId?.trim() ?? '';
  const pushToken = opts.eventPushToken?.trim() ?? '';
  if (!activityId || !pushToken) {
    return { action: 'ignore', reason: 'missing_id_or_token' };
  }

  const sameHandle = opts.currentHandle != null && opts.currentHandle === activityId;
  const sameNavSession =
    !!opts.eventNavigationSessionId
    && !!opts.currentNavigationSessionId
    && opts.eventNavigationSessionId === opts.currentNavigationSessionId;

  // Exact active handle: token rotation for the live activity.
  if (sameHandle) {
    return {
      action: 'adopt',
      activityId,
      pushToken,
      observeExisting: false,
    };
  }

  // No handle yet: only adopt when the event is for the current nav session.
  if (!opts.currentHandle) {
    if (!sameNavSession) {
      return { action: 'ignore', reason: 'null_handle_foreign_or_missing_session' };
    }
    return {
      action: 'adopt',
      activityId,
      pushToken,
      observeExisting: true,
    };
  }

  // Live handle A + event for B (even same session): do not switch or corrupt
  // the activityId/pushToken pairing.
  return { action: 'ignore', reason: 'foreign_handle' };
}
