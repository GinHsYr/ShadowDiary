// 导出 Mood 类型供其他模块使用
export type Mood = 'happy' | 'calm' | 'sad' | 'excited' | 'tired'

export interface DiaryEntry {
  id: string
  title: string
  content: string
  mood: Mood
  tags: string[]
  weather?: string
  createdAt: number // Timestamp (ms)
  updatedAt: number
}

export interface HomePageStats {
  totalEntries: number
  currentStreak: number // 连续写作天数
  moodMap: Record<string, number> // 日期 -> 心情映射
}

export interface UserInfo {
  name: string
  avatar: string
}

export interface SearchParams {
  keyword?: string
  mood?: Mood
  tags?: string[]
  dateFrom?: number
  dateTo?: number
  limit?: number
  offset?: number
  lightweight?: boolean
}

export interface AttachmentInfo {
  id: string
  diaryId: string
  filename: string
  mimeType: string
  filePath: string
  size: number
  createdAt: number
}

export interface DiaryListResult {
  entries: DiaryEntry[]
  total: number
}

export interface SearchResult {
  entries: DiaryEntry[]
  total: number
  expandedKeywords?: string[] // 扩展后的关键词列表（包含档案别名）
}

export interface PersonMentionDetailItem {
  id: string
  title: string
  content: string // plain_content（纯文本）
  mood: Mood
  createdAt: number
  updatedAt: number
  mentionCount: number
  matchedKeywords: string[]
}

export interface PersonMentionDetailResult {
  personName: string
  keywords: string[]
  entries: PersonMentionDetailItem[]
  total: number
}

export type ArchiveType = 'person' | 'object' | 'other'

export interface Archive {
  id: string
  name: string
  aliases: string[]
  description?: string
  type: ArchiveType
  mainImage?: string
  images: string[]
  createdAt: number
  updatedAt: number
}
