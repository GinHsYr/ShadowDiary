import { getDatabase, isDisguiseDatabaseActive } from './index'
import type {
  MediaLibraryItem,
  MediaLibraryQueryParams,
  MediaLibraryResult,
  MediaLibrarySourceRef,
  MediaLibrarySourceType
} from '../../types/model'

interface DiaryMediaRow {
  id: string
  title: string
  content: string
  created_at: number
  updated_at: number
}

interface ArchiveMediaRow {
  id: string
  name: string
  main_image: string | null
  images: string | null
  created_at: number
  updated_at: number
}

interface ImagePathCandidate {
  imagePath?: string
  previewPath?: string
}

interface MediaAccumulator {
  id: string
  imagePath: string
  previewPath: string
  latestAt: number
  hasDiarySource: boolean
  hasArchiveSource: boolean
  sourceMap: Map<string, MediaLibrarySourceRef>
}

interface MediaLibrarySnapshot {
  items: MediaLibraryItem[]
  mode: 'real' | 'disguise'
  builtAt: number
}

const DIARY_IMAGE_PATH_RE = /diary-image:\/\/([a-f0-9-]+)(?:(_thumb))?\.[a-z0-9]+/gi
const DIARY_IMAGE_PATH_FULL_RE = /^diary-image:\/\/([a-f0-9-]+)(?:(_thumb))?\.[a-z0-9]+$/i
const MEDIA_CACHE_TTL_MS = 2 * 60 * 1000
const DEFAULT_PAGE_SIZE = 72
const MAX_PAGE_SIZE = 200

let mediaSnapshot: MediaLibrarySnapshot | null = null

function getActiveMode(): 'real' | 'disguise' {
  return isDisguiseDatabaseActive() ? 'disguise' : 'real'
}

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

function normalizeSource(
  source: MediaLibraryQueryParams['source']
): 'all' | MediaLibrarySourceType {
  if (source === 'diary' || source === 'archive') return source
  return 'all'
}

function createFallbackPreviewPath(imageId: string): string {
  return `diary-image://${imageId}_thumb.webp`
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

  let match: RegExpExecArray | null
  DIARY_IMAGE_PATH_RE.lastIndex = 0
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

function collectArchiveImageCandidates(row: ArchiveMediaRow): Map<string, ImagePathCandidate> {
  const candidates = new Map<string, ImagePathCandidate>()
  const paths: string[] = []

  if (row.main_image) {
    paths.push(row.main_image)
  }

  if (row.images) {
    try {
      const parsed: unknown = JSON.parse(row.images)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') {
            paths.push(item)
          }
        }
      }
    } catch (error) {
      console.warn('解析档案媒体图片失败:', error)
    }
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

function upsertMediaAccumulator(
  accumulators: Map<string, MediaAccumulator>,
  imageId: string,
  candidate: ImagePathCandidate,
  source: MediaLibrarySourceRef
): void {
  const sourceKey = `${source.type}:${source.id}`
  const fallbackPreviewPath = createFallbackPreviewPath(imageId)
  const sourceImagePath = candidate.imagePath || candidate.previewPath || fallbackPreviewPath
  const sourcePreviewPath = candidate.previewPath || fallbackPreviewPath
  const existing = accumulators.get(imageId)

  if (!existing) {
    accumulators.set(imageId, {
      id: imageId,
      imagePath: sourceImagePath,
      previewPath: sourcePreviewPath,
      latestAt: source.updatedAt,
      hasDiarySource: source.type === 'diary',
      hasArchiveSource: source.type === 'archive',
      sourceMap: new Map([[sourceKey, source]])
    })
    return
  }

  if (candidate.imagePath && existing.imagePath === existing.previewPath) {
    existing.imagePath = candidate.imagePath
  }

  if (candidate.previewPath && !existing.previewPath.includes('_thumb.')) {
    existing.previewPath = candidate.previewPath
  }

  existing.latestAt = Math.max(existing.latestAt, source.updatedAt)
  existing.hasDiarySource = existing.hasDiarySource || source.type === 'diary'
  existing.hasArchiveSource = existing.hasArchiveSource || source.type === 'archive'

  const previousSource = existing.sourceMap.get(sourceKey)
  if (!previousSource || source.updatedAt >= previousSource.updatedAt) {
    existing.sourceMap.set(sourceKey, source)
  }
}

function buildMediaItems(): MediaLibraryItem[] {
  const db = getDatabase()
  const accumulators = new Map<string, MediaAccumulator>()

  const diaryRows = db
    .prepare(
      `SELECT id, title, content, created_at, updated_at
       FROM diary_entries
       WHERE content LIKE '%diary-image://%'`
    )
    .all() as DiaryMediaRow[]

  for (const row of diaryRows) {
    const source: MediaLibrarySourceRef = {
      type: 'diary',
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }

    const candidates = collectImageCandidatesFromText(row.content)
    for (const [imageId, candidate] of candidates) {
      upsertMediaAccumulator(accumulators, imageId, candidate, source)
    }
  }

  const archiveRows = db
    .prepare(
      `SELECT id, name, main_image, images, created_at, updated_at
       FROM archives
       WHERE main_image LIKE '%diary-image://%' OR images LIKE '%diary-image://%'`
    )
    .all() as ArchiveMediaRow[]

  for (const row of archiveRows) {
    const source: MediaLibrarySourceRef = {
      type: 'archive',
      id: row.id,
      title: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }

    const candidates = collectArchiveImageCandidates(row)
    for (const [imageId, candidate] of candidates) {
      upsertMediaAccumulator(accumulators, imageId, candidate, source)
    }
  }

  return [...accumulators.values()]
    .map((item): MediaLibraryItem => {
      const sourceTypes: MediaLibrarySourceType[] = []
      if (item.hasDiarySource) sourceTypes.push('diary')
      if (item.hasArchiveSource) sourceTypes.push('archive')

      const sources = [...item.sourceMap.values()].sort((a, b) => {
        if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
        return a.id.localeCompare(b.id)
      })

      return {
        id: item.id,
        imagePath: item.imagePath,
        previewPath: item.previewPath || item.imagePath,
        latestAt: item.latestAt,
        sourceTypes,
        sources
      }
    })
    .sort((a, b) => {
      if (b.latestAt !== a.latestAt) return b.latestAt - a.latestAt
      return a.id.localeCompare(b.id)
    })
}

function getOrBuildSnapshot(): MediaLibrarySnapshot {
  const now = Date.now()
  const mode = getActiveMode()
  if (
    mediaSnapshot &&
    mediaSnapshot.mode === mode &&
    now - mediaSnapshot.builtAt < MEDIA_CACHE_TTL_MS
  ) {
    return mediaSnapshot
  }

  const snapshot: MediaLibrarySnapshot = {
    items: buildMediaItems(),
    mode,
    builtAt: now
  }
  mediaSnapshot = snapshot
  return snapshot
}

export function invalidateMediaLibraryCache(): void {
  mediaSnapshot = null
}

export function getMediaLibrary(params: MediaLibraryQueryParams = {}): MediaLibraryResult {
  const source = normalizeSource(params.source)
  const limit = normalizePageSize(params.limit)
  const offset = normalizeOffset(params.offset)
  const snapshot = getOrBuildSnapshot()

  const filteredItems =
    source === 'all'
      ? snapshot.items
      : snapshot.items.filter((item) => item.sourceTypes.includes(source))

  const total = filteredItems.length
  const items = filteredItems.slice(offset, offset + limit)
  const hasMore = offset + items.length < total

  return { items, total, hasMore }
}
