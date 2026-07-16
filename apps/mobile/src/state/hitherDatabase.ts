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
