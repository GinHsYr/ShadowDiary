import { ElectronAPI } from '@electron-toolkit/preload'
import type { DiaryAPI } from '../types/api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: DiaryAPI
  }
}
