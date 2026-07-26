import { app } from 'electron'
import { hostname } from 'os'
import { randomBytes, randomInt } from 'crypto'
import Bonjour from 'bonjour-service'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { getRealSetting, setRealSetting } from '../database/settings'
import { getDatabase } from '../database'
import { invalidatePersonMentionCache, rebuildPersonMentionStatsIndex } from '../database/diary'
import { invalidateMediaLibraryCache, rebuildMediaSourceIndex } from '../database/media'
import {
  collectImageIdsFromTexts,
  getAllReferencedImageIds,
  syncImageRefs
} from '../database/imageRefs'
import {
  createEphemeralKeyPair,
  createProof,
  derivePairingKey,
  deriveSessionKey,
  SyncSessionCipher,
  verifyProof
} from './crypto'
import {
  deletePairedSecret,
  getOrCreateSyncDeviceId,
  getPairedSecret,
  hasPairedSecret,
  savePairedSecret
} from './pairingStore'
import { DesktopSyncRepository } from './repository'
import {
  SYNC_PROTOCOL_VERSION,
  SYNC_SERVICE_TYPE,
  SYNC_SUBPROTOCOL,
  type SyncAssetManifest,
  type SyncConflict,
  type SyncConflictChoice,
  type SyncRecord,
  type SyncRuntimeState
} from './types'

const SYNC_ENABLED_SETTING = 'sync.enabled'
const MAX_RECORDS = 100_000
const MAX_ASSET_BYTES = 32 * 1024 * 1024
const CHUNK_SIZE = 192 * 1024
const PAIRING_TTL_MS = 2 * 60 * 1000
const MAX_PAIRING_ATTEMPTS = 5

type StateListener = (state: SyncRuntimeState, dataChanged?: boolean) => void
type PrepareForSync = () => Promise<void>

class ShadowDiarySyncServer {
  private readonly deviceId = getOrCreateSyncDeviceId()
  private readonly repository = new DesktopSyncRepository(this.deviceId)
  private readonly listener: StateListener
  private readonly prepareForSync: PrepareForSync
  private webSocketServer: WebSocketServer | null = null
  private bonjour: Bonjour | null = null
  private service: ReturnType<Bonjour['publish']> | null = null
  private pairingTimer: NodeJS.Timeout | null = null
  private pairingAttempts = 0
  private persistentlyEnabled = false
  private paused = false
  private syncSessionActive = false
  private state: SyncRuntimeState = {
    enabled: false,
    phase: 'disabled',
    pairedDevices: [],
    conflictCount: 0,
    completedRecords: 0,
    totalRecords: 0,
    completedBytes: 0,
    totalBytes: 0
  }

  constructor(listener: StateListener, prepareForSync: PrepareForSync) {
    this.listener = listener
    this.prepareForSync = prepareForSync
    this.refreshState()
  }

  async initialize(): Promise<void> {
    this.persistentlyEnabled = getRealSetting(SYNC_ENABLED_SETTING) === 'true'
    if (this.persistentlyEnabled) await this.start()
  }

  getState(): SyncRuntimeState {
    this.refreshState()
    return structuredClone(this.state)
  }

  async setEnabled(enabled: boolean): Promise<SyncRuntimeState> {
    this.persistentlyEnabled = enabled
    setRealSetting(SYNC_ENABLED_SETTING, enabled ? 'true' : 'false')
    if (enabled) {
      this.paused = false
      await this.start()
    } else {
      await this.stop()
    }
    return this.getState()
  }

  async pause(): Promise<void> {
    this.paused = true
    await this.stop(false)
  }

  async resume(): Promise<void> {
    this.paused = false
    if (this.persistentlyEnabled) await this.start()
  }

