import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  ingestLocationBatch,
  type LocationBatchResult,
} from '../api/services/LocationService';
import type { Coordinates } from '../types';
import type { TrackingMode } from '../utils/locationPolicy';
import { getHitherDatabase } from './hitherDatabase';

export const LOCATION_OUTBOX_KEY = '@hither/location-outbox';
const TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_BATCH = 10;
const MAX_BACKOFF_MS = 15 * 60 * 1_000;

export type UploadTrackingMode = Exclude<TrackingMode, 'hidden'>;
export type LocationUploadSource =
  | 'foreground'
  | 'background_task'
  | 'refresh_request'
  | 'location_push';

export interface LocationUploadEvent {
  id: string;
  groupId: string;
  navigationSessionId: string | null;
  capturedAt: number;
  coords: Coordinates & {
    accuracy: number;
    speed?: number | null;
    course?: number | null;
  };
  trackingMode: UploadTrackingMode;
  source: LocationUploadSource;
  sequence: number;
}

export interface LocationOutboxEntry extends LocationUploadEvent {
  attempts: number;
  nextAttemptAt: number;
  expiresAt: number;
}

export interface LocationOutboxDatabase {
  initialize(): Promise<void>;
  insert(entry: LocationOutboxEntry): Promise<void>;
  removeExpired(now: number): Promise<void>;
  getDue(now: number, limit: number): Promise<LocationOutboxEntry[]>;
  resolveBatch(
    acceptedIds: string[],
    failed: Array<Pick<LocationOutboxEntry, 'id' | 'attempts' | 'nextAttemptAt'>>,
  ): Promise<void>;
  count(): Promise<number>;
  purge(): Promise<void>;
}

interface LegacyStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

interface LegacyEntry {
  id?: string;
  groupId?: string;
  coordinates?: Coordinates;
  capturedAt?: number;
  attempts?: number;
  nextAttemptAt?: number;
  expiresAt?: number;
}

interface LegacyEnqueueInput {
  id?: string;
  groupId: string;
  navigationSessionId?: string | null;
  coordinates: Coordinates & Partial<Pick<LocationUploadEvent['coords'], 'accuracy' | 'speed' | 'course'>>;
  capturedAt?: number;
  trackingMode?: UploadTrackingMode;
  source?: LocationUploadSource;
  sequence?: number;
}

type LocationOutboxUploader = (
  events: LocationUploadEvent[],
) => Promise<LocationBatchResult>;

interface LocationOutboxRow {
  id: string;
  group_id: string;
  navigation_session_id: string | null;
  captured_at: number;
  payload: string;
  sequence: number;
  attempts: number;
  next_attempt_at: number;
  expires_at: number;
}

function payloadOf(entry: LocationOutboxEntry): string {
  return JSON.stringify({
    coords: entry.coords,
    trackingMode: entry.trackingMode,
    source: entry.source,
  });
}

function eventOf(entry: LocationOutboxEntry): LocationUploadEvent {
  const { attempts: _attempts, nextAttemptAt: _next, expiresAt: _expires, ...event } = entry;
  return event;
}

function rowToEntry(row: LocationOutboxRow): LocationOutboxEntry {
  const payload = JSON.parse(row.payload) as Pick<
    LocationUploadEvent,
    'coords' | 'trackingMode' | 'source'
  >;
  return {
    id: row.id,
    groupId: row.group_id,
    navigationSessionId: row.navigation_session_id,
    capturedAt: row.captured_at,
    sequence: row.sequence,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    expiresAt: row.expires_at,
    ...payload,
  };
}

export class SQLiteLocationOutboxDatabase implements LocationOutboxDatabase {
  constructor(private readonly openDatabase: () => Promise<SQLiteDatabase> = getHitherDatabase) {}

  async initialize(): Promise<void> {
    await this.openDatabase();
  }

