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
import type { AppUpdateInfo, CheckForUpdatesResult, UpdateCheckOptions } from '../types/api'

let mainWindow: BrowserWindow | null = null
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { promises as fs } from 'fs'
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
  invalidatePersonMentionCache
} from './database/diary'
import { archives } from './database/archives'
import { getAllTags } from './database/tags'
import {
  addAttachment,
  deleteAttachment,
  deleteAttachmentFiles,
  getAttachments
} from './database/attachments'
import { getSetting, setSetting, getAllSettings } from './database/settings'
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
  deleteImageById,
  parseImageDataUrl
} from './utils/imageStorage'
import {
  cancelDataTransfer,
  exportAppData,
  importAppData,
  type DataTransferProgress
} from './utils/dataTransfer'

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
    console.warn('无效的 ELECTRON_RENDERER_URL，将忽略该信任源')
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
    console.error('关闭数据库失败:', error)
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
        console.error('发送退出前保存事件失败:', error)
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
      console.error('应用退出准备失败:', error)
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

  await Promise.allSettled([...uniqueIds].map((imageId) => deleteImageById(imageId)))
}

async function migrateLegacyAvatarSetting(): Promise<void> {
  try {
    const currentAvatar = getSetting('user.avatar')
    if (!currentAvatar || !parseImageDataUrl(currentAvatar)) return

    const saved = await saveImage(currentAvatar)
    const releasedIds = setSetting('user.avatar', saved.path)
    await cleanupReleasedImages(releasedIds)
  } catch (error) {
    console.error('迁移历史头像失败:', error)
  }
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
    return '更新服务器证书校验失败，请检查系统时间或代理设置'
  }

  return message || '未知错误'
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

function isWindowsPasswordSupported(): boolean {
  return process.platform === 'win32'
}

const POWERSHELL_WINDOWS_PASSWORD_VERIFY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$password = [Console]::In.ReadToEnd()
if ([string]::IsNullOrEmpty($password)) {
  Write-Output 'false'
  exit 0
}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NativeMethods {
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool LogonUser(
    string lpszUsername,
    string lpszDomain,
    string lpszPassword,
    int dwLogonType,
    int dwLogonProvider,
    out IntPtr phToken
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr hObject);
}
"@

$userName = [Environment]::UserName
$userDomain = [Environment]::UserDomainName
function Test-Logon([string]$name, [string]$domain, [string]$pwd) {
  $token = [IntPtr]::Zero
  $ok = [NativeMethods]::LogonUser($name, $domain, $pwd, 2, 0, [ref]$token)
  if ($ok) {
    [NativeMethods]::CloseHandle($token) | Out-Null
  }
  return $ok
}

