import { getDatabase } from './index'
import type {
  Archive,
  DiaryEntry,
  MediaLibraryItem,
  MediaLibraryQueryParams,
  MediaLibraryResult,
  MediaLibrarySourceRef,
  MediaLibrarySourceType
} from '../../types/model'

interface ImagePathCandidate {
  imagePath?: string
  previewPath?: string
}

interface MediaAggregateRow {
  image_id: string
  latest_at: number
  has_diary: number
  has_archive: number
}

interface MediaSourceRow {
  image_id: string
  source_type: MediaLibrarySourceType
  source_id: string
  source_title: string
  source_created_at: number
  source_updated_at: number
  image_path: string
  preview_path: string
}

interface DiaryMediaSourcePayload {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

interface ArchiveMediaSourcePayload {
  id: string
  name: string
  mainImage?: string
  images: string[]
  createdAt: number
  updatedAt: number
}

const DIARY_IMAGE_PATH_RE = /diary-image:\/\/([a-f0-9-]+)(?:(_thumb))?\.[a-z0-9]+/gi
const DIARY_IMAGE_PATH_FULL_RE = /^diary-image:\/\/([a-f0-9-]+)(?:(_thumb))?\.[a-z0-9]+$/i
const DEFAULT_PAGE_SIZE = 72
const MAX_PAGE_SIZE = 200

type NormalizedMediaSource = 'all' | MediaLibrarySourceType

function normalizePageSize(limit: number | undefined): number {
  if (typeof limit !== 'number' || Number.isNaN(limit)) return DEFAULT_PAGE_SIZE
  const rounded = Math.trunc(limit)
  if (rounded <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(rounded, MAX_PAGE_SIZE)
}

function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== 'number' || Number.isNaN(offset)) return 0
  const rounded = Math.trunc(offset)
  if (rounded < 0) return 0
  return rounded
}

function normalizeSource(source: MediaLibraryQueryParams['source']): NormalizedMediaSource {
  if (source === 'diary' || source === 'archive') return source
  return 'all'
}

function createFallbackPreviewPath(imageId: string): string {
  return `diary-image://${imageId}_thumb.webp`
}

function isThumbnailPath(path: string): boolean {
  return /_thumb\.[a-z0-9]+$/i.test(path)
}

function parseImagePath(path: string | null | undefined): {
  imageId: string
  isThumbnail: boolean
  normalizedPath: string
} | null {
  if (!path) return null
  const trimmed = path.trim()
  if (!trimmed) return null

  const match = DIARY_IMAGE_PATH_FULL_RE.exec(trimmed)
  if (!match) return null

  return {
    imageId: match[1].toLowerCase(),
    isThumbnail: Boolean(match[2]),
    normalizedPath: trimmed
  }
}

function collectImageCandidatesFromText(
  text: string | null | undefined
): Map<string, ImagePathCandidate> {
  const candidates = new Map<string, ImagePathCandidate>()
  if (!text) return candidates

  DIARY_IMAGE_PATH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DIARY_IMAGE_PATH_RE.exec(text)) !== null) {
    const imageId = match[1].toLowerCase()
    const fullPath = match[0]
    const isThumbnail = Boolean(match[2])
    const current = candidates.get(imageId) ?? {}

    if (isThumbnail) {
      if (!current.previewPath) {
        current.previewPath = fullPath
      }
    } else if (!current.imagePath) {
      current.imagePath = fullPath
    }

    candidates.set(imageId, current)
  }
  DIARY_IMAGE_PATH_RE.lastIndex = 0

  return candidates
}

function collectArchiveImageCandidates(
  payload: Pick<ArchiveMediaSourcePayload, 'mainImage' | 'images'>
): Map<string, ImagePathCandidate> {
  const candidates = new Map<string, ImagePathCandidate>()
  const paths: string[] = []

  if (payload.mainImage) {
    paths.push(payload.mainImage)
  }

  for (const image of payload.images) {
    paths.push(image)
  }

  for (const path of paths) {
    const parsed = parseImagePath(path)
    if (!parsed) continue

    const current = candidates.get(parsed.imageId) ?? {}
    if (parsed.isThumbnail) {
      if (!current.previewPath) {
        current.previewPath = parsed.normalizedPath
      }
    } else if (!current.imagePath) {
      current.imagePath = parsed.normalizedPath
    }
    candidates.set(parsed.imageId, current)
  }

  return candidates
}

