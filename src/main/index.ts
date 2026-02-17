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
  getAllDiaryContents,
  getPersonMentionStats,
  getPersonMentionDetails
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
  saveImage,
  getImage,
  ensureImageDirs,
  cleanupUnusedImages,
  extractImageIds
} from './utils/imageStorage'

const IMAGE_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
}

const UPDATE_CACHE_TTL_MS = 5 * 60 * 1000
let cachedUpdateCheck: CheckForUpdatesResult | null = null

function getImageMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return IMAGE_MIME_MAP[ext || 'png'] || 'image/png'
}

async function loadDiaryImage(url: string): Promise<{ mimeType: string; data: Buffer } | null> {
  try {
    const fileName = decodeURIComponent(url.replace('diary-image://', ''))
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

function collectAllUsedImageIds(): Set<string> {
  const contents = getAllDiaryContents()
  const usedIds = new Set<string>()
  for (const content of contents) {
    const ids = extractImageIds(content)
    for (const id of ids) {
      usedIds.add(id)
    }
  }
  return usedIds
}

function registerIpcHandlers(): void {
  // 日记 CRUD
  ipcMain.handle('diary:list', (_event, params) => {
    return getDiaryEntries(params ?? {})
  })

  ipcMain.handle('diary:get', (_event, id: string) => {
    return getDiaryEntry(id)
  })

  ipcMain.handle('diary:save', (_event, entry) => {
    return saveDiaryEntry(entry)
  })

  ipcMain.handle('diary:delete', async (_event, id: string) => {
    const attachments = getAttachments(id)
    const result = deleteDiaryEntry(id)
    if (result) {
      await deleteAttachmentFiles(attachments.map((attachment) => attachment.filePath))
      const usedIds = collectAllUsedImageIds()
      await cleanupUnusedImages(usedIds)
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

  ipcMain.handle('archives:save', (_event, archive) => {
    return archives.save(archive)
  })

  ipcMain.handle('archives:delete', (_event, id: string) => {
    return archives.delete(id)
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

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
    return true
  })

  ipcMain.handle('settings:getAll', () => {
    return getAllSettings()
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

  // 保存图片（将 base64 转换为文件）
  ipcMain.handle('image:save', async (_event, base64Data: string) => {
    try {
      const result = await saveImage(base64Data)
      return { success: true, ...result }
    } catch (error) {
      console.error('保存图片失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 清理未使用的图片
  ipcMain.handle('image:cleanup', async () => {
    try {
      const usedIds = collectAllUsedImageIds()
      await cleanupUnusedImages(usedIds)
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
        filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
        title: '选择图片'
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }

      const filePath = result.filePaths[0]
      const data = await fs.readFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp'
      }
      const mime = mimeMap[ext] || 'image/png'
      const dataUrl = `data:${mime};base64,${data.toString('base64')}`

      return { canceled: false, dataUrl }
    } catch (error) {
      console.error('选择图片失败:', error)
      return { canceled: true }
    }
  })

  // 复制图片到剪贴板（接收 base64 dataUrl）
  ipcMain.handle('image:copy', (_event, dataUrl: string) => {
    try {
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))
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
      const win = BrowserWindow.fromWebContents(event.sender)
      // 从 dataUrl 推断扩展名
      const mimeMatch = dataUrl.match(/^data:image\/(\w+);base64,/)
      const extRaw = mimeMatch ? mimeMatch[1] : 'png'
      const ext = extRaw === 'jpeg' ? 'jpg' : extRaw
      const dialogOptions = {
        defaultPath: `image.${ext}`,
        filters: [{ name: '图片', extensions: [ext] }],
        title: '保存图片'
      }
      const result = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (result.canceled || !result.filePath) return { success: false }
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'))
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
      const dataUrl = `data:image/png;base64,${cropped.toPNG().toString('base64')}`

      return { canceled: false, dataUrl }
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
