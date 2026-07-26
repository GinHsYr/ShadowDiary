export const SYNC_PROTOCOL_VERSION = 1 as const
export const SYNC_SUBPROTOCOL = 'shadowdiary-sync-v1' as const
export const SYNC_SERVICE_TYPE = 'shadowdiary' as const

export type SyncEntityType = 'diary' | 'archive'
export type SyncPhase =
  | 'disabled'
  | 'discovering'
  | 'pairing'
  | 'connecting'
  | 'syncing'
  | 'conflicts'
  | 'completed'
  | 'failed'

export interface SyncRecord {
  entityType: SyncEntityType
  entityId: string
  versionVector: Record<string, number>
  contentHash: string
  modifiedAt: number
  payload?: Record<string, unknown>
  deletedAt?: number
}

export interface SyncAssetManifest {
  id: string
  size: number
  sha256: string
  mimeType: string
  path?: string
}

export interface SyncConflict {
  id: string
  entityType: SyncEntityType
  entityId: string
  peerDeviceId: string
  localPayload?: Record<string, unknown>
  remotePayload?: Record<string, unknown>
  localVector: Record<string, number>
  remoteVector: Record<string, number>
  createdAt: number
}

export interface PairedSyncDevice {
  deviceId: string
  name: string
  pairedAt: number
  lastSeenAt?: number
  lastSyncAt?: number
}

export interface SyncRuntimeState {
  enabled: boolean
  phase: SyncPhase
  port?: number
  pairingCode?: string
  pairingExpiresAt?: number
  pairedDevices: PairedSyncDevice[]
  conflictCount: number
  activeDeviceId?: string
  completedRecords: number
  totalRecords: number
  completedBytes: number
  totalBytes: number
  lastSyncAt?: number
  error?: string
}

export type SyncConflictChoice = 'keepLocal' | 'keepRemote' | 'keepBoth'
