<template>
  <div class="ai-settings-page">
    <div class="page-header">
      <div class="header-main">
        <n-button
          quaternary
          circle
          class="exit-button"
          :aria-label="t('common.close')"
          @click="handleExitAISettings"
        >
          <template #icon>
            <n-icon><ArrowBackOutline /></n-icon>
          </template>
        </n-button>
        <div>
          <h1 class="page-title">{{ t('settings.ai.title') }}</h1>
          <p class="page-subtitle">{{ t('settings.ai.subtitle') }}</p>
        </div>
      </div>
      <div class="header-actions">
        <span v-if="aiSettings.isSaving" class="saving-hint">
          {{ t('settings.ai.messages.saving') }}
        </span>
      </div>
    </div>

    <div class="ai-layout">
      <n-card :title="t('settings.ai.provider.card')" :bordered="false" class="settings-card provider-list-card">
        <n-space vertical :size="10">
          <div v-if="providers.length > 0" class="provider-list">
            <button
              v-for="provider in providers"
              :key="provider.id"
              type="button"
              class="provider-item"
              :class="{ 'provider-item--active': provider.id === selectedProviderId }"
              @click="selectedProviderId = provider.id"
            >
              <div class="provider-name">{{ provider.name }}</div>
              <div class="provider-meta">
                {{ t('settings.ai.provider.modelCount', { count: provider.models.length }) }}
              </div>
            </button>
          </div>
          <n-empty
            v-else
            size="small"
            :description="t('settings.ai.provider.empty')"
            class="provider-empty"
          />

          <div class="provider-add-panel">
            <n-select
              :value="newProviderType"
              :options="providerTypeOptions"
              @update:value="handleProviderTypeChange"
            />
            <n-input
              v-if="newProviderType === 'custom'"
              :value="newCustomProviderName"
              :placeholder="t('settings.ai.provider.customNamePlaceholder')"
              @update:value="(value) => (newCustomProviderName = value)"
            />
            <n-button type="primary" block @click="handleAddProvider">
              {{ t('settings.ai.actions.addProvider') }}
            </n-button>
          </div>
        </n-space>
      </n-card>

      <div class="details-column">
        <n-card
          :title="t('settings.ai.provider.detailCard')"
          :bordered="false"
          class="settings-card"
        >
          <template v-if="selectedProvider">
            <n-space vertical :size="14">
              <div class="setting-item setting-item-top">
                <div class="setting-info">
                  <label class="setting-label">{{ t('settings.ai.provider.name') }}</label>
                </div>
                <n-input
                  :value="selectedProvider.name"
                  class="form-input"
                  :placeholder="t('settings.ai.provider.namePlaceholder')"
                  @update:value="(value) => handleProviderFieldChange('name', value)"
                />
              </div>

              <div class="setting-item setting-item-top">
                <div class="setting-info">
                  <label class="setting-label">{{ t('settings.ai.provider.baseUrl') }}</label>
                </div>
                <n-input
                  :value="selectedProvider.baseUrl"
                  class="form-input"
                  :placeholder="t('settings.ai.provider.baseUrlPlaceholder')"
                  @update:value="(value) => handleProviderFieldChange('baseUrl', value)"
                />
              </div>

              <div class="setting-item setting-item-top">
                <div class="setting-info">
                  <label class="setting-label">{{ t('settings.ai.provider.apiKey') }}</label>
                  <span class="setting-description">{{ t('settings.ai.provider.apiKeyDescription') }}</span>
                </div>
                <n-input
                  :value="selectedProvider.apiKey"
                  type="password"
                  show-password-on="mousedown"
                  class="form-input"
                  :placeholder="t('settings.ai.provider.apiKeyPlaceholder')"
                  @update:value="(value) => handleProviderFieldChange('apiKey', value)"
                />
              </div>

              <div class="provider-actions">
                <n-button type="error" secondary @click="handleDeleteProvider">
                  {{ t('settings.ai.actions.deleteProvider') }}
                </n-button>
              </div>
            </n-space>
          </template>

          <n-empty
            v-else
            size="small"
            :description="t('settings.ai.provider.selectProviderHint')"
          />
        </n-card>

        <n-card :title="t('settings.ai.model.card')" :bordered="false" class="settings-card">
          <template v-if="selectedProvider">
            <n-space vertical :size="12">
              <div v-if="selectedProvider.models.length > 0" class="model-list">
                <div v-for="model in selectedProvider.models" :key="model.id" class="model-item">
                  <n-input
                    :value="model.displayName"
                    :placeholder="t('settings.ai.model.displayNamePlaceholder')"
                    @update:value="(value) => handleModelDisplayNameChange(model.id, value)"
                  />
                  <n-input
                    :value="model.modelId"
                    :placeholder="t('settings.ai.model.modelIdPlaceholder')"
                    @update:value="(value) => handleModelIdChange(model.id, value)"
                  />
                  <n-button tertiary type="error" @click="handleDeleteModel(model.id)">
                    {{ t('settings.ai.actions.deleteModel') }}
                  </n-button>
                </div>
              </div>
              <n-empty v-else size="small" :description="t('settings.ai.model.empty')" />

              <div class="model-add-row">
                <n-input
                  :value="newModelDisplayName"
                  :placeholder="t('settings.ai.model.displayNamePlaceholder')"
                  @update:value="(value) => (newModelDisplayName = value)"
                />
                <n-input
                  :value="newModelId"
                  :placeholder="t('settings.ai.model.modelIdPlaceholder')"
                  @update:value="(value) => (newModelId = value)"
                />
                <n-button type="primary" @click="handleAddModel">
                  {{ t('settings.ai.actions.addModel') }}
                </n-button>
              </div>
            </n-space>
          </template>

          <n-empty
            v-else
            size="small"
            :description="t('settings.ai.provider.selectProviderHint')"
          />
        </n-card>

        <n-card :title="t('settings.ai.binding.card')" :bordered="false" class="settings-card">
          <n-space vertical :size="12">
            <div v-for="feature in featureRows" :key="feature.key" class="binding-row">
              <div class="binding-feature">{{ feature.label }}</div>
              <div class="binding-controls">
                <n-select
                  :value="getFeatureProviderId(feature.key)"
                  :options="providerSelectOptions"
                  clearable
                  :placeholder="t('settings.ai.binding.providerPlaceholder')"
                  @update:value="(value) => handleFeatureProviderChange(feature.key, value)"
                />
                <n-select
                  :value="getFeatureModelId(feature.key)"
                  :options="getFeatureModelOptions(feature.key)"
                  clearable
                  :placeholder="t('settings.ai.binding.modelPlaceholder')"
                  @update:value="(value) => handleFeatureModelChange(feature.key, value)"
                />
                <n-button tertiary @click="handleClearFeatureBinding(feature.key)">
                  {{ t('settings.ai.actions.clearBinding') }}
                </n-button>
              </div>
            </div>
          </n-space>
        </n-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowBackOutline } from '@vicons/ionicons5'
