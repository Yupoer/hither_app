import type { PushPayload } from "./messages.ts";

export function locationRefreshRecipientIds(
  payload: Pick<PushPayload, "category" | "sender_id" | "recipient_ids">,
): string[] {
  if (payload.category !== "location_refresh" || !Array.isArray(payload.recipient_ids)) {
    return [];
  }
  return [...new Set(
    payload.recipient_ids.filter((userId) => userId.length > 0 && userId !== payload.sender_id),
  )];
}

export function requestStartRecipientIds<
  T extends { user_id: string; role: string },
>(payload: PushPayload, members: T[]): string[] | null {
  if (
    payload.category !== "follower_requests" ||
    payload.type !== "request_start"
  ) {
    return null;
  }
  return members
    .filter((member) => member.role === "leader")
    .filter((member) => member.user_id !== payload.sender_id)
    .map((member) => member.user_id);
}

/**
 * Leader-only recipient set for arrival / leave-style events.
 * Mirrors client `notificationDeliveryPolicy` leader_only kind.
 */
export function leaderOnlyRecipientIds<
  T extends { user_id: string; role: string; solo?: boolean },
>(
  payload: Pick<PushPayload, "sender_id">,
  members: T[],
  options?: { excludeSolo?: boolean },
): string[] {
  return members
    .filter((member) => member.role === "leader")
    .filter((member) => member.user_id !== payload.sender_id)
    .filter((member) => (options?.excludeSolo ? !member.solo : true))
    .map((member) => member.user_id);
}

/** When non-null, replaces the default alert candidate pipeline. */
export function specialAlertRecipientIds<
  T extends { user_id: string; role: string; solo?: boolean },
>(payload: PushPayload, members: T[]): string[] | null {
  if (payload.category === "arrival") {
    return leaderOnlyRecipientIds(payload, members, { excludeSolo: true });
  }
  const requestStart = requestStartRecipientIds(payload, members);
  if (requestStart) return requestStart;
  return null;
}
