import type { PushPayload } from "./messages.ts";

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
    .map((member) => member.user_id);
}
