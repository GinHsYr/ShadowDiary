/// <reference types="vite/client" />

import type { ElectronAPI } from '@electron-toolkit/preload'
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider'
import type {
  DiaryEntry,
  DiaryListResult,
  SearchParams,
  SearchResult,
  HomePageStats,
  AttachmentInfo,
  Archive
} from '../../types/model'

interface DiaryAPI {
  // 档案
  getArchives(params?: { type?: string; search?: string }): Promise<Archive[]>
  getArchive(id: string): Promise<Archive | null>
  saveArchive(archive: Partial<Archive>): Promise<Archive>
  deleteArchive(id: string): Promise<void>

  // 日记
  getDiaryEntries(params: {
    limit?: number
    offset?: number
    lightweight?: boolean
  }): Promise<DiaryListResult>
  getDiaryEntry(id: string): Promise<DiaryEntry | null>
  saveDiaryEntry(entry: {
    id?: string
    title: string
    content: string
    mood: string
    tags?: string[]
    weather?: string
    createdAt?: number
  }): Promise<DiaryEntry>
  deleteDiaryEntry(id: string): Promise<boolean>
  getDiaryByDate(dateStr: string): Promise<DiaryEntry | null>
  getDiaryDates(yearMonth: string): Promise<string[]>

  // 搜索
  searchDiaries(params: SearchParams): Promise<SearchResult>

  // 标签
  getAllTags(): Promise<{ id: number; name: string }[]>

  // 附件
  addAttachment(diaryId: string): Promise<AttachmentInfo | null>
  deleteAttachment(id: string): Promise<boolean>
  getAttachments(diaryId: string): Promise<AttachmentInfo[]>

  // 设置
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  getAllSettings(): Promise<Record<string, string>>

  // 统计
  getStats(): Promise<HomePageStats>

  // 图片保存（将 base64 转换为文件）
  saveImage(base64Data: string): Promise<{
    success: boolean
    id?: string
    path?: string
    thumbnailPath?: string
    error?: string
  }>

  // 图片选择
  selectImage(): Promise<{ canceled: boolean; dataUrl?: string }>

  // 读取图片文件为 dataUrl（拖拽插入）
  readImageFile(filePath: string): Promise<{ success: boolean; dataUrl?: string }>

  // 图片操作（右键菜单）
  copyImage(dataUrl: string): Promise<{ success: boolean }>
  saveImageAs(dataUrl: string): Promise<{ success: boolean }>

  // 头像
  selectAvatar(): Promise<{ canceled: boolean; dataUrl?: string }>

  // 窗口控制
  windowMinimize(): Promise<void>
  windowMaximize(): Promise<void>
  windowClose(): Promise<void>
  windowIsMaximized(): Promise<boolean>

  // 应用信息和更新
  getAppInfo(): Promise<{
    name: string
    version: string
    electronVersion: string
    chromeVersion: string
    nodeVersion: string
  }>
  checkForUpdates(): Promise<{
    success: boolean
    updateInfo?: any
    error?: string
  }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DiaryAPI
    $message?: MessageApiInjection
  }
}

export {}
