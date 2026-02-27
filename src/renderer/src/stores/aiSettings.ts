import { defineStore } from 'pinia'

export const AI_SETTINGS_KEY = 'settings.ai.config.v1'
export const AI_FEATURE_KEYS = ['chat', 'summary', 'rewrite'] as const
export type AIFeatureKey = (typeof AI_FEATURE_KEYS)[number]
export type AIProviderType = 'openai' | 'anthropic' | 'siliconflow' | 'custom'

export interface AIModelConfig {
  id: string
  displayName: string
  modelId: string
}

export interface AIProviderConfig {
  id: string
  name: string
  type: AIProviderType
  baseUrl: string
  apiKey: string
  models: AIModelConfig[]
}

export interface AIFeatureBinding {
  providerId: string
  modelId: string
}

export interface AISettingsConfig {
  providers: AIProviderConfig[]
  featureBindings: Partial<Record<AIFeatureKey, AIFeatureBinding>>
}

interface PersistResult {
  success: boolean
  error?: string
}

const SAVE_DEBOUNCE_MS = 300

const DEFAULT_PROVIDER_TEMPLATES: Record<
  AIProviderType,
  Pick<AIProviderConfig, 'name' | 'baseUrl' | 'type'>
> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    type: 'openai'
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    type: 'anthropic'
  },
  siliconflow: {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    type: 'siliconflow'
  },
  custom: {
    name: '自定义提供商',
    baseUrl: '',
    type: 'custom'
  }
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeProviderType(value: unknown): AIProviderType {
  if (value === 'openai' || value === 'anthropic' || value === 'siliconflow' || value === 'custom') {
    return value
  }
  return 'custom'
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function createProviderFromTemplate(
  type: AIProviderType,
  options?: Partial<Pick<AIProviderConfig, 'id' | 'name' | 'baseUrl' | 'apiKey' | 'models'>>
): AIProviderConfig {
  const template = DEFAULT_PROVIDER_TEMPLATES[type]
  return {
    id: options?.id?.trim() || createId('provider'),
    name: options?.name?.trim() || template.name,
    type,
    baseUrl: options?.baseUrl?.trim() ?? template.baseUrl,
    apiKey: options?.apiKey ?? '',
    models: options?.models ?? []
  }
}

function createDefaultAISettingsConfig(): AISettingsConfig {
  return {
    providers: [
      createProviderFromTemplate('openai', { id: 'provider-openai-default' }),
      createProviderFromTemplate('anthropic', { id: 'provider-anthropic-default' }),
      createProviderFromTemplate('siliconflow', { id: 'provider-siliconflow-default' })
    ],
    featureBindings: {}
  }
}

function isFeatureKey(value: string): value is AIFeatureKey {
  return AI_FEATURE_KEYS.includes(value as AIFeatureKey)
}

function normalizeModelConfig(value: unknown, existingIds: Set<string>): AIModelConfig | null {
  if (!isRecord(value)) return null

  const modelId = trimString(value.modelId)
  if (!modelId) return null

  const idInput = trimString(value.id)
  let id = idInput || createId('model')
  while (existingIds.has(id)) {
    id = createId('model')
  }
  existingIds.add(id)

  return {
    id,
    displayName: trimString(value.displayName) || modelId,
    modelId
  }
}

function normalizeProviderConfig(value: unknown, existingIds: Set<string>): AIProviderConfig | null {
  if (!isRecord(value)) return null

  const type = normalizeProviderType(value.type)
  const template = DEFAULT_PROVIDER_TEMPLATES[type]

  const idInput = trimString(value.id)
  let id = idInput || createId('provider')
  while (existingIds.has(id)) {
    id = createId('provider')
  }
  existingIds.add(id)

  const modelIds = new Set<string>()
  const models: AIModelConfig[] = []
  const modelEntries = Array.isArray(value.models) ? value.models : []
  for (const item of modelEntries) {
    const model = normalizeModelConfig(item, modelIds)
    if (!model) continue
    if (models.some((existing) => existing.modelId === model.modelId)) continue
    models.push(model)
  }

  return {
    id,
    name: trimString(value.name) || template.name,
    type,
    baseUrl: trimString(value.baseUrl) || template.baseUrl,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    models
  }
}

function normalizeFeatureBindings(
  value: unknown,
  providers: AIProviderConfig[]
): Partial<Record<AIFeatureKey, AIFeatureBinding>> {
  if (!isRecord(value)) return {}

  const result: Partial<Record<AIFeatureKey, AIFeatureBinding>> = {}
  for (const [feature, rawBinding] of Object.entries(value)) {
    if (!isFeatureKey(feature)) continue
    if (!isRecord(rawBinding)) continue

    const providerId = trimString(rawBinding.providerId)
    const modelId = trimString(rawBinding.modelId)
    if (!providerId || !modelId) continue

    const provider = providers.find((item) => item.id === providerId)
    if (!provider) continue
    if (!provider.models.some((model) => model.modelId === modelId)) continue

    result[feature] = { providerId, modelId }
  }
  return result
}

function normalizeAISettingsConfig(
  value: unknown,
  options?: { fallbackToDefaultProviders?: boolean }
): AISettingsConfig {
  if (!isRecord(value)) {
    return options?.fallbackToDefaultProviders ? createDefaultAISettingsConfig() : { providers: [], featureBindings: {} }
  }

  const providerEntries = Array.isArray(value.providers) ? value.providers : []
  const providerIds = new Set<string>()
  const providers: AIProviderConfig[] = []
  for (const entry of providerEntries) {
    const provider = normalizeProviderConfig(entry, providerIds)
    if (!provider) continue
    providers.push(provider)
  }

  const normalizedProviders =
    providers.length === 0 && options?.fallbackToDefaultProviders
      ? createDefaultAISettingsConfig().providers
      : providers

  return {
    providers: normalizedProviders,
    featureBindings: normalizeFeatureBindings(value.featureBindings, normalizedProviders)
  }
}

function cloneConfig(config: AISettingsConfig): AISettingsConfig {
  return {
    providers: config.providers.map((provider) => ({
      ...provider,
      models: provider.models.map((model) => ({ ...model }))
    })),
    featureBindings: { ...config.featureBindings }
  }
}

function cleanupFeatureBindings(config: AISettingsConfig): void {
  const nextBindings: Partial<Record<AIFeatureKey, AIFeatureBinding>> = {}
  for (const feature of AI_FEATURE_KEYS) {
    const binding = config.featureBindings[feature]
    if (!binding) continue
    const provider = config.providers.find((item) => item.id === binding.providerId)
    if (!provider) continue
    if (!provider.models.some((model) => model.modelId === binding.modelId)) continue
    nextBindings[feature] = binding
  }
  config.featureBindings = nextBindings
}

function stringifyConfig(config: AISettingsConfig): string {
  return JSON.stringify(config)
}

export const useAISettingsStore = defineStore('aiSettings', {
  state: () => ({
    config: createDefaultAISettingsConfig() as AISettingsConfig,
    isInitialized: false,
    isLoading: false,
    isSaving: false,
    lastError: '',
    saveTimer: null as ReturnType<typeof setTimeout> | null
  }),

  getters: {
    providers(state): AIProviderConfig[] {
      return state.config.providers
    },
    featureBindings(state): Partial<Record<AIFeatureKey, AIFeatureBinding>> {
      return state.config.featureBindings
    }
  },

  actions: {
    async initFromStorage(): Promise<void> {
      if (this.isInitialized || this.isLoading) return

      this.isLoading = true
      try {
        const raw = await window.api.getSecureSetting(AI_SETTINGS_KEY)
        if (!raw) {
          this.config = createDefaultAISettingsConfig()
        } else {
          try {
            const parsed = JSON.parse(raw) as unknown
            this.config = normalizeAISettingsConfig(parsed)
          } catch (error) {
            console.error('解析 AI 设置失败，已回退默认配置:', error)
            this.config = createDefaultAISettingsConfig()
          }
        }
        cleanupFeatureBindings(this.config)
        this.lastError = ''
      } catch (error) {
        console.error('加载 AI 设置失败:', error)
        this.config = createDefaultAISettingsConfig()
        this.lastError = String(error)
      } finally {
        this.isLoading = false
        this.isInitialized = true
      }
    },

    replaceConfig(config: AISettingsConfig): void {
      const next = cloneConfig(config)
      cleanupFeatureBindings(next)
      this.config = next
      this.queueSave()
    },

    queueSave(): void {
      if (!this.isInitialized) return
      if (this.saveTimer) {
        clearTimeout(this.saveTimer)
      }
      this.saveTimer = setTimeout(() => {
        void this.persistNow()
      }, SAVE_DEBOUNCE_MS)
    },

    async persistNow(): Promise<PersistResult> {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer)
        this.saveTimer = null
      }

      this.isSaving = true
      try {
        await window.api.setSecureSetting(AI_SETTINGS_KEY, stringifyConfig(this.config))
        this.lastError = ''
        return { success: true }
      } catch (error) {
        console.error('保存 AI 设置失败:', error)
        this.lastError = String(error)
        return {
          success: false,
          error: String(error)
        }
      } finally {
        this.isSaving = false
      }
    },

    addProvider(type: AIProviderType, name?: string): string {
      const template = DEFAULT_PROVIDER_TEMPLATES[type]
      const provider = createProviderFromTemplate(type, {
        name: name?.trim() || template.name
      })
      this.config.providers = [...this.config.providers, provider]
      this.queueSave()
      return provider.id
    },

    updateProvider(
      providerId: string,
      patch: Partial<Pick<AIProviderConfig, 'name' | 'baseUrl' | 'apiKey'>>
    ): void {
      const index = this.config.providers.findIndex((item) => item.id === providerId)
      if (index < 0) return

      const current = this.config.providers[index]
      const next: AIProviderConfig = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        baseUrl: patch.baseUrl !== undefined ? patch.baseUrl.trim() : current.baseUrl,
        apiKey: patch.apiKey !== undefined ? patch.apiKey : current.apiKey
      }
      this.config.providers.splice(index, 1, next)
      this.queueSave()
    },

    removeProvider(providerId: string): void {
      const nextConfig = cloneConfig(this.config)
      nextConfig.providers = nextConfig.providers.filter((item) => item.id !== providerId)
      cleanupFeatureBindings(nextConfig)
      this.config = nextConfig
      this.queueSave()
    },

    addModel(
      providerId: string,
      input: {
        displayName: string
        modelId: string
      }
    ): PersistResult {
      const providerIndex = this.config.providers.findIndex((item) => item.id === providerId)
      if (providerIndex < 0) {
        return { success: false, error: '提供商不存在' }
      }

      const displayName = input.displayName.trim()
      const modelId = input.modelId.trim()
      if (!modelId) {
        return { success: false, error: '模型 ID 不能为空' }
      }

      const provider = this.config.providers[providerIndex]
      if (provider.models.some((model) => model.modelId === modelId)) {
        return { success: false, error: '模型 ID 已存在' }
      }

      const model: AIModelConfig = {
        id: createId('model'),
        displayName: displayName || modelId,
        modelId
      }

      const nextProvider: AIProviderConfig = {
        ...provider,
        models: [...provider.models, model]
      }
      this.config.providers.splice(providerIndex, 1, nextProvider)
      this.queueSave()
      return { success: true }
    },

    updateModel(
      providerId: string,
      modelId: string,
      patch: Partial<Pick<AIModelConfig, 'displayName' | 'modelId'>>
    ): PersistResult {
      const providerIndex = this.config.providers.findIndex((item) => item.id === providerId)
      if (providerIndex < 0) {
        return { success: false, error: '提供商不存在' }
      }

      const provider = this.config.providers[providerIndex]
      const modelIndex = provider.models.findIndex((item) => item.id === modelId)
      if (modelIndex < 0) {
        return { success: false, error: '模型不存在' }
      }

      const current = provider.models[modelIndex]
      const nextModelId = patch.modelId !== undefined ? patch.modelId.trim() : current.modelId
      if (!nextModelId) {
        return { success: false, error: '模型 ID 不能为空' }
      }
      if (provider.models.some((item) => item.id !== modelId && item.modelId === nextModelId)) {
        return { success: false, error: '模型 ID 已存在' }
      }

      const nextModel: AIModelConfig = {
        ...current,
        displayName:
          patch.displayName !== undefined ? patch.displayName.trim() || nextModelId : current.displayName,
        modelId: nextModelId
      }
      const nextModels = [...provider.models]
      nextModels.splice(modelIndex, 1, nextModel)

      const nextConfig = cloneConfig(this.config)
      nextConfig.providers.splice(providerIndex, 1, {
        ...provider,
        models: nextModels
      })

      for (const feature of AI_FEATURE_KEYS) {
        const binding = nextConfig.featureBindings[feature]
        if (!binding) continue
        if (binding.providerId !== providerId) continue
        if (binding.modelId !== current.modelId) continue
        nextConfig.featureBindings[feature] = {
          ...binding,
          modelId: nextModelId
        }
      }

      cleanupFeatureBindings(nextConfig)
      this.config = nextConfig
      this.queueSave()
      return { success: true }
    },

    removeModel(providerId: string, modelId: string): void {
      const nextConfig = cloneConfig(this.config)
      const provider = nextConfig.providers.find((item) => item.id === providerId)
      if (!provider) return

      provider.models = provider.models.filter((item) => item.id !== modelId)
      cleanupFeatureBindings(nextConfig)
      this.config = nextConfig
      this.queueSave()
    },

    setFeatureBinding(feature: AIFeatureKey, binding: AIFeatureBinding | null): void {
      const nextConfig = cloneConfig(this.config)
      if (!binding) {
        delete nextConfig.featureBindings[feature]
      } else {
        nextConfig.featureBindings[feature] = {
          providerId: binding.providerId,
          modelId: binding.modelId
        }
      }
      cleanupFeatureBindings(nextConfig)
      this.config = nextConfig
      this.queueSave()
    }
  }
})
