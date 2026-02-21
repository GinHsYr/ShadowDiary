import { getDatabase } from './index'
import { collectImageIdsFromText, syncImageRefs } from './imageRefs'

export function getSetting(key: string): string | null {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): string[] {
  const db = getDatabase()
  const previous = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)

  if (key !== 'user.avatar') return []

  return syncImageRefs(collectImageIdsFromText(previous?.value), collectImageIdsFromText(value))
}

export function getAllSettings(): Record<string, string> {
  const db = getDatabase()
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

export function deleteSetting(key: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  return result.changes > 0
}
