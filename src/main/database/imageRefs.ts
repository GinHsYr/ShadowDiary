import { extractImageIds } from '../utils/imageStorage'
import { getDatabase } from './index'

function normalizeImageIdSet(ids: Iterable<string>): Set<string> {
  const normalized = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (trimmed) normalized.add(trimmed)
  }
  return normalized
}

export function collectImageIdsFromText(content: string | null | undefined): Set<string> {
  if (!content) return new Set()
  return normalizeImageIdSet(extractImageIds(content))
}

export function collectImageIdsFromTexts(contents: Array<string | null | undefined>): Set<string> {
  const imageIds = new Set<string>()
  for (const content of contents) {
    if (!content) continue
    for (const id of extractImageIds(content)) {
      const trimmed = id.trim()
      if (trimmed) imageIds.add(trimmed)
    }
  }
  return imageIds
}

export function syncImageRefs(oldIds: Iterable<string>, newIds: Iterable<string>): string[] {
  const oldSet = normalizeImageIdSet(oldIds)
  const newSet = normalizeImageIdSet(newIds)
  const addedIds = [...newSet].filter((id) => !oldSet.has(id))
  const removedIds = [...oldSet].filter((id) => !newSet.has(id))

  if (addedIds.length === 0 && removedIds.length === 0) return []

  const db = getDatabase()
  const now = Date.now()
  const releasedImageIds: string[] = []

  const upsertRef = db.prepare(`
    INSERT INTO image_refs (image_id, ref_count, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(image_id) DO UPDATE SET
      ref_count = image_refs.ref_count + 1,
      updated_at = excluded.updated_at
  `)
  const decrementRef = db.prepare(`
    UPDATE image_refs
    SET ref_count = CASE WHEN ref_count > 0 THEN ref_count - 1 ELSE 0 END, updated_at = ?
    WHERE image_id = ?
  `)
  const getRefCount = db.prepare('SELECT ref_count FROM image_refs WHERE image_id = ?')
  const deleteRef = db.prepare('DELETE FROM image_refs WHERE image_id = ?')

  const apply = db.transaction(() => {
    for (const imageId of addedIds) {
      upsertRef.run(imageId, now)
    }

    for (const imageId of removedIds) {
      decrementRef.run(now, imageId)
      const row = getRefCount.get(imageId) as { ref_count: number } | undefined
      if (!row || row.ref_count <= 0) {
        deleteRef.run(imageId)
        releasedImageIds.push(imageId)
      }
    }
  })

  apply()
  return releasedImageIds
}

export function getAllReferencedImageIds(): Set<string> {
  const db = getDatabase()
  const rows = db.prepare('SELECT image_id FROM image_refs').all() as { image_id: string }[]
  return normalizeImageIdSet(rows.map((row) => row.image_id))
}
