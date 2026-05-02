import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeImage,
  clipboard,
  protocol,
  powerMonitor
} from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { autoUpdater } from 'electron-updater'
import { CancellationError, CancellationToken } from 'builder-util-runtime'
import type {
  AppUpdateInfo,
  CheckForUpdatesResult,
  PrivacyAuthSupport,
  UpdateCheckOptions,
  WindowsHelloVerificationResult
} from '../types/api'

let mainWindow: BrowserWindow | null = null
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { existsSync, promises as fs } from 'fs'
import { spawn } from 'child_process'
import { initDatabase, closeDatabase } from './database'
import {
  getDiaryEntries,
  getDiaryEntry,
  saveDiaryEntry,
  deleteDiaryEntry,
  getDiaryByDate,
  getDiaryDates,
  searchDiaries,
  getStats,
  getPersonMentionStats,
  getPersonMentionDetails,
  invalidatePersonMentionCache,
  rebuildPersonMentionStatsIndex
} from './database/diary'
import { archives } from './database/archives'
import {
  getMediaLibrary,
  invalidateMediaLibraryCache,
  removeArchiveMediaSource,
  removeDiaryMediaSource,
  rebuildMediaSourceIndex,
  syncArchiveMediaSource,
  syncDiaryMediaSource
} from './database/media'
import { getAllTags } from './database/tags'
import {
  addAttachment,
  deleteAttachment,
  deleteAttachmentFiles,
  getAttachments
} from './database/attachments'
import {
  getSetting,
  setSetting,
  getAllSettings,
  getRealSetting,
  setRealSetting
} from './database/settings'
import {
  collectImageIdsFromText,
  collectImageIdsFromTexts,
  getAllReferencedImageIds,
  syncImageRefs
} from './database/imageRefs'
import {
  saveImage,
  saveImageFromBuffer,
  saveImageFromBytes,
  saveImageFromFile,
  saveArchiveAvatarFromFile,
  getImage,
  ensureImageDirs,
  cleanupUnusedImages,
  deleteImageByIds,
  parseImageDataUrl
} from './utils/imageStorage'
import {
  cancelDataTransfer,
  exportAppData,
  importAppData,
  type DataTransferProgress
} from './utils/dataTransfer'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecretPayload
} from './security/secureSettings'
import {
  disableDisguiseMode,
  enableDisguiseMode,
  isDisguiseModeEnabled,
  regenerateDisguiseModeData
} from './privacy/disguiseSession'

const IMAGE_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

const UPDATE_CACHE_TTL_MS = 5 * 60 * 1000
const UPDATE_CHECK_RETRY_COUNT = 1
const APP_QUIT_PREPARE_TIMEOUT_MS = 3000
const DISGUISE_AUTO_ENABLE_ON_LAUNCH_KEY = 'disguise.autoEnableOnLaunch'
const DISGUISE_SHORTCUT_KEY = 'disguise.shortcut'
const DISGUISE_LAST_ENABLED_KEY = 'disguise.lastEnabled'
const AI_SETTINGS_CONFIG_KEY = 'settings.ai.config.v1'
const DEFAULT_DISGUISE_SHORTCUT = 'Ctrl+Shift+M'
const DISGUISE_RESTRICTED_ERROR = '浼妯″紡涓嬩笉鍙敤'
const SECURE_SETTINGS_KEY_ALLOWLIST = new Set<string>([AI_SETTINGS_CONFIG_KEY])
let cachedUpdateCheck: CheckForUpdatesResult | null = null
let activeUpdateDownloadToken: CancellationToken | null = null
let isQuitInProgress = false
let hasClosedDatabase = false
let pendingQuitAckIds: Set<number> | null = null
let quitPrepareTimer: ReturnType<typeof setTimeout> | null = null
let resolveQuitPreparation: (() => void) | null = null
const trustedRendererOrigins = new Set<string>()

const rendererDevUrl = process.env['ELECTRON_RENDERER_URL']
if (rendererDevUrl) {
  try {
    trustedRendererOrigins.add(new URL(rendererDevUrl).origin)
  } catch {
    console.warn('鏃犳晥鐨?ELECTRON_RENDERER_URL锛屽皢蹇界暐璇ヤ俊浠绘簮')
  }
}

function isHttpProtocolUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isTrustedRendererUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return true
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && is.dev) {
      return trustedRendererOrigins.has(parsed.origin)
    }
    return false
  } catch {
    return false
  }
}

type TrustedIpcEvent = IpcMainEvent | IpcMainInvokeEvent

function isTrustedIpcEvent(event: TrustedIpcEvent): boolean {
  const sender = event.sender
  if (!sender || sender.isDestroyed()) return false

  const ownerWindow = BrowserWindow.fromWebContents(sender)
  if (!ownerWindow || ownerWindow.isDestroyed()) return false
  if (mainWindow && ownerWindow !== mainWindow) return false

  const senderUrl = sender.getURL()
  if (!isTrustedRendererUrl(senderUrl)) return false

  const frameUrl = event.senderFrame?.url
  if (frameUrl && !isTrustedRendererUrl(frameUrl)) return false

  return true
}

function assertTrustedIpcEvent(event: TrustedIpcEvent, channel: string): void {
  if (isTrustedIpcEvent(event)) return

  const sourceUrl = event.senderFrame?.url || event.sender.getURL() || 'unknown'
  console.warn(`[SECURITY] Blocked IPC channel "${channel}" from "${sourceUrl}"`)
  throw new Error(`Blocked IPC channel: ${channel}`)
}

