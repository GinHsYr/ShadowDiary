/// <reference types="vite/client" />

import type { ElectronAPI } from '@electron-toolkit/preload'
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider'
import type { DiaryAPI } from '../../types/api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: DiaryAPI
    $message?: MessageApiInjection
  }
}

export {}