  async beginPairing(): Promise<SyncRuntimeState> {
    if (!this.persistentlyEnabled) await this.setEnabled(true)
    if (!this.webSocketServer) throw new Error('sync_server_unavailable')
    this.clearPairing()
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const expiresAt = Date.now() + PAIRING_TTL_MS
    this.pairingAttempts = MAX_PAIRING_ATTEMPTS
    this.state = {
      ...this.state,
      phase: 'pairing',
      pairingCode: code,
      pairingExpiresAt: expiresAt,
      error: undefined
    }
    this.pairingTimer = setTimeout(() => this.clearPairing(), PAIRING_TTL_MS)
    this.publishService()
    this.emit()
    return this.getState()
  }

  listConflicts(): SyncConflict[] {
    return this.repository.listConflicts()
  }

  resolveConflict(id: string, choice: SyncConflictChoice): SyncRuntimeState {
    this.repository.resolveConflict(id, choice)
    this.rebuildDerivedData()
    this.refreshState()
    this.listener(this.getState(), true)
    return this.getState()
  }

  unpair(deviceId: string): SyncRuntimeState {
    deletePairedSecret(deviceId)
    this.repository.forgetPeer(deviceId)
    this.refreshState()
    this.emit()
    return this.getState()
  }

  async shutdown(): Promise<void> {
    this.persistentlyEnabled = false
    await this.stop(false)
  }