function onTrustedIpc<TArgs extends unknown[]>(
  channel: string,
  handler: (event: IpcMainEvent, ...args: TArgs) => void
): void {
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertTrustedIpcEvent(event, channel)
      handler(event, ...(args as TArgs))
    } catch (error) {
      console.error(error)
    }
  })
}

function handleTrustedIpc<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcEvent(event, channel)
    return await handler(event, ...(args as TArgs))
  })
}

function blockUntrustedNavigation(targetWindow: BrowserWindow): void {
  const blockNavigation = (event: Electron.Event, url: string): void => {
    if (isTrustedRendererUrl(url)) return

    event.preventDefault()
    if (isHttpProtocolUrl(url)) {
      void shell.openExternal(url)
      return
    }

    console.warn(`[SECURITY] Blocked navigation to "${url}"`)
  }

  targetWindow.webContents.on('will-navigate', blockNavigation)
  targetWindow.webContents.on('will-redirect', blockNavigation)
}

function closeDatabaseSafely(): void {
  if (hasClosedDatabase) return
  hasClosedDatabase = true
  try {
    closeDatabase()
  } catch (error) {
    console.error('鍏抽棴鏁版嵁搴撳け璐?', error)
  }
}

function finishQuitPreparationWait(): void {
  if (quitPrepareTimer) {
    clearTimeout(quitPrepareTimer)
    quitPrepareTimer = null
  }
  pendingQuitAckIds = null
  const resolve = resolveQuitPreparation
  resolveQuitPreparation = null
  resolve?.()
}

function acknowledgeQuitPreparation(senderId: number): void {
  if (!pendingQuitAckIds) return
  pendingQuitAckIds.delete(senderId)
  if (pendingQuitAckIds.size === 0) {
    finishQuitPreparationWait()
  }
}

async function waitForRendererBeforeQuit(): Promise<void> {
  const targets = BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && !win.webContents.isDestroyed()
  )

  if (targets.length === 0) return

  await new Promise<void>((resolve) => {
    resolveQuitPreparation = resolve
    pendingQuitAckIds = new Set<number>(targets.map((win) => win.webContents.id))
    quitPrepareTimer = setTimeout(() => {
      finishQuitPreparationWait()
    }, APP_QUIT_PREPARE_TIMEOUT_MS)

    for (const win of targets) {
      try {
        win.webContents.send('app:before-quit')
      } catch (error) {
        console.error('鍙戦€侀€€鍑哄墠淇濆瓨浜嬩欢澶辫触:', error)
        acknowledgeQuitPreparation(win.webContents.id)
      }
    }

    if (pendingQuitAckIds.size === 0) {
      finishQuitPreparationWait()
    }
  })
}

function hideAllWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.hide()
    }
  }
}

function requestAppQuit(): void {
  if (isQuitInProgress) return
  isQuitInProgress = true

  void (async () => {
    try {
      hideAllWindows()
      await waitForRendererBeforeQuit()
    } catch (error) {
      console.error('搴旂敤閫€鍑哄噯澶囧け璐?', error)
    } finally {
      closeDatabaseSafely()
      app.exit(0)
    }
  })()
}

function getImageMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return IMAGE_MIME_MAP[ext || 'png'] || 'image/png'
}

function parseDiaryImageFileName(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'diary-image:') return null

    const rawFileName = `${parsed.hostname}${parsed.pathname}`.replace(/^\/+/, '')
    if (!rawFileName) return null

    return decodeURIComponent(rawFileName)
  } catch {
    return null
  }
}

async function loadDiaryImage(url: string): Promise<{ mimeType: string; data: Buffer } | null> {
  try {
    const fileName = parseDiaryImageFileName(url)
    if (!fileName) {
      return null
    }

    const buffer = await getImage(fileName)
    return {
      mimeType: getImageMimeType(fileName),
      data: buffer
    }
  } catch (error) {
    console.error('Failed to load image:', error)
    return null
  }
}

interface ResolvedImagePayload {
  buffer: Buffer
  ext: string
}

async function resolveImagePayload(imageSource: string): Promise<ResolvedImagePayload | null> {
  const parsedDataUrl = parseImageDataUrl(imageSource)
  if (parsedDataUrl) {
    return { buffer: parsedDataUrl.buffer, ext: parsedDataUrl.ext }
  }

  const fileName = parseDiaryImageFileName(imageSource)
  if (!fileName) return null

  const buffer = await getImage(fileName)
  const ext = fileName.split('.').pop()?.toLowerCase() || 'png'
  return { buffer, ext }
}

function collectArchiveImageIds(archive: { mainImage?: string; images?: string[] }): Set<string> {
  return collectImageIdsFromTexts([archive.mainImage, ...(archive.images ?? [])])
}

async function cleanupReleasedImages(imageIds: Iterable<string>): Promise<void> {
  const uniqueIds = new Set<string>()
  for (const id of imageIds) {
    const normalized = id.trim()
    if (normalized) uniqueIds.add(normalized)
  }

  if (uniqueIds.size === 0) return

  await deleteImageByIds(uniqueIds)
}

