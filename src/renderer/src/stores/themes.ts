// src/stores/theme.ts
import { defineStore } from 'pinia'
import { darkTheme } from 'naive-ui'

export enum ThemeMode {
  Light = 'lightTheme',
  Dark = 'darkTheme'
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: ThemeMode.Light
  }),

  getters: {
    isDark(state): boolean {
      if (state.mode === ThemeMode.Dark) return true
      if (state.mode === ThemeMode.Light) return false
      return false
    },
    getTheme(): typeof darkTheme | null {
      return this.isDark ? darkTheme : null
    }
  },

  actions: {
    setMode(mode: ThemeMode) {
      this.mode = mode
      // 自动保存到数据库
      window.api.setSetting('settings.theme', mode === ThemeMode.Dark ? 'dark' : 'light').catch((error) => {
        console.error('保存主题设置失败:', error)
      })
    },

    // 从数据库加载主题设置
    async initFromStorage() {
      try {
        const theme = await window.api.getSetting('settings.theme')
        if (theme === 'dark') {
          this.mode = ThemeMode.Dark
        } else if (theme === 'light') {
          this.mode = ThemeMode.Light
        }
      } catch (error) {
        console.error('加载主题设置失败:', error)
      }
    }
  }
})
