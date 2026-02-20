import { randomUUID } from 'crypto'
import { getDatabase } from './index'
import { stripHtmlToPlain } from './migrations'
import type {
  DiaryEntry,
  Mood,
  SearchParams,
  HomePageStats,
  SearchResult,
  PersonMentionDetailItem,
  PersonMentionDetailResult
} from '../../types/model'

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

function sanitizeDiaryHtml(content: string): string {
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
  const sanitizedContent = sanitizeDiaryHtml(entry.content)
  const plainContent = stripHtmlToPlain(sanitizedContent)

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
          sanitizedContent,
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
      sanitizedContent,
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
  invalidatePersonMentionCache()
  return getDiaryEntry(id)!
}

export function deleteDiaryEntry(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM diary_entries WHERE id = ?').run(id)
  const deleted = result.changes > 0
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
    for (const alias of splitAliases(row.alias)) {
      allNames.add(alias)
    }
  }

  return Array.from(allNames)
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

  const keywordGroups: string[][] = []

  // Keyword search: split by spaces for multi-keyword AND matching
  // 每个关键词如果匹配到档案，则扩展为该档案的所有名称（OR 逻辑）
  if (params.keyword && params.keyword.trim()) {
    const keywords = params.keyword.trim().split(/\s+/).filter(Boolean)
    for (const kw of keywords) {
      // 扩展关键词：如果匹配档案，加入该档案的所有别名
      const expandedKeywords = [
        ...new Set(expandKeywordWithArchiveAliases(kw).map((k) => k.trim()))
      ].filter(Boolean)
      if (expandedKeywords.length === 0) continue
      keywordGroups.push(expandedKeywords)

      // 收集所有扩展的关键词
      for (const ek of expandedKeywords) {
        allExpandedKeywords.add(ek)
      }
    }
  }

  if (keywordGroups.length > 0) {
    const ftsExpression = buildFtsMatchExpression(keywordGroups)
    const likeGroupConditions: string[] = []
    const likeValues: unknown[] = []

    for (const keywordGroup of keywordGroups) {
      const orConditions: string[] = []
      for (const keyword of keywordGroup) {
        const likePattern = `%${escapeLikePattern(keyword)}%`
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

    if (keywordClauses.length === 1) {
      conditions.push(keywordClauses[0])
      values.push(...keywordValues)
    } else if (keywordClauses.length > 1) {
      // FTS 命中快，但中文连续文本场景可能被分词漏掉，补充 LIKE 保证不漏召回。
      conditions.push(`(${keywordClauses.join(' OR ')})`)
      values.push(...keywordValues)
    }
  }

  // Mood filter
  if (params.mood) {
    conditions.push('e.mood = ?')
    values.push(params.mood)
  }

  // Date range
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

  const tagsByDiaryId = getTagsByDiaryIds(rows.map((row) => row.id))
  const entries = rows.map((row) => rowToEntry(row, tagsByDiaryId.get(row.id) ?? []))

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

function splitAliases(alias: string | null): string[] {
  if (!alias) return []
  return alias
    .split(/[,，、;；\n\r]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

function buildPersonMentionMatcher(personArchives: PersonArchiveRow[]): PersonMentionMatcher {
  const personNames = personArchives.map((p) => p.name)
  const personTokens: string[][] = []
  const tokenOwners = new Map<string, Set<number>>()
  const tokenMetaByKey = new Map<string, PersonTokenMeta>()

  for (let i = 0; i < personArchives.length; i++) {
    const person = personArchives[i]
    const tokenMetaForPerson = new Map<string, { token: string; isAlias: boolean }>()
    const rawTokens = [
      { token: person.name, isAlias: false },
      ...splitAliases(person.alias).map((token) => ({ token, isAlias: true }))
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

interface PersonMentionCacheEntry {
  personName: string
  keywords: string[]
  entries: PersonMentionDetailItem[]
}

const PERSON_MENTION_CACHE_LIMIT = 6
const personMentionDetailCache = new Map<string, PersonMentionCacheEntry>()

function setPersonMentionCache(key: string, entry: PersonMentionCacheEntry): void {
  if (
    !personMentionDetailCache.has(key) &&
    personMentionDetailCache.size >= PERSON_MENTION_CACHE_LIMIT
  ) {
    const oldestKey = personMentionDetailCache.keys().next().value
    if (oldestKey) {
      personMentionDetailCache.delete(oldestKey)
    }
  }
  personMentionDetailCache.set(key, entry)
}

export function invalidatePersonMentionCache(): void {
  personMentionDetailCache.clear()
}

export function getPersonMentionStats(): { name: string; count: number }[] {
  const db = getDatabase()

  // 获取所有 type='person' 的档案
  const personArchives = db
    .prepare('SELECT name, alias FROM archives WHERE type = ?')
    .all('person') as PersonArchiveRow[]

  if (personArchives.length === 0) return []

  const matcher = buildPersonMentionMatcher(personArchives)
  if (!matcher.mentionRegex) return []

  const mentionCounts = new Array<number>(personArchives.length).fill(0)
  const diaryRows = db.prepare('SELECT plain_content FROM diary_entries').iterate() as Iterable<{
    plain_content: string
  }>

  for (const row of diaryRows) {
    const text = row.plain_content || ''
    if (!text) continue

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

      mentionCounts[ownerIndex]++
    }
  }

  return matcher.personNames
    .map((name, index) => ({ name, count: mentionCounts[index] }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
}

export function getPersonMentionDetails(
  personName: string,
  params?: { limit?: number; offset?: number }
): PersonMentionDetailResult {
  const db = getDatabase()
  const limit = params?.limit ?? 50
  const offset = params?.offset ?? 0

  const personArchives = db
    .prepare('SELECT name, alias FROM archives WHERE type = ?')
    .all('person') as PersonArchiveRow[]

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
  const cached = personMentionDetailCache.get(cacheKey)
  if (cached) {
    return {
      personName: cached.personName,
      keywords: cached.keywords,
      entries: cached.entries.slice(offset, offset + limit),
      total: cached.entries.length
    }
  }

  const rows: Iterable<MentionDiaryRow> = (() => {
    const coarseKeywords = [
      ...new Set(normalizedKeywords.map((token) => token.toLocaleLowerCase()))
    ]
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
      filters.unshift(
        `rowid IN (SELECT rowid FROM diary_search_fts WHERE diary_search_fts MATCH ?)`
      )
      values.unshift(ftsExpression)
    }

    return db
      .prepare(
        `SELECT id, title, plain_content, mood, created_at, updated_at
         FROM diary_entries
         WHERE ${filters.join(' OR ')}
         ORDER BY created_at DESC`
      )
      .iterate(...values) as Iterable<MentionDiaryRow>
  })()

  const allEntries: PersonMentionDetailItem[] = []
  for (const row of rows) {
    const textForMatch = `${row.title || ''}\n${row.plain_content || ''}`
    const { count, matchedKeys } = countMentionsForPerson(
      textForMatch,
      personIndex,
      matcher.mentionRegex,
      matcher.tokenOwners,
      matcher.tokenMetaByKey
    )

    if (count <= 0) continue

    const matchedKeywords = normalizedKeywords.filter((token) =>
      matchedKeys.has(token.toLocaleLowerCase())
    )

    allEntries.push({
      id: row.id,
      title: row.title,
      content: row.plain_content,
      mood: row.mood,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      mentionCount: count,
      matchedKeywords
    })
  }

  setPersonMentionCache(cacheKey, {
    personName: normalizedPersonName,
    keywords: normalizedKeywords,
    entries: allEntries
  })

  return {
    personName: normalizedPersonName,
    keywords: normalizedKeywords,
    entries: allEntries.slice(offset, offset + limit),
    total: allEntries.length
  }
}

function escapeLikePattern(str: string): string {
  return str.replace(/[\\%_]/g, '\\$&')
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