import { NButton, NCard, NEmpty, NIcon, NInput, NSelect, NSpace, useDialog } from 'naive-ui'
import { useRouter } from 'vue-router'
import {
  AI_FEATURE_KEYS,
  type AIFeatureBinding,
  type AIFeatureKey,
  type AIProviderType,
  useAISettingsStore
} from '@renderer/stores/aiSettings'

const aiSettings = useAISettingsStore()
const { t } = useI18n()
const dialog = useDialog()
const router = useRouter()

const selectedProviderId = ref('')
const newProviderType = ref<AIProviderType>('openai')
const newCustomProviderName = ref('')
const newModelDisplayName = ref('')
const newModelId = ref('')

const providers = computed(() => aiSettings.providers)
const selectedProvider = computed(() =>
  aiSettings.providers.find((provider) => provider.id === selectedProviderId.value)
)

const providerTypeOptions = computed(() => [
  {
    label: t('settings.ai.provider.types.openai'),
    value: 'openai' as AIProviderType
  },
  {
    label: t('settings.ai.provider.types.anthropic'),
    value: 'anthropic' as AIProviderType
  },
  {
    label: t('settings.ai.provider.types.siliconflow'),
    value: 'siliconflow' as AIProviderType
  },
  {
    label: t('settings.ai.provider.types.custom'),
    value: 'custom' as AIProviderType
  }
])

const providerSelectOptions = computed(() =>
  aiSettings.providers.map((provider) => ({
    label: provider.name,
    value: provider.id
  }))
)

