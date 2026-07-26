import { createHash, randomUUID } from 'crypto'
import { getDatabase } from '../database'
import { sanitizeDiaryHtml } from '../database/diary'
import { stripHtmlToPlain } from '../database/migrations'
import { splitArchiveAliases } from '../database/archiveAliases'
import { getImage, storeSyncedImage } from '../utils/imageStorage'
import type {
  PairedSyncDevice,
  SyncAssetManifest,
  SyncConflict,
  SyncConflictChoice,
  SyncEntityType,
  SyncRecord
} from './types'

type VersionRelation = 'equal' | 'localDescends' | 'remoteDescends' | 'concurrent'

interface SyncMetadataRow {
  entity_type: SyncEntityType
  entity_id: string
  version_vector: string
  content_hash: string
  deleted_at: number | null
  modified_at: number
}

interface DiarySyncRow {
  id: string
  title: string
  content: string
  plain_content: string
  mood: string
  weather: string | null
  created_at: number
  updated_at: number
  tags: string | null
}

interface ArchiveSyncRow {
  id: string
  name: string
  alias: string | null
  description: string | null
  type: string
  main_image: string | null
  images: string | null
  created_at: number
  updated_at: number
}

interface SyncConflictRow {
  id: string
  entity_type: SyncEntityType
  entity_id: string
  peer_device_id: string
  local_payload: string | null
  remote_payload: string | null
  local_vector: string
  remote_vector: string
  created_at: number
}

export interface ReconcileResult {
  recordsForPeer: SyncRecord[]
  conflicts: SyncConflict[]
  appliedCount: number
}

const ASSET_ID_RE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?:_thumb)?\.webp$/
const ASSET_URI_RE =
  /diary-image:\/\/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?:_thumb)?\.webp)/gi
const TAG_DELIMITER = '\u001f'

export class DesktopSyncRepository {
  constructor(readonly deviceId: string) {}