async function migrateLegacyAvatarSetting(): Promise<void> {
  try {
    const currentAvatar = getSetting('user.avatar')
    if (!currentAvatar || !parseImageDataUrl(currentAvatar)) return

    const saved = await saveImage(currentAvatar)
    const releasedIds = setSetting('user.avatar', saved.path)
    await cleanupReleasedImages(releasedIds)
  } catch (error) {
    console.error('杩佺Щ鍘嗗彶澶村儚澶辫触:', error)
  }
}

function parseBooleanSetting(value: string | null | undefined, defaultValue = false): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return defaultValue
  return normalized === '1' || normalized === 'true'
}

function normalizeDisguiseShortcut(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : DEFAULT_DISGUISE_SHORTCUT
}

function getDisguiseConfig(): {
  enabled: boolean
  autoEnableOnLaunch: boolean
  shortcut: string
} {
  return {
    enabled: isDisguiseModeEnabled(),
    autoEnableOnLaunch: parseBooleanSetting(getRealSetting(DISGUISE_AUTO_ENABLE_ON_LAUNCH_KEY)),
    shortcut: normalizeDisguiseShortcut(getRealSetting(DISGUISE_SHORTCUT_KEY))
  }
}

function setDisguiseLastEnabled(enabled: boolean): void {
  setRealSetting(DISGUISE_LAST_ENABLED_KEY, enabled ? '1' : '0')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertSecureSettingKey(key: string): void {
  if (!SECURE_SETTINGS_KEY_ALLOWLIST.has(key)) {
    throw new Error('不支持的安全设置键')
  }
}

function decryptAiSettingsValue(value: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return value
  }

  if (!isPlainRecord(parsed) || !Array.isArray(parsed.providers)) {
    return value
  }

  let changed = false
  const providers = parsed.providers.map((provider) => {
    if (!isPlainRecord(provider)) return provider

    const secret = provider.apiKey
    if (!isEncryptedSecretPayload(secret)) return provider

    try {
      changed = true
      return {
        ...provider,
        apiKey: decryptSecret(secret)
      }
    } catch (error) {
      console.error('瑙ｅ瘑 AI API Key 澶辫触:', error)
      changed = true
      return {
        ...provider,
        apiKey: ''
      }
    }
  })

  if (!changed) return value

  return JSON.stringify({
    ...parsed,
    providers
  })
}

function encryptAiSettingsValue(value: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('AI 璁剧疆鏍煎紡鏃犳晥')
  }

  if (!isPlainRecord(parsed)) {
    throw new Error('AI 璁剧疆鏍煎紡鏃犳晥')
  }

  if (!Array.isArray(parsed.providers)) {
    throw new Error('AI 设置格式无效，providers 必须为数组')
  }

  const providers = parsed.providers.map((provider) => {
    if (!isPlainRecord(provider)) return provider

    const secret = provider.apiKey
    if (isEncryptedSecretPayload(secret)) return provider
    if (typeof secret !== 'string' || !secret.trim()) {
      return {
        ...provider,
        apiKey: ''
      }
    }

    return {
      ...provider,
      apiKey: encryptSecret(secret)
    }
  })

  return JSON.stringify({
    ...parsed,
    providers
  })
}

function applyDisguiseModeOnLaunch(): void {
  const autoEnableOnLaunch = parseBooleanSetting(getRealSetting(DISGUISE_AUTO_ENABLE_ON_LAUNCH_KEY))
  const lastEnabled = parseBooleanSetting(getRealSetting(DISGUISE_LAST_ENABLED_KEY))
  if (!autoEnableOnLaunch || !lastEnabled) return

  try {
    enableDisguiseMode()
  } catch (error) {
    console.error('鍚姩浼妯″紡澶辫触:', error)
    setDisguiseLastEnabled(false)
  }
}

function assertDisguiseAvailable(action: string): void {
  if (!isDisguiseModeEnabled()) return
  throw new Error(`${DISGUISE_RESTRICTED_ERROR}：${action}`)
}

function registerDiaryImageProtocol(): void {
  if (typeof protocol.handle === 'function') {
    protocol.handle('diary-image', async (request) => {
      const result = await loadDiaryImage(request.url)
      if (!result) {
        return new Response('', { status: 404, headers: { 'content-type': 'image/png' } })
      }

      return new Response(new Uint8Array(result.data), {
        headers: { 'content-type': result.mimeType }
      })
    })
    return
  }

  protocol.registerBufferProtocol('diary-image', async (request, callback) => {
    const result = await loadDiaryImage(request.url)
    if (!result) {
      callback({ mimeType: 'image/png', data: Buffer.from('') })
      return
    }
    callback(result)
  })
}

function normalizeUpdateInfo(
  updateInfo:
    | {
        version: string
        releaseDate?: string
        releaseName?: string | null
      }
    | undefined
): AppUpdateInfo | undefined {
  if (!updateInfo) return undefined

  return {
    version: updateInfo.version,
    releaseDate: updateInfo.releaseDate,
    releaseName: updateInfo.releaseName
  }
}

function isUpdateCacheFresh(): boolean {
  if (!cachedUpdateCheck) return false
  return Date.now() - cachedUpdateCheck.checkedAt < UPDATE_CACHE_TTL_MS
}

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error:\s*/i, '').trim()
}

