import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateMyLocation } from '../api/services/LocationService';
import type { Coordinates } from '../types';

export const LOCATION_OUTBOX_KEY = '@hither/location-outbox';
const MAX_ENTRIES = 100;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BATCH = 10;

export interface LocationOutboxEntry {
  id: string;
  groupId: string;
  coordinates: Coordinates;
  capturedAt: number;
  attempts: number;
  nextAttemptAt: number;
  expiresAt: number;
}

export interface LocationOutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type LocationOutboxUploader = (
  entry: LocationOutboxEntry,
) => Promise<void>;

function entryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validEntry(value: unknown): value is LocationOutboxEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LocationOutboxEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.groupId === 'string' &&
    typeof entry.coordinates?.latitude === 'number' &&
    typeof entry.coordinates?.longitude === 'number' &&
    Number.isFinite(entry.capturedAt) &&
    Number.isFinite(entry.attempts) &&
    Number.isFinite(entry.nextAttemptAt) &&
    Number.isFinite(entry.expiresAt)
  );
}

/**
 * Small durable queue used by foreground and background callbacks.
 * ponytail: AsyncStorage keeps this O(n); move to SQLite when history or
 * throughput makes the 100-entry cap observable.
 */
export function createLocationOutbox(
  storage: LocationOutboxStorage,
  upload: LocationOutboxUploader,
  now: () => number = Date.now,
) {
  let serial = Promise.resolve();

  const runSerial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = serial.then(operation, operation);
    serial = next.then(() => undefined, () => undefined);
    return next;
  };

  const read = async (): Promise<LocationOutboxEntry[]> => {
    const raw = await storage.getItem(LOCATION_OUTBOX_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(validEntry) : [];
    } catch {
      return [];
    }
  };

  const write = (entries: LocationOutboxEntry[]): Promise<void> =>
    storage.setItem(LOCATION_OUTBOX_KEY, JSON.stringify(entries));

  return {
    enqueue(input: {
      groupId: string;
      coordinates: Coordinates;
      capturedAt?: number;
    }): Promise<void> {
      return runSerial(async () => {
        const capturedAt = input.capturedAt ?? now();
        const entries = await read();
        entries.push({
          id: entryId(),
          groupId: input.groupId,
          coordinates: input.coordinates,
          capturedAt,
          attempts: 0,
          nextAttemptAt: now(),
          expiresAt: capturedAt + TTL_MS,
        });
        await write(entries.slice(-MAX_ENTRIES));
      });
    },

    flush(maxEntries = MAX_BATCH): Promise<{ sent: number; remaining: number }> {
      return runSerial(async () => {
        const current = now();
        let entries = (await read()).filter((entry) => entry.expiresAt > current);
        let sent = 0;

        for (const entry of [...entries]
          .filter((item) => item.nextAttemptAt <= current)
          .sort((a, b) => a.capturedAt - b.capturedAt)
          .slice(0, maxEntries)) {
          try {
            await upload(entry);
            entries = entries.filter((item) => item.id !== entry.id);
            sent += 1;
            await write(entries);
          } catch {
            const attempts = entry.attempts + 1;
            const retryDelay = Math.min(15 * 60_000, 2 ** attempts * 1_000);
            entries = entries.map((item) =>
              item.id === entry.id
                ? {
                    ...item,
                    attempts,
                    nextAttemptAt: current + retryDelay,
                  }
                : item,
            );
            await write(entries);
            // A network failure will affect the rest of the batch too.
            break;
          }
        }

        await write(entries);
        return { sent, remaining: entries.length };
      });
    },
  };
}

const outbox = createLocationOutbox(
  AsyncStorage,
  (entry) => updateMyLocation(entry.coordinates, entry.groupId),
);

export function enqueueLocationOutbox(input: {
  groupId: string;
  coordinates: Coordinates;
  capturedAt?: number;
}): Promise<void> {
  return outbox.enqueue(input);
}

export function flushLocationOutbox(
  maxEntries = MAX_BATCH,
): Promise<{ sent: number; remaining: number }> {
  return outbox.flush(maxEntries);
}
