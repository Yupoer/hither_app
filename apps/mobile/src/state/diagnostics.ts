import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  ingestDiagnosticBatch,
  type DiagnosticBatchResult,
  type DiagnosticUploadMetadata,
} from '../api/services/DiagnosticService';
import { getDiagnosticConsentEnabled } from './diagnosticConsent';
import { getHitherDatabase } from './hitherDatabase';
import { notifyLogRecorded } from './logBatchScheduler';

const RETENTION_MS = 72 * 60 * 60 * 1_000;
const MAX_RECORDS = 10_000;
const MAX_UPLOAD_BATCH = 100;

type DiagnosticValue = string | number | boolean;
export type DiagnosticPayload = Record<string, DiagnosticValue>;
export type DiagnosticMode = 'minimal' | 'verbose';

export interface DiagnosticInput {
  event: string;
  navigationSessionId?: string | null;
  errorCode?: string;
  trackingMode?: string;
  source?: string;
  reason?: string;
  count?: number;
  durationMs?: number;
  accuracyM?: number;
  distanceM?: number;
  appState?: string;
  permissionStatus?: string;
  sequence?: number;
  sent?: number;
  remaining?: number;
  mode?: string;
  status?: string;
  success?: boolean;
  expectedVersion?: number;
  updateId?: string;
  runtimeVersion?: string;
  appVersion?: string;
}

export interface DiagnosticRecord {
  id: string;
  timestamp: number;
  sessionId: string;
  event: string;
  navigationSessionId: string | null;
  payload: DiagnosticPayload;
  attempts: number;
  uploadedAt: number | null;
}

export interface DiagnosticSummary {
  total: number;
  pending: number;
  lastTimestamp: number | null;
  byEvent: Record<string, number>;
}

export interface DiagnosticDatabase {
  initialize(): Promise<void>;
  insert(record: DiagnosticRecord): Promise<void>;
  cleanup(cutoff: number, maximum: number): Promise<void>;
  list(limit: number): Promise<DiagnosticRecord[]>;
  getPending(limit: number): Promise<DiagnosticRecord[]>;
  resolveUpload(
    acceptedIds: string[],
    failedIds: string[],
    uploadedAt: number,
  ): Promise<void>;
  pendingCount(): Promise<number>;
  purgeUnuploaded(): Promise<void>;
}

interface DiagnosticRow {
  id: string;
  timestamp: number;
  session_id: string;
  event: string;
  navigation_session_id: string | null;
  payload: string;
  attempts: number;
  uploaded_at: number | null;
}

function rowToRecord(row: DiagnosticRow): DiagnosticRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    sessionId: row.session_id,
    event: row.event,
    navigationSessionId: row.navigation_session_id,
    payload: JSON.parse(row.payload) as DiagnosticPayload,
    attempts: row.attempts,
    uploadedAt: row.uploaded_at,
  };
}

export class SQLiteDiagnosticDatabase implements DiagnosticDatabase {
  constructor(private readonly openDatabase: () => Promise<SQLiteDatabase> = getHitherDatabase) {}

  async initialize(): Promise<void> {
    await this.openDatabase();
  }

