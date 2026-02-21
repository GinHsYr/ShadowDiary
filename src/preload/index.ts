import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { DiaryAPI } from '../types/api'

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
  setSetting: (key, value) => invoke('settings:set', key, value),
  getAllSettings: () => invoke('settings:getAll'),
  exportData: () => invoke('data:export'),
  importData: () => invoke('data:import'),

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
  installUpdate: () => invoke('app:installUpdate'),
  onDownloadProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { percent: number }): void => {
      callback(progress)
    }
    ipcRenderer.on('update:download-progress', listener)
    return () => ipcRenderer.removeListener('update:download-progress', listener)
  },
  onUpdateDownloaded: (callback) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on('update:downloaded', listener)
    return () => ipcRenderer.removeListener('update:downloaded', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const globalWindow = globalThis as typeof globalThis & {
    electron: typeof electronAPI
    api: DiaryAPI
  }
  globalWindow.electron = electronAPI
  globalWindow.api = api
}
