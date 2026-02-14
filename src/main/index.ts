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
import { join, extname, resolve } from 'path'
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
  getStats
} from './database/diary'
import { getAllTags } from './database/tags'
import { addAttachment, deleteAttachment, getAttachments } from './database/attachments'
import { getSetting, setSetting, getAllSettings } from './database/settings'
import { saveImage, getImage, ensureImageDirs } from './utils/imageStorage'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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
    mainWindow.show()
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
  ensureImageDirs()

  // Register custom protocol for images
  protocol.registerBufferProtocol('diary-image', async (request, callback) => {
    try {
      const url = request.url.replace('diary-image://', '')
      const buffer = await getImage(url)

      // 根据文件扩展名确定 MIME 类型
      const ext = url.split('.').pop()?.toLowerCase()
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp'
      }
      const mimeType = mimeMap[ext || 'png'] || 'image/png'

      callback({
        mimeType,
        data: buffer
      })
    } catch (error) {
      console.error('Failed to load image:', error)
      callback({ mimeType: 'image/png', data: Buffer.from('') })
    }
  })

  // Register IPC handlers
  registerIpcHandlers()

  createWindow()
  autoUpdater.checkForUpdatesAndNotify()

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

  ipcMain.handle('diary:save', (_event, entry) => {
    return saveDiaryEntry(entry)
  })

  ipcMain.handle('diary:delete', (_event, id: string) => {
    return deleteDiaryEntry(id)
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

  // 读取图片文件为 dataUrl（用于拖拽插入）
  ipcMain.handle('read-image-file', async (_event, filePath: string) => {
    try {
      // 安全校验：只允许读取图片文件
      const allowedImageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])
      const normalizedPath = resolve(filePath)
      const ext = extname(normalizedPath).toLowerCase()
      if (!allowedImageExts.has(ext)) return { success: false }

      const data = await fs.readFile(normalizedPath)
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
      }
      const mime = mimeMap[ext]
      if (!mime) return { success: false }
      const dataUrl = `data:${mime};base64,${data.toString('base64')}`
      return { success: true, dataUrl }
    } catch {
      return { success: false }
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
  ipcMain.handle('app:checkForUpdates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return {
        success: true,
        updateInfo: result?.updateInfo
      }
    } catch (error) {
      return {
        success: false,
        error: String(error)
      }
    }
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
