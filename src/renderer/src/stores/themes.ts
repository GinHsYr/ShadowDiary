// src/stores/theme.ts
import { darkTheme, type GlobalThemeOverrides } from 'naive-ui'
import { defineStore } from 'pinia'

export enum ThemeMode {
  Light = 'lightTheme',
  Dark = 'darkTheme'
}

export enum ThemeAccent {
  Green = 'green',
  Blue = 'blue',
  Black = 'black',
  Orange = 'orange',
  Red = 'red',
  Purple = 'purple',
  Teal = 'teal'
}

export enum MotionLevel {
  Full = 'full',
  Reduced = 'reduced'
}

interface ThemeAccentPalette {
  primaryColor: string
  primaryColorHover: string
  primaryColorPressed: string
  primaryColorSuppl: string
}

type AccentStyleVars = Record<
  | '--app-accent-color'
  | '--app-accent-06'
  | '--app-accent-08'
  | '--app-accent-12'
  | '--app-accent-16'
  | '--app-accent-20'
  | '--app-accent-40',
  string
>

const SETTINGS_THEME_KEY = 'settings.theme'
const SETTINGS_THEME_ACCENT_KEY = 'settings.themeAccent'
const SETTINGS_THEME_MOTION_KEY = 'settings.themeMotion'
const DEFAULT_THEME_ACCENT = ThemeAccent.Green
const DEFAULT_DARK_ACCENT_COLOR = '#18a058'

export const THEME_ACCENT_PALETTES: Record<ThemeAccent, ThemeAccentPalette> = {
  [ThemeAccent.Green]: {
    primaryColor: '#18a058',
    primaryColorHover: '#36ad6a',
    primaryColorPressed: '#0c7a43',
    primaryColorSuppl: '#36ad6a'
  },
  [ThemeAccent.Blue]: {
    primaryColor: '#2080f0',
    primaryColorHover: '#4098fc',
    primaryColorPressed: '#1060c9',
    primaryColorSuppl: '#4098fc'
  },
  [ThemeAccent.Black]: {
    primaryColor: '#1a1a1a',
    primaryColorHover: '#333333',
    primaryColorPressed: '#000000',
    primaryColorSuppl: '#333333'
  },
  [ThemeAccent.Orange]: {
    primaryColor: '#f0a020',
    primaryColorHover: '#fcb040',
    primaryColorPressed: '#c97c10',
    primaryColorSuppl: '#fcb040'
  },
  [ThemeAccent.Red]: {
    primaryColor: '#d03050',
    primaryColorHover: '#de576d',
    primaryColorPressed: '#ab1f3f',
    primaryColorSuppl: '#de576d'
  },
  [ThemeAccent.Purple]: {
    primaryColor: '#7a3cff',
    primaryColorHover: '#9366ff',
    primaryColorPressed: '#5a27cc',
    primaryColorSuppl: '#9366ff'
  },
  [ThemeAccent.Teal]: {
    primaryColor: '#00a6a6',
    primaryColorHover: '#1bb8b8',
    primaryColorPressed: '#008080',
    primaryColorSuppl: '#1bb8b8'
  }
}

function normalizeThemeAccent(value: string | null): ThemeAccent {
  if (value && Object.prototype.hasOwnProperty.call(THEME_ACCENT_PALETTES, value)) {
    return value as ThemeAccent
  }
  return DEFAULT_THEME_ACCENT
}

