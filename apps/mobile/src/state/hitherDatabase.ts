import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'hither.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openHitherDatabase(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS location_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL,
      navigation_session_id TEXT,
      captured_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS location_outbox_due
      ON location_outbox(next_attempt_at, captured_at, sequence);
    CREATE TABLE IF NOT EXISTS diagnostic_events (
      id TEXT PRIMARY KEY NOT NULL,
      timestamp INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      event TEXT NOT NULL,
      navigation_session_id TEXT,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      uploaded_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS diagnostic_events_pending
      ON diagnostic_events(uploaded_at, timestamp);
    CREATE TABLE IF NOT EXISTS performance_events (
      id TEXT PRIMARY KEY NOT NULL,
      timestamp INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      uploaded_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS performance_events_pending
      ON performance_events(uploaded_at, timestamp);

    -- OTA-04: first-batch local-first core data
    CREATE TABLE IF NOT EXISTS core_snapshots (
      group_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      entity_version INTEGER NOT NULL DEFAULT 1,
      synced_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS core_active_gathering (
      group_id TEXT PRIMARY KEY NOT NULL,
      journey_phase TEXT NOT NULL,
      active_destination_id TEXT,
      point_statuses TEXT NOT NULL,
      phase_changed_at INTEGER NOT NULL,
      entity_version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS core_navigation_responses (
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      response TEXT,
      entity_version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS core_navigation_responses_group
      ON core_navigation_responses(group_id, session_id);
    CREATE TABLE IF NOT EXISTS core_operation_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_version INTEGER NOT NULL,
      operation_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      conflict_result TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS core_operation_outbox_due
      ON core_operation_outbox(next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS core_operation_outbox_group
      ON core_operation_outbox(group_id, status);
  `);
  return database;
}

export function initializeHitherDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) databasePromise = openHitherDatabase();
  return databasePromise;
}

export function getHitherDatabase(): Promise<SQLite.SQLiteDatabase> {
  return initializeHitherDatabase();
}
