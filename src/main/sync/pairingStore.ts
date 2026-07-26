import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

interface StoredPeer {
  deviceId: string
  name: string
  encryptedSecret: string
  pairedAt: number
}

interface PairingStoreFile {
  version: 1
  deviceId: string
  peers: StoredPeer[]
}

const FILE_NAME = 'sync-devices.json'

function storePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function emptyStore(): PairingStoreFile {
  return { version: 1, deviceId: randomUUID(), peers: [] }
}

function loadStore(): PairingStoreFile {
  const path = storePath()
  if (!existsSync(path)) {
    const created = emptyStore()
    saveStore(created)
    return created
  }
  let parsed: Partial<PairingStoreFile>
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PairingStoreFile>
  } catch {
    throw new Error('sync_pairing_store_invalid')
  }
  if (parsed.version !== 1 || typeof parsed.deviceId !== 'string' || !Array.isArray(parsed.peers)) {
    throw new Error('sync_pairing_store_invalid')
  }
  return {
    version: 1,
    deviceId: parsed.deviceId,
    peers: parsed.peers.filter(isStoredPeer)
  }
}

function isStoredPeer(value: unknown): value is StoredPeer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const peer = value as Partial<StoredPeer>
  return (
    typeof peer.deviceId === 'string' &&
    typeof peer.name === 'string' &&
    typeof peer.encryptedSecret === 'string' &&
    typeof peer.pairedAt === 'number'
  )
}

function saveStore(value: PairingStoreFile): void {
  const path = storePath()
  const temporaryPath = `${path}.${process.pid}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temporaryPath, path)
}

function assertSecureStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('sync_secure_storage_unavailable')
}

export function getOrCreateSyncDeviceId(): string {
  return loadStore().deviceId
}

export function getPairedSecret(deviceId: string): Buffer | null {
  const peer = loadStore().peers.find((item) => item.deviceId === deviceId)
  if (!peer) return null
  assertSecureStorage()
  return Buffer.from(
    safeStorage.decryptString(Buffer.from(peer.encryptedSecret, 'base64')),
    'base64'
  )
}

export function savePairedSecret(deviceId: string, name: string, secret: Uint8Array): void {
  if (secret.byteLength !== 32) throw new Error('invalid_sync_secret')
  assertSecureStorage()
  const store = loadStore()
  const encryptedSecret = safeStorage
    .encryptString(Buffer.from(secret).toString('base64'))
    .toString('base64')
  const existing = store.peers.find((item) => item.deviceId === deviceId)
  if (existing) {
    existing.name = name
    existing.encryptedSecret = encryptedSecret
  } else {
    store.peers.push({ deviceId, name, encryptedSecret, pairedAt: Date.now() })
  }
  saveStore(store)
}

export function deletePairedSecret(deviceId: string): void {
  const store = loadStore()
  store.peers = store.peers.filter((item) => item.deviceId !== deviceId)
  saveStore(store)
}

export function hasPairedSecret(deviceId: string): boolean {
  return loadStore().peers.some((item) => item.deviceId === deviceId)
}
