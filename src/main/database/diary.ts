import { randomUUID } from 'crypto'
import { getDatabase } from './index'
import { stripHtmlToPlain } from './migrations'
import type { DiaryEntry, Mood, SearchParams, HomePageStats, SearchResult } from '../../types/model'

interface DiaryRow {
  id: string
  title: string
  content: string
  plain_content: string
  mood: string
  weather: string | null
  created_at: number
  updated_at: number
}

interface TagRow {
  name: string
}

function rowToEntry(row: DiaryRow, tags: string[]): DiaryEntry {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    mood: row.mood as Mood,
    tags,
    weather: row.weather ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getTagsForDiary(diaryId: string): string[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      'SELECT t.name FROM tags t JOIN diary_tags dt ON t.id = dt.tag_id WHERE dt.diary_id = ?'
    )
    .all(diaryId) as TagRow[]
  return rows.map((r) => r.name)
}

function syncTags(diaryId: string, tags: string[]): void {
  const db = getDatabase()

  // Remove existing tag associations
  db.prepare('DELETE FROM diary_tags WHERE diary_id = ?').run(diaryId)

  if (tags.length === 0) return

  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
  const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?')
  const insertDiaryTag = db.prepare(
    'INSERT OR IGNORE INTO diary_tags (diary_id, tag_id) VALUES (?, ?)'
  )

  for (const tag of tags) {
    insertTag.run(tag)
    const row = getTagId.get(tag) as { id: number }
    insertDiaryTag.run(diaryId, row.id)
  }
}