function isLikelyNetworkUpdateError(message: string): boolean {
  const normalized = message.toUpperCase()
  return (
    normalized.includes('ERR_CONNECTION_RESET') ||
    normalized.includes('ERR_CONNECTION_REFUSED') ||
    normalized.includes('ERR_CONNECTION_CLOSED') ||
    normalized.includes('ERR_CONNECTION_TIMED_OUT') ||
    normalized.includes('ERR_TIMED_OUT') ||
    normalized.includes('ERR_INTERNET_DISCONNECTED') ||
    normalized.includes('ERR_NAME_NOT_RESOLVED') ||
    normalized.includes('ECONNRESET') ||
    normalized.includes('ECONNREFUSED') ||
    normalized.includes('ETIMEDOUT') ||
    normalized.includes('ENOTFOUND') ||
    normalized.includes('EAI_AGAIN')
  )
}

function normalizeUpdateErrorMessage(error: unknown): string {
  const message = getErrorMessage(error)
  const normalized = message.toUpperCase()

  if (normalized.includes('ERR_CONNECTION_RESET') || normalized.includes('ECONNRESET')) {
    return '连接更新服务器时被重置，请检查网络或代理后重试'
  }

  if (
    normalized.includes('ERR_CONNECTION_TIMED_OUT') ||
    normalized.includes('ERR_TIMED_OUT') ||
    normalized.includes('ETIMEDOUT')
  ) {
    return '连接更新服务器超时，请稍后重试'
  }

  if (normalized.includes('ERR_NAME_NOT_RESOLVED') || normalized.includes('ENOTFOUND')) {
    return '无法解析更新服务器地址，请检查网络或 DNS 设置后重试'
  }

  if (
    normalized.includes('ERR_CONNECTION_REFUSED') ||
    normalized.includes('ERR_CONNECTION_CLOSED') ||
    normalized.includes('ECONNREFUSED') ||
    normalized.includes('ERR_INTERNET_DISCONNECTED') ||
    normalized.includes('EAI_AGAIN')
  ) {
    return '无法连接更新服务器，请检查网络连接或代理设置后重试'
  }

  if (normalized.includes('CERT_') || normalized.includes('ERR_SSL')) {
    return '鏇存柊鏈嶅姟鍣ㄨ瘉涔︽牎楠屽け璐ワ紝璇锋鏌ョ郴缁熸椂闂存垨浠ｇ悊璁剧疆'
  }

  return message || '鏈煡閿欒'
}

function isUpdateDownloadCanceledError(error: unknown): boolean {
  if (error instanceof CancellationError) return true
  const message = getErrorMessage(error).toUpperCase()
  return message.includes('CANCEL') || message.includes('ABORT')
}

function broadcastToAllWindows(channel: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel)
    }
  }
}

function registerSystemSecurityEvents(): void {
  powerMonitor.on('lock-screen', () => {
    broadcastToAllWindows('system:lock-screen')
  })
}

type WindowsHelloHelperCommand = {
  command: string
  args: string[]
}

type WindowsHelloHelperOutput = {
  ok?: boolean
  supported?: boolean
  availability?: string
  result?: string
  error?: string
}

function resolveWindowsHelloHelperCommand(): WindowsHelloHelperCommand | null {
  if (process.platform !== 'win32') return null

  const packagedExe = join(
    process.resourcesPath,
    'windows-hello-helper',
    'ShadowDiary.WindowsHello.exe'
  )
  if (app.isPackaged) {
    if (!existsSync(packagedExe)) return null
    return { command: packagedExe, args: [] }
  }

  const appPath = app.getAppPath()
  const builtExe = join(appPath, 'build', 'windows-hello-helper', 'ShadowDiary.WindowsHello.exe')
  if (existsSync(builtExe)) {
    return { command: builtExe, args: [] }
  }

  const helperDll = join(
    appPath,
    'src',
    'native',
    'ShadowDiary.WindowsHello',
    'bin',
    'Debug',
    'net10.0-windows10.0.19041.0',
    'ShadowDiary.WindowsHello.dll'
  )
  if (existsSync(helperDll)) {
    return { command: 'dotnet', args: [helperDll] }
  }

  const helperProject = join(
    appPath,
    'src',
    'native',
    'ShadowDiary.WindowsHello',
    'ShadowDiary.WindowsHello.csproj'
  )
  if (!existsSync(helperProject)) return null

  return {
    command: 'dotnet',
    args: ['run', '--project', helperProject, '--no-launch-profile', '--']
  }
}

async function runWindowsHelloHelper(args: string[]): Promise<WindowsHelloHelperOutput> {
  const helper = resolveWindowsHelloHelperCommand()
  if (!helper) {
    return { ok: false, supported: false, error: 'windows_hello_helper_unavailable' }
  }

  return await new Promise<WindowsHelloHelperOutput>((resolve) => {
    let settled = false
    const settle = (value: WindowsHelloHelperOutput): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const child = spawn(helper.command, [...helper.args, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      settle({ ok: false, supported: false, error: getErrorMessage(error) })
    })

    child.on('close', () => {
      const payloadText = stdout.trim()
      if (!payloadText) {
        settle({ ok: false, supported: false, error: stderr.trim() || 'empty_helper_response' })
        return
      }

      try {
        settle(JSON.parse(payloadText) as WindowsHelloHelperOutput)
      } catch (error) {
        settle({
          ok: false,
          supported: false,
          error: `${getErrorMessage(error)}: ${payloadText}`
        })
      }
    })
  })
}

function getWindowHandleValue(win: BrowserWindow): string | null {
  try {
    const handle = win.getNativeWindowHandle()
    if (handle.length >= 8) {
      return handle.readBigUInt64LE(0).toString()
    }
    if (handle.length >= 4) {
      return BigInt(handle.readUInt32LE(0)).toString()
    }
    return null
  } catch {
    return null
  }
}

