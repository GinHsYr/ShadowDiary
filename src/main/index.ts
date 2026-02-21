import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeImage,
  clipboard,
  protocol
} from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateInfo, CheckForUpdatesResult, UpdateCheckOptions } from '../types/api'

let mainWindow: BrowserWindow | null = null
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { promises as fs } from 'fs'
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
import { exportAppData, importAppData } from './utils/dataTransfer'

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
let cachedUpdateCheck: CheckForUpdatesResult | null = null

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

async function runUpdateCheck(): Promise<CheckForUpdatesResult> {
  try {
    const result = await autoUpdater.checkForUpdates()
    return {
      success: true,
      updateInfo: normalizeUpdateInfo(result?.updateInfo),
      checkedAt: Date.now(),
      fromCache: false
    }
  } catch (error) {
    return {
      success: false,
      error: String(error),
      checkedAt: Date.now(),
      fromCache: false
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        shell.openExternal(details.url)
      }
    } catch {
      // 无效 URL，忽略
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
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

  void migrateLegacyAvatarSetting()

  // Register IPC handlers
  registerIpcHandlers()

  createWindow()
  void getUpdateCheckResult({ force: true })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDatabase()
})

// ========== IPC Handlers ==========

function registerIpcHandlers(): void {
  // 日记 CRUD
  ipcMain.handle('diary:list', (_event, params) => {
    return getDiaryEntries(params ?? {})
  })

  ipcMain.handle('diary:get', (_event, id: string) => {
    return getDiaryEntry(id)
  })

  ipcMain.handle('diary:save', async (_event, entry) => {
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

  ipcMain.handle('diary:delete', async (_event, id: string) => {
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

  ipcMain.handle('diary:getByDate', (_event, dateStr: string) => {
    return getDiaryByDate(dateStr)
  })

  ipcMain.handle('diary:getDates', (_event, yearMonth: string) => {
    return getDiaryDates(yearMonth)
  })

  // 搜索
  ipcMain.handle('diary:search', (_event, params) => {
    return searchDiaries(params)
  })

  // 档案
  ipcMain.handle('archives:list', (_event, params) => {
    return archives.list(params)
  })

  ipcMain.handle('archives:get', (_event, id: string) => {
    return archives.get(id)
  })

  ipcMain.handle('archives:save', async (_event, archive) => {
    const previous = archive.id ? archives.get(archive.id) : null
    const saved = await archives.save(archive)
    const releasedIds = syncImageRefs(
      collectArchiveImageIds(previous ?? {}),
      collectArchiveImageIds(saved)
    )
    await cleanupReleasedImages(releasedIds)
    invalidatePersonMentionCache()
    return saved
  })

  ipcMain.handle('archives:delete', async (_event, id: string) => {
    const previous = archives.get(id)
    archives.delete(id)
    const releasedIds = syncImageRefs(collectArchiveImageIds(previous ?? {}), [])
    await cleanupReleasedImages(releasedIds)
    invalidatePersonMentionCache()
  })

  // 标签
  ipcMain.handle('tags:list', () => {
    return getAllTags()
  })

  // 附件
  ipcMain.handle('attachment:add', async (_event, diaryId: string) => {
    return await addAttachment(diaryId)
  })

  ipcMain.handle('attachment:delete', async (_event, id: string) => {
    return await deleteAttachment(id)
  })

  ipcMain.handle('attachment:list', (_event, diaryId: string) => {
    return getAttachments(diaryId)
  })

  // 设置
  ipcMain.handle('settings:get', (_event, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    const releasedIds = setSetting(key, value)
    await cleanupReleasedImages(releasedIds)
    return true
  })

  ipcMain.handle('settings:getAll', () => {
    return getAllSettings()
  })

  // 数据导入/导出
  ipcMain.handle('data:export', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return await exportAppData(win)
  })

  ipcMain.handle('data:import', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await importAppData(win)
    if (result.success) {
      invalidatePersonMentionCache()
    }
    return result
  })

  // 统计
  ipcMain.handle('stats:get', () => {
    return getStats()
  })

  ipcMain.handle('stats:personMentions', () => {
    return getPersonMentionStats()
  })

  ipcMain.handle(
    'stats:personMentionDetails',
    (_event, personName: string, params?: { limit?: number; offset?: number }) => {
      return getPersonMentionDetails(personName, params)
    }
  )

  // 保存图片（兼容 data URL）
  ipcMain.handle('image:save', async (_event, base64Data: string) => {
    try {
      const result = await saveImage(base64Data)
      return { success: true, ...result }
    } catch (error) {
      console.error('保存图片失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 保存图片（文件路径）
  ipcMain.handle('image:save-file', async (_event, filePath: string) => {
    try {
      const result = await saveImageFromFile(filePath)
      return { success: true, ...result }
    } catch (error) {
      console.error('通过文件路径保存图片失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 保存图片（二进制）
  ipcMain.handle(
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
  ipcMain.handle('image:cleanup', async () => {
    try {
      await cleanupUnusedImages(getAllReferencedImageIds())
      return { success: true }
    } catch (error) {
      console.error('清理图片失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 图片选择（用于编辑器插入图片）
  ipcMain.handle('select-image', async (event) => {
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
  ipcMain.handle('select-archive-avatar', async (event) => {
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
  ipcMain.handle('image:copy', async (_event, dataUrl: string) => {
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
  ipcMain.handle('image:save-as', async (event, dataUrl: string) => {
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
  ipcMain.handle('select-avatar', async (event) => {
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
  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isMaximized() ?? false
  })

  // 应用信息
  ipcMain.handle('app:getInfo', () => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node
    }
  })

  // 检查更新
  ipcMain.handle('app:checkForUpdates', async (_event, options?: UpdateCheckOptions) => {
    return await getUpdateCheckResult(options)
  })

  // 下载更新
  ipcMain.handle('app:downloadUpdate', async () => {
    await autoUpdater.downloadUpdate()
  })

  // 安装更新
  ipcMain.handle('app:installUpdate', () => {
    autoUpdater.quitAndInstall()
  })

  // 更新下载进度事件
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:download-progress', progress)
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
