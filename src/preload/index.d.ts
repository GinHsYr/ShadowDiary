import type { DiaryAPI } from '../types/api'

declare global {
  interface Window {
    api: DiaryAPI
  }
}
