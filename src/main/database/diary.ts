import { randomUUID } from 'crypto'
import { getDatabase } from './index'
import { stripHtmlToPlain } from './migrations'
import type {
  DiaryEntry,
  DiaryMetadata,
  DiaryPlainTextReadResult,
  Mood,
  SearchParams,
  HomePageStats,
  SearchResult,
  SearchHighlightKeyword,
  PersonMentionDetailItem,
  PersonMentionDetailResult
} from '../../types/model'
import { splitArchiveAliases } from './archiveAliases'

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

interface TagGroupRow {
  diary_id: string
  tags: string | null
}

interface PersonArchiveRow {
  id: string
  name: string
  alias: string | null
}

interface MentionDiaryRow {
  id: string
  title: string
  plain_content: string
  mood: Mood
  created_at: number
  updated_at: number
}

interface MentionDiaryScanRow {
  id: string
  title: string
  plain_content: string
  created_at: number
}

interface DiaryMetadataRow {
  id: string
  title: string
  plain_content: string
  mood: Mood
  weather: string | null
  created_at: number
  updated_at: number
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

function rowToMetadata(row: DiaryMetadataRow, tags: string[]): DiaryMetadata {
  return {
    id: row.id,
    title: row.title,
    mood: row.mood,
    tags,
    weather: row.weather ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contentLength: row.plain_content.length
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

const TAG_CONCAT_DELIMITER = '\u001f'

function getTagsByDiaryIds(diaryIds: string[]): Map<string, string[]> {
  const tagsByDiaryId = new Map<string, string[]>()
  if (diaryIds.length === 0) return tagsByDiaryId

  const db = getDatabase()
  const placeholders = diaryIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT dt.diary_id, GROUP_CONCAT(t.name, '${TAG_CONCAT_DELIMITER}') as tags
       FROM diary_tags dt
       JOIN tags t ON t.id = dt.tag_id
       WHERE dt.diary_id IN (${placeholders})
       GROUP BY dt.diary_id`
    )
    .all(...diaryIds) as TagGroupRow[]

  for (const row of rows) {
    tagsByDiaryId.set(
      row.diary_id,
      row.tags ? row.tags.split(TAG_CONCAT_DELIMITER).filter(Boolean) : []
    )
  }

  return tagsByDiaryId
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

const blockedHtmlTags = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'link',
  'meta',
  'base'
]
const blockedHtmlTagPattern = blockedHtmlTags.join('|')

export function sanitizeDiaryHtml(content: string): string {
  let sanitized = content

  sanitized = sanitized.replace(
    new RegExp(`<\\s*(${blockedHtmlTagPattern})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, 'gi'),
    ''
  )
  sanitized = sanitized.replace(
    new RegExp(`<\\s*(?:${blockedHtmlTagPattern})\\b[^>]*\\/?>`, 'gi'),
    ''
  )
  sanitized = sanitized.replace(/\s+on[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gis, '')
  sanitized = sanitized.replace(/\s+(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gis, '')
  sanitized = sanitized.replace(/\s+(href|src)\s*=\s*(['"])\s*data:text\/html[\s\S]*?\2/gis, '')
  sanitized = sanitized.replace(
    /\s+style\s*=\s*(['"])([\s\S]*?)\1/gis,
    (_match, quote: string, styleValue: string) => {
      const loweredStyle = styleValue.toLowerCase()
      if (
        loweredStyle.includes('expression') ||
        loweredStyle.includes('javascript:') ||
        loweredStyle.includes('url(')
      ) {
        return ''
      }
      return ` style=${quote}${styleValue}${quote}`
    }
  )

  return sanitized
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

  const tagsByDiaryId = getTagsByDiaryIds(rows.map((row) => row.id))
  const entries = rows.map((row) => rowToEntry(row, tagsByDiaryId.get(row.id) ?? []))
  return { entries, total }
}

export function getDiaryEntry(id: string): DiaryEntry | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM diary_entries WHERE id = ?').get(id) as DiaryRow | undefined
  if (!row) return null
  return rowToEntry(row, getTagsForDiary(row.id))
}

export function getDiaryMetadata(id: string): DiaryMetadata | null {
  const db = getDatabase()
  const row = db
    .prepare(
      'SELECT id, title, plain_content, mood, weather, created_at, updated_at FROM diary_entries WHERE id = ?'
    )
    .get(id) as DiaryMetadataRow | undefined
  if (!row) return null
  return rowToMetadata(row, getTagsForDiary(row.id))
}

export function getDiaryMetadataBatch(ids: string[]): DiaryMetadata[] {
  const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (normalizedIds.length === 0) return []

  const db = getDatabase()
  const placeholders = normalizedIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, title, plain_content, mood, weather, created_at, updated_at
       FROM diary_entries
       WHERE id IN (${placeholders})`
    )
    .all(...normalizedIds) as DiaryMetadataRow[]

  const tagsByDiaryId = getTagsByDiaryIds(rows.map((row) => row.id))
  const rowById = new Map(rows.map((row) => [row.id, row]))

  return normalizedIds
    .map((id) => {
      const row = rowById.get(id)
      if (!row) return null
      return rowToMetadata(row, tagsByDiaryId.get(row.id) ?? [])
    })
    .filter((item): item is DiaryMetadata => Boolean(item))
}

export function readDiaryPlainText(params: {
  id: string
  offset?: number
  maxChars?: number
}): DiaryPlainTextReadResult | null {
  const metadata = getDiaryMetadata(params.id)
  if (!metadata) return null

  const db = getDatabase()
  const row = db.prepare('SELECT plain_content FROM diary_entries WHERE id = ?').get(params.id) as
    | { plain_content: string }
    | undefined
  if (!row) return null

  const content = row.plain_content || ''
  const offset = Math.max(0, Math.min(Math.floor(params.offset ?? 0), content.length))
  const maxChars = Math.max(1, Math.floor(params.maxChars ?? 4000))
  const nextOffset = offset + maxChars < content.length ? offset + maxChars : null

  return {
    ...metadata,
    content: content.slice(offset, offset + maxChars),
    offset,
    nextOffset,
    truncated: nextOffset !== null
  }
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

function getLocalDayRange(timestamp: number): { dayStart: number; dayEnd: number } {
  const date = new Date(timestamp)
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0)
  return {
    dayStart: dayStart.getTime(),
    dayEnd: dayEnd.getTime()
  }
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
  const sanitizedContent = sanitizeDiaryHtml(entry.content)
  const plainContent = stripHtmlToPlain(sanitizedContent)

  const save = db.transaction(() => {
    if (entry.id) {
      // Check if exists
      const existing = db
        .prepare('SELECT id, plain_content FROM diary_entries WHERE id = ?')
        .get(entry.id) as { id: string; plain_content: string } | undefined
      if (existing) {
        // Update
        db.prepare(
          'UPDATE diary_entries SET title = ?, content = ?, plain_content = ?, mood = ?, weather = ?, updated_at = ? WHERE id = ?'
        ).run(
          entry.title,
          sanitizedContent,
          plainContent,
          entry.mood,
          entry.weather ?? null,
          now,
          entry.id
        )
        syncTags(entry.id, entry.tags ?? [])
        syncPersonMentionStatsForDiaryTextChange(db, existing.plain_content || '', plainContent)
        return entry.id
      }
    }

    // Insert
    const id = entry.id || randomUUID()
    const createdAt = entry.createdAt ?? now
    const { dayStart, dayEnd } = getLocalDayRange(createdAt)
    const sameDayEntry = db
      .prepare(
        'SELECT id FROM diary_entries WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 1'
      )
      .get(dayStart, dayEnd) as { id: string } | undefined
    if (sameDayEntry) {
      return sameDayEntry.id
    }

    db.prepare(
      'INSERT INTO diary_entries (id, title, content, plain_content, mood, weather, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      entry.title,
      sanitizedContent,
      plainContent,
      entry.mood,
      entry.weather ?? null,
      createdAt,
      now
    )
    syncTags(id, entry.tags ?? [])
    syncPersonMentionStatsForDiaryTextChange(db, '', plainContent)
    return id
  })

  const id = save()
  invalidatePersonMentionCache()
  return getDiaryEntry(id)!
}

export function deleteDiaryEntry(id: string): boolean {
  const db = getDatabase()
  const remove = db.transaction(() => {
    const existing = db.prepare('SELECT plain_content FROM diary_entries WHERE id = ?').get(id) as
      | { plain_content: string }
      | undefined
    if (!existing) return false

    const result = db.prepare('DELETE FROM diary_entries WHERE id = ?').run(id)
    if (result.changes <= 0) return false

    syncPersonMentionStatsForDiaryTextChange(db, existing.plain_content || '', '')
    return true
  })

  const deleted = remove()
  if (deleted) {
    invalidatePersonMentionCache()
  }
  return deleted
}

export function getDiaryDates(yearMonth: string): string[] {
  const db = getDatabase()
  // yearMonth format: 'YYYY-MM'，显式构造本地时间避免时区歧义
  const [y, m] = yearMonth.split('-').map(Number)
  const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime()
  const monthEnd = new Date(y, m, 1, 0, 0, 0, 0).getTime()

  const rows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS diary_date
       FROM diary_entries
       WHERE created_at >= ? AND created_at < ?
       ORDER BY diary_date`
    )
    .all(monthStart, monthEnd) as { diary_date: string | null }[]

  return rows.map((row) => row.diary_date).filter((date): date is string => Boolean(date))
}

function quoteFtsToken(token: string): string | null {
  const trimmed = token.trim()
  if (!trimmed) return null
  const escaped = trimmed.replace(/"/g, '""')
  return `"${escaped}"`
}

function buildFtsMatchExpression(keywordGroups: string[][]): string | null {
  if (keywordGroups.length === 0) return null

  const groupExpressions = keywordGroups
    .map((group) => {
      const terms = group.map(quoteFtsToken).filter((term): term is string => Boolean(term))
      if (terms.length === 0) return null
      return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`
    })
    .filter((expr): expr is string => Boolean(expr))

  if (groupExpressions.length === 0) return null
  return groupExpressions.join(' AND ')
}

interface ArchiveKeywordRow {
  id: string
  name: string
  alias: string | null
}

interface KeywordAlternative {
  value: string
  standalone: boolean
}

interface KeywordExpansion {
  primary: KeywordAlternative[]
}

interface SearchExecutionResult {
  entries: DiaryEntry[]
  total: number
}

function buildKeywordExpansion(keyword: string): KeywordExpansion {
  const db = getDatabase()
  const trimmedKeyword = keyword.trim()
  const lowerKeyword = trimmedKeyword.toLocaleLowerCase()
  const archiveLike = `%${escapeLikePattern(lowerKeyword)}%`

  const rows = db
    .prepare(
      `SELECT id, name, alias FROM archives
       WHERE LOWER(name) LIKE ? ESCAPE '\\'
          OR LOWER(IFNULL(alias, '')) LIKE ? ESCAPE '\\'`
    )
    .all(archiveLike, archiveLike) as ArchiveKeywordRow[]

  const exactArchiveIds = new Set<string>()
  const fuzzyArchiveIds = new Set<string>()
  const keywordsByArchiveId = new Map<string, string[]>()

  for (const row of rows) {
    const archiveKeywords = [row.name, ...splitArchiveAliases(row.alias)]
      .map((item) => item.trim())
      .filter(Boolean)

    if (archiveKeywords.length === 0) continue
    keywordsByArchiveId.set(row.id, archiveKeywords)

    const hasExactMatch = archiveKeywords.some((item) => item.toLocaleLowerCase() === lowerKeyword)
    const hasFuzzyMatch = archiveKeywords.some((item) =>
      item.toLocaleLowerCase().includes(lowerKeyword)
    )

    if (hasExactMatch) {
      exactArchiveIds.add(row.id)
    } else if (hasFuzzyMatch) {
      fuzzyArchiveIds.add(row.id)
    }
  }

  const exactKeywords = collectArchiveSearchKeywords(exactArchiveIds, keywordsByArchiveId, true)
  const fuzzyKeywords = collectArchiveSearchKeywords(fuzzyArchiveIds, keywordsByArchiveId, false)

  if (exactKeywords.length === 0) {
    const primary = dedupeKeywordAlternatives([
      { value: trimmedKeyword, standalone: false },
      ...fuzzyKeywords
    ])
    return {
      primary
    }
  }

  const primary = dedupeKeywordAlternatives(exactKeywords)
  return {
    primary
  }
}

function collectArchiveSearchKeywords(
  archiveIds: Set<string>,
  keywordsByArchiveId: Map<string, string[]>,
  standaloneSingleChar: boolean
): KeywordAlternative[] {
  const alternatives: KeywordAlternative[] = []

  for (const archiveId of archiveIds) {
    const keywords = keywordsByArchiveId.get(archiveId) ?? []
    for (const keyword of keywords) {
      alternatives.push({
        value: keyword,
        standalone: standaloneSingleChar && [...keyword].length === 1
      })
    }
  }

  return alternatives
}

function dedupeKeywordAlternatives(alternatives: KeywordAlternative[]): KeywordAlternative[] {
  const byKey = new Map<string, KeywordAlternative>()

  for (const alternative of alternatives) {
    const value = alternative.value.trim()
    if (!value) continue
    const key = value.toLocaleLowerCase()
    if (!byKey.has(key)) {
      byKey.set(key, { value, standalone: alternative.standalone })
    }
  }

  return [...byKey.values()]
}

function buildKeywordSearchCondition(keywordGroups: KeywordAlternative[][]): {
  condition: string | null
  values: unknown[]
} {
  if (keywordGroups.length === 0) {
    return { condition: null, values: [] }
  }

  const ftsExpression = buildFtsMatchExpression(
    keywordGroups.map((group) => group.map((keyword) => keyword.value))
  )
  const likeGroupConditions: string[] = []
  const likeValues: unknown[] = []

  for (const keywordGroup of keywordGroups) {
    const orConditions: string[] = []
    for (const keyword of keywordGroup) {
      const likePattern = `%${escapeLikePattern(keyword.value)}%`
      orConditions.push(
        "(e.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR e.plain_content LIKE ? ESCAPE '\\' COLLATE NOCASE)"
      )
      likeValues.push(likePattern, likePattern)
    }
    if (orConditions.length > 0) {
      likeGroupConditions.push(`(${orConditions.join(' OR ')})`)
    }
  }

  const keywordClauses: string[] = []
  const keywordValues: unknown[] = []

  if (ftsExpression) {
    keywordClauses.push(
      'e.rowid IN (SELECT rowid FROM diary_search_fts WHERE diary_search_fts MATCH ?)'
    )
    keywordValues.push(ftsExpression)
  }

  if (likeGroupConditions.length > 0) {
    keywordClauses.push(likeGroupConditions.join(' AND '))
    keywordValues.push(...likeValues)
  }

  if (keywordClauses.length === 0) {
    return { condition: null, values: [] }
  }

  return {
    condition: keywordClauses.length === 1 ? keywordClauses[0] : `(${keywordClauses.join(' OR ')})`,
    values: keywordValues
  }
}

function buildDiarySearchConditions(
  params: SearchParams,
  keywordGroups: KeywordAlternative[][]
): { conditions: string[]; values: unknown[] } {
  const conditions: string[] = []
  const values: unknown[] = []
  const keywordCondition = buildKeywordSearchCondition(keywordGroups)

  if (keywordCondition.condition) {
    conditions.push(keywordCondition.condition)
    values.push(...keywordCondition.values)
  }

  if (params.mood) {
    conditions.push('e.mood = ?')
    values.push(params.mood)
  }

  if (typeof params.dateFrom === 'number' && Number.isFinite(params.dateFrom)) {
    conditions.push('e.created_at >= ?')
    values.push(params.dateFrom)
  }
  if (typeof params.dateTo === 'number' && Number.isFinite(params.dateTo)) {
    const dateTo = new Date(params.dateTo)
    const dateToExclusive = new Date(
      dateTo.getFullYear(),
      dateTo.getMonth(),
      dateTo.getDate() + 1
    ).getTime()
    conditions.push('e.created_at < ?')
    values.push(dateToExclusive)
  }

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

  return { conditions, values }
}

function requiresKeywordPostFilter(keywordGroups: KeywordAlternative[][]): boolean {
  return keywordGroups.some((group) => group.some((keyword) => keyword.standalone))
}

function rowMatchesKeywordGroups(row: DiaryRow, keywordGroups: KeywordAlternative[][]): boolean {
  if (keywordGroups.length === 0) return true

  const text = `${row.title || ''}\n${row.plain_content || row.content || ''}`
  const loweredText = text.toLocaleLowerCase()

  return keywordGroups.every((group) =>
    group.some((keyword) => {
      const loweredKeyword = keyword.value.toLocaleLowerCase()
      if (!keyword.standalone) {
        return loweredText.includes(loweredKeyword)
      }
      return hasStandaloneMatch(loweredText, loweredKeyword)
    })
  )
}

function hasStandaloneMatch(text: string, keyword: string): boolean {
  if (!keyword) return false

  let index = text.indexOf(keyword)
  while (index !== -1) {
    const end = index + keyword.length
    const prevChar = index > 0 ? text[index - 1] : undefined
    const nextChar = end < text.length ? text[end] : undefined

    if (!isWordLikeChar(prevChar) && !isWordLikeChar(nextChar)) {
      return true
    }

    index = text.indexOf(keyword, index + keyword.length)
  }

  return false
}

function collectExpandedKeywords(keywordGroups: KeywordAlternative[][]): string[] | undefined {
  const keywords = new Set<string>()

  for (const group of keywordGroups) {
    for (const keyword of group) {
      keywords.add(keyword.value)
    }
  }

  return keywords.size > 0 ? [...keywords] : undefined
}

function collectHighlightKeywords(
  keywordGroups: KeywordAlternative[][]
): SearchHighlightKeyword[] | undefined {
  const keywords = new Map<string, SearchHighlightKeyword>()

  for (const group of keywordGroups) {
    for (const keyword of group) {
      const key = keyword.value.toLocaleLowerCase()
      if (!keywords.has(key)) {
        keywords.set(key, {
          keyword: keyword.value,
          standalone: keyword.standalone || undefined
        })
      }
    }
  }

  return keywords.size > 0 ? [...keywords.values()] : undefined
}

function executeDiarySearchPhase(
  params: SearchParams,
  keywordGroups: KeywordAlternative[][]
): SearchExecutionResult {
  const db = getDatabase()
  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const lightweight = params.lightweight ?? false
  const fromClause = 'diary_entries e'
  const selectClause = lightweight
    ? 'e.id, e.title, e.mood, e.weather, e.created_at, e.updated_at, e.plain_content as content'
    : 'e.*'
  const { conditions, values } = buildDiarySearchConditions(params, keywordGroups)
  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  if (requiresKeywordPostFilter(keywordGroups)) {
    const querySql = `SELECT ${selectClause} FROM ${fromClause} ${whereClause} ORDER BY e.created_at DESC`
    const allRows = db.prepare(querySql).all(...values) as DiaryRow[]
    const rows = allRows.filter((row) => rowMatchesKeywordGroups(row, keywordGroups))
    const pageRows = rows.slice(offset, offset + limit)
    const tagsByDiaryId = getTagsByDiaryIds(pageRows.map((row) => row.id))
    const entries = pageRows.map((row) => rowToEntry(row, tagsByDiaryId.get(row.id) ?? []))

    return { entries, total: rows.length }
  }

  const countSql = `SELECT COUNT(*) as count FROM ${fromClause} ${whereClause}`
  const total = (db.prepare(countSql).get(...values) as { count: number }).count

  const querySql = `SELECT ${selectClause} FROM ${fromClause} ${whereClause} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
  const rows = db.prepare(querySql).all(...values, limit, offset) as DiaryRow[]
  const tagsByDiaryId = getTagsByDiaryIds(rows.map((row) => row.id))
  const entries = rows.map((row) => rowToEntry(row, tagsByDiaryId.get(row.id) ?? []))

  return { entries, total }
}

function searchDiariesWithArchivePriority(params: SearchParams): SearchResult {
  const keywordGroups: KeywordAlternative[][] = []

  if (params.keyword && params.keyword.trim()) {
    const keywords = params.keyword.trim().split(/\s+/).filter(Boolean)
    for (const kw of keywords) {
      const expansion = buildKeywordExpansion(kw)
      if (expansion.primary.length === 0) continue

      keywordGroups.push(expansion.primary)
    }
  }

  const result = executeDiarySearchPhase(params, keywordGroups)

  return {
    ...result,
    expandedKeywords: collectExpandedKeywords(keywordGroups),
    highlightKeywords: collectHighlightKeywords(keywordGroups)
  }
}

export function searchDiaries(params: SearchParams): SearchResult {
  return searchDiariesWithArchivePriority(params)
}

export function getStats(): HomePageStats {
  const db = getDatabase()

  // Total entries
  const totalEntries = (
    db.prepare('SELECT COUNT(*) as count FROM diary_entries').get() as { count: number }
  ).count

  // Total characters: based on plain text content, excluding common whitespace.
  const totalCharacters = (
    db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(plain_content, char(13), ''), char(10), ''), char(9), ''), ' ', ''), char(12288), '')
        )), 0) as count
         FROM diary_entries`
      )
      .get() as { count: number }
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

  return { totalEntries, currentStreak, totalCharacters, moodMap }
}

export function getAllDiaryContents(): string[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT content FROM diary_entries').all() as { content: string }[]
  return rows.map((r) => r.content)
}

interface PersonMentionMatcher {
  personIds: string[]
  personNames: string[]
  personTokens: string[][]
  tokenOwners: Map<string, Set<number>>
  tokenMetaByKey: Map<string, PersonTokenMeta>
  mentionRegex: RegExp | null
}

interface PersonTokenMeta {
  personIndex: number
  isAlias: boolean
  charLength: number
}

function getPersonArchives(db: ReturnType<typeof getDatabase>): PersonArchiveRow[] {
  return db
    .prepare('SELECT id, name, alias FROM archives WHERE type = ? ORDER BY id')
    .all('person') as PersonArchiveRow[]
}

function buildPersonMentionMatcher(personArchives: PersonArchiveRow[]): PersonMentionMatcher {
  const personIds = personArchives.map((p) => p.id)
  const personNames = personArchives.map((p) => p.name)
  const personTokens: string[][] = []
  const tokenOwners = new Map<string, Set<number>>()
  const tokenMetaByKey = new Map<string, PersonTokenMeta>()

  for (let i = 0; i < personArchives.length; i++) {
    const person = personArchives[i]
    const tokenMetaForPerson = new Map<string, { token: string; isAlias: boolean }>()
    const rawTokens = [
      { token: person.name, isAlias: false },
      ...splitArchiveAliases(person.alias).map((token) => ({ token, isAlias: true }))
    ]

    for (const { token, isAlias } of rawTokens) {
      const key = token.toLocaleLowerCase()
      const existing = tokenMetaForPerson.get(key)
      if (!existing || (existing.isAlias && !isAlias)) {
        tokenMetaForPerson.set(key, { token, isAlias })
      }
    }

    const tokenList = [...tokenMetaForPerson.values()].map((item) => item.token)
    personTokens.push(tokenList)

    for (const [key, tokenMeta] of tokenMetaForPerson) {
      let owners = tokenOwners.get(key)
      if (!owners) {
        owners = new Set<number>()
        tokenOwners.set(key, owners)
      }
      owners.add(i)

      if (!tokenMetaByKey.has(key)) {
        tokenMetaByKey.set(key, {
          personIndex: i,
          isAlias: tokenMeta.isAlias,
          charLength: [...tokenMeta.token].length
        })
      }
    }
  }

  const orderedTokens = [...tokenOwners.keys()].sort((a, b) => {
    const lenDiff = b.length - a.length
    if (lenDiff !== 0) return lenDiff
    return a.localeCompare(b)
  })

  return {
    personIds,
    personNames,
    personTokens,
    tokenOwners,
    tokenMetaByKey,
    mentionRegex:
      orderedTokens.length > 0 ? new RegExp(orderedTokens.map(escapeRegExp).join('|'), 'giu') : null
  }
}

function isWordLikeChar(char: string | undefined): boolean {
  if (!char) return false
  return /[\p{L}\p{N}]/u.test(char)
}

function isSingleCharAliasStandaloneMatch(
  text: string,
  match: RegExpExecArray,
  tokenMeta: PersonTokenMeta
): boolean {
  if (!tokenMeta.isAlias || tokenMeta.charLength !== 1) return true

  const start = match.index
  const end = start + match[0].length
  const prevChar = start > 0 ? text[start - 1] : undefined
  const nextChar = end < text.length ? text[end] : undefined

  return !isWordLikeChar(prevChar) && !isWordLikeChar(nextChar)
}

function countMentionsForPerson(
  text: string,
  personIndex: number,
  mentionRegex: RegExp,
  tokenOwners: Map<string, Set<number>>,
  tokenMetaByKey: Map<string, PersonTokenMeta>
): { count: number; matchedKeys: Set<string> } {
  mentionRegex.lastIndex = 0

  let count = 0
  const matchedKeys = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = mentionRegex.exec(text)) !== null) {
    const key = match[0].toLocaleLowerCase()
    const owners = tokenOwners.get(key)

    // 同名/同别名冲突时跳过，避免错误归属。
    if (!owners || owners.size !== 1 || !owners.has(personIndex)) continue

    const tokenMeta = tokenMetaByKey.get(key)
    if (!tokenMeta || tokenMeta.personIndex !== personIndex) continue
    if (!isSingleCharAliasStandaloneMatch(text, match, tokenMeta)) continue

    count++
    matchedKeys.add(key)
  }

  return { count, matchedKeys }
}

function countMentionsByPerson(text: string, matcher: PersonMentionMatcher): number[] {
  const counts = new Array<number>(matcher.personNames.length).fill(0)
  if (!text || !matcher.mentionRegex) return counts

  matcher.mentionRegex.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = matcher.mentionRegex.exec(text)) !== null) {
    const key = match[0].toLocaleLowerCase()
    const owners = matcher.tokenOwners.get(key)
    if (!owners || owners.size !== 1) continue

    const ownerIndex = owners.values().next().value
    if (typeof ownerIndex !== 'number') continue

    const tokenMeta = matcher.tokenMetaByKey.get(key)
    if (!tokenMeta || tokenMeta.personIndex !== ownerIndex) continue
    if (!isSingleCharAliasStandaloneMatch(text, match, tokenMeta)) continue

    counts[ownerIndex]++
  }

  return counts
}

function upsertPersonMentionStatRows(
  db: ReturnType<typeof getDatabase>,
  personArchives: PersonArchiveRow[],
  timestamp: number
): void {
  const ensureRow = db.prepare(
    `INSERT INTO person_mention_stats (archive_id, mention_count, updated_at)
     VALUES (?, 0, ?)
     ON CONFLICT(archive_id) DO NOTHING`
  )

  for (const archive of personArchives) {
    ensureRow.run(archive.id, timestamp)
  }
}

function syncPersonMentionStatsForDiaryTextChange(
  db: ReturnType<typeof getDatabase>,
  previousText: string,
  nextText: string
): void {
  const personArchives = getPersonArchives(db)
  if (personArchives.length === 0) return

  const matcher = buildPersonMentionMatcher(personArchives)
  const now = Date.now()
  upsertPersonMentionStatRows(db, personArchives, now)

  const previousCounts = countMentionsByPerson(previousText, matcher)
  const nextCounts = countMentionsByPerson(nextText, matcher)

  const applyDelta = db.prepare(
    `UPDATE person_mention_stats
     SET mention_count = CASE WHEN mention_count + ? > 0 THEN mention_count + ? ELSE 0 END,
         updated_at = ?
     WHERE archive_id = ?`
  )

  for (let i = 0; i < personArchives.length; i++) {
    const delta = nextCounts[i] - previousCounts[i]
    if (delta === 0) continue
    applyDelta.run(delta, delta, now, personArchives[i].id)
  }
}

export function rebuildPersonMentionStatsIndex(): void {
  const db = getDatabase()
  const personArchives = getPersonArchives(db)
  const now = Date.now()

  const rebuild = db.transaction(() => {
    db.prepare('DELETE FROM person_mention_stats').run()
    if (personArchives.length === 0) return

    const matcher = buildPersonMentionMatcher(personArchives)
    const counts = new Array<number>(personArchives.length).fill(0)

    if (matcher.mentionRegex) {
      const diaryRows = db
        .prepare('SELECT plain_content FROM diary_entries')
        .iterate() as Iterable<{
        plain_content: string
      }>

      for (const row of diaryRows) {
        const rowCounts = countMentionsByPerson(row.plain_content || '', matcher)
        for (let i = 0; i < rowCounts.length; i++) {
          counts[i] += rowCounts[i]
        }
      }
    }

    const insertStat = db.prepare(
      'INSERT INTO person_mention_stats (archive_id, mention_count, updated_at) VALUES (?, ?, ?)'
    )
    for (let i = 0; i < personArchives.length; i++) {
      insertStat.run(personArchives[i].id, counts[i], now)
    }
  })

  rebuild()
}

interface PersonMentionCacheEntry {
  personName: string
  keywords: string[]
  indices: PersonMentionIndexItem[]
  expiresAt: number
  sizeBytes: number
}

interface PersonMentionIndexItem {
  id: string
  createdAt: number
  mentionCount: number
}

const PERSON_MENTION_CACHE_LIMIT = 6
const PERSON_MENTION_CACHE_TTL_MS = 5 * 60 * 1000
const PERSON_MENTION_CACHE_MAX_BYTES = 1024 * 1024
const PERSON_MENTION_SCAN_BATCH_SIZE = 200
const personMentionDetailCache = new Map<string, PersonMentionCacheEntry>()
let personMentionCacheBytes = 0

function estimateStringBytes(value: string): number {
  return value.length * 2
}

function estimatePersonMentionCacheSize(entry: {
  personName: string
  keywords: string[]
  indices: PersonMentionIndexItem[]
}): number {
  const baseBytes = 128 + estimateStringBytes(entry.personName)
  const keywordBytes = entry.keywords.reduce(
    (sum, keyword) => sum + estimateStringBytes(keyword),
    0
  )
  const indexBytes = entry.indices.reduce((sum, item) => sum + estimateStringBytes(item.id) + 24, 0)
  return baseBytes + keywordBytes + indexBytes
}

function deletePersonMentionCacheEntry(key: string): void {
  const entry = personMentionDetailCache.get(key)
  if (!entry) return
  personMentionCacheBytes = Math.max(0, personMentionCacheBytes - entry.sizeBytes)
  personMentionDetailCache.delete(key)
}

function pruneExpiredPersonMentionCache(now = Date.now()): void {
  for (const [key, entry] of personMentionDetailCache) {
    if (entry.expiresAt <= now) {
      deletePersonMentionCacheEntry(key)
    }
  }
}

function getPersonMentionCache(key: string): PersonMentionCacheEntry | null {
  const now = Date.now()
  pruneExpiredPersonMentionCache(now)

  const cached = personMentionDetailCache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= now) {
    deletePersonMentionCacheEntry(key)
    return null
  }

  // 读取时提升为最近使用，避免热点被过早淘汰
  personMentionDetailCache.delete(key)
  personMentionDetailCache.set(key, cached)
  return cached
}

function setPersonMentionCache(
  key: string,
  entry: { personName: string; keywords: string[]; indices: PersonMentionIndexItem[] }
): void {
  const now = Date.now()
  pruneExpiredPersonMentionCache(now)

  const existing = personMentionDetailCache.get(key)
  if (existing) {
    personMentionCacheBytes = Math.max(0, personMentionCacheBytes - existing.sizeBytes)
    personMentionDetailCache.delete(key)
  }

  const sizeBytes = estimatePersonMentionCacheSize(entry)
  if (sizeBytes > PERSON_MENTION_CACHE_MAX_BYTES) {
    return
  }

  if (
    !personMentionDetailCache.has(key) &&
    (personMentionDetailCache.size >= PERSON_MENTION_CACHE_LIMIT ||
      personMentionCacheBytes + sizeBytes > PERSON_MENTION_CACHE_MAX_BYTES)
  ) {
    while (
      personMentionDetailCache.size >= PERSON_MENTION_CACHE_LIMIT ||
      personMentionCacheBytes + sizeBytes > PERSON_MENTION_CACHE_MAX_BYTES
    ) {
      const oldestKey = personMentionDetailCache.keys().next().value
      if (!oldestKey) break
      deletePersonMentionCacheEntry(oldestKey)
    }
  }

  const cacheEntry: PersonMentionCacheEntry = {
    ...entry,
    expiresAt: now + PERSON_MENTION_CACHE_TTL_MS,
    sizeBytes
  }
  personMentionDetailCache.set(key, cacheEntry)
  personMentionCacheBytes += sizeBytes
}

export function invalidatePersonMentionCache(): void {
  personMentionDetailCache.clear()
  personMentionCacheBytes = 0
}

function buildPersonMentionCandidateFilter(normalizedKeywords: string[]): {
  whereClause: string
  values: unknown[]
} | null {
  if (normalizedKeywords.length === 0) return null

  const coarseKeywords = [...new Set(normalizedKeywords.map((token) => token.toLocaleLowerCase()))]
  if (coarseKeywords.length === 0) return null

  const likeConditions = coarseKeywords
    .map(() => "(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(plain_content) LIKE ? ESCAPE '\\')")
    .join(' OR ')
  const likeValues = coarseKeywords.flatMap((token) => {
    const pattern = `%${escapeLikePattern(token)}%`
    return [pattern, pattern]
  })

  const filters = [`(${likeConditions})`]
  const values: unknown[] = [...likeValues]

  const ftsExpression = buildFtsMatchExpression([normalizedKeywords])
  if (ftsExpression) {
    // FTS 命中快，但中文连续文本场景可能被分词漏掉，补充 LIKE 保证不漏召回。
    filters.unshift(`rowid IN (SELECT rowid FROM diary_search_fts WHERE diary_search_fts MATCH ?)`)
    values.unshift(ftsExpression)
  }

  return {
    whereClause: filters.join(' OR '),
    values
  }
}

function buildPersonMentionPageEntries(
  db: ReturnType<typeof getDatabase>,
  pageIndices: PersonMentionIndexItem[],
  normalizedKeywords: string[],
  personIndex: number,
  matcher: PersonMentionMatcher
): PersonMentionDetailItem[] {
  if (pageIndices.length === 0) return []

  const pageIds = pageIndices.map((item) => item.id)
  const placeholders = pageIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, title, plain_content, mood, created_at, updated_at
       FROM diary_entries
       WHERE id IN (${placeholders})`
    )
    .all(...pageIds) as MentionDiaryRow[]

  const rowById = new Map(rows.map((row) => [row.id, row]))

  return pageIndices
    .map((indexItem) => {
      const row = rowById.get(indexItem.id)
      if (!row) return null

      const textForMatch = `${row.title || ''}\n${row.plain_content || ''}`
      const { matchedKeys } = countMentionsForPerson(
        textForMatch,
        personIndex,
        matcher.mentionRegex!,
        matcher.tokenOwners,
        matcher.tokenMetaByKey
      )

      const matchedKeywords = normalizedKeywords.filter((token) =>
        matchedKeys.has(token.toLocaleLowerCase())
      )

      return {
        id: row.id,
        title: row.title,
        content: row.plain_content,
        mood: row.mood,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        mentionCount: indexItem.mentionCount,
        matchedKeywords
      }
    })
    .filter((item): item is PersonMentionDetailItem => Boolean(item))
}

export function getPersonMentionStats(): { name: string; count: number }[] {
  const db = getDatabase()
  const personArchives = getPersonArchives(db)
  if (personArchives.length === 0) return []

  const indexedCount = (
    db.prepare('SELECT COUNT(*) as count FROM person_mention_stats').get() as { count: number }
  ).count
  if (indexedCount !== personArchives.length) {
    rebuildPersonMentionStatsIndex()
  }

  const rows = db
    .prepare(
      `SELECT a.name as name, COALESCE(pms.mention_count, 0) as count
       FROM archives a
       LEFT JOIN person_mention_stats pms ON pms.archive_id = a.id
       WHERE a.type = ? AND COALESCE(pms.mention_count, 0) > 0
       ORDER BY count DESC, a.name COLLATE NOCASE ASC`
    )
    .all('person') as { name: string; count: number }[]

  return rows
}

export function getPersonMentionDetails(
  personName: string,
  params?: { limit?: number; offset?: number }
): PersonMentionDetailResult {
  const db = getDatabase()
  const requestedLimit = params?.limit ?? 50
  const requestedOffset = params?.offset ?? 0
  const limit = Math.max(1, Math.min(100, Math.floor(requestedLimit)))
  const offset = Math.max(0, Math.floor(requestedOffset))

  const personArchives = getPersonArchives(db)

  if (personArchives.length === 0) {
    return { personName, keywords: [personName], entries: [], total: 0 }
  }

  const matcher = buildPersonMentionMatcher(personArchives)
  if (!matcher.mentionRegex) {
    return { personName, keywords: [personName], entries: [], total: 0 }
  }

  let personIndex = matcher.personNames.findIndex((name) => name === personName)
  if (personIndex === -1) {
    const target = personName.toLocaleLowerCase()
    personIndex = matcher.personNames.findIndex((name) => name.toLocaleLowerCase() === target)
  }

  if (personIndex === -1) {
    return { personName, keywords: [personName], entries: [], total: 0 }
  }

  const normalizedPersonName = matcher.personNames[personIndex]
  const personKeywords = matcher.personTokens[personIndex]
  const normalizedKeywords = [...new Set(personKeywords.map((token) => token.trim()))].filter(
    Boolean
  )
  if (normalizedKeywords.length === 0) {
    return {
      personName: normalizedPersonName,
      keywords: normalizedKeywords,
      entries: [],
      total: 0
    }
  }

  const cacheKey = normalizedPersonName.toLocaleLowerCase()
  const cached = getPersonMentionCache(cacheKey)
  if (cached) {
    const pageIndices = cached.indices.slice(offset, offset + limit)
    return {
      personName: cached.personName,
      keywords: cached.keywords,
      entries: buildPersonMentionPageEntries(
        db,
        pageIndices,
        cached.keywords,
        personIndex,
        matcher
      ),
      total: cached.indices.length
    }
  }

  const filter = buildPersonMentionCandidateFilter(normalizedKeywords)
  if (!filter) {
    return {
      personName: normalizedPersonName,
      keywords: normalizedKeywords,
      entries: [],
      total: 0
    }
  }

  // 先 count 粗召回结果，再分页扫描候选数据，避免一次性把全部文本加载进内存。
  const coarseTotal = (
    db
      .prepare(`SELECT COUNT(*) as count FROM diary_entries WHERE ${filter.whereClause}`)
      .get(...filter.values) as { count: number }
  ).count

  if (coarseTotal <= 0) {
    return {
      personName: normalizedPersonName,
      keywords: normalizedKeywords,
      entries: [],
      total: 0
    }
  }

  const mentionIndexItems: PersonMentionIndexItem[] = []
  let scanOffset = 0

  while (scanOffset < coarseTotal) {
    const scanRows = db
      .prepare(
        `SELECT id, title, plain_content, created_at
         FROM diary_entries
         WHERE ${filter.whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...filter.values, PERSON_MENTION_SCAN_BATCH_SIZE, scanOffset) as MentionDiaryScanRow[]

    if (scanRows.length === 0) break

    for (const row of scanRows) {
      const textForMatch = `${row.title || ''}\n${row.plain_content || ''}`
      const { count } = countMentionsForPerson(
        textForMatch,
        personIndex,
        matcher.mentionRegex,
        matcher.tokenOwners,
        matcher.tokenMetaByKey
      )

      if (count <= 0) continue
      mentionIndexItems.push({
        id: row.id,
        createdAt: row.created_at,
        mentionCount: count
      })
    }

    scanOffset += scanRows.length
  }

  setPersonMentionCache(cacheKey, {
    personName: normalizedPersonName,
    keywords: normalizedKeywords,
    indices: mentionIndexItems
  })

  const pageIndices = mentionIndexItems.slice(offset, offset + limit)

  return {
    personName: normalizedPersonName,
    keywords: normalizedKeywords,
    entries: buildPersonMentionPageEntries(
      db,
      pageIndices,
      normalizedKeywords,
      personIndex,
      matcher
    ),
    total: mentionIndexItems.length
  }
}

function escapeLikePattern(str: string): string {
  return str.replace(/[\\%_]/g, '\\$&')
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