$identityName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if (Test-Logon $userName $userDomain $password) {
  Write-Output 'true'
  exit 0
}
if (Test-Logon $userName '.' $password) {
  Write-Output 'true'
  exit 0
}
if ($identityName -and $identityName.Contains('\\')) {
  $parts = $identityName.Split('\\', 2)
  if ($parts.Length -eq 2 -and (Test-Logon $parts[1] $parts[0] $password)) {
    Write-Output 'true'
    exit 0
  }
}
Write-Output 'false'
`

async function verifyWindowsPassword(password: string): Promise<boolean> {
  if (!isWindowsPasswordSupported()) return false
  if (!password) return false

  return await new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_WINDOWS_PASSWORD_VERIFY_SCRIPT],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      console.error('执行 Windows 密码验证失败:', error)
      settle(false)
    })

    child.on('close', (code) => {
      if (code !== 0 && stderr.trim()) {
        console.error('Windows 密码验证脚本异常:', stderr.trim())
      }
      settle(stdout.trim().toLowerCase().endsWith('true'))
    })

    child.stdin.on('error', () => {
      // 进程提前结束时忽略 stdin 写入错误
    })
    child.stdin.end(password)
  })
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
  .then(() => {
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

    // 手动触发下载，避免检查更新后自动开始下载导致状态不可控
    autoUpdater.autoDownload = false

    void migrateLegacyAvatarSetting()

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
    console.error('应用初始化失败:', error)
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

  // 日记 CRUD
  handleTrustedIpc('diary:list', (_event, params: Parameters<typeof getDiaryEntries>[0]) => {
    return getDiaryEntries(params ?? {})
  })

  handleTrustedIpc('diary:get', (_event, id: string) => {
    return getDiaryEntry(id)
  })

  handleTrustedIpc('diary:save', async (_event, entry: Parameters<typeof saveDiaryEntry>[0]) => {
    const previous = entry.id ? getDiaryEntry(entry.id) : null
    const saved = saveDiaryEntry(entry)
    const releasedIds = syncImageRefs(
      collectImageIdsFromText(previous?.content),
      collectImageIdsFromText(saved.content)
    )
    await cleanupReleasedImages(releasedIds)
    invalidatePersonMentionCache()
    return saved
  })

  handleTrustedIpc('diary:delete', async (_event, id: string) => {
    const previous = getDiaryEntry(id)
    const attachments = getAttachments(id)
    const result = deleteDiaryEntry(id)
    if (result) {
      const releasedIds = syncImageRefs(collectImageIdsFromText(previous?.content), [])
      await cleanupReleasedImages(releasedIds)
      invalidatePersonMentionCache()
      await deleteAttachmentFiles(attachments.map((attachment) => attachment.filePath))
    }
    return result
  })

  handleTrustedIpc('diary:getByDate', (_event, dateStr: string) => {
    return getDiaryByDate(dateStr)
  })

  handleTrustedIpc('diary:getDates', (_event, yearMonth: string) => {
    return getDiaryDates(yearMonth)
  })

  // 搜索
  handleTrustedIpc('diary:search', (_event, params: Parameters<typeof searchDiaries>[0]) => {
    return searchDiaries(params)
  })

  // 档案
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
      const releasedIds = syncImageRefs(
        collectArchiveImageIds(previous ?? {}),
        collectArchiveImageIds(saved)
      )
      await cleanupReleasedImages(releasedIds)
      invalidatePersonMentionCache()
      return saved
    }
  )

  handleTrustedIpc('archives:delete', async (_event, id: string) => {
    const previous = archives.get(id)
    archives.delete(id)
    const releasedIds = syncImageRefs(collectArchiveImageIds(previous ?? {}), [])
    await cleanupReleasedImages(releasedIds)
    invalidatePersonMentionCache()
  })

  // 标签
  handleTrustedIpc('tags:list', () => {
    return getAllTags()
  })

  // 附件
  handleTrustedIpc('attachment:add', async (_event, diaryId: string) => {
    return await addAttachment(diaryId)
  })

  handleTrustedIpc('attachment:delete', async (_event, id: string) => {
    return await deleteAttachment(id)
  })

  handleTrustedIpc('attachment:list', (_event, diaryId: string) => {
    return getAttachments(diaryId)
  })

  // 设置
  handleTrustedIpc('settings:get', (_event, key: string) => {
    return getSetting(key)
  })

  handleTrustedIpc('settings:set', async (_event, key: string, value: string) => {
    const releasedIds = setSetting(key, value)
    await cleanupReleasedImages(releasedIds)
    return true
  })

  handleTrustedIpc('settings:getAll', () => {
    return getAllSettings()
  })

  handleTrustedIpc('privacy:getAuthSupport', () => {
    return { windowsPassword: isWindowsPasswordSupported() }
  })

  handleTrustedIpc('privacy:verifyWindowsPassword', async (_event, password: string) => {
    if (typeof password !== 'string') return false
    return await verifyWindowsPassword(password)
  })

  // 数据导入/导出
  handleTrustedIpc('data:export', async (event, options?: { backupPassword?: string }) => {
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
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await importAppData(
      win,
      { backupPassword: options?.backupPassword ?? '' },
      (progress: DataTransferProgress) => {
        event.sender.send('data:import-progress', progress)
      }
    )
    if (result.success) {
      invalidatePersonMentionCache()
    }
    return result
  })

  handleTrustedIpc('data:cancel', () => {
    return cancelDataTransfer()
  })

  // 统计
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

  // 保存图片（兼容 data URL）
  handleTrustedIpc('image:save', async (_event, base64Data: string) => {
    try {
      const result = await saveImage(base64Data)
      return { success: true, ...result }
    } catch (error) {
      console.error('保存图片失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 保存图片（文件路径）
  handleTrustedIpc('image:save-file', async (_event, filePath: string) => {
    try {
      const result = await saveImageFromFile(filePath)
      return { success: true, ...result }
    } catch (error) {
      console.error('通过文件路径保存图片失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 保存图片（二进制）
  handleTrustedIpc(
    'image:save-bytes',
    async (_event, payload: { bytes: Uint8Array; mimeType: string }) => {
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
        console.error('通过二进制保存图片失败:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // 清理未使用的图片
  handleTrustedIpc('image:cleanup', async () => {
    try {
      await cleanupUnusedImages(getAllReferencedImageIds())
      return { success: true }
    } catch (error) {
      console.error('清理图片失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 图片选择（用于编辑器插入图片）
  handleTrustedIpc('select-image', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        properties: ['openFile'] as 'openFile'[],
        filters: [
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] }
        ],
        title: '选择图片'
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
      console.error('选择图片失败:', error)
      return { canceled: true }
    }
  })

  // 档案头像选择（自动 1:1 裁切，仅保存 webp 缩略图）
  handleTrustedIpc('select-archive-avatar', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
        title: '选择头像图片'
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
      console.error('选择档案头像失败:', error)
      return { canceled: true }
    }
  })

  // 复制图片到剪贴板（接收 base64 dataUrl）
  handleTrustedIpc('image:copy', async (_event, dataUrl: string) => {
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

  // 另存为图片文件
  handleTrustedIpc('image:save-as', async (event, dataUrl: string) => {
    try {
      const payload = await resolveImagePayload(dataUrl)
      if (!payload) return { success: false }

      const win = BrowserWindow.fromWebContents(event.sender)
      const ext = payload.ext === 'jpeg' ? 'jpg' : payload.ext
      const dialogOptions = {
        defaultPath: `image.${ext}`,
        filters: [{ name: '图片', extensions: [ext] }],
        title: '保存图片'
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

  // 头像选择
  handleTrustedIpc('select-avatar', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
        title: '选择头像图片'
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
      console.error('处理头像失败:', error)
      return { canceled: true }
    }
  })

  // 窗口控制
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

  // 应用信息
  handleTrustedIpc('app:getInfo', () => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node
    }
  })

  // 检查更新
  handleTrustedIpc('app:checkForUpdates', async (_event, options?: UpdateCheckOptions) => {
    return await getUpdateCheckResult(options)
  })

  // 下载更新
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
        throw new Error('当前已是最新版本，无需下载更新')
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

  // 安装更新
  handleTrustedIpc('app:installUpdate', () => {
    autoUpdater.quitAndInstall()
  })

  // 更新下载进度事件
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

  // 更新下载完成事件
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