  private async start(): Promise<void> {
    if (this.webSocketServer || this.paused) return
    const server = new WebSocketServer({
      host: '0.0.0.0',
      port: 0,
      maxPayload: 48 * 1024 * 1024,
      handleProtocols: (protocols) => (protocols.has(SYNC_SUBPROTOCOL) ? SYNC_SUBPROTOCOL : false)
    })
    this.webSocketServer = server
    server.on('connection', (socket, request) => {
      if (request.url !== '/sync' || socket.protocol !== SYNC_SUBPROTOCOL) {
        socket.close(1008, 'invalid sync endpoint')
        return
      }
      void this.handleConnection(socket)
    })
    server.on('error', (error) => this.fail(error))
    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }
      server.once('listening', onListening)
      server.once('error', onError)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('sync_server_port_unavailable')
    this.state = {
      ...this.state,
      enabled: true,
      phase: 'discovering',
      port: address.port,
      error: undefined
    }
    this.publishService()
    this.emit()
  }

  private async stop(resetPersistentState = true): Promise<void> {
    this.clearPairing()
    if (this.service) {
      const service = this.service
      this.service = null
      await new Promise<void>((resolve) => service.stop(() => resolve()))
    }
    if (this.bonjour) {
      const bonjour = this.bonjour
      this.bonjour = null
      await new Promise<void>((resolve) => bonjour.destroy(() => resolve()))
    }
    if (this.webSocketServer) {
      const server = this.webSocketServer
      this.webSocketServer = null
      for (const client of server.clients) client.close(1001, 'sync server stopped')
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    this.state = {
      ...this.state,
      enabled: false,
      phase: 'disabled',
      port: undefined,
      activeDeviceId: undefined,
      pairingCode: undefined,
      pairingExpiresAt: undefined
    }
    if (resetPersistentState) this.persistentlyEnabled = false
    this.emit()
  }

  private publishService(): void {
    if (!this.webSocketServer || !this.state.port) return
    if (this.service) this.service.stop()
    if (!this.bonjour) this.bonjour = new Bonjour()
    this.service = this.bonjour.publish({
      name: `${app.getName()} · ${hostname()}`,
      type: SYNC_SERVICE_TYPE,
      protocol: 'tcp',
      port: this.state.port,
      txt: {
        id: this.deviceId,
        pv: String(SYNC_PROTOCOL_VERSION),
        pair: this.state.pairingCode ? '1' : '0'
      }
    })
  }

  private clearPairing(): void {
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = null
    const hadPairing = Boolean(this.state.pairingCode)
    this.state = {
      ...this.state,
      phase: this.state.enabled ? 'discovering' : 'disabled',
      pairingCode: undefined,
      pairingExpiresAt: undefined
    }
    if (hadPairing && this.webSocketServer) {
      this.publishService()
      this.emit()
    }
  }

  private async handleConnection(socket: WebSocket): Promise<void> {
    const connection = new SocketConnection(socket)
    try {
      const hello = await connection.nextPlain()
      if (
        hello.kind !== 'hello' ||
        hello.protocol !== SYNC_PROTOCOL_VERSION ||
        typeof hello.deviceId !== 'string' ||
        typeof hello.deviceName !== 'string'
      ) {
        throw new Error('invalid_sync_hello')
      }
      if (hello.mode === 'pair') {
        await this.handlePairing(connection, hello)
      } else if (hello.mode === 'paired') {
        await this.handlePairedSync(connection, hello)
      } else {
        throw new Error('invalid_sync_mode')
      }
    } catch (error) {
      connection.sendPlain({ kind: 'error', error: errorCode(error) })
      connection.close(1008, 'sync rejected')
      this.fail(error)
    }
  }

  private async handlePairing(
    connection: SocketConnection,
    hello: Record<string, unknown>
  ): Promise<void> {
    if (
      !this.state.pairingCode ||
      !this.state.pairingExpiresAt ||
      this.state.pairingExpiresAt <= Date.now() ||
      this.pairingAttempts <= 0
    ) {
      throw new Error('pairing_not_available')
    }
    if (typeof hello.publicKey !== 'string') throw new Error('invalid_pairing_public_key')
    const ephemeral = createEphemeralKeyPair()
    const nonce = randomBytes(32)
    const nonceText = nonce.toString('base64')
    const clientId = String(hello.deviceId)
    const clientName = String(hello.deviceName).slice(0, 120)
    connection.sendPlain({
      kind: 'pairChallenge',
      serverId: this.deviceId,
      publicKey: ephemeral.publicKey,
      nonce: nonceText
    })
    const response = await connection.nextPlain()
    if (response.kind !== 'pairResponse' || typeof response.proof !== 'string') {
      throw new Error('invalid_pairing_response')
    }
    const pairingKey = derivePairingKey({
      privateKey: ephemeral.privateKey,
      remotePublicKey: hello.publicKey,
      pairingCode: this.state.pairingCode,
      nonce
    })
    const transcript = `${clientId}|${this.deviceId}|${nonceText}|${hello.publicKey}|${ephemeral.publicKey}`
    if (!verifyProof(pairingKey, `pair-client|${transcript}`, response.proof)) {
      this.pairingAttempts--
      if (this.pairingAttempts <= 0) this.clearPairing()
      throw new Error('invalid_pairing_code')
    }
    const sharedSecret = randomBytes(32)
    savePairedSecret(clientId, clientName, sharedSecret)
    this.repository.rememberPeer(clientId, clientName)
    const cipher = new SyncSessionCipher(pairingKey)
    connection.sendEncrypted(cipher, {
      kind: 'pairAccepted',
      serverId: this.deviceId,
      serverName: `${app.getName()} · ${hostname()}`,
      sharedSecret: sharedSecret.toString('base64')
    })
    this.clearPairing()
    this.refreshState()
    this.emit()
    connection.close(1000, 'paired')
  }

  private async handlePairedSync(
    connection: SocketConnection,
    hello: Record<string, unknown>
  ): Promise<void> {
    const clientId = String(hello.deviceId)
    if (!hasPairedSecret(clientId)) throw new Error('device_not_paired')
    const secret = getPairedSecret(clientId)
    if (!secret || secret.byteLength !== 32) throw new Error('paired_secret_unavailable')
    const nonce = randomBytes(32)
    const nonceText = nonce.toString('base64')
    connection.sendPlain({ kind: 'authChallenge', serverId: this.deviceId, nonce: nonceText })
    const response = await connection.nextPlain()
    if (
      response.kind !== 'authResponse' ||
      typeof response.proof !== 'string' ||
      !verifyProof(secret, `auth-client|${nonceText}|${clientId}|${this.deviceId}`, response.proof)
    ) {
      throw new Error('authentication_failed')
    }
    connection.sendPlain({
      kind: 'authAccepted',
      proof: createProof(secret, `auth-server|${nonceText}|${clientId}|${this.deviceId}`)
    })
    this.repository.rememberPeer(clientId, String(hello.deviceName).slice(0, 120))
    const cipher = new SyncSessionCipher(deriveSessionKey(secret, nonce))
    if (this.syncSessionActive) throw new Error('sync_session_busy')
    this.syncSessionActive = true
    try {
      await this.prepareForSync()
      await this.runSync(connection, cipher, clientId)
    } finally {
      this.syncSessionActive = false
    }
  }

  private async runSync(
    connection: SocketConnection,
    cipher: SyncSessionCipher,
    clientId: string
  ): Promise<void> {
    this.state = {
      ...this.state,
      phase: 'syncing',
      activeDeviceId: clientId,
      error: undefined,
      completedBytes: 0,
      totalBytes: 0,
      completedRecords: 0,
      totalRecords: 0
    }
    this.emit()
    const snapshot = await connection.nextEncrypted(cipher)
    if (snapshot.kind !== 'syncSnapshot') throw new Error('expected_sync_snapshot')
    const remoteRecords = parseRecords(snapshot.records)
    const remoteAssets = parseAssetManifests(snapshot.assets)
    this.state.totalRecords = remoteRecords.length
    this.state.totalBytes = remoteAssets.reduce((total, asset) => total + asset.size, 0)
    this.emit()

    const needAssets: string[] = []
    for (const asset of remoteAssets) {
      if (!(await this.repository.hasAsset(asset.id, asset.sha256))) needAssets.push(asset.id)
    }
    const serverRecords = this.repository.prepareSnapshot()
    const serverAssets = await this.repository.collectAssets(serverRecords)
    connection.sendEncrypted(cipher, {
      kind: 'syncPlan',
      records: serverRecords,
      needAssets,
      assets: serverAssets
    })
    await this.receiveAssets(
      connection,
      cipher,
      new Map(remoteAssets.map((asset) => [asset.id, asset])),
      new Set(needAssets)
    )
    this.repository.reconcileRemote(remoteRecords, clientId)
    const request = await connection.nextEncrypted(cipher)
    if (request.kind !== 'requestAssets' || !Array.isArray(request.ids)) {
      throw new Error('expected_asset_request')
    }
    const requested = new Set(request.ids.filter((id): id is string => typeof id === 'string'))
    const allowed = new Map(serverAssets.map((asset) => [asset.id, asset]))
    for (const id of requested) {
      const manifest = allowed.get(id)
      if (!manifest) throw new Error('unavailable_sync_asset')
      await this.sendAsset(connection, cipher, manifest)
    }
    connection.sendEncrypted(cipher, { kind: 'assetsComplete' })

    const applied = await connection.nextEncrypted(cipher)
    if (applied.kind !== 'applyComplete') throw new Error('expected_apply_complete')
    this.repository.markPeerSynced(clientId)
    this.rebuildDerivedData()
    this.state = {
      ...this.state,
      phase: this.repository.listConflicts().length > 0 ? 'conflicts' : 'completed',
      activeDeviceId: undefined,
      completedRecords: remoteRecords.length + serverRecords.length,
      totalRecords: remoteRecords.length + serverRecords.length,
      lastSyncAt: Date.now()
    }
    this.refreshState()
    connection.sendEncrypted(cipher, {
      kind: 'syncComplete',
      conflicts: this.state.conflictCount
    })
    this.listener(this.getState(), true)
    connection.close(1000, 'sync complete')
    setTimeout(() => {
      if (this.state.phase === 'completed') {
        this.state = { ...this.state, phase: 'discovering' }
        this.emit()
      }
    }, 3000)
  }

  private async receiveAssets(
    connection: SocketConnection,
    cipher: SyncSessionCipher,
    manifests: Map<string, SyncAssetManifest>,
    requested: Set<string>
  ): Promise<void> {
    const chunks = new Map<string, Buffer[]>()
    const lengths = new Map<string, number>()
    while (true) {
      const message = await connection.nextEncrypted(cipher)
      if (message.kind === 'uploadsComplete') break
      if (message.kind !== 'assetChunk') throw new Error('expected_asset_chunk')
      const id = String(message.id)
      const manifest = manifests.get(id)
      if (!requested.has(id) || !manifest) throw new Error('unrequested_sync_asset')
      const offset = Number(message.offset)
      const currentLength = lengths.get(id) ?? 0
      if (offset !== currentLength) throw new Error('asset_chunk_out_of_order')
      const data = Buffer.from(String(message.data), 'base64')
      const nextLength = currentLength + data.byteLength
      if (nextLength > manifest.size || nextLength > MAX_ASSET_BYTES) {
        throw new Error('sync_asset_too_large')
      }
      const list = chunks.get(id) ?? []
      list.push(data)
      chunks.set(id, list)
      lengths.set(id, nextLength)
      this.state.completedBytes += data.byteLength
      this.emit()
      if (message.final === true) {
        if (nextLength !== manifest.size) throw new Error('sync_asset_size_mismatch')
        await this.repository.storeAsset(id, Buffer.concat(list), manifest.sha256)
        chunks.delete(id)
        lengths.delete(id)
        requested.delete(id)
      }
    }
    if (requested.size > 0 || chunks.size > 0) throw new Error('incomplete_asset_transfer')
  }

  private async sendAsset(
    connection: SocketConnection,
    cipher: SyncSessionCipher,
    manifest: SyncAssetManifest
  ): Promise<void> {
    const bytes = await this.repository.readAsset(manifest.id)
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) {
      const end = Math.min(offset + CHUNK_SIZE, bytes.byteLength)
      connection.sendEncrypted(cipher, {
        kind: 'assetChunk',
        id: manifest.id,
        sha256: manifest.sha256,
        size: manifest.size,
        offset,
        data: bytes.subarray(offset, end).toString('base64'),
        final: end === bytes.byteLength
      })
      this.state.completedBytes += end - offset
      this.emit()
    }
  }

  private rebuildDerivedData(): void {
    rebuildPersonMentionStatsIndex()
    rebuildMediaSourceIndex()
    const db = getDatabase()
    const diaryContent = db
      .prepare('SELECT content FROM diary_entries')
      .all()
      .map((row) => (row as { content: string }).content)
    const archiveContent = db
      .prepare('SELECT main_image, images FROM archives')
      .all()
      .flatMap((row) => {
        const value = row as { main_image: string | null; images: string | null }
        return [value.main_image, value.images]
      })
    syncImageRefs(
      getAllReferencedImageIds(),
      collectImageIdsFromTexts([...diaryContent, ...archiveContent])
    )
    invalidatePersonMentionCache()
    invalidateMediaLibraryCache()
  }

  private refreshState(): void {
    this.state = {
      ...this.state,
      pairedDevices: this.repository.listPairedDevices(),
      conflictCount: this.repository.listConflicts().length
    }
  }

  private fail(error: unknown): void {
    console.error('LAN sync error:', error)
    if (!this.state.enabled) return
    this.state = {
      ...this.state,
      phase: 'failed',
      activeDeviceId: undefined,
      error: errorCode(error)
    }
    this.emit()
    setTimeout(() => {
      if (this.state.enabled && this.state.phase === 'failed') {
        this.state = { ...this.state, phase: 'discovering', error: undefined }
        this.emit()
      }
    }, 8000)
  }

  private emit(): void {
    this.listener(this.getState())
  }
}

