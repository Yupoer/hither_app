export function isExpiredPush(payload: { expires_at?: string | null }, now = Date.now()): boolean {
  if (payload.expires_at == null) return false;
  const expiresAt = Date.parse(payload.expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}
