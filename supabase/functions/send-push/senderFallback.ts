export type SenderRole = "leader" | "follower";

export interface SenderProfileLookupResult {
  data: { nickname?: unknown } | null;
  error: unknown | null;
}

export type SenderProfileLookup = () => Promise<SenderProfileLookupResult>;

export function senderRoleFallback(role: SenderRole): string {
  return role === "leader" ? "隊長" : "成員";
}

export async function resolveSenderName(
  role: SenderRole,
  lookup: SenderProfileLookup,
  onLookupError: (error: unknown) => void = (error) => {
    console.warn("sender profile enrichment failed", error);
  },
): Promise<string> {
  try {
    const { data, error } = await lookup();
    if (error) {
      onLookupError(error);
      return senderRoleFallback(role);
    }
    const nickname = typeof data?.nickname === "string" ? data.nickname.trim() : "";
    return nickname || senderRoleFallback(role);
  } catch (error) {
    onLookupError(error);
    return senderRoleFallback(role);
  }
}

export async function deliverWithSenderFallback<
  T extends { sender_name?: string },
  R,
>(
  payload: T,
  role: SenderRole,
  lookup: SenderProfileLookup,
  deliver: (payload: T) => Promise<R>,
  onLookupError?: (error: unknown) => void,
): Promise<R> {
  const senderName = await resolveSenderName(role, lookup, onLookupError);
  return deliver({ ...payload, sender_name: senderName });
}
