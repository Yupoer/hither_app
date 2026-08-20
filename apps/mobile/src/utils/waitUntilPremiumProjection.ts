import type { PremiumProjection } from '../entitlements';

export function isPremiumProjectionActive(projection: Pick<
  PremiumProjection,
  'personalPremiumActive' | 'teamPremiumActive'
>): boolean {
  return Boolean(projection.personalPremiumActive || projection.teamPremiumActive);
}

/**
 * Keep purchase loading up until Apple + verify-and-apply + refresh show
 * personal or team premium. Client-only native success is not enough.
 */
export async function waitUntilPremiumProjectionActive(options: {
  groupId?: string | null;
  getPremiumProjection: (groupId?: string | null) => Promise<PremiumProjection>;
  alreadyActive?: boolean;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  if (options.alreadyActive) return true;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 400;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    const projection = await options.getPremiumProjection(options.groupId);
    if (isPremiumProjectionActive(projection)) return true;
    if (now() + intervalMs > deadline) break;
    await sleep(intervalMs);
  }
  return false;
}
