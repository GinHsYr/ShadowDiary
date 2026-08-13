const DIARY_IMAGE_PROTOCOL = 'diary-image://'
const UNSAFE_DIARY_IMAGE_PREFIX_RE = /^unsafe:(?=diary-image:\/\/)/i
const UUID_PATTERN = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
const DIARY_IMAGE_PATH_RE = new RegExp(
  `${DIARY_IMAGE_PROTOCOL}(${UUID_PATTERN})(?:(_thumb))?\\.([a-z0-9]+)`,
  'gi'
)
const DIARY_IMAGE_PATH_FULL_RE = new RegExp(
  `^${DIARY_IMAGE_PROTOCOL}(${UUID_PATTERN})(?:(_thumb))?\\.([a-z0-9]+)$`,
  'i'
)

export interface ParsedDiaryImagePath {
  imageId: string
  isThumbnail: boolean
  extension: string
  filename: string
  normalizedPath: string
}

export interface DiaryImagePathCandidate {
  imagePath?: string
  previewPath?: string
}

export function createDiaryImagePath(filename: string): string {
  return `${DIARY_IMAGE_PROTOCOL}${filename}`
}

export function createThumbnailPath(imageId: string): string {
  return createDiaryImagePath(`${imageId.toLowerCase()}_thumb.webp`)
}

export function parseDiaryImagePath(path: string | null | undefined): ParsedDiaryImagePath | null {
  if (!path) return null
  const trimmed = path.trim().replace(UNSAFE_DIARY_IMAGE_PREFIX_RE, '')
  if (!trimmed) return null

  const match = DIARY_IMAGE_PATH_FULL_RE.exec(trimmed)
  if (!match) return null

  const imageId = match[1].toLowerCase()
  const isThumbnail = Boolean(match[2])
  const extension = match[3].toLowerCase()
  const filename = `${imageId}${isThumbnail ? '_thumb' : ''}.${extension}`

  return {
    imageId,
    isThumbnail,
    extension,
    filename,
    normalizedPath: trimmed
  }
}

export function isDiaryImageThumbnailPath(path: string): boolean {
  return parseDiaryImagePath(path)?.isThumbnail ?? false
}

export function extractDiaryImageIds(value: string | null | undefined): string[] {
  if (!value) return []

  const imageIds: string[] = []
  const normalized = value.replace(/unsafe:(?=diary-image:\/\/)/gi, '')
  DIARY_IMAGE_PATH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DIARY_IMAGE_PATH_RE.exec(normalized)) !== null) {
    imageIds.push(match[1].toLowerCase())
  }
  DIARY_IMAGE_PATH_RE.lastIndex = 0

  return imageIds
}

export function collectDiaryImageCandidatesFromText(
  text: string | null | undefined
): Map<string, DiaryImagePathCandidate> {
  const candidates = new Map<string, DiaryImagePathCandidate>()
  if (!text) return candidates

  const normalized = text.replace(/unsafe:(?=diary-image:\/\/)/gi, '')
  DIARY_IMAGE_PATH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DIARY_IMAGE_PATH_RE.exec(normalized)) !== null) {
    const imageId = match[1].toLowerCase()
    const fullPath = match[0]
    const isThumbnail = Boolean(match[2])
    const current = candidates.get(imageId) ?? {}

    if (isThumbnail) {
      if (!current.previewPath) current.previewPath = fullPath
    } else if (!current.imagePath) {
      current.imagePath = fullPath
    }
    candidates.set(imageId, current)
  }
  DIARY_IMAGE_PATH_RE.lastIndex = 0

  return candidates
}

export function collectDiaryImageCandidatesFromPaths(
  paths: Iterable<string | null | undefined>
): Map<string, DiaryImagePathCandidate> {
  const candidates = new Map<string, DiaryImagePathCandidate>()

  for (const path of paths) {
    const parsed = parseDiaryImagePath(path)
    if (!parsed) continue

    const current = candidates.get(parsed.imageId) ?? {}
    if (parsed.isThumbnail) {
      if (!current.previewPath) current.previewPath = parsed.normalizedPath
    } else if (!current.imagePath) {
      current.imagePath = parsed.normalizedPath
    }
    candidates.set(parsed.imageId, current)
  }

  return candidates
}
