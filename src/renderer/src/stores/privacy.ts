import { defineStore } from 'pinia'

const PRIVACY_ENABLED_KEY = 'privacy.enabled'
const PRIVACY_PASSWORD_HASH_KEY = 'privacy.passwordHash'
const PRIVACY_IDLE_LOCK_MINUTES_KEY = 'privacy.idleLockMinutes'
const PRIVACY_AUTH_METHOD_KEY = 'privacy.authMethod'
const PRIVACY_MANUAL_LOCK_SHORTCUT_KEY = 'privacy.manualLockShortcut'
const DEFAULT_PRIVACY_AUTH_METHOD = 'pin'
const DEFAULT_PRIVACY_IDLE_LOCK_MINUTES = 5
export const DEFAULT_PRIVACY_MANUAL_LOCK_SHORTCUT = 'Alt+L'
export const PRIVACY_IDLE_LOCK_MINUTE_OPTIONS = [1, 5, 10, 15, 30] as const
export type PrivacyAuthMethod = 'pin' | 'windows'

function isPrivacyAuthMethod(value: string): value is PrivacyAuthMethod {
  return value === 'pin' || value === 'windows'
}

function normalizeAuthMethod(
  value: string | null | undefined,
  windowsPasswordSupported: boolean
): PrivacyAuthMethod {
  const trimmed = value?.trim() || ''
  if (!isPrivacyAuthMethod(trimmed)) return DEFAULT_PRIVACY_AUTH_METHOD
  if (trimmed === 'windows' && !windowsPasswordSupported) return DEFAULT_PRIVACY_AUTH_METHOD
  return trimmed
}

function normalizeIdleLockMinutes(value: string | null | undefined): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return DEFAULT_PRIVACY_IDLE_LOCK_MINUTES
  if (
    PRIVACY_IDLE_LOCK_MINUTE_OPTIONS.includes(
      parsed as (typeof PRIVACY_IDLE_LOCK_MINUTE_OPTIONS)[number]
    )
  ) {
    return parsed
  }
  return DEFAULT_PRIVACY_IDLE_LOCK_MINUTES
}

type ParsedShortcut = {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

const MODIFIER_EVENT_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const SHORTCUT_MODIFIER_ALIASES: Record<string, keyof Omit<ParsedShortcut, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta'
}

function normalizeShortcutKey(raw: string): string | null {
  const key = raw.trim()
  if (!key) return null

  const lower = key.toLowerCase()
  if (lower === 'space' || lower === 'spacebar') return 'Space'
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase()
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) return lower.toUpperCase()

  const normalizedNamedKeys: Record<string, string> = {
    enter: 'Enter',
    escape: 'Escape',
    esc: 'Escape',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    insert: 'Insert',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight'
  }

  return normalizedNamedKeys[lower] ?? null
}

function parseShortcut(value: string | null | undefined): ParsedShortcut | null {
  const raw = value?.trim() || ''
  if (!raw) return null

  const tokens = raw
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  if (tokens.length < 2) return null

  const parsed: ParsedShortcut = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: ''
  }

  for (const token of tokens) {
    const modifier = SHORTCUT_MODIFIER_ALIASES[token.toLowerCase()]
    if (modifier) {
      parsed[modifier] = true
      continue
    }

    if (parsed.key) return null
    const normalizedKey = normalizeShortcutKey(token)
    if (!normalizedKey) return null
    parsed.key = normalizedKey
  }

  if (!parsed.key) return null
  if (!parsed.ctrl && !parsed.alt && !parsed.shift && !parsed.meta) return null
  return parsed
}

function formatShortcut(parsed: ParsedShortcut): string {
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.meta) parts.push('Meta')
  parts.push(parsed.key)
  return parts.join('+')
}

export function normalizePrivacyManualLockShortcut(value: string | null | undefined): string {
  const parsed = parseShortcut(value)
  if (!parsed) return DEFAULT_PRIVACY_MANUAL_LOCK_SHORTCUT
  return formatShortcut(parsed)
}

export function isModifierOnlyKey(key: string): boolean {
  return MODIFIER_EVENT_KEYS.has(key)
}

export function buildPrivacyManualLockShortcutFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || isModifierOnlyKey(event.key)) return null
  const normalizedKey = normalizeShortcutKey(event.key)
  if (!normalizedKey) return null

  const parsed: ParsedShortcut = {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key: normalizedKey
  }

  if (!parsed.ctrl && !parsed.alt && !parsed.shift && !parsed.meta) return null
  return formatShortcut(parsed)
}

export function isPrivacyManualLockShortcutMatch(event: KeyboardEvent, shortcut: string): boolean {
  const eventShortcut = buildPrivacyManualLockShortcutFromEvent(event)
  if (!eventShortcut) return false
  return eventShortcut === normalizePrivacyManualLockShortcut(shortcut)
}

export function isValidPrivacyPassword(password: string): boolean {
  return /^\d{6}$/.test(password)
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const usePrivacyStore = defineStore('privacy', {
  state: () => ({
    isEnabled: false,
    isLocked: false,
    isInitialized: false,
    passwordHash: '',
    idleLockMinutes: DEFAULT_PRIVACY_IDLE_LOCK_MINUTES,
    manualLockShortcut: DEFAULT_PRIVACY_MANUAL_LOCK_SHORTCUT,
    authMethod: DEFAULT_PRIVACY_AUTH_METHOD as PrivacyAuthMethod,
    isWindowsPasswordSupported: false
  }),

  getters: {
    isUnlocked(state): boolean {
      return !state.isLocked
    },
    usesWindowsPassword(state): boolean {
      return state.authMethod === 'windows'
    },
    hasPassword(state): boolean {
      return state.passwordHash.length > 0
    },
    hasCredential(state): boolean {
      if (state.authMethod === 'windows') {
        return state.isWindowsPasswordSupported
      }
      return state.passwordHash.length > 0
    },
    idleLockMs(state): number {
      return state.idleLockMinutes * 60 * 1000
    }
  },

  actions: {
    async initFromStorage(): Promise<void> {
      try {
        const [
          enabledSetting,
          passwordHash,
          idleLockMinutesSetting,
          authMethodSetting,
          manualLockShortcutSetting,
          authSupport
        ] = await Promise.all([
          window.api.getSetting(PRIVACY_ENABLED_KEY),
          window.api.getSetting(PRIVACY_PASSWORD_HASH_KEY),
          window.api.getSetting(PRIVACY_IDLE_LOCK_MINUTES_KEY),
          window.api.getSetting(PRIVACY_AUTH_METHOD_KEY),
          window.api.getSetting(PRIVACY_MANUAL_LOCK_SHORTCUT_KEY),
          window.api.getPrivacyAuthSupport()
        ])

        const enabled = enabledSetting === '1'
        const normalizedHash = passwordHash?.trim() || ''
        const idleLockMinutes = normalizeIdleLockMinutes(idleLockMinutesSetting)
        const manualLockShortcut = normalizePrivacyManualLockShortcut(manualLockShortcutSetting)
        const windowsPasswordSupported = !!authSupport?.windowsPassword
        const authMethod = normalizeAuthMethod(authMethodSetting, windowsPasswordSupported)

        this.isEnabled = enabled
        this.passwordHash = normalizedHash
        this.idleLockMinutes = idleLockMinutes
        this.manualLockShortcut = manualLockShortcut
        this.authMethod = authMethod
        this.isWindowsPasswordSupported = windowsPasswordSupported
        this.isLocked = enabled && this.hasCredential

        if ((authMethodSetting?.trim() || '') !== authMethod) {
          void window.api
            .setSetting(PRIVACY_AUTH_METHOD_KEY, authMethod)
            .catch((error) => console.error('保存隐私认证方式失败:', error))
        }
        if ((manualLockShortcutSetting?.trim() || '') !== manualLockShortcut) {
          void window.api
            .setSetting(PRIVACY_MANUAL_LOCK_SHORTCUT_KEY, manualLockShortcut)
            .catch((error) => console.error('保存手动锁定快捷键失败:', error))
        }
      } catch (error) {
        console.error('加载隐私设置失败:', error)
        this.isEnabled = false
        this.isLocked = false
        this.passwordHash = ''
        this.idleLockMinutes = DEFAULT_PRIVACY_IDLE_LOCK_MINUTES
        this.manualLockShortcut = DEFAULT_PRIVACY_MANUAL_LOCK_SHORTCUT
        this.authMethod = DEFAULT_PRIVACY_AUTH_METHOD
        this.isWindowsPasswordSupported = false
      } finally {
        this.isInitialized = true
      }
    },

    async unlockWithPassword(password: string): Promise<boolean> {
      if (!this.isEnabled) {
        this.isLocked = false
        return true
      }

      const matches = await this.verifyCredential(password)
      if (!matches) {
        return false
      }

      this.isLocked = false
      return true
    },

    lock(): void {
      if (!this.isEnabled || !this.hasCredential) return
      this.isLocked = true
    },

    async enablePrivacy(): Promise<void> {
      await window.api.setSetting(PRIVACY_ENABLED_KEY, '1')
      this.isEnabled = true
      this.isLocked = false
    },

    async disablePrivacy(): Promise<void> {
      await window.api.setSetting(PRIVACY_ENABLED_KEY, '0')
      await window.api.setSetting(PRIVACY_PASSWORD_HASH_KEY, '')
      this.isEnabled = false
      this.isLocked = false
      this.passwordHash = ''
    },

    async disablePrivacyWithPassword(password: string): Promise<void> {
      const matched = await this.verifyCredential(password)
      if (!matched) {
        throw new Error('原密码错误')
      }

      await this.disablePrivacy()
    },

    async setPassword(password: string): Promise<void> {
      if (!isValidPrivacyPassword(password)) {
        throw new Error('密码必须是6位数字')
      }

      const hash = await sha256Hex(password)
      await window.api.setSetting(PRIVACY_PASSWORD_HASH_KEY, hash)
      this.passwordHash = hash
      if (this.isEnabled) {
        this.isLocked = false
      }
    },

    async verifyPassword(password: string): Promise<boolean> {
      return await this.verifyCredential(password)
    },

    async verifyPinPassword(password: string): Promise<boolean> {
      if (!isValidPrivacyPassword(password) || !this.passwordHash) {
        return false
      }

      const hashed = await sha256Hex(password)
      return hashed === this.passwordHash
    },

    async verifyCredential(password: string): Promise<boolean> {
      if (this.authMethod === 'windows') {
        if (!this.isWindowsPasswordSupported || !password) return false
        return await window.api.verifyWindowsPassword(password)
      }
      return await this.verifyPinPassword(password)
    },

    async setAuthMethod(method: PrivacyAuthMethod): Promise<void> {
      const normalizedMethod = normalizeAuthMethod(method, this.isWindowsPasswordSupported)
      if (normalizedMethod !== method) {
        throw new Error('当前系统不支持 Windows 登录密码')
      }
      if (normalizedMethod === 'pin' && this.isEnabled && !this.hasPassword) {
        throw new Error('请先设置6位数字密码')
      }

      await window.api.setSetting(PRIVACY_AUTH_METHOD_KEY, normalizedMethod)
      this.authMethod = normalizedMethod
      if (this.isEnabled) {
        this.isLocked = false
      }
    },

    async updatePasswordWithCurrent(currentPassword: string, newPassword: string): Promise<void> {
      const currentValid = await this.verifyPinPassword(currentPassword)
      if (!currentValid) {
        throw new Error('原密码错误')
      }

      await this.setPassword(newPassword)
    },

    async setIdleLockMinutes(minutes: number): Promise<void> {
      const normalized = normalizeIdleLockMinutes(String(minutes))
      await window.api.setSetting(PRIVACY_IDLE_LOCK_MINUTES_KEY, String(normalized))
      this.idleLockMinutes = normalized
    },

    async setManualLockShortcut(shortcut: string): Promise<void> {
      const parsed = parseShortcut(shortcut)
      if (!parsed) {
        throw new Error('手动锁定快捷键格式无效')
      }
      const normalized = formatShortcut(parsed)
      await window.api.setSetting(PRIVACY_MANUAL_LOCK_SHORTCUT_KEY, normalized)
      this.manualLockShortcut = normalized
    }
  }
})
