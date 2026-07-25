/**
 * Local handling state for organizer exceptions (open / acknowledged / resolved).
 * Survives refresh via AsyncStorage; does not mutate team phase or member rows.
 *
 * Writes are serialized per groupId so concurrent markHandled calls cannot
 * drop updates (read-modify-write races).
 *
 * Storage is already scoped by groupId. We intentionally do NOT wipe handling
 * when the session key flips nav:→dest: for the same gathering stop — that
 * would erase ack/resolve while the leader is still working the episode.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  ExceptionAction,
  ExceptionHandlingMap,
} from '../utils/organizerExceptions';
import { transitionExceptionHandling } from '../utils/organizerExceptions';

export function exceptionHandlingStorageKey(groupId: string): string {
  return `hither.exceptionHandling.${groupId}`;
}

/** In-memory cache per group so rebuilds stay sync after first hydrate. */
const cache = new Map<string, ExceptionHandlingMap>();
const hydratePromises = new Map<string, Promise<ExceptionHandlingMap>>();
/** Per-group write chain — each mutation awaits the previous. */
const writeChains = new Map<string, Promise<unknown>>();

function isHandlingMap(value: unknown): value is ExceptionHandlingMap {
  if (!value || typeof value !== 'object') return false;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as { status?: unknown; updatedAt?: unknown };
    if (
      e.status !== 'open' &&
      e.status !== 'acknowledged' &&
      e.status !== 'resolved'
    ) {
      return false;
    }
    if (typeof e.updatedAt !== 'string') return false;
  }
  return true;
}

function enqueueWrite<T>(groupId: string, task: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(groupId) ?? Promise.resolve();
  const next = prev.then(task, task);
  // Keep chain alive even if task rejects so later writes still run.
  writeChains.set(
    groupId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export function getCachedExceptionHandling(groupId: string): ExceptionHandlingMap {
  return cache.get(groupId) ?? {};
}

export async function loadExceptionHandling(
  groupId: string,
): Promise<ExceptionHandlingMap> {
  if (cache.has(groupId)) return cache.get(groupId)!;
  const existing = hydratePromises.get(groupId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(exceptionHandlingStorageKey(groupId));
      if (!raw) {
        cache.set(groupId, {});
        return {};
      }
      const parsed: unknown = JSON.parse(raw);
      const map = isHandlingMap(parsed) ? parsed : {};
      cache.set(groupId, map);
      return map;
    } catch {
      cache.set(groupId, {});
      return {};
    } finally {
      hydratePromises.delete(groupId);
    }
  })();

  hydratePromises.set(groupId, promise);
  return promise;
}

export async function saveExceptionHandling(
  groupId: string,
  map: ExceptionHandlingMap,
): Promise<void> {
  cache.set(groupId, map);
  await AsyncStorage.setItem(
    exceptionHandlingStorageKey(groupId),
    JSON.stringify(map),
  );
}

/**
 * Apply one handling action. Serialized per group so parallel ack/resolve
 * cannot overwrite each other.
 */
export async function applyExceptionHandlingAction(
  groupId: string,
  rootCauseKey: string,
  action: ExceptionAction,
  nowIso: string = new Date().toISOString(),
): Promise<ExceptionHandlingMap> {
  return enqueueWrite(groupId, async () => {
    // Prefer in-memory cache after hydrate; load only when cold.
    const current = cache.has(groupId)
      ? cache.get(groupId)!
      : await loadExceptionHandling(groupId);
    const next = transitionExceptionHandling(current, rootCauseKey, action, nowIso);
    await saveExceptionHandling(groupId, next);
    return next;
  });
}

/** Drop resolved handling older than this (keeps storage bounded). */
export const HANDLING_RESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Soft prune within a group: storage is already group-keyed, so nav:↔dest:
 * flips for the same stop must not wipe recent ack/resolve.
 *
 * Retention rules:
 * - Always keep keys for the active session key and dest:{destinationId}
 * - Keep nav:* and group:{groupId} keys that are open/acknowledged
 * - Keep resolved entries only if updatedAt is within HANDLING_RESOLVED_TTL_MS
 * - Drop dest:* keys for other destinations
 * - Drop stale resolved nav:/group: entries past TTL
 */
export async function pruneExceptionHandlingForSession(
  groupId: string,
  activeSessionKey: string,
  options?: { destinationId?: string | null; nowMs?: number },
): Promise<ExceptionHandlingMap> {
  return enqueueWrite(groupId, async () => {
    const current = cache.has(groupId)
      ? cache.get(groupId)!
      : await loadExceptionHandling(groupId);
    const destinationId = options?.destinationId ?? null;
    const nowMs = options?.nowMs ?? Date.now();
    const next: ExceptionHandlingMap = {};

    for (const [key, entry] of Object.entries(current)) {
      const updatedMs = Date.parse(entry.updatedAt);
      const isResolved = entry.status === 'resolved';
      const resolvedStale =
        isResolved &&
        Number.isFinite(updatedMs) &&
        nowMs - updatedMs > HANDLING_RESOLVED_TTL_MS;

      if (resolvedStale) continue;

      const isActiveSession = key.startsWith(`${activeSessionKey}|`);
      const isActiveDest =
        !!destinationId && key.startsWith(`dest:${destinationId}|`);
      const isNav = key.startsWith('nav:');
      const isGroup = key.startsWith(`group:${groupId}|`);
      // Only drop dest keys for *other* destinations when we know the active dest.
      const isOtherDest =
        !!destinationId && key.startsWith('dest:') && !isActiveDest;

      if (isOtherDest) continue;

      if (isActiveSession || isActiveDest) {
        next[key] = entry;
        continue;
      }

      // Other nav:/group:/dest: (when dest unknown) keys: keep non-stale.
      if (isNav || isGroup || key.startsWith('dest:')) {
        next[key] = entry;
      }
    }

    if (Object.keys(next).length !== Object.keys(current).length) {
      await saveExceptionHandling(groupId, next);
    }
    return next;
  });
}

/** Test helper — clears module cache between Jest cases. */
export function __resetExceptionHandlingStoreForTests(): void {
  cache.clear();
  hydratePromises.clear();
  writeChains.clear();
}