  async insert(record: DiagnosticRecord): Promise<void> {
    const database = await this.openDatabase();
    await database.runAsync(
      `INSERT OR IGNORE INTO diagnostic_events
       (id, timestamp, session_id, event, navigation_session_id, payload, attempts, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.timestamp,
      record.sessionId,
      record.event,
      record.navigationSessionId,
      JSON.stringify(record.payload),
      record.attempts,
      record.uploadedAt,
    );
  }

  async cleanup(cutoff: number, maximum: number): Promise<void> {
    const database = await this.openDatabase();
    await database.withTransactionAsync(async () => {
      await database.runAsync('DELETE FROM diagnostic_events WHERE timestamp < ?', cutoff);
      await database.runAsync(
        `DELETE FROM diagnostic_events
         WHERE id IN (
           SELECT id FROM diagnostic_events
           ORDER BY timestamp DESC
           LIMIT -1 OFFSET ?
         )`,
        maximum,
      );
    });
  }

  async list(limit: number): Promise<DiagnosticRecord[]> {
    const database = await this.openDatabase();
    const rows = await database.getAllAsync<DiagnosticRow>(
      `SELECT * FROM diagnostic_events
       ORDER BY timestamp ASC
       LIMIT ?`,
      limit,
    );
    return rows.map(rowToRecord);
  }

  async getPending(limit: number): Promise<DiagnosticRecord[]> {
    const database = await this.openDatabase();
    const rows = await database.getAllAsync<DiagnosticRow>(
      `SELECT * FROM diagnostic_events
       WHERE uploaded_at IS NULL
       ORDER BY timestamp ASC
       LIMIT ?`,
      limit,
    );
    return rows.map(rowToRecord);
  }

  async resolveUpload(
    acceptedIds: string[],
    failedIds: string[],
    uploadedAt: number,
  ): Promise<void> {
    const database = await this.openDatabase();
    await database.withTransactionAsync(async () => {
      for (const id of acceptedIds) {
        await database.runAsync(
          'UPDATE diagnostic_events SET uploaded_at = ? WHERE id = ?',
          uploadedAt,
          id,
        );
      }
      for (const id of failedIds) {
        await database.runAsync(
          'UPDATE diagnostic_events SET attempts = attempts + 1 WHERE id = ?',
          id,
        );
      }
    });
  }

  async pendingCount(): Promise<number> {
    const database = await this.openDatabase();
    const row = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM diagnostic_events WHERE uploaded_at IS NULL',
    );
    return row?.count ?? 0;
  }

  async purgeUnuploaded(): Promise<void> {
    const database = await this.openDatabase();
    await database.runAsync(
      'DELETE FROM diagnostic_events WHERE uploaded_at IS NULL',
    );
  }
}

const ALLOWED_FIELDS = [
  'errorCode',
  'trackingMode',
  'source',
  'reason',
  'count',
  'durationMs',
  'accuracyM',
  'distanceM',
  'appState',
  'permissionStatus',
  'sequence',
  'sent',
  'remaining',
  'mode',
  'status',
  'success',
  'expectedVersion',
  'updateId',
  'runtimeVersion',
  'appVersion',
] as const;

function sanitize(input: DiagnosticInput): DiagnosticPayload {
  const payload: DiagnosticPayload = {};
  for (const field of ALLOWED_FIELDS) {
    const value = input[field];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) payload[field] = value;
  }
  return payload;
}

type DiagnosticUploader = (
  records: DiagnosticRecord[],
  metadata: DiagnosticUploadMetadata,
) => Promise<DiagnosticBatchResult>;

export function createDiagnostics(
  database: DiagnosticDatabase,
  upload: DiagnosticUploader,
  now: () => number,
  metadata: DiagnosticUploadMetadata & { sessionId: string },
  uuid: () => string,
  mode: DiagnosticMode = 'verbose',
) {
  let initialization: Promise<void> | null = null;
  let serial = Promise.resolve();

  const initialize = (): Promise<void> => {
    if (!initialization) initialization = database.initialize();
    return initialization;
  };

  const runSerial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = serial.then(operation, operation);
    serial = next.then(() => undefined, () => undefined);
    return next;
  };

  const cleanup = async (): Promise<void> => {
    await database.cleanup(now() - RETENTION_MS, MAX_RECORDS);
  };

  const list = async (limit = MAX_RECORDS): Promise<DiagnosticRecord[]> => {
    await initialize();
    await cleanup();
    return database.list(Math.min(MAX_RECORDS, Math.max(0, limit)));
  };

  return {
    write(input: DiagnosticInput): Promise<void> {
      return runSerial(async () => {
        if (!(await getDiagnosticConsentEnabled())) return;
        await initialize();
        if (
          mode === 'minimal' &&
          input.event === 'location_callback' &&
          input.success !== false &&
          !input.errorCode
        ) return;
        const timestamp = now();
        await database.insert({
          id: uuid(),
          timestamp,
          sessionId: metadata.sessionId,
          event: input.event,
          navigationSessionId: input.navigationSessionId ?? null,
          payload: sanitize(input),
          attempts: 0,
          uploadedAt: null,
        });
        await database.cleanup(timestamp - RETENTION_MS, MAX_RECORDS);
        notifyLogRecorded();
      });
    },

    list,

    flush(): Promise<{ sent: number; remaining: number }> {
      return runSerial(async () => {
        if (!(await getDiagnosticConsentEnabled())) {
          return { sent: 0, remaining: 0 };
        }
        await initialize();
        const pending = await database.getPending(MAX_UPLOAD_BATCH);
        if (pending.length === 0) {
          await cleanup();
          return { sent: 0, remaining: 0 };
        }
        let result: DiagnosticBatchResult;
        try {
          result = await upload(pending, metadata);
        } catch {
          result = { acceptedIds: [], rejected: [] };
        }
        const pendingIds = new Set(pending.map((record) => record.id));
        const acceptedIds = result.acceptedIds.filter((id) => pendingIds.has(id));
        const accepted = new Set(acceptedIds);
        const failedIds = pending
          .filter((record) => !accepted.has(record.id))
          .map((record) => record.id);
        await database.resolveUpload(acceptedIds, failedIds, now());
        await cleanup();
        return {
          sent: acceptedIds.length,
          remaining: await database.pendingCount(),
        };
      });
    },

    async purge(): Promise<void> {
      await initialize();
      await database.purgeUnuploaded();
    },

    async summary(): Promise<DiagnosticSummary> {
      const records = await list();
      return {
        total: records.length,
        pending: records.filter((record) => record.uploadedAt === null).length,
        lastTimestamp: records.at(-1)?.timestamp ?? null,
        byEvent: records.reduce<Record<string, number>>((counts, record) => {
          counts[record.event] = (counts[record.event] ?? 0) + 1;
          return counts;
        }, {}),
      };
    },

    async exportJson(): Promise<string> {
      const records = await list();
      return JSON.stringify({
        schemaVersion: 1,
        generatedAt: now(),
        metadata,
        records,
      });
    },
  };
}

const metadata = {
  sessionId: Crypto.randomUUID(),
  deviceId: Constants.sessionId || 'unknown-device',
  buildNumber: Constants.nativeBuildVersion ?? 'development',
  appVersion: Constants.expoConfig?.version ?? 'development',
};

export const diagnostics = createDiagnostics(
  new SQLiteDiagnosticDatabase(),
  ingestDiagnosticBatch,
  Date.now,
  metadata,
  Crypto.randomUUID,
  process.env.EXPO_PUBLIC_DIAGNOSTIC_LEVEL === 'verbose' ||
    (typeof __DEV__ !== 'undefined' && __DEV__)
    ? 'verbose'
    : 'minimal',
);
