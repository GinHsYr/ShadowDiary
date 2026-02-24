import { defineStore } from 'pinia'
import {
  type LocaleCode,
  type LocalePreference,
  normalizeLocalePreference,
  resolveLocale,
  setI18nLocale
} from '@renderer/i18n'

const SETTINGS_LOCALE_KEY = 'settings.locale'

export const useLocaleStore = defineStore('locale', {
  state: () => ({
    preference: 'system' as LocalePreference,
    currentLocale: 'zh-CN' as LocaleCode,
    isInitialized: false
  }),

  actions: {
    async initFromStorage(): Promise<void> {
      try {
        const savedPreference = await window.api.getSetting(SETTINGS_LOCALE_KEY)
        this.preference = normalizeLocalePreference(savedPreference)
      } catch (error) {
        console.error('Failed to load locale preference:', error)
        this.preference = 'system'
      }

      this.currentLocale = resolveLocale(this.preference, navigator.language)
      setI18nLocale(this.currentLocale)
      this.isInitialized = true
    },

    async setPreference(preference: LocalePreference): Promise<void> {
      this.preference = preference
      this.currentLocale = resolveLocale(preference, navigator.language)
      setI18nLocale(this.currentLocale)
      await window.api.setSetting(SETTINGS_LOCALE_KEY, preference)
    }
  }
})