  prepareSnapshot(): SyncRecord[] {
    const db = getDatabase()
    const liveRecords = new Map<string, SyncRecord>()
    for (const record of this.readDiaryRecords()) liveRecords.set(recordKey(record), record)
    for (const record of this.readArchiveRecords()) liveRecords.set(recordKey(record), record)

    const metadataRows = db.prepare('SELECT * FROM sync_records').all() as SyncMetadataRow[]
    const metadata = new Map<string, SyncMetadataRow>(
      metadataRows.map((row) => [`${row.entity_type}:${row.entity_id}`, row] as const)
    )
    const now = Date.now()
    const result: SyncRecord[] = []
    const persist = db.prepare(`
      INSERT INTO sync_records(
        entity_type, entity_id, version_vector, content_hash, deleted_at, modified_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        version_vector = excluded.version_vector,
        content_hash = excluded.content_hash,
        deleted_at = excluded.deleted_at,
        modified_at = excluded.modified_at
    `)

    db.transaction(() => {
      for (const [key, source] of liveRecords) {
        const stored = metadata.get(key)
        const storedVector = stored ? decodeVector(stored.version_vector) : {}
        const changed =
          !stored || stored.content_hash !== source.contentHash || stored.deleted_at !== null
        const record: SyncRecord = {
          ...source,
          versionVector: changed ? incrementVector(storedVector, this.deviceId) : storedVector,
          modifiedAt: changed ? now : stored!.modified_at
        }
        persist.run(
          record.entityType,
          record.entityId,
          encodeVector(record.versionVector),
          record.contentHash,
          null,
          record.modifiedAt
        )
        result.push(record)
      }

      for (const [key, stored] of metadata) {
        if (liveRecords.has(key)) continue
        const vector = decodeVector(stored.version_vector)
        const record: SyncRecord = {
          entityType: stored.entity_type,
          entityId: stored.entity_id,
          versionVector:
            stored.deleted_at === null ? incrementVector(vector, this.deviceId) : vector,
          contentHash: stored.content_hash,
          modifiedAt: stored.deleted_at === null ? now : stored.modified_at,
          deletedAt: stored.deleted_at ?? now
        }
        if (stored.deleted_at === null) {
          persist.run(
            record.entityType,
            record.entityId,
            encodeVector(record.versionVector),
            record.contentHash,
            record.deletedAt,
            record.modifiedAt
          )
        }
        result.push(record)
      }
    })()

    return result.sort(
      (a, b) => a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId)
    )
  }

  reconcileRemote(remoteRecords: SyncRecord[], peerDeviceId: string): ReconcileResult {
    const localRecords = new Map(
      this.prepareSnapshot().map((record) => [recordKey(record), record] as const)
    )
    const recordsForPeer: SyncRecord[] = []
    const conflicts: SyncConflict[] = []
    let appliedCount = 0

    for (const remote of remoteRecords) {
      validateRecord(remote)
      const key = recordKey(remote)
      const local = localRecords.get(key)
      localRecords.delete(key)
      if (!local) {
        this.applyRemoteRecord(remote)
        appliedCount++
        continue
      }
      if (
        local.contentHash === remote.contentHash &&
        Boolean(local.deletedAt) === Boolean(remote.deletedAt)
      ) {
        const merged = {
          ...local,
          versionVector: mergeVectors(local.versionVector, remote.versionVector)
        }
        this.writeMetadata(merged)
        this.clearConflict(local.entityType, local.entityId, peerDeviceId)
        recordsForPeer.push(merged)
        continue
      }
      if (
        Boolean(local.deletedAt) === Boolean(remote.deletedAt) &&
        payloadsEquivalentIgnoringUpdatedAt(local.payload, remote.payload)
      ) {
        const useRemote = payloadUpdatedAt(remote) > payloadUpdatedAt(local)
        const preferred = useRemote ? remote : local
        const merged = {
          ...preferred,
          versionVector: mergeVectors(local.versionVector, remote.versionVector)
        }
        if (useRemote) {
          this.applyRemoteRecord(merged)
          appliedCount++
        } else {
          this.writeMetadata(merged)
        }
        this.clearConflict(local.entityType, local.entityId, peerDeviceId)
        recordsForPeer.push(merged)
        continue
      }

      const relation = compareVectors(local.versionVector, remote.versionVector)
      if (relation === 'remoteDescends') {
        this.applyRemoteRecord(remote)
        this.clearConflict(remote.entityType, remote.entityId, peerDeviceId)
        appliedCount++
      } else if (relation === 'localDescends') {
        recordsForPeer.push(local)
      } else {
        conflicts.push(this.storeConflict(local, remote, peerDeviceId))
        recordsForPeer.push(local)
      }
    }
    recordsForPeer.push(...localRecords.values())
    return { recordsForPeer, conflicts, appliedCount }
  }

  listConflicts(): SyncConflict[] {
    const db = getDatabase()
    const rows = db
      .prepare('SELECT * FROM sync_conflicts ORDER BY created_at DESC')
      .all() as SyncConflictRow[]
    return rows.map(conflictFromRow)
  }

  resolveConflict(conflictId: string, choice: SyncConflictChoice): void {
    const conflict = this.listConflicts().find((item) => item.id === conflictId)
    if (!conflict) throw new Error('sync_conflict_not_found')
    const local = recordFromConflict(conflict, 'local')
    const remote = recordFromConflict(conflict, 'remote')
    const mergedVector = incrementVector(
      mergeVectors(local.versionVector, remote.versionVector),
      this.deviceId
    )

    if (choice === 'keepRemote') {
      this.applyRemoteRecord({ ...remote, versionVector: mergedVector })
    } else {
      this.applyRemoteRecord({ ...local, versionVector: mergedVector })
      if (choice === 'keepBoth' && remote.payload) {
        const copyId = randomUUID()
        const isDiary = remote.entityType === 'diary'
        const titleKey = isDiary ? 'title' : 'name'
        const originalTitle = String(remote.payload[titleKey] ?? '')
        const payload: Record<string, unknown> = {
          ...remote.payload,
          id: copyId,
          [titleKey]: `${originalTitle} (冲突副本)`,
          updatedAt: Date.now()
        }
        this.applyRemoteRecord({
          entityType: remote.entityType,
          entityId: copyId,
          versionVector: { [this.deviceId]: 1 },
          contentHash: payloadHash(payload),
          modifiedAt: Date.now(),
          payload
        })
      }
    }
    getDatabase().prepare('DELETE FROM sync_conflicts WHERE id = ?').run(conflict.id)
  }

  async collectAssets(records: SyncRecord[]): Promise<SyncAssetManifest[]> {
    const ids = new Set<string>()
    for (const record of records) {
      if (!record.payload) continue
      for (const id of assetIdsFromPayload(record.payload)) ids.add(id)
    }

    const assets: SyncAssetManifest[] = []
    for (const id of ids) {
      try {
        const bytes = await getImage(id)
        assets.push({
          id,
          size: bytes.byteLength,
          sha256: sha256(bytes),
          mimeType: 'image/webp'
        })
      } catch {
        // A missing local image remains visible as missing instead of aborting all records.
      }
    }
    return assets
  }

  async readAsset(id: string): Promise<Buffer> {
    assertAssetId(id)
    return await getImage(id)
  }

  async hasAsset(id: string, expectedHash: string): Promise<boolean> {
    try {
      return sha256(await this.readAsset(id)) === expectedHash.toLowerCase()
    } catch {
      return false
    }
  }

  async storeAsset(id: string, bytes: Uint8Array, expectedHash: string): Promise<void> {
    assertAssetId(id)
    if (sha256(bytes) !== expectedHash.toLowerCase()) throw new Error('asset_hash_mismatch')
    await storeSyncedImage(id, bytes)
  }

  rememberPeer(deviceId: string, name: string): void {
    const now = Date.now()
    getDatabase()
      .prepare(
        `INSERT INTO sync_devices(device_id, name, paired_at, last_seen_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           name = excluded.name,
           last_seen_at = excluded.last_seen_at`
      )
      .run(deviceId, name, now, now)
  }

  markPeerSynced(deviceId: string): void {
    const now = Date.now()
    getDatabase()
      .prepare('UPDATE sync_devices SET last_seen_at = ?, last_sync_at = ? WHERE device_id = ?')
      .run(now, now, deviceId)
  }

  listPairedDevices(): PairedSyncDevice[] {
    return getDatabase()
      .prepare(
        `SELECT device_id AS deviceId, name, paired_at AS pairedAt,
                last_seen_at AS lastSeenAt, last_sync_at AS lastSyncAt
         FROM sync_devices ORDER BY COALESCE(last_sync_at, paired_at) DESC`
      )
      .all() as PairedSyncDevice[]
  }

  forgetPeer(deviceId: string): void {
    const db = getDatabase()
    db.transaction(() => {
      db.prepare('DELETE FROM sync_devices WHERE device_id = ?').run(deviceId)
      db.prepare('DELETE FROM sync_conflicts WHERE peer_device_id = ?').run(deviceId)
    })()
  }

  private readDiaryRecords(): SyncRecord[] {
    const rows = getDatabase()
      .prepare(
        `SELECT e.id, e.title, e.content, e.plain_content, e.mood, e.weather,
                e.created_at, e.updated_at,
                GROUP_CONCAT(t.name, char(31)) AS tags
         FROM diary_entries e
         LEFT JOIN diary_tags dt ON dt.diary_id = e.id
         LEFT JOIN tags t ON t.id = dt.tag_id
         GROUP BY e.id ORDER BY e.id`
      )
      .all() as DiarySyncRow[]
    return rows.map((row) => {
      const created = new Date(row.created_at)
      const calendarDate = `${created.getFullYear().toString().padStart(4, '0')}-${(created.getMonth() + 1).toString().padStart(2, '0')}-${created.getDate().toString().padStart(2, '0')}`
      const tags = row.tags ? row.tags.split(TAG_DELIMITER).filter(Boolean).sort() : []
      const payload: Record<string, unknown> = {
        id: row.id,
        title: row.title,
        content: canonicalizeMediaSources(row.content),
        plainContent: row.plain_content,
        mood: row.mood,
        weather: row.weather,
        calendarDate,
        createdAt: Date.UTC(created.getFullYear(), created.getMonth(), created.getDate()),
        updatedAt: row.updated_at,
        tags
      }
      return {
        entityType: 'diary',
        entityId: row.id,
        versionVector: {},
        contentHash: payloadHash(payload),
        modifiedAt: row.updated_at,
        payload
      }
    })
  }

  private readArchiveRecords(): SyncRecord[] {
    const rows = getDatabase()
      .prepare('SELECT * FROM archives ORDER BY id')
      .all() as ArchiveSyncRow[]
    return rows.map((row) => {
      const payload: Record<string, unknown> = {
        id: row.id,
        name: row.name,
        aliases: splitArchiveAliases(row.alias),
        description: row.description,
        type: row.type,
        mainImage: row.main_image ? canonicalizeMediaSources(row.main_image) : null,
        images: decodeStringList(row.images).map(canonicalizeMediaSources),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
      return {
        entityType: 'archive',
        entityId: row.id,
        versionVector: {},
        contentHash: payloadHash(payload),
        modifiedAt: row.updated_at,
        payload
      }
    })
  }

  private applyRemoteRecord(record: SyncRecord): void {
    validateRecord(record)
    const db = getDatabase()
    db.transaction(() => {
      if (record.deletedAt || !record.payload) {
        db.prepare(
          `DELETE FROM ${record.entityType === 'diary' ? 'diary_entries' : 'archives'} WHERE id = ?`
        ).run(record.entityId)
      } else if (record.entityType === 'diary') {
        this.applyDiary(record.payload)
      } else {
        this.applyArchive(record.payload)
      }
      this.writeMetadata(record)
    })()
  }

  private applyDiary(payload: Record<string, unknown>): void {
    const db = getDatabase()
    const id = requiredString(payload.id, 'diary.id')
    const content = sanitizeDiaryHtml(requiredString(payload.content, 'diary.content'))
    db.prepare(
      `INSERT INTO diary_entries(
         id, title, content, plain_content, mood, weather, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         plain_content = excluded.plain_content,
         mood = excluded.mood,
         weather = excluded.weather,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      id,
      String(payload.title ?? ''),
      content,
      typeof payload.plainContent === 'string' ? payload.plainContent : stripHtmlToPlain(content),
      String(payload.mood ?? 'calm'),
      typeof payload.weather === 'string' ? payload.weather : null,
      localDiaryTimestamp(payload),
      requiredNumber(payload.updatedAt, 'diary.updatedAt')
    )
    db.prepare('DELETE FROM diary_tags WHERE diary_id = ?').run(id)
    const insertTag = db.prepare('INSERT OR IGNORE INTO tags(name) VALUES (?)')
    const findTag = db.prepare('SELECT id FROM tags WHERE name = ?')
    const linkTag = db.prepare('INSERT OR IGNORE INTO diary_tags(diary_id, tag_id) VALUES (?, ?)')
    for (const tag of stringArray(payload.tags)) {
      insertTag.run(tag)
      const row = findTag.get(tag) as { id: number }
      linkTag.run(id, row.id)
    }
  }

  private applyArchive(payload: Record<string, unknown>): void {
    getDatabase()
      .prepare(
        `INSERT INTO archives(
           id, name, alias, description, type, main_image, images, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           alias = excluded.alias,
           description = excluded.description,
           type = excluded.type,
           main_image = excluded.main_image,
           images = excluded.images,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`
      )
      .run(
        requiredString(payload.id, 'archive.id'),
        String(payload.name ?? ''),
        stringArray(payload.aliases).join(', ') || null,
        typeof payload.description === 'string' ? payload.description : null,
        ['person', 'object', 'other'].includes(String(payload.type))
          ? String(payload.type)
          : 'other',
        typeof payload.mainImage === 'string' ? payload.mainImage : null,
        JSON.stringify(stringArray(payload.images)),
        requiredNumber(payload.createdAt, 'archive.createdAt'),
        requiredNumber(payload.updatedAt, 'archive.updatedAt')
      )
  }

  private writeMetadata(record: SyncRecord): void {
    getDatabase()
      .prepare(
        `INSERT INTO sync_records(
           entity_type, entity_id, version_vector, content_hash, deleted_at, modified_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           version_vector = excluded.version_vector,
           content_hash = excluded.content_hash,
           deleted_at = excluded.deleted_at,
           modified_at = excluded.modified_at`
      )
      .run(
        record.entityType,
        record.entityId,
        encodeVector(record.versionVector),
        record.contentHash,
        record.deletedAt ?? null,
        record.modifiedAt
      )
  }

  private clearConflict(entityType: SyncEntityType, entityId: string, peerDeviceId: string): void {
    getDatabase()
      .prepare(
        `DELETE FROM sync_conflicts
         WHERE entity_type = ? AND entity_id = ? AND peer_device_id = ?`
      )
      .run(entityType, entityId, peerDeviceId)
  }

  private storeConflict(local: SyncRecord, remote: SyncRecord, peerDeviceId: string): SyncConflict {
    const conflict: SyncConflict = {
      id: randomUUID(),
      entityType: local.entityType,
      entityId: local.entityId,
      peerDeviceId,
      localPayload: local.payload,
      remotePayload: remote.payload,
      localVector: local.versionVector,
      remoteVector: remote.versionVector,
      createdAt: Date.now()
    }
    this.clearConflict(local.entityType, local.entityId, peerDeviceId)
    getDatabase()
      .prepare(
        `INSERT INTO sync_conflicts(
           id, entity_type, entity_id, peer_device_id, local_payload, remote_payload,
           local_vector, remote_vector, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        conflict.id,
        conflict.entityType,
        conflict.entityId,
        conflict.peerDeviceId,
        conflict.localPayload ? JSON.stringify(conflict.localPayload) : null,
        conflict.remotePayload ? JSON.stringify(conflict.remotePayload) : null,
        encodeVector(conflict.localVector),
        encodeVector(conflict.remoteVector),
        conflict.createdAt
      )
    return conflict
  }
}

function recordKey(record: Pick<SyncRecord, 'entityType' | 'entityId'>): string {
  return `${record.entityType}:${record.entityId}`
}

export function compareVectors(
  local: Record<string, number>,
  remote: Record<string, number>
): VersionRelation {
  let localGreater = false
  let remoteGreater = false
  for (const deviceId of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const localValue = local[deviceId] ?? 0
    const remoteValue = remote[deviceId] ?? 0
    if (localValue > remoteValue) localGreater = true
    if (remoteValue > localValue) remoteGreater = true
  }
  if (!localGreater && !remoteGreater) return 'equal'
  if (localGreater && !remoteGreater) return 'localDescends'
  if (!localGreater && remoteGreater) return 'remoteDescends'
  return 'concurrent'
}

export function mergeVectors(
  first: Record<string, number>,
  second: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const deviceId of new Set([...Object.keys(first), ...Object.keys(second)])) {
    result[deviceId] = Math.max(first[deviceId] ?? 0, second[deviceId] ?? 0)
  }
  return result
}

function incrementVector(vector: Record<string, number>, deviceId: string): Record<string, number> {
  return { ...vector, [deviceId]: (vector[deviceId] ?? 0) + 1 }
}

function encodeVector(vector: Record<string, number>): string {
  return stableStringify(vector)
}

function decodeVector(value: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, Number(item) || 0]))
  } catch {
    return {}
  }
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function payloadsEquivalentIgnoringUpdatedAt(
  local: Record<string, unknown> | undefined,
  remote: Record<string, unknown> | undefined
): boolean {
  if (!local || !remote) return local === remote
  const localContent = { ...local }
  const remoteContent = { ...remote }
  delete localContent.updatedAt
  delete remoteContent.updatedAt
  return stableStringify(localContent) === stableStringify(remoteContent)
}