class SocketConnection {
  private readonly socket: WebSocket
  private readonly queue: string[] = []
  private readonly waiters: Array<{
    resolve: (value: string) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }> = []
  private closed = false

  constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        this.close(1003, 'binary frames are not supported')
        return
      }
      const value = data.toString()
      const waiter = this.waiters.shift()
      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.resolve(value)
      } else {
        this.queue.push(value)
      }
    })
    socket.on('close', () => {
      this.closed = true
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error('sync_connection_closed'))
      }
    })
    socket.on('error', (error) => {
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
    })
  }

  sendPlain(message: Record<string, unknown>): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  sendEncrypted(cipher: SyncSessionCipher, message: Record<string, unknown>): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(cipher.encrypt(message))
  }

  async nextPlain(): Promise<Record<string, unknown>> {
    const raw = await this.next()
    if (raw.length > 64 * 1024) throw new Error('sync_handshake_too_large')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid_sync_handshake')
    }
    return parsed as Record<string, unknown>
  }

  async nextEncrypted(cipher: SyncSessionCipher): Promise<Record<string, unknown>> {
    return cipher.decrypt(await this.next())
  }

  close(code: number, reason: string): void {
    if (!this.closed && this.socket.readyState < WebSocket.CLOSING) this.socket.close(code, reason)
  }

  private next(): Promise<string> {
    const queued = this.queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (this.closed) return Promise.reject(new Error('sync_connection_closed'))
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new Error('sync_connection_timeout'))
      }, 45_000)
      this.waiters.push({ resolve, reject, timer })
    })
  }
}

