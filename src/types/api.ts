import type {
  Archive,
  AttachmentInfo,
  DiaryEntry,
  DiaryListResult,
  HomePageStats,
  Mood,
  PersonMentionDetailResult,
  SearchParams,
  SearchResult
} from './model'

export interface ArchiveQueryParams {
  type?: Archive['type'] | 'all'
  search?: string
}

export interface SaveDiaryEntryInput {
  id?: string
  title: string
  content: string
  mood: Mood
  tags?: string[]
  weather?: string
  createdAt?: number
}

export interface AppInfo {
  name: string
  version: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

export interface AppUpdateInfo {
  version: string
  releaseDate?: string
  releaseName?: string | null
}

export interface UpdateCheckOptions {
  force?: boolean
}

export interface CheckForUpdatesResult {
  success: boolean
  updateInfo?: AppUpdateInfo
  error?: string
  checkedAt: number
  fromCache: boolean
}

export interface DiaryAPI {
  // 档案
  getArchives(params?: ArchiveQueryParams): Promise<Archive[]>
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
  saveDiaryEntry(entry: SaveDiaryEntryInput): Promise<DiaryEntry>
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
  getPersonMentionStats(): Promise<{ name: string; count: number }[]>
  getPersonMentionDetails(
    personName: string,
    params?: { limit?: number; offset?: number }
  ): Promise<PersonMentionDetailResult>

  // 图片保存（将 base64 转换为文件）
  saveImage(base64Data: string): Promise<{
    success: boolean
    id?: string
    path?: string
    thumbnailPath?: string
    error?: string
  }>

  // 清理未使用的图片
  cleanupImages(): Promise<{ success: boolean; error?: string }>

  // 图片选择
  selectImage(): Promise<{ canceled: boolean; dataUrl?: string }>

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
  getAppInfo(): Promise<AppInfo>
  checkForUpdates(options?: UpdateCheckOptions): Promise<CheckForUpdatesResult>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onDownloadProgress(callback: (progress: { percent: number }) => void): () => void
  onUpdateDownloaded(callback: () => void): () => void
}
