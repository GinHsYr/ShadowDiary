import { getDatabase } from './index'
import { v4 as uuidv4 } from 'uuid'
import type { Archive } from '../../types/model'
import { isImageDataUrl, saveImage } from '../utils/imageStorage'
import { splitArchiveAliases } from './archiveAliases'

interface ArchiveRow {
  id: string
  name: string
  alias: string | null
  description: string | null
  type: Archive['type']
  main_image: string | null
  images: string | null
  created_at: number
  updated_at: number
}

function parseArchiveImages(imagesJson: string | null): string[] {
  if (!imagesJson) return []

  try {
    const parsed: unknown = JSON.parse(imagesJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch (error) {
    console.warn('解析档案图片列表失败:', error)
    return []
  }
}

async function normalizeArchiveImage(image: string | undefined): Promise<string | undefined> {
  if (!image) return undefined
  if (!isImageDataUrl(image)) return image
  const saved = await saveImage(image)
  return saved.path
}

async function normalizeArchiveImageList(images: string[] | undefined): Promise<string[]> {
  if (!images || images.length === 0) return []
  const normalized = await Promise.all(images.map((image) => normalizeArchiveImage(image)))
  return normalized.filter((image): image is string => Boolean(image))
}

function rowToArchive(row: ArchiveRow): Archive {
  return {
    id: row.id,
    name: row.name,
    aliases: splitArchiveAliases(row.alias),
    description: row.description ?? undefined,
    type: row.type,
    mainImage: row.main_image ?? undefined,
    images: parseArchiveImages(row.images),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export const archives = {
  list(params?: { type?: string; search?: string }): Archive[] {
    const db = getDatabase()
    let sql = 'SELECT * FROM archives WHERE 1=1'
    const args: string[] = []

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
    const rows = stmt.all(...args) as ArchiveRow[]
    return rows.map(rowToArchive)
  },

  get(id: string): Archive | null {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM archives WHERE id = ?').get(id) as ArchiveRow | undefined
    if (!row) return null

    return rowToArchive(row)
  },

  async save(archive: Partial<Archive>): Promise<Archive> {
    const db = getDatabase()
    const now = Date.now()
    const aliasStr = archive.aliases?.length ? archive.aliases.join(', ') : null
    const normalizedMainImage = await normalizeArchiveImage(archive.mainImage)
    const normalizedImages = await normalizeArchiveImageList(archive.images)
    const imagesJson = JSON.stringify(normalizedImages)

    if (archive.id) {
      // Update
      const stmt = db.prepare(`
        UPDATE archives
        SET name = ?, alias = ?, description = ?, type = ?, main_image = ?, images = ?, updated_at = ?
        WHERE id = ?
      `)
      const result = stmt.run(
        archive.name,
        aliasStr,
        archive.description || null,
        archive.type || 'other',
        normalizedMainImage || null,
        imagesJson,
        now,
        archive.id
      )
      if (result.changes === 0) {
        throw new Error(`更新档案失败，未找到档案: ${archive.id}`)
      }
      const saved = this.get(archive.id)
      if (!saved) {
        throw new Error(`更新档案失败，未找到档案: ${archive.id}`)
      }
      return saved
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
        normalizedMainImage || null,
        imagesJson,
        now,
        now
      )
      const saved = this.get(id)
      if (!saved) {
        throw new Error(`创建档案失败，未找到档案: ${id}`)
      }
      return saved
    }
  },

  delete(id: string): void {
    const db = getDatabase()
    db.prepare('DELETE FROM archives WHERE id = ?').run(id)
  },

  searchByName(name: string, limit?: number): Archive[] {
    const db = getDatabase()
    const trimmed = (name || '').trim()
    if (!trimmed) return []

    const lowered = trimmed.toLowerCase()
    const like = `%${lowered.replace(/[\\%_]/g, '\\$&')}%`
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit ?? 20)))

    // 1) 精确名称/别名匹配优先；2) 模糊匹配次之。最终在 JS 中再次过滤别名命中以避免子串误判（如别名"小明"被"小明明"逗号分隔后误中）。
    const sql = `
      SELECT *,
        CASE
          WHEN LOWER(name) = ? THEN 0
          WHEN LOWER(alias) = ? THEN 1
          WHEN LOWER(name) LIKE ? ESCAPE '\\' THEN 2
          ELSE 3
        END AS match_rank
      FROM archives
      WHERE LOWER(name) LIKE ? ESCAPE '\\'
         OR LOWER(IFNULL(alias, '')) LIKE ? ESCAPE '\\'
      ORDER BY match_rank ASC, updated_at DESC
      LIMIT ?
    `
    const rows = db
      .prepare(sql)
      .all(lowered, lowered, like, like, like, safeLimit) as ArchiveRow[]

    return rows
      .map(rowToArchive)
      .filter((archive) => {
        if (archive.name.toLowerCase().includes(lowered)) return true
        return archive.aliases.some((alias) => alias.toLowerCase().includes(lowered))
      })
  }
}