function replaceSourceMediaRefs(
  sourceType: MediaLibrarySourceType,
  sourceId: string,
  sourceTitle: string,
  sourceCreatedAt: number,
  sourceUpdatedAt: number,
  candidates: Map<string, ImagePathCandidate>
): void {
  const db = getDatabase()
  const apply = db.transaction(() => {
    db.prepare('DELETE FROM media_source_refs WHERE source_type = ? AND source_id = ?').run(
      sourceType,
      sourceId
    )

    if (candidates.size === 0) return

    const insertRef = db.prepare(
      `INSERT INTO media_source_refs (
         image_id,
         source_type,
         source_id,
         source_title,
         source_created_at,
         source_updated_at,
         image_path,
         preview_path
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (const [imageId, candidate] of candidates) {
      const fallbackPreviewPath = createFallbackPreviewPath(imageId)
      const imagePath = candidate.imagePath || candidate.previewPath || fallbackPreviewPath
      const previewPath = candidate.previewPath || fallbackPreviewPath
      insertRef.run(
        imageId,
        sourceType,
        sourceId,
        sourceTitle,
        sourceCreatedAt,
        sourceUpdatedAt,
        imagePath,
        previewPath
      )
    }
  })

  apply()
}

export function syncDiaryMediaSource(
  entry: Pick<DiaryEntry, 'id' | 'title' | 'content' | 'createdAt' | 'updatedAt'>
): void {
  const payload: DiaryMediaSourcePayload = {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  }

  replaceSourceMediaRefs(
    'diary',
    payload.id,
    payload.title || '',
    payload.createdAt,
    payload.updatedAt,
    collectImageCandidatesFromText(payload.content)
  )
}

export function removeDiaryMediaSource(diaryId: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM media_source_refs WHERE source_type = ? AND source_id = ?').run(
    'diary',
    diaryId
  )
}

export function syncArchiveMediaSource(
  archive: Pick<Archive, 'id' | 'name' | 'mainImage' | 'images' | 'createdAt' | 'updatedAt'>
): void {
  const payload: ArchiveMediaSourcePayload = {
    id: archive.id,
    name: archive.name,
    mainImage: archive.mainImage,
    images: archive.images,
    createdAt: archive.createdAt,
    updatedAt: archive.updatedAt
  }

  replaceSourceMediaRefs(
    'archive',
    payload.id,
    payload.name || '',
    payload.createdAt,
    payload.updatedAt,
    collectArchiveImageCandidates(payload)
  )
}

export function removeArchiveMediaSource(archiveId: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM media_source_refs WHERE source_type = ? AND source_id = ?').run(
    'archive',
    archiveId
  )
}

export function rebuildMediaSourceIndex(): void {
  const db = getDatabase()
  db.prepare('DELETE FROM media_source_refs').run()

  const diaryRows = db
    .prepare(
      `SELECT id, title, content, created_at, updated_at
       FROM diary_entries
       WHERE content LIKE '%diary-image://%'`
    )
    .iterate() as Iterable<{
    id: string
    title: string
    content: string
    created_at: number
    updated_at: number
  }>

  for (const row of diaryRows) {
    replaceSourceMediaRefs(
      'diary',
      row.id,
      row.title || '',
      row.created_at,
      row.updated_at,
      collectImageCandidatesFromText(row.content)
    )
  }

  const archiveRows = db
    .prepare(
      `SELECT id, name, main_image, images, created_at, updated_at
       FROM archives
       WHERE main_image LIKE '%diary-image://%' OR images LIKE '%diary-image://%'`
    )
    .iterate() as Iterable<{
    id: string
    name: string
    main_image: string | null
    images: string | null
    created_at: number
    updated_at: number
  }>

  for (const row of archiveRows) {
    let images: string[] = []
    if (row.images) {
      try {
        const parsed: unknown = JSON.parse(row.images)
        if (Array.isArray(parsed)) {
          images = parsed.filter((item): item is string => typeof item === 'string')
        }
      } catch {
        images = []
      }
    }

    replaceSourceMediaRefs(
      'archive',
      row.id,
      row.name || '',
      row.created_at,
      row.updated_at,
      collectArchiveImageCandidates({
        mainImage: row.main_image ?? undefined,
        images
      })
    )
  }
}

function buildSourceHavingClause(source: NormalizedMediaSource): string {
  if (source === 'diary') {
    return "HAVING SUM(CASE WHEN source_type = 'diary' THEN 1 ELSE 0 END) > 0"
  }
  if (source === 'archive') {
    return "HAVING SUM(CASE WHEN source_type = 'archive' THEN 1 ELSE 0 END) > 0"
  }
  return ''
}

function getMediaTotal(source: NormalizedMediaSource): number {
  const db = getDatabase()
  const havingClause = buildSourceHavingClause(source)
  const row = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM (
         SELECT image_id
         FROM media_source_refs
         GROUP BY image_id
         ${havingClause}
       ) grouped`
    )
    .get() as { count: number }

  return row.count
}

function getMediaAggregatePage(
  source: NormalizedMediaSource,
  limit: number,
  offset: number
): MediaAggregateRow[] {
  const db = getDatabase()
  const havingClause = buildSourceHavingClause(source)

  return db
    .prepare(
      `SELECT image_id,
              MAX(source_updated_at) as latest_at,
              MAX(CASE WHEN source_type = 'diary' THEN 1 ELSE 0 END) as has_diary,
              MAX(CASE WHEN source_type = 'archive' THEN 1 ELSE 0 END) as has_archive
       FROM media_source_refs
       GROUP BY image_id
       ${havingClause}
       ORDER BY latest_at DESC, image_id ASC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as MediaAggregateRow[]
}

function getMediaSourcesForImages(imageIds: string[]): MediaSourceRow[] {
  if (imageIds.length === 0) return []

  const db = getDatabase()
  const placeholders = imageIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT image_id,
              source_type,
              source_id,
              source_title,
              source_created_at,
              source_updated_at,
              image_path,
              preview_path
       FROM media_source_refs
       WHERE image_id IN (${placeholders})
       ORDER BY source_updated_at DESC, source_id ASC`
    )
    .all(...imageIds) as MediaSourceRow[]
}

function buildMediaItem(
  imageId: string,
  aggregate: MediaAggregateRow,
  sourceRows: MediaSourceRow[]
): MediaLibraryItem {
  const fallbackPreviewPath = createFallbackPreviewPath(imageId)
  let imagePath = sourceRows[0]?.image_path || sourceRows[0]?.preview_path || fallbackPreviewPath
  let previewPath = sourceRows[0]?.preview_path || fallbackPreviewPath

  for (const row of sourceRows) {
    if (isThumbnailPath(imagePath) && row.image_path && !isThumbnailPath(row.image_path)) {
      imagePath = row.image_path
    }
    if (!isThumbnailPath(previewPath) && row.preview_path && isThumbnailPath(row.preview_path)) {
      previewPath = row.preview_path
    }
  }

  const sourceTypes: MediaLibrarySourceType[] = []
  if (aggregate.has_diary > 0) sourceTypes.push('diary')
  if (aggregate.has_archive > 0) sourceTypes.push('archive')

  const sources: MediaLibrarySourceRef[] = sourceRows.map((row) => ({
    type: row.source_type,
    id: row.source_id,
    title: row.source_title,
    createdAt: row.source_created_at,
    updatedAt: row.source_updated_at
  }))

  return {
    id: imageId,
    imagePath,
    previewPath,
    latestAt: aggregate.latest_at,
    sourceTypes,
    sources
  }
}

export function invalidateMediaLibraryCache(): void {
  // No-op: media list now comes from incremental DB index and paged query.
}

export function getMediaLibrary(params: MediaLibraryQueryParams = {}): MediaLibraryResult {
  const source = normalizeSource(params.source)
  const limit = normalizePageSize(params.limit)
  const offset = normalizeOffset(params.offset)

  const total = getMediaTotal(source)
  if (total === 0 || offset >= total) {
    return { items: [], total, hasMore: false }
  }

  const aggregateRows = getMediaAggregatePage(source, limit, offset)
  if (aggregateRows.length === 0) {
    return { items: [], total, hasMore: false }
  }

  const imageIds = aggregateRows.map((row) => row.image_id)
  const sources = getMediaSourcesForImages(imageIds)
  const sourceRowsByImage = new Map<string, MediaSourceRow[]>()
  for (const row of sources) {
    const current = sourceRowsByImage.get(row.image_id)
    if (current) {
      current.push(row)
    } else {
      sourceRowsByImage.set(row.image_id, [row])
    }
  }

  const items = aggregateRows.map((aggregate) => {
    const sourceRows = sourceRowsByImage.get(aggregate.image_id) ?? []
    return buildMediaItem(aggregate.image_id, aggregate, sourceRows)
  })

  const hasMore = offset + items.length < total
  return { items, total, hasMore }
}
