import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import jaJP from './locales/ja-JP'
import koKR from './locales/ko-KR'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'] as const
export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]
export type LocalePreference = 'system' | LocaleCode

const DEFAULT_LOCALE: LocaleCode = 'zh-CN'

function normalizeLocaleTag(input: string | null | undefined): LocaleCode {
  const normalized = (input || '').toLowerCase().replace('_', '-')
  if (normalized === 'zh-cn' || normalized.startsWith('zh')) {
    return 'zh-CN'
  }
  if (normalized === 'en-us' || normalized.startsWith('en')) {
    return 'en-US'
  }
  if (normalized === 'ja-jp' || normalized.startsWith('ja')) {
    return 'ja-JP'
  }
  if (normalized === 'ko-kr' || normalized.startsWith('ko')) {
    return 'ko-KR'
  }
  return DEFAULT_LOCALE
}

export function resolveLocale(
  preference: LocalePreference,
  systemLanguage: string | null | undefined
): LocaleCode {
  if (preference !== 'system') {
    return preference
  }
  return normalizeLocaleTag(systemLanguage)
}

export function normalizeLocalePreference(input: string | null | undefined): LocalePreference {
  if (input === 'system') {
    return 'system'
  }
  if (input === 'zh-CN' || input === 'en-US' || input === 'ja-JP' || input === 'ko-KR') {
    return input
  }
  return 'system'
}

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
    'ja-JP': jaJP,
    'ko-KR': koKR
  }
})

export function setI18nLocale(locale: LocaleCode): void {
  i18n.global.locale.value = locale
}