  async insert(entry: LocationOutboxEntry): Promise<void> {
    const database = await this.openDatabase();
    await database.runAsync(
      `INSERT OR IGNORE INTO location_outbox
       (id, group_id, navigation_session_id, captured_at, payload, sequence,
        attempts, next_attempt_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.groupId,
      entry.navigationSessionId,
      entry.capturedAt,
      payloadOf(entry),
      entry.sequence,
      entry.attempts,
      entry.nextAttemptAt,
      entry.expiresAt,
    );
  }

  async removeExpired(now: number): Promise<void> {
    const database = await this.openDatabase();
    await database.runAsync('DELETE FROM location_outbox WHERE expires_at <= ?', now);
  }

  async getDue(now: number, limit: number): Promise<LocationOutboxEntry[]> {
    const database = await this.openDatabase();
    const rows = await database.getAllAsync<LocationOutboxRow>(
      `SELECT * FROM location_outbox
       WHERE next_attempt_at <= ?
       ORDER BY captured_at ASC, sequence ASC
       LIMIT ?`,
      now,
      limit,
    );
    return rows.map(rowToEntry);
  }

  async resolveBatch(
    acceptedIds: string[],
    failed: Array<Pick<LocationOutboxEntry, 'id' | 'attempts' | 'nextAttemptAt'>>,
  ): Promise<void> {
    const database = await this.openDatabase();
    await database.withTransactionAsync(async () => {
      for (const id of acceptedIds) {
        await database.runAsync('DELETE FROM location_outbox WHERE id = ?', id);
      }
      for (const entry of failed) {
        await database.runAsync(
          `UPDATE location_outbox
           SET attempts = ?, next_attempt_at = ?
           WHERE id = ?`,
          entry.attempts,
          entry.nextAttemptAt,
          entry.id,
        );
      }
    });
  }

  async count(): Promise<number> {
    const database = await this.openDatabase();
    const row = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM location_outbox',
    );
    return row?.count ?? 0;
  }

  async purge(): Promise<void> {
    const database = await this.openDatabase();
    await database.runAsync('DELETE FROM location_outbox');
  }
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeInput(
  input: LocationUploadEvent | LegacyEnqueueInput,
  now: number,
): LocationUploadEvent {
  if ('coords' in input) return input;
  const capturedAt = input.capturedAt ?? now;
  return {
    id: input.id ?? Crypto.randomUUID(),
    groupId: input.groupId,
    navigationSessionId: input.navigationSessionId ?? null,
    capturedAt,
    coords: {
      latitude: input.coordinates.latitude,
      longitude: input.coordinates.longitude,
      accuracy: input.coordinates.accuracy ?? 0,
      speed: input.coordinates.speed,
      course: input.coordinates.course,
    },
    trackingMode: input.trackingMode ?? 'foreground',
    source: input.source ?? 'foreground',
    sequence: input.sequence ?? capturedAt,
  };
}

function legacyToEvent(value: unknown): LocationUploadEvent | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as LegacyEntry;
  if (
    typeof entry.groupId !== 'string' ||
    !isFiniteCoordinate(entry.coordinates?.latitude) ||
    !isFiniteCoordinate(entry.coordinates?.longitude) ||
    !isFiniteCoordinate(entry.capturedAt)
  ) return null;
  return {
    id: isUuid(entry.id) ? entry.id : Crypto.randomUUID(),
    groupId: entry.groupId,
    navigationSessionId: null,
    capturedAt: entry.capturedAt,
    coords: { ...entry.coordinates, accuracy: 0 },
    trackingMode: 'foreground',
    source: 'foreground',
    sequence: entry.capturedAt,
  };
}

export function createLocationOutbox(
  database: LocationOutboxDatabase,
  upload: LocationOutboxUploader,
  now: () => number = Date.now,
  legacyStorage?: LegacyStorage,
) {
  let serial = Promise.resolve();
  let initialization: Promise<void> | null = null;

  const runSerial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = serial.then(operation, operation);
    serial = next.then(() => undefined, () => undefined);
    return next;
  };

  const initialize = (): Promise<void> => {
    if (!initialization) {
      initialization = (async () => {
        await database.initialize();
        if (!legacyStorage) return;
        const raw = await legacyStorage.getItem(LOCATION_OUTBOX_KEY);
        if (raw) {
          try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              for (const value of parsed) {
                const event = legacyToEvent(value);
                if (!event || event.capturedAt + TTL_MS <= now()) continue;
                await database.insert({
                  ...event,
                  attempts: 0,
                  nextAttemptAt: now(),
                  expiresAt: event.capturedAt + TTL_MS,
                });
              }
            }
          } finally {
            await legacyStorage.removeItem(LOCATION_OUTBOX_KEY);
          }
        }
      })().catch((error) => {
        initialization = null;
        throw error;
      });
    }
    return initialization;
  };

  return {
    initialize,

    enqueue(input: LocationUploadEvent | LegacyEnqueueInput): Promise<void> {
      return runSerial(async () => {
        await initialize();
        const current = now();
        const event = normalizeInput(input, current);
        await database.insert({
          ...event,
          attempts: 0,
          nextAttemptAt: current,
          expiresAt: event.capturedAt + TTL_MS,
        });
      });
    },

    flush(maxEntries = MAX_BATCH): Promise<{ sent: number; remaining: number }> {
      return runSerial(async () => {
        await initialize();
        const current = now();
        await database.removeExpired(current);
        const due = await database.getDue(current, Math.max(0, maxEntries));
        if (due.length === 0) return { sent: 0, remaining: await database.count() };

        let result: LocationBatchResult;
        try {
          result = await upload(due.map(eventOf));
        } catch {
          result = { acceptedIds: [], rejected: [] };
        }

        const dueIds = new Set(due.map((entry) => entry.id));
        const accepted = new Set(
          result.acceptedIds.filter((id) => dueIds.has(id)),
        );
        const failed = due
          .filter((entry) => !accepted.has(entry.id))
          .map((entry) => {
            const attempts = entry.attempts + 1;
            return {
              id: entry.id,
              attempts,
              nextAttemptAt: current + Math.min(MAX_BACKOFF_MS, 2 ** attempts * 1_000),
            };
          });
        await database.resolveBatch([...accepted], failed);
        return { sent: accepted.size, remaining: await database.count() };
      });
    },

    purge(): Promise<void> {
      return runSerial(async () => {
        await initialize();
        await database.purge();
      });
    },
  };
}

const outbox = createLocationOutbox(
  new SQLiteLocationOutboxDatabase(),
  ingestLocationBatch,
  Date.now,
  AsyncStorage,
);

export function enqueueLocationOutbox(
  input: LocationUploadEvent | LegacyEnqueueInput,
): Promise<void> {
  return outbox.enqueue(input);
}

export function flushLocationOutbox(
  maxEntries = MAX_BATCH,
): Promise<{ sent: number; remaining: number }> {
  return outbox.flush(maxEntries);
}

export function purgeLocationOutbox(): Promise<void> {
  return outbox.purge();
}