function parseRecords(value: unknown): SyncRecord[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) throw new Error('invalid_sync_records')
  return value as SyncRecord[]
}

function parseAssetManifests(value: unknown): SyncAssetManifest[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) throw new Error('invalid_asset_manifest')
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('invalid_asset_manifest')
    }
    const manifest = item as Partial<SyncAssetManifest>
    if (
      typeof manifest.id !== 'string' ||
      typeof manifest.sha256 !== 'string' ||
      typeof manifest.size !== 'number' ||
      !Number.isSafeInteger(manifest.size) ||
      manifest.size < 0 ||
      manifest.size > MAX_ASSET_BYTES ||
      !/^[a-f0-9]{64}$/i.test(manifest.sha256)
    ) {
      throw new Error('invalid_asset_manifest')
    }
    return {
      id: manifest.id,
      size: manifest.size,
      sha256: manifest.sha256.toLowerCase(),
      mimeType: typeof manifest.mimeType === 'string' ? manifest.mimeType : 'image/webp'
    }
  })
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 120)
  return 'sync_failed'
}

let instance: ShadowDiarySyncServer | null = null

export async function initializeSyncServer(
  listener: StateListener,
  prepareForSync: PrepareForSync
): Promise<void> {
  if (instance) return
  instance = new ShadowDiarySyncServer(listener, prepareForSync)
  await instance.initialize()
}