export function getDiaryEntries(params: {
  limit?: number
  offset?: number
  lightweight?: boolean
}): { entries: DiaryEntry[]; total: number } {
  const db = getDatabase()
  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const lightweight = params.lightweight ?? false

  const total = (
    db.prepare('SELECT COUNT(*) as count FROM diary_entries').get() as { count: number }
  ).count

  // lightweight 模式：只返回元数据和纯文本预览，不返回完整 HTML content
  const selectFields = lightweight
    ? 'id, title, mood, weather, created_at, updated_at, plain_content as content'
    : '*'

  const rows = db
    .prepare(`SELECT ${selectFields} FROM diary_entries ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as DiaryRow[]

  const entries = rows.map((row) => rowToEntry(row, getTagsForDiary(row.id)))
  return { entries, total }
}

export function getDiaryEntry(id: string): DiaryEntry | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM diary_entries WHERE id = ?').get(id) as DiaryRow | undefined
  if (!row) return null
  return rowToEntry(row, getTagsForDiary(row.id))
}

export function getDiaryByDate(dateStr: string): DiaryEntry | null {
  const db = getDatabase()
  // dateStr format: 'YYYY-MM-DD'，显式构造本地时间避免时区歧义
  const [y, m, d] = dateStr.split('-').map(Number)
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime()

  const row = db
    .prepare(
      'SELECT * FROM diary_entries WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(dayStart, dayEnd) as DiaryRow | undefined

  if (!row) return null
  return rowToEntry(row, getTagsForDiary(row.id))
}

export function saveDiaryEntry(entry: {
  id?: string
  title: string
  content: string
  mood: Mood
  tags?: string[]
  weather?: string
  createdAt?: number
}): DiaryEntry {
  const db = getDatabase()
  const now = Date.now()
  const plainContent = stripHtmlToPlain(entry.content)

  const save = db.transaction(() => {
    if (entry.id) {
      // Check if exists
      const existing = db.prepare('SELECT id FROM diary_entries WHERE id = ?').get(entry.id)
      if (existing) {
        // Update
        db.prepare(
          'UPDATE diary_entries SET title = ?, content = ?, plain_content = ?, mood = ?, weather = ?, updated_at = ? WHERE id = ?'
        ).run(
          entry.title,
          entry.content,
          plainContent,
          entry.mood,
          entry.weather ?? null,
          now,
          entry.id
        )
        syncTags(entry.id, entry.tags ?? [])
        return entry.id
      }
    }

    // Insert
    const id = entry.id || randomUUID()
    const createdAt = entry.createdAt ?? now
    db.prepare(
      'INSERT INTO diary_entries (id, title, content, plain_content, mood, weather, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      entry.title,
      entry.content,
      plainContent,
      entry.mood,
      entry.weather ?? null,
      createdAt,
      now
    )
    syncTags(id, entry.tags ?? [])
    return id
  })

  const id = save()
  return getDiaryEntry(id)!
}

export function deleteDiaryEntry(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM diary_entries WHERE id = ?').run(id)
  return result.changes > 0
}

export function getDiaryDates(yearMonth: string): string[] {
  const db = getDatabase()
  // yearMonth format: 'YYYY-MM'，显式构造本地时间避免时区歧义
  const [y, m] = yearMonth.split('-').map(Number)
  const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime()
  const monthEnd = new Date(y, m, 1, 0, 0, 0, 0).getTime()

  const rows = db
    .prepare('SELECT created_at FROM diary_entries WHERE created_at >= ? AND created_at < ?')
    .all(monthStart, monthEnd) as { created_at: number }[]

  const dateSet = new Set<string>()
  for (const row of rows) {
    const d = new Date(row.created_at)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    dateSet.add(ds)
  }
  return Array.from(dateSet)
}

// 根据关键词查找匹配的档案，返回该档案的所有名称（name + aliases）
function expandKeywordWithArchiveAliases(keyword: string): string[] {
  const db = getDatabase()
  const lowerKw = keyword.toLowerCase()

  // 查找 name 或 alias 包含该关键词的档案
  const rows = db
    .prepare('SELECT name, alias FROM archives WHERE LOWER(name) LIKE ? OR LOWER(alias) LIKE ?')
    .all(`%${lowerKw}%`, `%${lowerKw}%`) as { name: string; alias: string | null }[]

  const allNames = new Set<string>([keyword])

  for (const row of rows) {
    // 添加档案名称
    allNames.add(row.name)
    // 添加所有别名
    if (row.alias) {
      const aliases = row.alias
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      for (const alias of aliases) {
        allNames.add(alias)
      }
    }
  }

  return Array.from(allNames)
}

export function searchDiaries(params: SearchParams): SearchResult {
  const db = getDatabase()
  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const lightweight = params.lightweight ?? false

  const conditions: string[] = []
  const values: unknown[] = []
  const fromClause = 'diary_entries e'
  const selectClause = lightweight
    ? 'e.id, e.title, e.mood, e.weather, e.created_at, e.updated_at, e.plain_content as content'
    : 'e.*'

  // 收集所有扩展后的关键词用于前端高亮
  const allExpandedKeywords = new Set<string>()

  // Keyword search: split by spaces for multi-keyword AND matching
  // 每个关键词如果匹配到档案，则扩展为该档案的所有名称（OR 逻辑）
  if (params.keyword && params.keyword.trim()) {
    const keywords = params.keyword.trim().split(/\s+/).filter(Boolean)
    for (const kw of keywords) {
      // 扩展关键词：如果匹配档案，加入该档案的所有别名
      const expandedKeywords = expandKeywordWithArchiveAliases(kw)

      // 收集所有扩展的关键词
      for (const ek of expandedKeywords) {
        allExpandedKeywords.add(ek)
      }

      if (expandedKeywords.length === 1) {
        // 没有匹配到档案，使用原始关键词
        const likePattern = `%${kw}%`
        conditions.push('(e.title LIKE ? COLLATE NOCASE OR e.plain_content LIKE ? COLLATE NOCASE)')
        values.push(likePattern, likePattern)
      } else {
        // 匹配到档案，使用 OR 连接所有扩展的关键词
        const orConditions: string[] = []
        for (const expandedKw of expandedKeywords) {
          const likePattern = `%${expandedKw}%`
          orConditions.push(
            '(e.title LIKE ? COLLATE NOCASE OR e.plain_content LIKE ? COLLATE NOCASE)'
          )
          values.push(likePattern, likePattern)
        }
        conditions.push(`(${orConditions.join(' OR ')})`)
      }
    }
  }

  // Mood filter
  if (params.mood) {
    conditions.push('e.mood = ?')
    values.push(params.mood)
  }

  // Date range
  if (params.dateFrom) {
    conditions.push('e.created_at >= ?')
    values.push(params.dateFrom)
  }
  if (params.dateTo) {
    conditions.push('e.created_at <= ?')
    values.push(params.dateTo)
  }

  // Tag filter (AND logic: entry must have ALL specified tags)
  if (params.tags && params.tags.length > 0) {
    conditions.push(`e.id IN (
      SELECT dt.diary_id FROM diary_tags dt
      JOIN tags t ON dt.tag_id = t.id
      WHERE t.name IN (${params.tags.map(() => '?').join(',')})
      GROUP BY dt.diary_id
      HAVING COUNT(DISTINCT t.name) = ?
    )`)
    values.push(...params.tags, params.tags.length)
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  const countSql = `SELECT COUNT(*) as count FROM ${fromClause} ${whereClause}`
  const total = (db.prepare(countSql).get(...values) as { count: number }).count

  const querySql = `SELECT ${selectClause} FROM ${fromClause} ${whereClause} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
  const rows = db.prepare(querySql).all(...values, limit, offset) as DiaryRow[]

  const entries = rows.map((row) => rowToEntry(row, getTagsForDiary(row.id)))

  // 只有当关键词被扩展时才返回 expandedKeywords
  const expandedKeywords =
    allExpandedKeywords.size > 0 ? Array.from(allExpandedKeywords) : undefined

  return { entries, total, expandedKeywords }
}

export function getStats(): HomePageStats {
  const db = getDatabase()

  // Total entries
  const totalEntries = (
    db.prepare('SELECT COUNT(*) as count FROM diary_entries').get() as { count: number }
  ).count

  // Current streak: count consecutive days with diary entries going back from today
  let currentStreak = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // 一次查询获取过去 365 天所有有日记的日期，在 JS 中计算连续天数
  const yearAgo = new Date(today)
  yearAgo.setDate(yearAgo.getDate() - 365)

  const streakRows = db
    .prepare('SELECT created_at FROM diary_entries WHERE created_at >= ? ORDER BY created_at DESC')
    .all(yearAgo.getTime()) as { created_at: number }[]

  const daysWithEntries = new Set<string>()
  for (const row of streakRows) {
    const d = new Date(row.created_at)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    daysWithEntries.add(ds)
  }

  for (let i = 0; i < 365; i++) {
    const day = new Date(today)
    day.setDate(day.getDate() - i)
    const ds = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    if (daysWithEntries.has(ds)) {
      currentStreak++
    } else {
      // 如果今天还没写日记，跳过继续检查昨天
      if (i === 0) continue
      break
    }
  }

  // Mood map: date -> mood value (most recent mood per day, last 90 days)
  const ninetyDaysAgo = new Date(today)
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const moodRows = db
    .prepare(
      'SELECT created_at, mood FROM diary_entries WHERE created_at >= ? ORDER BY created_at DESC'
    )
    .all(ninetyDaysAgo.getTime()) as { created_at: number; mood: string }[]

  const moodMap: Record<string, number> = {}
  const moodValues: Record<string, number> = { happy: 5, excited: 4, calm: 3, tired: 2, sad: 1 }

  for (const row of moodRows) {
    const d = new Date(row.created_at)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    // Keep first (most recent) mood per day
    if (!(dateStr in moodMap)) {
      moodMap[dateStr] = moodValues[row.mood] ?? 3
    }
  }

  return { totalEntries, currentStreak, moodMap }
}

export function getAllDiaryContents(): string[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT content FROM diary_entries').all() as { content: string }[]
  return rows.map((r) => r.content)
}
