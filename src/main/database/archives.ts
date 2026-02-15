import { getDatabase } from './index'
import { v4 as uuidv4 } from 'uuid'
import { Archive } from '../../types/model'

export const archives = {
  list(params?: { type?: string; search?: string }): Archive[] {
    const db = getDatabase()
    let sql = 'SELECT * FROM archives WHERE 1=1'
    const args: any[] = []

    if (params?.type && params.type !== 'all') {
      sql += ' AND type = ?'
      args.push(params.type)
    }

    if (params?.search) {
      sql += ' AND (name LIKE ? OR alias LIKE ?)'
      const term = `%${params.search}%`
      args.push(term, term)
    }

    sql += ' ORDER BY created_at DESC'

    const stmt = db.prepare(sql)
    const rows = stmt.all(...args)

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      aliases: row.alias ? row.alias.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      description: row.description,
      type: row.type,
      mainImage: row.main_image,
      images: row.images ? JSON.parse(row.images) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  },

  get(id: string): Archive | null {
    const db = getDatabase()
    const row: any = db.prepare('SELECT * FROM archives WHERE id = ?').get(id)
    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      aliases: row.alias ? row.alias.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      description: row.description,
      type: row.type,
      mainImage: row.main_image,
      images: row.images ? JSON.parse(row.images) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  },

  save(archive: Partial<Archive>): Archive {
    const db = getDatabase()
    const now = Date.now()
    const aliasStr = archive.aliases?.length ? archive.aliases.join(', ') : null
    const imagesJson = JSON.stringify(archive.images || [])

    if (archive.id) {
      // Update
      const stmt = db.prepare(`
        UPDATE archives
        SET name = ?, alias = ?, description = ?, type = ?, main_image = ?, images = ?, updated_at = ?
        WHERE id = ?
      `)
      stmt.run(
        archive.name,
        aliasStr,
        archive.description || null,
        archive.type || 'other',
        archive.mainImage || null,
        imagesJson,
        now,
        archive.id
      )
      return this.get(archive.id)!
    } else {
      // Create
      const id = uuidv4()
      const stmt = db.prepare(`
        INSERT INTO archives (id, name, alias, description, type, main_image, images, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        id,
        archive.name,
        aliasStr,
        archive.description || null,
        archive.type || 'other',
        archive.mainImage || null,
        imagesJson,
        now,
        now
      )
      return this.get(id)!
    }
  },

  delete(id: string): void {
    const db = getDatabase()
    db.prepare('DELETE FROM archives WHERE id = ?').run(id)
  }
}
