import Database from 'better-sqlite3-multiple-ciphers'
import { app } from 'electron'
import { copyFileSync, existsSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { runMigrations } from './migrations'
import {
  clearLocalDbKey,
  createRandomDbKeyHex,
  getLocalDbKeyOrThrow,
  hasLocalDbKey,
  storeLocalDbKey
} from '../security/dbKey'

let db: Database.Database | null = null

export type WalCheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE'

function ensureValidDbKeyHex(dbKeyHex: string): void {
  if (!/^[a-f0-9]{64}$/i.test(dbKeyHex)) {
    throw new Error('数据库密钥无效')
  }
}

function applySqlCipherPragmas(currentDb: Database.Database): void {
  currentDb.pragma('cipher_page_size = 4096')
  currentDb.pragma('kdf_iter = 256000')
  currentDb.pragma('cipher_hmac_algorithm = HMAC_SHA512')
  currentDb.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
}

function applySqlCipherKey(currentDb: Database.Database, dbKeyHex: string): void {
  ensureValidDbKeyHex(dbKeyHex)
  currentDb.pragma(`key = "x'${dbKeyHex}'"`)
  applySqlCipherPragmas(currentDb)
}

function configureDatabasePragmas(currentDb: Database.Database): void {
  // Performance & integrity pragmas
  currentDb.pragma('journal_mode = WAL')
  currentDb.pragma('foreign_keys = ON')
  currentDb.pragma('busy_timeout = 5000')
}

function verifyDatabaseKey(currentDb: Database.Database): void {
  currentDb.prepare('SELECT COUNT(*) as count FROM sqlite_master').get()
}

function verifyEncryptedDatabaseFile(dbPath: string, dbKeyHex: string): void {
  const verifyDb = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    applySqlCipherKey(verifyDb, dbKeyHex)
    verifyDatabaseKey(verifyDb)
  } finally {
    verifyDb.close()
  }
}

export function verifyDatabaseFileWithKey(dbPath: string, dbKeyHex: string): void {
  verifyEncryptedDatabaseFile(dbPath, dbKeyHex)
}

function deleteIfExists(path: string): void {
  if (!existsSync(path)) return
  rmSync(path, { recursive: true, force: true })
}

function clearWalFiles(dbPath: string): void {
  deleteIfExists(`${dbPath}-wal`)
  deleteIfExists(`${dbPath}-shm`)
}

function restoreDatabaseFromRollback(dbPath: string, rollbackPath: string): void {
  if (!existsSync(rollbackPath)) return
  deleteIfExists(dbPath)
  clearWalFiles(dbPath)
  renameSync(rollbackPath, dbPath)
  clearWalFiles(dbPath)
}

function preparePlaintextDatabaseForMigration(dbPath: string): void {
  const plaintextDb = new Database(dbPath)
  try {
    plaintextDb.pragma('busy_timeout = 5000')
    plaintextDb.pragma('wal_checkpoint(TRUNCATE)')
    plaintextDb.pragma('journal_mode = DELETE')
  } finally {
    plaintextDb.close()
  }
}

function migratePlaintextDatabase(dbPath: string, dbKeyHex: string): void {
  ensureValidDbKeyHex(dbKeyHex)
  const rollbackPath = `${dbPath}.rollback-${Date.now()}`

  try {
    preparePlaintextDatabaseForMigration(dbPath)
    copyFileSync(dbPath, rollbackPath)

    const plaintextDb = new Database(dbPath)
    try {
      plaintextDb.pragma('busy_timeout = 5000')
      applySqlCipherPragmas(plaintextDb)
      plaintextDb.pragma(`rekey = "x'${dbKeyHex}'"`)
    } finally {
      plaintextDb.close()
    }

    verifyEncryptedDatabaseFile(dbPath, dbKeyHex)

    deleteIfExists(rollbackPath)
  } catch (error) {
    try {
      restoreDatabaseFromRollback(dbPath, rollbackPath)
    } catch {
      // Ignore rollback recovery errors and rethrow the original migration error.
    }
    throw error
  }
}

function resolveDatabaseKey(dbPath: string): string {
  if (hasLocalDbKey()) {
    return getLocalDbKeyOrThrow()
  }

  const keyHex = createRandomDbKeyHex()
  if (existsSync(dbPath)) {
    storeLocalDbKey(keyHex)
    try {
      migratePlaintextDatabase(dbPath, keyHex)
    } catch (error) {
      clearLocalDbKey()
      throw error
    }
    return keyHex
  }

  storeLocalDbKey(keyHex)
  return keyHex
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'diary.db')
  const dbKeyHex = resolveDatabaseKey(dbPath)

  db = new Database(dbPath)
  applySqlCipherKey(db, dbKeyHex)
  verifyDatabaseKey(db)
  configureDatabasePragmas(db)

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
