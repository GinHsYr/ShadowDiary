/// <reference types="vite/client" />

import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider'
import type { DiaryAPI } from '../../types/api'

declare global {
  interface Window {
    api: DiaryAPI
    $message?: MessageApiInjection
  }
}

export {}