async function getPrivacyAuthSupport(): Promise<PrivacyAuthSupport> {
  const result = await runWindowsHelloHelper(['support'])
  return {
    windowsHello: result.supported === true,
    availability: result.availability,
    error: result.error
  }
}

async function verifyWindowsHello(
  win: BrowserWindow,
  message: string
): Promise<WindowsHelloVerificationResult> {
  const hwnd = getWindowHandleValue(win)
  if (!hwnd) {
    return { ok: false, error: 'window_handle_unavailable' }
  }

  const result = await runWindowsHelloHelper(['verify', hwnd, message])
  return {
    ok: result.ok === true,
    result: result.result,
    error: result.error
  }
}

async function runUpdateCheck(): Promise<CheckForUpdatesResult> {
  let retryLeft = UPDATE_CHECK_RETRY_COUNT

  while (true) {
    try {
      const result = await autoUpdater.checkForUpdates()
      return {
        success: true,
        updateInfo:
          result?.isUpdateAvailable === true ? normalizeUpdateInfo(result.updateInfo) : undefined,
        checkedAt: Date.now(),
        fromCache: false
      }
    } catch (error) {
      const rawMessage = getErrorMessage(error)
      if (retryLeft > 0 && isLikelyNetworkUpdateError(rawMessage)) {
        retryLeft -= 1
        continue
      }

      return {
        success: false,
        error: normalizeUpdateErrorMessage(error),
        checkedAt: Date.now(),
        fromCache: false
      }
    }
  }
}

async function getUpdateCheckResult(options?: UpdateCheckOptions): Promise<CheckForUpdatesResult> {
  if (!options?.force && isUpdateCacheFresh() && cachedUpdateCheck) {
    return {
      ...cachedUpdateCheck,
      fromCache: true
    }
  }

  const fresh = await runUpdateCheck()
  cachedUpdateCheck = fresh
  return fresh
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    minHeight: 550,
    minWidth: 700,
    frame: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (isQuitInProgress) return
    event.preventDefault()
    requestAppQuit()
  })

  blockUntrustedNavigation(mainWindow)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isHttpProtocolUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId('com.hsyr.shadowdiary')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Initialize database
    initDatabase()

    // Ensure image directories exist
    void ensureImageDirs()

    // Register custom protocol for images
    registerDiaryImageProtocol()

    // 鎵嬪姩瑙﹀彂涓嬭浇锛岄伩鍏嶆鏌ユ洿鏂板悗鑷姩寮€濮嬩笅杞藉鑷寸姸鎬佷笉鍙帶
    autoUpdater.autoDownload = false

    await migrateLegacyAvatarSetting()
    applyDisguiseModeOnLaunch()

    // Register IPC handlers
    registerIpcHandlers()
    registerSystemSecurityEvents()

    createWindow()
    void getUpdateCheckResult({ force: true })

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    console.error('搴旂敤鍒濆鍖栧け璐?', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (isQuitInProgress) return
  event.preventDefault()
  requestAppQuit()
})

// ========== IPC Handlers ==========

