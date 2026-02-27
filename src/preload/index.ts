import { contextBridge, ipcRenderer } from 'electron'
import type { DataTransferProgress, DiaryAPI, UpdateDownloadProgress } from '../types/api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

// Custom APIs for renderer
const api: DiaryAPI = {
  // 日记
  getDiaryEntries: (params) => invoke('diary:list', params),
  getDiaryEntry: (id) => invoke('diary:get', id),
  saveDiaryEntry: (entry) => invoke('diary:save', entry),
  deleteDiaryEntry: (id) => invoke('diary:delete', id),
  getDiaryByDate: (dateStr) => invoke('diary:getByDate', dateStr),
  getDiaryDates: (yearMonth) => invoke('diary:getDates', yearMonth),

  // 档案
  getArchives: (params) => invoke('archives:list', params),
  getArchive: (id) => invoke('archives:get', id),
  saveArchive: (archive) => invoke('archives:save', archive),
  deleteArchive: (id) => invoke('archives:delete', id),

  // 搜索
  searchDiaries: (params) => invoke('diary:search', params),

  // 标签
  getAllTags: () => invoke('tags:list'),

  // 附件
  addAttachment: (diaryId) => invoke('attachment:add', diaryId),
  deleteAttachment: (id) => invoke('attachment:delete', id),
  getAttachments: (diaryId) => invoke('attachment:list', diaryId),

  // 设置
  getSetting: (key) => invoke('settings:get', key),
  getSecureSetting: (key) => invoke('settings:getSecure', key),
  setSetting: (key, value) => invoke('settings:set', key, value),
  setSecureSetting: (key, value) => invoke('settings:setSecure', key, value),
  getAllSettings: () => invoke('settings:getAll'),
  getPrivacyAuthSupport: () => invoke('privacy:getAuthSupport'),
  verifyWindowsPassword: (password) => invoke('privacy:verifyWindowsPassword', password),
  getDisguiseConfig: () => invoke('disguise:getConfig'),
  setDisguiseEnabled: (enabled) => invoke('disguise:setEnabled', enabled),
  setDisguiseAutoEnableOnLaunch: (enabled) => invoke('disguise:setAutoEnableOnLaunch', enabled),
  setDisguiseShortcut: (shortcut) => invoke('disguise:setShortcut', shortcut),
  regenerateDisguiseData: () => invoke('disguise:regenerateData'),
  exportData: (options) => invoke('data:export', options),
  importData: (options) => invoke('data:import', options),
  cancelDataTransfer: () => invoke('data:cancel'),
  onExportProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DataTransferProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('data:export-progress', listener)
    return () => ipcRenderer.removeListener('data:export-progress', listener)
  },
  onImportProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DataTransferProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('data:import-progress', listener)
    return () => ipcRenderer.removeListener('data:import-progress', listener)
  },

  // 统计
  getStats: () => invoke('stats:get'),
  getPersonMentionStats: () => invoke('stats:personMentions'),
  getPersonMentionDetails: (personName, params) =>
    invoke('stats:personMentionDetails', personName, params),

  // 图片保存（兼容 data URL）
  saveImage: (base64Data) => invoke('image:save', base64Data),
  saveImageFromFile: (filePath) => invoke('image:save-file', filePath),
  saveImageFromBytes: (bytes, mimeType) => invoke('image:save-bytes', { bytes, mimeType }),

  // 清理未使用的图片
  cleanupImages: () => invoke('image:cleanup'),

  // 媒体库
  getMediaLibrary: (params) => invoke('media:list', params),

  // 图片选择（编辑器插入图片）
  selectImage: () => invoke('select-image'),

  // 档案头像选择（自动裁切并保存为 webp 缩略图）
  selectArchiveAvatar: () => invoke('select-archive-avatar'),

  // 图片操作（右键菜单）
  copyImage: (dataUrl) => invoke('image:copy', dataUrl),
  saveImageAs: (dataUrl) => invoke('image:save-as', dataUrl),

  // 头像
  selectAvatar: () => invoke('select-avatar'),

  // 窗口控制
  windowMinimize: () => invoke('window:minimize'),
  windowMaximize: () => invoke('window:maximize'),
  windowClose: () => invoke('window:close'),
  windowIsMaximized: () => invoke('window:isMaximized'),

  // 应用信息和更新
  getAppInfo: () => invoke('app:getInfo'),
  checkForUpdates: (options) => invoke('app:checkForUpdates', options),
  downloadUpdate: () => invoke('app:downloadUpdate'),
  cancelUpdateDownload: () => invoke('app:cancelUpdateDownload'),
  installUpdate: () => invoke('app:installUpdate'),
  onDownloadProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: UpdateDownloadProgress
    ): void => {
      callback(progress)
    }
    ipcRenderer.on('update:download-progress', listener)
    return () => ipcRenderer.removeListener('update:download-progress', listener)
  },
  onUpdateDownloadCanceled: (callback) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on('update:download-canceled', listener)
    return () => ipcRenderer.removeListener('update:download-canceled', listener)
  },
  onUpdateDownloaded: (callback) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on('update:downloaded', listener)
    return () => ipcRenderer.removeListener('update:downloaded', listener)
  },
  onSystemLock: (callback) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on('system:lock-screen', listener)
    return () => ipcRenderer.removeListener('system:lock-screen', listener)
  },
  onAppBeforeQuit: (callback) => {
    const listener = (): void => {
      void callback()
    }
    ipcRenderer.on('app:before-quit', listener)
    return () => ipcRenderer.removeListener('app:before-quit', listener)
  },
  notifyAppBeforeQuitDone: () => {
    ipcRenderer.send('app:before-quit-done')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const globalWindow = globalThis as typeof globalThis & {
    api: DiaryAPI
  }
  globalWindow.api = api
}