const featureRows = computed(() =>
  AI_FEATURE_KEYS.map((key) => ({
    key,
    label: t(`settings.ai.features.${key}`)
  }))
)

watch(
  () => aiSettings.providers,
  (nextProviders) => {
    if (nextProviders.length === 0) {
      selectedProviderId.value = ''
      return
    }

    const stillExists = nextProviders.some((provider) => provider.id === selectedProviderId.value)
    if (!stillExists) {
      selectedProviderId.value = nextProviders[0].id
    }
  },
  { immediate: true, deep: true }
)

function notify(type: 'success' | 'error' | 'warning', message: string): void {
  const messageApi = window.$message
  if (messageApi) {
    messageApi[type](message)
    return
  }

  if (type !== 'success') {
    alert(message)
  }
}

function getProviderDisplayName(type: AIProviderType): string {
  if (type === 'openai') return t('settings.ai.provider.types.openai')
  if (type === 'anthropic') return t('settings.ai.provider.types.anthropic')
  if (type === 'siliconflow') return t('settings.ai.provider.types.siliconflow')
  return t('settings.ai.provider.types.custom')
}

function handleProviderTypeChange(value: string | number | null): void {
  if (value !== 'openai' && value !== 'anthropic' && value !== 'siliconflow' && value !== 'custom') {
    return
  }
  newProviderType.value = value
}

function handleAddProvider(): void {
  const providerName =
    newProviderType.value === 'custom'
      ? newCustomProviderName.value.trim() || t('settings.ai.provider.defaultCustomName')
      : getProviderDisplayName(newProviderType.value)

  const providerId = aiSettings.addProvider(newProviderType.value, providerName)
  selectedProviderId.value = providerId
  newCustomProviderName.value = ''
  notify('success', t('settings.ai.messages.providerAdded'))
}

function handleProviderFieldChange(
  field: 'name' | 'baseUrl' | 'apiKey',
  value: string
): void {
  if (!selectedProvider.value) return
  aiSettings.updateProvider(selectedProvider.value.id, {
    [field]: value
  })
}

function handleDeleteProvider(): void {
  if (!selectedProvider.value) return

  const provider = selectedProvider.value
  dialog.warning({
    title: t('settings.ai.provider.deleteConfirmTitle'),
    content: t('settings.ai.provider.deleteConfirmContent', { name: provider.name }),
    positiveText: t('settings.ai.actions.deleteProvider'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      aiSettings.removeProvider(provider.id)
      notify('success', t('settings.ai.messages.providerDeleted'))
    }
  })
}

function handleAddModel(): void {
  if (!selectedProvider.value) return

  const result = aiSettings.addModel(selectedProvider.value.id, {
    displayName: newModelDisplayName.value,
    modelId: newModelId.value
  })

  if (!result.success) {
    notify('error', result.error || t('settings.ai.messages.modelAddFailed'))
    return
  }

  newModelDisplayName.value = ''
  newModelId.value = ''
  notify('success', t('settings.ai.messages.modelAdded'))
}

function handleModelDisplayNameChange(id: string, value: string): void {
  if (!selectedProvider.value) return
  const result = aiSettings.updateModel(selectedProvider.value.id, id, {
    displayName: value
  })
  if (!result.success) {
    notify('error', result.error || t('settings.ai.messages.modelUpdateFailed'))
  }
}

function handleModelIdChange(id: string, value: string): void {
  if (!selectedProvider.value) return
  const result = aiSettings.updateModel(selectedProvider.value.id, id, {
    modelId: value
  })
  if (!result.success) {
    notify('error', result.error || t('settings.ai.messages.modelUpdateFailed'))
  }
}

function handleDeleteModel(id: string): void {
  if (!selectedProvider.value) return
  aiSettings.removeModel(selectedProvider.value.id, id)
  notify('success', t('settings.ai.messages.modelDeleted'))
}

function getFeatureBinding(feature: AIFeatureKey): AIFeatureBinding | null {
  return aiSettings.featureBindings[feature] || null
}

function getFeatureProviderId(feature: AIFeatureKey): string | null {
  return getFeatureBinding(feature)?.providerId || null
}

