/**
 * Per-category notification preferences.
 *
 * Each category can be toggled independently. Stored server-side (table
 * `notification_preferences`) — NOT just device-local — because the APNs Edge
 * Function filters recipients by these flags before sending, so the decision of
 * "should this user get this push" is authoritative on the server.
 *
 * Categories map 1:1 to the push trigger categories (migration 20260619000000):
 *   add_gathering     新增集合點
 *   leader_commands   隊長指令
 *   follower_requests 成員快捷請求
 *   journey           行程開始/暫停
 */
export interface NotificationPreferences {
  addGathering: boolean;
  leaderCommands: boolean;
  followerRequests: boolean;
  journey: boolean;
}

export type NotificationCategory = keyof NotificationPreferences;

/** Defaults when the user has no stored row yet: everything on. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  addGathering: true,
  leaderCommands: true,
  followerRequests: true,
  journey: true,
};
