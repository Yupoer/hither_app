/**
 * Dual-path event identity for APNs/FCM data payloads.
 * Keep lockstep with mobile `buildAlignedNotificationEventId` /
 * `mapPushCategoryToEventKey` (apps/mobile/src/utils/notificationDeliveryPolicy.ts).
 *
 * Vectors: `eventId.vectors.json` — exercised by `eventId_test.ts` (Deno)
 * and mobile `notificationEventIdParity.test.ts` (Jest against mobile impl).
 */

export type EventIdPayload = {
  category: string;
  group_id: string;
  type?: string | null;
  sender_id?: string | null;
  entity_id?: string | null;
  destination_id?: string | null;
  member_id?: string | null;
  request_id?: string | null;
  status?: string | null;
  title?: string | null;
  version?: string | number | null;
};

export function mapPushCategoryToEventKey(
  category: string,
  type?: string | null,
): string {
  if (type === "request_start") return "route_request";
  switch (category) {
    case "leader_commands":
    case "follower_requests":
      return "quick_command";
    case "add_gathering":
      return "add_gathering";
    case "journey":
      return "journey";
    case "arrival":
      return "member_arrival";
    case "straggler":
      return "straggler";
    default:
      return category;
  }
}

export function eventIdFromPayload(payload: EventIdPayload): string {
  const event = mapPushCategoryToEventKey(payload.category, payload.type);
  const entity =
    payload.entity_id
    ?? payload.request_id
    ?? payload.destination_id
    ?? payload.member_id
    ?? (payload.type && payload.sender_id
      ? `${payload.type}:${payload.sender_id}`
      : null)
    ?? payload.status
    ?? payload.title
    ?? "";
  const isJourney = event === "journey";
  const entityId = isJourney ? (payload.status ?? entity) : entity;
  const senderId = isJourney ? "" : (payload.sender_id ?? "");
  const version = isJourney
    ? String(payload.status ?? payload.version ?? "")
    : (payload.version != null ? String(payload.version) : "");
  return [event, payload.group_id, entityId ?? "", senderId, version].join(":");
}