function getFeatureModelId(feature: AIFeatureKey): string | null {
  return getFeatureBinding(feature)?.modelId || null
}

function getFeatureModelOptions(feature: AIFeatureKey): Array<{ label: string; value: string }> {
  const providerId = getFeatureProviderId(feature)
  if (!providerId) return []

  const provider = aiSettings.providers.find((item) => item.id === providerId)
  if (!provider) return []

  return provider.models.map((model) => ({
    label: `${model.displayName} (${model.modelId})`,
    value: model.modelId
  }))
}

function handleFeatureProviderChange(feature: AIFeatureKey, value: string | number | null): void {
  if (typeof value !== 'string' || !value) {
    aiSettings.setFeatureBinding(feature, null)
    return
  }

  const provider = aiSettings.providers.find((item) => item.id === value)
  if (!provider) {
    aiSettings.setFeatureBinding(feature, null)
    return
  }

  const defaultModel = provider.models[0]
  if (!defaultModel) {
    aiSettings.setFeatureBinding(feature, null)
    notify('warning', t('settings.ai.messages.providerHasNoModel'))
    return
  }

  aiSettings.setFeatureBinding(feature, {
    providerId: provider.id,
    modelId: defaultModel.modelId
  })
}

function handleFeatureModelChange(feature: AIFeatureKey, value: string | number | null): void {
  const providerId = getFeatureProviderId(feature)
  if (!providerId) return

  if (typeof value !== 'string' || !value) {
    aiSettings.setFeatureBinding(feature, null)
    return
  }

  aiSettings.setFeatureBinding(feature, {
    providerId,
    modelId: value
  })
}

function handleClearFeatureBinding(feature: AIFeatureKey): void {
  aiSettings.setFeatureBinding(feature, null)
}

function handleExitAISettings(): void {
  router.push('/settings').catch((error) => {
    console.error('退出 AI 设置页面失败:', error)
  })
}

onMounted(() => {
  void aiSettings.initFromStorage()
})
</script>

<style scoped>
.ai-settings-page {
  height: 100%;
  padding: 24px;
  box-sizing: border-box;
  overflow-y: auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.header-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.exit-button {
  flex: 0 0 auto;
  margin-top: 2px;
}

.page-title {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  color: var(--n-text-color);
}

.page-subtitle {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--n-text-color-3);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.saving-hint {
  font-size: 13px;
  color: var(--n-text-color-3);
}

.ai-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
}

.settings-card {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition:
    box-shadow var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.settings-card:hover {
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.provider-list-card {
  height: fit-content;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.provider-item {
  border: 1px solid var(--n-border-color);
  border-radius: 10px;
  background: var(--n-color-modal);
  text-align: left;
  padding: 10px 12px;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}

.provider-item:hover {
  border-color: var(--n-primary-color-hover);
}

.provider-item--active {
  border-color: var(--n-primary-color);
  box-shadow: 0 0 0 1px var(--n-primary-color) inset;
}

.provider-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--n-text-color);
}

.provider-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--n-text-color-3);
}

.provider-empty {
  padding: 8px 0;
}

.provider-add-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--n-border-color);
}

.details-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-item {
  display: flex;
  gap: 14px;
  justify-content: space-between;
}

.setting-item-top {
  align-items: flex-start;
}

.setting-info {
  min-width: 140px;
  flex: 0 0 140px;
}

.setting-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--n-text-color);
}

.setting-description {
  margin-top: 4px;
  display: block;
  font-size: 12px;
  color: var(--n-text-color-3);
}

.form-input {
  max-width: 420px;
}

.provider-actions {
  display: flex;
  justify-content: flex-end;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.model-item {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 10px;
}

.model-add-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 10px;
  padding-top: 6px;
}

.binding-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.binding-feature {
  font-size: 14px;
  color: var(--n-text-color-2);
}

.binding-controls {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 10px;
}

@media (max-width: 1100px) {
  .ai-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .ai-settings-page {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .header-main {
    width: 100%;
  }

  .setting-item {
    flex-direction: column;
  }

  .setting-info {
    min-width: 0;
    flex: 1;
  }

  .model-item,
  .model-add-row,
  .binding-controls {
    grid-template-columns: 1fr;
  }

  .binding-row {
    grid-template-columns: 1fr;
  }
}
</style>
