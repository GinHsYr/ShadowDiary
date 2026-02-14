import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // 日记
  getDiaryEntries: (params: { limit?: number; offset?: number; lightweight?: boolean }) =>
    ipcRenderer.invoke('diary:list', params),
  getDiaryEntry: (id: string) => ipcRenderer.invoke('diary:get', id),
  saveDiaryEntry: (entry: {
    id?: string
    title: string
    content: string
    mood: string
    tags?: string[]
    weather?: string
    createdAt?: number
  }) => ipcRenderer.invoke('diary:save', entry),
  deleteDiaryEntry: (id: string) => ipcRenderer.invoke('diary:delete', id),
  getDiaryByDate: (dateStr: string) => ipcRenderer.invoke('diary:getByDate', dateStr),
  getDiaryDates: (yearMonth: string) => ipcRenderer.invoke('diary:getDates', yearMonth),

  // 搜索
  searchDiaries: (params: {
    keyword?: string
    mood?: string
    tags?: string[]
    dateFrom?: number
    dateTo?: number
    limit?: number
    offset?: number
    lightweight?: boolean
  }) => ipcRenderer.invoke('diary:search', params),

  // 标签
  getAllTags: () => ipcRenderer.invoke('tags:list'),

  // 附件
  addAttachment: (diaryId: string) => ipcRenderer.invoke('attachment:add', diaryId),
  deleteAttachment: (id: string) => ipcRenderer.invoke('attachment:delete', id),
  getAttachments: (diaryId: string) => ipcRenderer.invoke('attachment:list', diaryId),

  // 设置
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),

  // 统计
  getStats: () => ipcRenderer.invoke('stats:get'),

  // 图片保存（将 base64 转换为文件）
  saveImage: (base64Data: string) => ipcRenderer.invoke('image:save', base64Data),

  // 图片选择（编辑器插入图片）
  selectImage: () => ipcRenderer.invoke('select-image'),

  // 读取图片文件为 dataUrl（拖拽插入）
  readImageFile: (filePath: string) => ipcRenderer.invoke('read-image-file', filePath),

  // 图片操作（右键菜单）
  copyImage: (dataUrl: string) => ipcRenderer.invoke('image:copy', dataUrl),
  saveImageAs: (dataUrl: string) => ipcRenderer.invoke('image:save-as', dataUrl),

  // 头像
  selectAvatar: () => ipcRenderer.invoke('select-avatar'),

  // 窗口控制
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // 应用信息和更新
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
