import { defineStore } from 'pinia'

const PRIVACY_ENABLED_KEY = 'privacy.enabled'
const PRIVACY_PASSWORD_HASH_KEY = 'privacy.passwordHash'
const PRIVACY_IDLE_LOCK_MINUTES_KEY = 'privacy.idleLockMinutes'
const PRIVACY_AUTH_METHOD_KEY = 'privacy.authMethod'
const DEFAULT_PRIVACY_AUTH_METHOD = 'pin'
const DEFAULT_PRIVACY_IDLE_LOCK_MINUTES = 5
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
          authSupport
        ] = await Promise.all([
          window.api.getSetting(PRIVACY_ENABLED_KEY),
          window.api.getSetting(PRIVACY_PASSWORD_HASH_KEY),
          window.api.getSetting(PRIVACY_IDLE_LOCK_MINUTES_KEY),
          window.api.getSetting(PRIVACY_AUTH_METHOD_KEY),
          window.api.getPrivacyAuthSupport()
        ])

        const enabled = enabledSetting === '1'
        const normalizedHash = passwordHash?.trim() || ''
        const idleLockMinutes = normalizeIdleLockMinutes(idleLockMinutesSetting)
        const windowsPasswordSupported = !!authSupport?.windowsPassword
        const authMethod = normalizeAuthMethod(authMethodSetting, windowsPasswordSupported)

        this.isEnabled = enabled
        this.passwordHash = normalizedHash
        this.idleLockMinutes = idleLockMinutes
        this.authMethod = authMethod
        this.isWindowsPasswordSupported = windowsPasswordSupported
        this.isLocked = enabled && this.hasCredential

        if ((authMethodSetting?.trim() || '') !== authMethod) {
          void window.api
            .setSetting(PRIVACY_AUTH_METHOD_KEY, authMethod)
            .catch((error) => console.error('保存隐私认证方式失败:', error))
        }
      } catch (error) {
        console.error('加载隐私设置失败:', error)
        this.isEnabled = false
        this.isLocked = false
        this.passwordHash = ''
        this.idleLockMinutes = DEFAULT_PRIVACY_IDLE_LOCK_MINUTES
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
    }
  }
})
