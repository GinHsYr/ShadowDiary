import { getDatabase } from './index'

interface TagRow {
  id: number
  name: string
}

export function getAllTags(): { id: number; name: string }[] {
  const db = getDatabase()
  return db.prepare('SELECT id, name FROM tags ORDER BY name').all() as TagRow[]
}

export function createTag(name: string): { id: number; name: string } {
  const db = getDatabase()
  db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name)
  return db.prepare('SELECT id, name FROM tags WHERE name = ?').get(name) as TagRow
}

export function deleteTag(id: number): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM tags WHERE id = ?').run(id)
  return result.changes > 0
}
