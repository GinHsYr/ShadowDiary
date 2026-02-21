import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export type WalCheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE'

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'diary.db')

  db = new Database(dbPath)

  // Performance & integrity pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  runMigrations(db)
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function checkpointDatabase(mode: WalCheckpointMode = 'TRUNCATE'): void {
  const currentDb = getDatabase()
  currentDb.pragma(`wal_checkpoint(${mode})`)
}