function payloadUpdatedAt(record: SyncRecord): number {
  const value = record.payload?.updatedAt
  return typeof value === 'number' && Number.isFinite(value) ? value : record.modifiedAt
}

function payloadHash(payload?: Record<string, unknown>): string {
  return payload ? sha256(Buffer.from(stableStringify(payload), 'utf8')) : ''
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalizeMediaSources(value: string): string {
  return value.replace(
    /(?:file:(?:\/\/)?[^"'<>\s]*|[A-Za-z]:[\\/][^"'<>\s]*)([a-fA-F0-9-]{36}(?:_thumb)?\.webp)/gi,
    (_match, filename: string) => `diary-image://${filename.toLowerCase()}`
  )
}

function decodeStringList(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function assetIdsFromPayload(payload: Record<string, unknown>): string[] {
  const values: string[] = []
  if (typeof payload.content === 'string') values.push(payload.content)
  if (typeof payload.mainImage === 'string') values.push(payload.mainImage)
  values.push(...stringArray(payload.images))
  const ids = new Set<string>()
  for (const value of values) {
    ASSET_URI_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = ASSET_URI_RE.exec(value)) !== null) ids.add(match[1].toLowerCase())
    ASSET_URI_RE.lastIndex = 0
  }
  return [...ids]
}

function assertAssetId(id: string): void {
  if (!ASSET_ID_RE.test(id.toLowerCase())) throw new Error('invalid_asset_id')
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid_sync_field:${field}`)
  return value
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid_sync_field:${field}`)
  }
  return Math.trunc(value)
}

