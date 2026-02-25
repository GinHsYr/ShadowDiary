import type Database from 'better-sqlite3'
import { getDatabase, getRealDatabase } from './index'
import { collectImageIdsFromText, syncImageRefs } from './imageRefs'

function getSettingFromDb(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setSettingOnDb(db: Database.Database, key: string, value: string): string[] {
  const previous = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)

  if (key !== 'user.avatar') return []

  return syncImageRefs(collectImageIdsFromText(previous?.value), collectImageIdsFromText(value))
}

function getAllSettingsFromDb(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
}

export function getSetting(key: string): string | null {
  return getSettingFromDb(getDatabase(), key)
}

export function getRealSetting(key: string): string | null {
  return getSettingFromDb(getRealDatabase(), key)
}

export function setSetting(key: string, value: string): string[] {
  return setSettingOnDb(getDatabase(), key, value)
}

export function setRealSetting(key: string, value: string): string[] {
  return setSettingOnDb(getRealDatabase(), key, value)
}

export function getAllSettings(): Record<string, string> {
  return getAllSettingsFromDb(getDatabase())
}

export function getAllRealSettings(): Record<string, string> {
  return getAllSettingsFromDb(getRealDatabase())
}

export function deleteSetting(key: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  return result.changes > 0
}
