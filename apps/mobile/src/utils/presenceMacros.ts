import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type NotificationPreferences,
} from '../types';

export type PresenceMacroKind = 'follow' | 'solo' | 'stealth';

export type PresenceMacroState = {
  solo: boolean;
  locationSharing: boolean;
  notifications: NotificationPreferences;
};

export const GROUP_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'leaderCommands',
  'journey',
  'addGathering',
];

export const ALL_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'addGathering',
  'leaderCommands',
  'followerRequests',
  'journey',
];

function allNotificationsOff(notifications: NotificationPreferences): boolean {
  return ALL_NOTIFICATION_CATEGORIES.every((key) => notifications[key] === false);
}

/** Restart derivation: stealth if location+notifs off, else solo, else follow. */
export function derivePresenceMacro(state: PresenceMacroState): PresenceMacroKind {
  if (!state.locationSharing && allNotificationsOff(state.notifications)) return 'stealth';
  if (state.solo) return 'solo';
  return 'follow';
}

export type PresenceMacroWrites = {
  solo?: boolean;
  locationSharing?: boolean;
  notifications?: Partial<NotificationPreferences>;
};

function pickNotificationDiff(
  current: NotificationPreferences,
  next: Partial<NotificationPreferences>,
): Partial<NotificationPreferences> | undefined {
  const diff: Partial<NotificationPreferences> = {};
  for (const key of Object.keys(next) as NotificationCategory[]) {
    if (current[key] !== next[key]) diff[key] = next[key];
  }
  return Object.keys(diff).length > 0 ? diff : undefined;
}

/**
 * Macros over existing controls. Already-matching writes are omitted so the
 * caller can skip RPCs (e.g. location already off → stealth only turns off
 * remaining notification categories).
 */
export function presenceMacroWrites(
  kind: PresenceMacroKind,
  current: PresenceMacroState,
): PresenceMacroWrites {
  const writes: PresenceMacroWrites = {};
  if (kind === 'follow') {
    if (current.solo) writes.solo = false;
    const notifications: Partial<NotificationPreferences> = {};
    for (const key of GROUP_NOTIFICATION_CATEGORIES) notifications[key] = true;
    const diff = pickNotificationDiff(current.notifications, notifications);
    if (diff) writes.notifications = diff;
  } else if (kind === 'solo') {
    if (!current.solo) writes.solo = true;
    const notifications: Partial<NotificationPreferences> = {};
    for (const key of GROUP_NOTIFICATION_CATEGORIES) notifications[key] = false;
    const diff = pickNotificationDiff(current.notifications, notifications);
    if (diff) writes.notifications = diff;
  } else {
    if (current.locationSharing) writes.locationSharing = false;
    const notifications: Partial<NotificationPreferences> = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    for (const key of ALL_NOTIFICATION_CATEGORIES) notifications[key] = false;
    const diff = pickNotificationDiff(current.notifications, notifications);
    if (diff) writes.notifications = diff;
  }
  return writes;
}