function localDiaryTimestamp(payload: Record<string, unknown>): number {
  if (typeof payload.calendarDate === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(payload.calendarDate)
    if (match) {
      const year = Number(match[1])
      const month = Number(match[2])
      const day = Number(match[3])
      const localNoon = new Date(year, month - 1, day, 12, 0, 0, 0)
      if (
        localNoon.getFullYear() === year &&
        localNoon.getMonth() === month - 1 &&
        localNoon.getDate() === day
      ) {
        return localNoon.getTime()
      }
    }
  }
  return requiredNumber(payload.createdAt, 'diary.createdAt')
}

function validateRecord(record: SyncRecord): void {
  if (!record || (record.entityType !== 'diary' && record.entityType !== 'archive')) {
    throw new Error('invalid_sync_record')
  }
  if (typeof record.entityId !== 'string' || record.entityId.length > 128) {
    throw new Error('invalid_sync_record_id')
  }
  if (!/^[a-f0-9]{64}$|^$/i.test(record.contentHash)) throw new Error('invalid_sync_hash')
  if (!Number.isSafeInteger(record.modifiedAt)) throw new Error('invalid_sync_timestamp')
  for (const value of Object.values(record.versionVector)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_sync_vector')
  }
  if (record.payload && stableStringify(record.payload).length > 8 * 1024 * 1024) {
    throw new Error('sync_record_too_large')
  }
}

function conflictFromRow(row: SyncConflictRow): SyncConflict {
  const parsePayload = (value: string | null): Record<string, unknown> | undefined => {
    if (!value) return undefined
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  }
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    peerDeviceId: row.peer_device_id,
    localPayload: parsePayload(row.local_payload),
    remotePayload: parsePayload(row.remote_payload),
    localVector: decodeVector(row.local_vector),
    remoteVector: decodeVector(row.remote_vector),
    createdAt: row.created_at
  }
}

function recordFromConflict(conflict: SyncConflict, side: 'local' | 'remote'): SyncRecord {
  const payload = side === 'local' ? conflict.localPayload : conflict.remotePayload
  const vector = side === 'local' ? conflict.localVector : conflict.remoteVector
  return {
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    versionVector: vector,
    contentHash: payloadHash(payload),
    modifiedAt: Date.now(),
    payload,
    ...(payload ? {} : { deletedAt: Date.now() })
  }
}
