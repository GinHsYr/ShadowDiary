import { defineStore } from 'pinia'

export const DEFAULT_DISGUISE_SHORTCUT = 'Ctrl+Shift+M'

const MODIFIER_EVENT_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

type ParsedShortcut = {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

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

export function normalizeDisguiseShortcut(value: string | null | undefined): string {
  const parsed = parseShortcut(value)
  if (!parsed) return DEFAULT_DISGUISE_SHORTCUT
  return formatShortcut(parsed)
}

export function isModifierOnlyKey(key: string): boolean {
  return MODIFIER_EVENT_KEYS.has(key)
}

export function buildDisguiseShortcutFromEvent(event: KeyboardEvent): string | null {
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

export function isDisguiseShortcutMatch(event: KeyboardEvent, shortcut: string): boolean {
  const eventShortcut = buildDisguiseShortcutFromEvent(event)
  if (!eventShortcut) return false
  return eventShortcut === normalizeDisguiseShortcut(shortcut)
}

export const useDisguiseStore = defineStore('disguise', {
  state: () => ({
    isEnabled: false,
    autoEnableOnLaunch: false,
    shortcut: DEFAULT_DISGUISE_SHORTCUT,
    isInitialized: false
  }),

  actions: {
    async initFromMain(): Promise<void> {
      const config = await window.api.getDisguiseConfig()
      this.isEnabled = Boolean(config.enabled)
      this.autoEnableOnLaunch = Boolean(config.autoEnableOnLaunch)
      this.shortcut = normalizeDisguiseShortcut(config.shortcut)
      this.isInitialized = true
    },

    async setEnabled(enabled: boolean): Promise<void> {
      await window.api.setDisguiseEnabled(enabled)
      this.isEnabled = enabled
    },

    async setAutoEnableOnLaunch(enabled: boolean): Promise<void> {
      await window.api.setDisguiseAutoEnableOnLaunch(enabled)
      this.autoEnableOnLaunch = enabled
    },

    async setShortcut(shortcut: string): Promise<void> {
      const normalized = normalizeDisguiseShortcut(shortcut)
      await window.api.setDisguiseShortcut(normalized)
      this.shortcut = normalized
    },

    async regenerateData(): Promise<void> {
      await window.api.regenerateDisguiseData()
    }
  }
})