function normalizeMotionLevel(value: string | null): MotionLevel {
  return value === MotionLevel.Reduced ? MotionLevel.Reduced : MotionLevel.Full
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace(/^#/, '')

  if (!/^[\da-fA-F]{3}$|^[\da-fA-F]{6}$/.test(normalized)) {
    return null
  }

  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized

  const r = Number.parseInt(expanded.slice(0, 2), 16)
  const g = Number.parseInt(expanded.slice(2, 4), 16)
  const b = Number.parseInt(expanded.slice(4, 6), 16)
  return [r, g, b]
}

function createAccentStyleVars(primaryColor: string): AccentStyleVars {
  const rgb = hexToRgb(primaryColor) ?? hexToRgb(DEFAULT_DARK_ACCENT_COLOR) ?? [24, 160, 88]
  const [r, g, b] = rgb

  return {
    '--app-accent-color': primaryColor,
    '--app-accent-06': `rgba(${r}, ${g}, ${b}, 0.06)`,
    '--app-accent-08': `rgba(${r}, ${g}, ${b}, 0.08)`,
    '--app-accent-12': `rgba(${r}, ${g}, ${b}, 0.12)`,
    '--app-accent-16': `rgba(${r}, ${g}, ${b}, 0.16)`,
    '--app-accent-20': `rgba(${r}, ${g}, ${b}, 0.20)`,
    '--app-accent-40': `rgba(${r}, ${g}, ${b}, 0.40)`
  }
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: ThemeMode.Light,
    accent: DEFAULT_THEME_ACCENT as ThemeAccent,
    motionLevel: MotionLevel.Full as MotionLevel
  }),

  getters: {
    isDark(state): boolean {
      if (state.mode === ThemeMode.Dark) return true
      if (state.mode === ThemeMode.Light) return false
      return false
    },
    getTheme(): typeof darkTheme | null {
      return this.isDark ? darkTheme : null
    },
    themeOverrides(): GlobalThemeOverrides | undefined {
      if (this.isDark) return undefined

      const accentPalette =
        THEME_ACCENT_PALETTES[this.accent] ?? THEME_ACCENT_PALETTES[DEFAULT_THEME_ACCENT]
      return {
        common: {
          primaryColor: accentPalette.primaryColor,
          primaryColorHover: accentPalette.primaryColorHover,
          primaryColorPressed: accentPalette.primaryColorPressed,
          primaryColorSuppl: accentPalette.primaryColorSuppl
        }
      }
    },
    accentStyleVars(): AccentStyleVars {
      const primaryColor = this.isDark
        ? DEFAULT_DARK_ACCENT_COLOR
        : (THEME_ACCENT_PALETTES[this.accent] ?? THEME_ACCENT_PALETTES[DEFAULT_THEME_ACCENT])
            .primaryColor

      return createAccentStyleVars(primaryColor)
    },
    isMotionReduced(): boolean {
      return this.motionLevel === MotionLevel.Reduced
    }
  },

  actions: {
    setMode(mode: ThemeMode) {
      this.mode = mode
      // 自动保存到数据库
      window.api
        .setSetting(SETTINGS_THEME_KEY, mode === ThemeMode.Dark ? 'dark' : 'light')
        .catch((error) => {
          console.error('保存主题设置失败:', error)
        })
    },
    setAccent(accent: ThemeAccent) {
      this.accent = accent
      window.api.setSetting(SETTINGS_THEME_ACCENT_KEY, accent).catch((error) => {
        console.error('保存主题色设置失败:', error)
      })
    },
    setMotionLevel(level: MotionLevel) {
      this.motionLevel = level
      window.api.setSetting(SETTINGS_THEME_MOTION_KEY, level).catch((error) => {
        console.error('保存动效偏好设置失败:', error)
      })
    },

    // 从数据库加载主题设置
    async initFromStorage() {
      try {
        const [theme, accent, motionLevel] = await Promise.all([
          window.api.getSetting(SETTINGS_THEME_KEY),
          window.api.getSetting(SETTINGS_THEME_ACCENT_KEY),
          window.api.getSetting(SETTINGS_THEME_MOTION_KEY)
        ])

        if (theme === 'dark') {
          this.mode = ThemeMode.Dark
        } else if (theme === 'light') {
          this.mode = ThemeMode.Light
        }

        this.accent = normalizeThemeAccent(accent)
        this.motionLevel = normalizeMotionLevel(motionLevel)
      } catch (error) {
        console.error('加载主题设置失败:', error)
      }
    }
  }
})