export function getSyncState(): SyncRuntimeState {
  if (!instance) throw new Error('sync_server_not_initialized')
  return instance.getState()
}

export async function setSyncEnabled(enabled: boolean): Promise<SyncRuntimeState> {
  if (!instance) throw new Error('sync_server_not_initialized')
  return await instance.setEnabled(enabled)
}

export async function beginSyncPairing(): Promise<SyncRuntimeState> {
  if (!instance) throw new Error('sync_server_not_initialized')
  return await instance.beginPairing()
}

export function listSyncConflicts(): SyncConflict[] {
  if (!instance) throw new Error('sync_server_not_initialized')
  return instance.listConflicts()
}

export function resolveSyncConflict(id: string, choice: SyncConflictChoice): SyncRuntimeState {
  if (!instance) throw new Error('sync_server_not_initialized')
  return instance.resolveConflict(id, choice)
}

export function unpairSyncDevice(deviceId: string): SyncRuntimeState {
  if (!instance) throw new Error('sync_server_not_initialized')
  return instance.unpair(deviceId)
}

export async function pauseSyncServer(): Promise<void> {
  await instance?.pause()
}

export async function resumeSyncServer(): Promise<void> {
  await instance?.resume()
}

export async function shutdownSyncServer(): Promise<void> {
  const current = instance
  instance = null
  await current?.shutdown()
}
