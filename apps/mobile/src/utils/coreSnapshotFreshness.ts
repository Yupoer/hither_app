import type {
  CoreGroupSnapshot,
  CoreSnapshotFreshness,
  CoreSnapshotReadOutcome,
} from '../types/coreData';

/** Snapshots older than this are presented as stale (still readable offline). */
export const CORE_SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1_000;
/** Beyond fresh window, still readable but shown as aging. */
export const CORE_SNAPSHOT_AGING_MS = 30 * 60 * 1_000;

export function coreSnapshotFreshness(
  snapshot: CoreGroupSnapshot | null | undefined,
  nowMs: number,
): CoreSnapshotFreshness {
  if (!snapshot) return { unit: 'missing' };
  const ageMs = Math.max(0, nowMs - snapshot.syncedAt);
  if (ageMs >= CORE_SNAPSHOT_STALE_MS) return { unit: 'stale', ageMs };
  if (ageMs >= CORE_SNAPSHOT_AGING_MS) return { unit: 'aging', ageMs };
  return { unit: 'fresh' };
}

export function classifySnapshotRead(
  snapshot: CoreGroupSnapshot | null | undefined,
  nowMs: number,
): CoreSnapshotReadOutcome {
  if (!snapshot) return { kind: 'empty' };
  const freshness = coreSnapshotFreshness(snapshot, nowMs);
  if (freshness.unit === 'stale') {
    return { kind: 'stale', snapshot, ageMs: freshness.ageMs };
  }
  return { kind: 'hit', snapshot };
}

/** Human-readable age for banners (locale-neutral numbers). */
export function formatSnapshotAgeMs(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