function registerIpcHandlers(): void {
  onTrustedIpc('app:before-quit-done', (event) => {
    acknowledgeQuitPreparation(event.sender.id)
  })

  // 鏃ヨ CRUD
  handleTrustedIpc('diary:list', (_event, params: Parameters<typeof getDiaryEntries>[0]) => {
    return getDiaryEntries(params ?? {})
  })

  handleTrustedIpc('diary:get', (_event, id: string) => {
    return getDiaryEntry(id)
  })

  handleTrustedIpc('diary:save', async (_event, entry: Parameters<typeof saveDiaryEntry>[0]) => {
    const previous = entry.id ? getDiaryEntry(entry.id) : null
    const saved = saveDiaryEntry(entry)
    syncDiaryMediaSource(saved)
    if (!isDisguiseModeEnabled()) {
      const releasedIds = syncImageRefs(
        collectImageIdsFromText(previous?.content),
        collectImageIdsFromText(saved.content)
      )
      await cleanupReleasedImages(releasedIds)
    }
    invalidatePersonMentionCache()
    invalidateMediaLibraryCache()
    return saved
  })

  handleTrustedIpc('diary:delete', async (_event, id: string) => {
    const previous = getDiaryEntry(id)
    const attachments = getAttachments(id)
    const result = deleteDiaryEntry(id)
    if (result) {
      removeDiaryMediaSource(id)
      if (!isDisguiseModeEnabled()) {
        const releasedIds = syncImageRefs(collectImageIdsFromText(previous?.content), [])
        await cleanupReleasedImages(releasedIds)
      }
      invalidatePersonMentionCache()
      invalidateMediaLibraryCache()
      if (!isDisguiseModeEnabled()) {
        await deleteAttachmentFiles(attachments.map((attachment) => attachment.filePath))
      }
    }
    return result
  })

  handleTrustedIpc('diary:getByDate', (_event, dateStr: string) => {
    return getDiaryByDate(dateStr)
  })

  handleTrustedIpc('diary:getDates', (_event, yearMonth: string) => {
    return getDiaryDates(yearMonth)
  })

  // 鎼滅储
  handleTrustedIpc('diary:search', (_event, params: Parameters<typeof searchDiaries>[0]) => {
    return searchDiaries(params)
  })

  // 妗ｆ
  handleTrustedIpc('archives:list', (_event, params: Parameters<typeof archives.list>[0]) => {
    return archives.list(params)
  })

  handleTrustedIpc('archives:get', (_event, id: string) => {
    return archives.get(id)
  })

  handleTrustedIpc(
    'archives:save',
    async (_event, archive: Parameters<typeof archives.save>[0]) => {
      const previous = archive.id ? archives.get(archive.id) : null
      const saved = await archives.save(archive)
      syncArchiveMediaSource(saved)
      if (previous?.type === 'person' || saved.type === 'person') {
        rebuildPersonMentionStatsIndex()
      }
      if (!isDisguiseModeEnabled()) {
        const releasedIds = syncImageRefs(
          collectArchiveImageIds(previous ?? {}),
          collectArchiveImageIds(saved)
        )
        await cleanupReleasedImages(releasedIds)
      }
      invalidatePersonMentionCache()
      invalidateMediaLibraryCache()
      return saved
    }
  )

  handleTrustedIpc('archives:delete', async (_event, id: string) => {
    const previous = archives.get(id)
    archives.delete(id)
    removeArchiveMediaSource(id)
    if (previous?.type === 'person') {
      rebuildPersonMentionStatsIndex()
    }
    if (!isDisguiseModeEnabled()) {
      const releasedIds = syncImageRefs(collectArchiveImageIds(previous ?? {}), [])
      await cleanupReleasedImages(releasedIds)
    }
    invalidatePersonMentionCache()
    invalidateMediaLibraryCache()
  })

  // 鏍囩
  handleTrustedIpc('tags:list', () => {
    return getAllTags()
  })

  // 闄勪欢
  handleTrustedIpc('attachment:add', async (_event, diaryId: string) => {
    assertDisguiseAvailable('闄勪欢娣诲姞')
    return await addAttachment(diaryId)
  })

  handleTrustedIpc('attachment:delete', async (_event, id: string) => {
    assertDisguiseAvailable('闄勪欢鍒犻櫎')
    return await deleteAttachment(id)
  })

  handleTrustedIpc('attachment:list', (_event, diaryId: string) => {
    assertDisguiseAvailable('闄勪欢璇诲彇')
    return getAttachments(diaryId)
  })

  // 璁剧疆
  handleTrustedIpc('settings:get', (_event, key: string) => {
    return getSetting(key)
  })

  handleTrustedIpc('settings:getSecure', (_event, key: string) => {
    assertSecureSettingKey(key)
    const value = getSetting(key)
    if (value === null) return null

    if (key === AI_SETTINGS_CONFIG_KEY) {
      return decryptAiSettingsValue(value)
    }

    return value
  })

  handleTrustedIpc('settings:set', async (_event, key: string, value: string) => {
    if (key.startsWith('disguise.')) {
      throw new Error('请使用专用伪装设置接口')
    }
    const releasedIds = setSetting(key, value)
    if (!isDisguiseModeEnabled()) {
      await cleanupReleasedImages(releasedIds)
    }
    return true
  })

  handleTrustedIpc('settings:setSecure', async (_event, key: string, value: string) => {
    assertSecureSettingKey(key)
    if (typeof value !== 'string') {
      throw new Error('设置值必须是字符串')
    }

    const storedValue = key === AI_SETTINGS_CONFIG_KEY ? encryptAiSettingsValue(value) : value
    const releasedIds = setSetting(key, storedValue)
    if (!isDisguiseModeEnabled()) {
      await cleanupReleasedImages(releasedIds)
    }
    return true
  })

  handleTrustedIpc('settings:getAll', () => {
    return getAllSettings()
  })

  handleTrustedIpc('privacy:getAuthSupport', async () => {
    return await getPrivacyAuthSupport()
  })

  handleTrustedIpc('privacy:verifyWindowsHello', async (event, message?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      return { ok: false, error: 'window_unavailable' }
    }

    const prompt =
      typeof message === 'string' && message.trim().length > 0
        ? message.trim()
        : 'Verify with Windows Hello'
    return await verifyWindowsHello(win, prompt)
  })

  handleTrustedIpc('disguise:getConfig', () => {
    return getDisguiseConfig()
  })

  handleTrustedIpc('disguise:setEnabled', (_event, enabled: boolean) => {
    if (enabled) {
      enableDisguiseMode()
    } else {
      disableDisguiseMode()
    }
    setDisguiseLastEnabled(Boolean(enabled))
    rebuildPersonMentionStatsIndex()
    rebuildMediaSourceIndex()
    invalidatePersonMentionCache()
    invalidateMediaLibraryCache()
    return true
  })

  handleTrustedIpc('disguise:setAutoEnableOnLaunch', (_event, enabled: boolean) => {
    setRealSetting(DISGUISE_AUTO_ENABLE_ON_LAUNCH_KEY, enabled ? '1' : '0')
    return true
  })

  handleTrustedIpc('disguise:setShortcut', (_event, shortcut: string) => {
    setRealSetting(DISGUISE_SHORTCUT_KEY, normalizeDisguiseShortcut(shortcut))
    return true
  })

  handleTrustedIpc('disguise:regenerateData', () => {
    regenerateDisguiseModeData()
    rebuildPersonMentionStatsIndex()
    rebuildMediaSourceIndex()
    invalidatePersonMentionCache()
    invalidateMediaLibraryCache()
    return true
  })

  // 鏁版嵁瀵煎叆/瀵煎嚭
  handleTrustedIpc('data:export', async (event, options?: { backupPassword?: string }) => {
    assertDisguiseAvailable('鏁版嵁瀵煎嚭')
    const win = BrowserWindow.fromWebContents(event.sender)
    return await exportAppData(
      win,
      { backupPassword: options?.backupPassword ?? '' },
      (progress: DataTransferProgress) => {
        event.sender.send('data:export-progress', progress)
      }
    )
  })

  handleTrustedIpc('data:import', async (event, options?: { backupPassword?: string }) => {
    assertDisguiseAvailable('鏁版嵁瀵煎叆')
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await importAppData(
      win,
      { backupPassword: options?.backupPassword ?? '' },
      (progress: DataTransferProgress) => {
        event.sender.send('data:import-progress', progress)
      }
    )
    if (result.success) {
      rebuildPersonMentionStatsIndex()
      rebuildMediaSourceIndex()
      invalidatePersonMentionCache()
      invalidateMediaLibraryCache()
    }
    return result
  })

  handleTrustedIpc('data:cancel', () => {
    assertDisguiseAvailable('鏁版嵁浼犺緭鍙栨秷')
    return cancelDataTransfer()
  })

  // 缁熻
  handleTrustedIpc('stats:get', () => {
    return getStats()
  })

  handleTrustedIpc('stats:personMentions', () => {
    return getPersonMentionStats()
  })

  handleTrustedIpc(
    'stats:personMentionDetails',
    (_event, personName: string, params?: { limit?: number; offset?: number }) => {
      return getPersonMentionDetails(personName, params)
    }
  )

  handleTrustedIpc('media:list', (_event, params: Parameters<typeof getMediaLibrary>[0]) => {
    return getMediaLibrary(params ?? {})
  })

  // 淇濆瓨鍥剧墖锛堝吋瀹?data URL锛?
  handleTrustedIpc('image:save', async (_event, base64Data: string) => {
    assertDisguiseAvailable('鍥剧墖淇濆瓨')
    try {
      const result = await saveImage(base64Data)
      return { success: true, ...result }
    } catch (error) {
      console.error('淇濆瓨鍥剧墖澶辫触:', error)
      return { success: false, error: String(error) }
    }
  })

  // 淇濆瓨鍥剧墖锛堟枃浠惰矾寰勶級
  handleTrustedIpc('image:save-file', async (_event, filePath: string) => {
    assertDisguiseAvailable('鍥剧墖淇濆瓨')
    try {
      const result = await saveImageFromFile(filePath)
      return { success: true, ...result }
    } catch (error) {
      console.error('閫氳繃鏂囦欢璺緞淇濆瓨鍥剧墖澶辫触:', error)
      return { success: false, error: String(error) }
    }
  })

  // 淇濆瓨鍥剧墖锛堜簩杩涘埗锛?
  handleTrustedIpc(
    'image:save-bytes',
    async (_event, payload: { bytes: Uint8Array; mimeType: string }) => {
      assertDisguiseAvailable('鍥剧墖淇濆瓨')
      try {
        if (
          !payload ||
          !(payload.bytes instanceof Uint8Array) ||
          typeof payload.mimeType !== 'string' ||
          !payload.mimeType.trim()
        ) {
          return { success: false, error: 'Invalid image bytes payload' }
        }

        const result = await saveImageFromBytes(payload.bytes, payload.mimeType)
        return { success: true, ...result }
      } catch (error) {
        console.error('閫氳繃浜岃繘鍒朵繚瀛樺浘鐗囧け璐?', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // 娓呯悊鏈娇鐢ㄧ殑鍥剧墖
  handleTrustedIpc('image:cleanup', async () => {
    assertDisguiseAvailable('鍥剧墖娓呯悊')
    try {
      await cleanupUnusedImages(getAllReferencedImageIds())
      return { success: true }
    } catch (error) {
      console.error('娓呯悊鍥剧墖澶辫触:', error)
      return { success: false, error: String(error) }
    }
  })

  // 鍥剧墖閫夋嫨锛堢敤浜庣紪杈戝櫒鎻掑叆鍥剧墖锛?
  handleTrustedIpc('select-image', async (event) => {
    assertDisguiseAvailable('鍥剧墖閫夋嫨')
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        properties: ['openFile'] as 'openFile'[],
        filters: [
          { name: '鍥剧墖', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] }
        ],
        title: '閫夋嫨鍥剧墖'
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }

      const filePath = result.filePaths[0]
      const saved = await saveImageFromFile(filePath)
      return { canceled: false, path: saved.path, thumbnailPath: saved.thumbnailPath }
    } catch (error) {
      console.error('閫夋嫨鍥剧墖澶辫触:', error)
      return { canceled: true }
    }
  })

  // 妗ｆ澶村儚閫夋嫨锛堣嚜鍔?1:1 瑁佸垏锛屼粎淇濆瓨 webp 缂╃暐鍥撅級
  handleTrustedIpc('select-archive-avatar', async (event) => {
    assertDisguiseAvailable('澶村儚閫夋嫨')
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: '鍥剧墖', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
        title: '閫夋嫨澶村儚鍥剧墖'
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }

      const filePath = result.filePaths[0]
      const saved = await saveArchiveAvatarFromFile(filePath)
      return { canceled: false, path: saved.path, thumbnailPath: saved.thumbnailPath }
    } catch (error) {
      console.error('閫夋嫨妗ｆ澶村儚澶辫触:', error)
      return { canceled: true }
    }
  })

  // 澶嶅埗鍥剧墖鍒板壀璐存澘锛堟帴鏀?base64 dataUrl锛?
  handleTrustedIpc('image:copy', async (_event, dataUrl: string) => {
    assertDisguiseAvailable('鍥剧墖澶嶅埗')
    try {
      const payload = await resolveImagePayload(dataUrl)
      if (!payload) return { success: false }
      const image = nativeImage.createFromBuffer(payload.buffer)
      if (image.isEmpty()) return { success: false }
      clipboard.writeImage(image)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  // 鍙﹀瓨涓哄浘鐗囨枃浠?
  handleTrustedIpc('image:save-as', async (event, dataUrl: string) => {
    assertDisguiseAvailable('图片另存为')
    try {
      const payload = await resolveImagePayload(dataUrl)
      if (!payload) return { success: false }

      const win = BrowserWindow.fromWebContents(event.sender)
      const ext = payload.ext === 'jpeg' ? 'jpg' : payload.ext
      const dialogOptions = {
        defaultPath: `image.${ext}`,
        filters: [{ name: '鍥剧墖', extensions: [ext] }],
        title: '淇濆瓨鍥剧墖'
      }
      const result = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (result.canceled || !result.filePath) return { success: false }
      await fs.writeFile(result.filePath, payload.buffer)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  // 澶村儚閫夋嫨
  handleTrustedIpc('select-avatar', async (event) => {
    assertDisguiseAvailable('澶村儚閫夋嫨')
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: '鍥剧墖', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
        title: '閫夋嫨澶村儚鍥剧墖'
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }

      const filePath = result.filePaths[0]
      const data = await fs.readFile(filePath)
      const image = nativeImage.createFromBuffer(data)

      if (image.isEmpty()) {
        return { canceled: true }
      }

      const cropped = cropImageToSquare(image)
      const saved = await saveImageFromBuffer(cropped.toPNG(), 'png')

      return { canceled: false, path: saved.path, thumbnailPath: saved.thumbnailPath }
    } catch (error) {
      console.error('澶勭悊澶村儚澶辫触:', error)
      return { canceled: true }
    }
  })

  // 绐楀彛鎺у埗
  handleTrustedIpc('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  handleTrustedIpc('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  handleTrustedIpc('window:close', () => {
    requestAppQuit()
  })

  handleTrustedIpc('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isMaximized() ?? false
  })

  // 搴旂敤淇℃伅
  handleTrustedIpc('app:getInfo', () => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node
    }
  })

  // 妫€鏌ユ洿鏂?
  handleTrustedIpc('app:checkForUpdates', async (_event, options?: UpdateCheckOptions) => {
    return await getUpdateCheckResult(options)
  })

  // 涓嬭浇鏇存柊
  handleTrustedIpc('app:downloadUpdate', async () => {
    if (activeUpdateDownloadToken && !activeUpdateDownloadToken.cancelled) {
      return
    }

    const cancellationToken = new CancellationToken()
    activeUpdateDownloadToken = cancellationToken

    try {
      await autoUpdater.downloadUpdate(cancellationToken)
    } catch (error) {
      if (isUpdateDownloadCanceledError(error)) {
        throw new Error('已取消更新下载')
      }

      const message = getErrorMessage(error)
      if (!message.includes('Please check update first')) {
        throw new Error(normalizeUpdateErrorMessage(error))
      }

      const checkResult = await getUpdateCheckResult({ force: true })
      if (!checkResult.success) {
        throw new Error(checkResult.error || '检查更新失败，请稍后重试')
      }
      if (!checkResult.updateInfo) {
        throw new Error('褰撳墠宸叉槸鏈€鏂扮増鏈紝鏃犻渶涓嬭浇鏇存柊')
      }

      await autoUpdater.downloadUpdate(cancellationToken)
    } finally {
      if (activeUpdateDownloadToken === cancellationToken) {
        activeUpdateDownloadToken = null
      }
      cancellationToken.dispose()
    }
  })

  handleTrustedIpc('app:cancelUpdateDownload', () => {
    const token = activeUpdateDownloadToken
    if (!token || token.cancelled) return false

    token.cancel()
    return true
  })

  // 瀹夎鏇存柊
  handleTrustedIpc('app:installUpdate', () => {
    autoUpdater.quitAndInstall()
  })

  // 鏇存柊涓嬭浇杩涘害浜嬩欢
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:download-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  autoUpdater.on('update-cancelled', () => {
    mainWindow?.webContents.send('update:download-canceled')
  })

  // 鏇存柊涓嬭浇瀹屾垚浜嬩欢
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update:downloaded')
  })
}

// ========== Avatar Helpers ==========

const AVATAR_MAX_SIZE = 512

const cropImageToSquare = (image: Electron.NativeImage): Electron.NativeImage => {
  const { width, height } = image.getSize()
  const size = Math.min(width, height)

  if (size <= 0) return image

  const cropped = image.crop({
    x: Math.floor((width - size) / 2),
    y: Math.floor((height - size) / 2),
    width: size,
    height: size
  })

  if (size > AVATAR_MAX_SIZE) {
    return cropped.resize({ width: AVATAR_MAX_SIZE, height: AVATAR_MAX_SIZE })
  }

  return cropped
}

