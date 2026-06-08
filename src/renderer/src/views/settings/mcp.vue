<template>
  <div class="mcp-settings-page">
    <div class="page-header">
      <div class="header-main">
        <n-button
          quaternary
          circle
          class="exit-button"
          :aria-label="t('common.close')"
          @click="handleExitMcpSettings"
        >
          <template #icon>
            <n-icon><ArrowBackOutline /></n-icon>
          </template>
        </n-button>
        <div>
          <h1 class="page-title">{{ t('settings.ai.mcp.card') }}</h1>
          <p class="page-subtitle">{{ t('settings.ai.mcp.enabledDescription') }}</p>
        </div>
      </div>
      <div class="header-actions">
        <span v-if="aiSettings.isSaving" class="saving-hint">
          {{ t('settings.ai.messages.saving') }}
        </span>
      </div>
    </div>

    <n-card :bordered="false" class="settings-card">
      <n-space vertical :size="14">
        <div class="setting-item">
          <div class="setting-info">
            <label class="setting-label">{{ t('settings.ai.mcp.enabled') }}</label>
            <span class="setting-description">{{ t('settings.ai.mcp.enabledDescription') }}</span>
          </div>
          <n-switch :value="mcp.enabled" @update:value="handleMcpEnabledChange" />
        </div>

        <div class="setting-item setting-item-top">
          <div class="setting-info">
            <label class="setting-label">{{ t('settings.ai.mcp.endpoint') }}</label>
            <span class="setting-description">{{ mcpStatusText }}</span>
          </div>
          <div class="mcp-endpoint">
            <n-input :value="mcpUrl" readonly class="form-input" />
            <n-tag :type="mcpStatusTagType" size="small">
              {{ mcpStatusLabel }}
            </n-tag>
          </div>
        </div>

        <div class="setting-item setting-item-top">
          <div class="setting-info">
            <label class="setting-label">{{ t('settings.ai.mcp.port') }}</label>
            <span class="setting-description">{{ t('settings.ai.mcp.portDescription') }}</span>
          </div>
          <n-input-number
            :value="mcp.port"
            class="number-input"
            :min="1024"
            :max="65535"
            :step="1"
            @update:value="handleMcpPortChange"
          />
        </div>

        <div class="setting-item setting-item-top">
          <div class="setting-info">
            <label class="setting-label">{{ t('settings.ai.mcp.token') }}</label>
            <span class="setting-description">{{ t('settings.ai.mcp.tokenDescription') }}</span>
          </div>
          <div class="mcp-token-row">
            <n-input
              :value="mcp.authToken"
              type="password"
              show-password-on="mousedown"
              readonly
            />
            <n-button secondary @click="handleCopyMcpToken">
              {{ t('settings.ai.actions.copyToken') }}
            </n-button>
            <n-button tertiary @click="handleRegenerateMcpToken">
              {{ t('settings.ai.actions.regenerateToken') }}
            </n-button>
          </div>
        </div>

        <div class="mcp-limits">
          <div class="setting-item setting-item-top">
            <div class="setting-info">
              <label class="setting-label">{{ t('settings.ai.mcp.maxSearchResults') }}</label>
            </div>
            <n-input-number
              :value="mcp.maxSearchResults"
              class="number-input"
              :min="1"
              :max="100"
              :step="1"
              @update:value="(value) => handleMcpNumberChange('maxSearchResults', value)"
            />
          </div>
          <div class="setting-item setting-item-top">
            <div class="setting-info">
              <label class="setting-label">{{ t('settings.ai.mcp.maxReadChars') }}</label>
            </div>
            <n-input-number
              :value="mcp.maxReadChars"
              class="number-input"
              :min="500"
              :max="20000"
              :step="500"
              @update:value="(value) => handleMcpNumberChange('maxReadChars', value)"
            />
          </div>
          <div class="setting-item setting-item-top">
            <div class="setting-info">
              <label class="setting-label">{{ t('settings.ai.mcp.maxBatchMetadata') }}</label>
            </div>
            <n-input-number
              :value="mcp.maxBatchMetadata"
              class="number-input"
              :min="1"
              :max="100"
              :step="1"
              @update:value="(value) => handleMcpNumberChange('maxBatchMetadata', value)"
            />
          </div>
        </div>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ArrowBackOutline } from '@vicons/ionicons5'
import {
  NButton,
  NCard,
  NIcon,
  NInput,
  NInputNumber,
  NSpace,
  NSwitch,
  NTag
} from 'naive-ui'
import type { McpRuntimeStatus } from '../../../../types/api'
import { type AIMcpConfig, useAISettingsStore } from '@renderer/stores/aiSettings'

const aiSettings = useAISettingsStore()
const { t } = useI18n()
const router = useRouter()

const mcpStatus = ref<McpRuntimeStatus | null>(null)

const mcp = computed(() => aiSettings.mcp)
const mcpUrl = computed(() => `http://127.0.0.1:${mcp.value.port}/mcp`)
const runtimeEnabled = computed(() => mcpStatus.value?.enabled ?? mcp.value.enabled)
const mcpStatusLabel = computed(() => {
  if (!runtimeEnabled.value) return t('settings.ai.mcp.statusStopped')
  if (mcpStatus.value?.running) return t('settings.ai.mcp.statusRunning')
  if (mcpStatus.value?.error) return t('settings.ai.mcp.statusError')
  return t('settings.ai.mcp.statusStarting')
})
const mcpStatusTagType = computed<'default' | 'success' | 'warning' | 'error'>(() => {
  if (!runtimeEnabled.value) return 'default'
  if (mcpStatus.value?.running) return 'success'
  if (mcpStatus.value?.error) return 'error'
  return 'warning'
})
const mcpStatusText = computed(() => {
  if (mcpStatus.value?.error) {
    return t('settings.ai.mcp.statusErrorDetail', { reason: mcpStatus.value.error })
  }
  return t('settings.ai.mcp.endpointDescription')
})

function notify(type: 'success' | 'error', message: string): void {
  const messageApi = window.$message
  if (messageApi) {
    messageApi[type](message)
    return
  }

  if (type !== 'success') {
    alert(message)
  }
}

async function persistMcpConfigAndRefreshStatus(): Promise<void> {
  const result = await aiSettings.persistNow()
  if (!result.success) {
    notify('error', result.error || t('settings.ai.messages.saveFailed'))
  }
  await refreshMcpStatus()
}

async function refreshMcpStatus(): Promise<void> {
  try {
    mcpStatus.value = await window.api.getMcpStatus()
  } catch (error) {
    console.error('Failed to load MCP status:', error)
  }
}

function handleMcpEnabledChange(value: boolean): void {
  aiSettings.updateMcpConfig({ enabled: value })
  void persistMcpConfigAndRefreshStatus()
}

function handleMcpPortChange(value: number | null): void {
  if (typeof value !== 'number') return
  aiSettings.updateMcpConfig({ port: value })
  void persistMcpConfigAndRefreshStatus()
}

function handleMcpNumberChange(
  field: 'maxSearchResults' | 'maxReadChars' | 'maxBatchMetadata',
  value: number | null
): void {
  if (typeof value !== 'number') return
  aiSettings.updateMcpConfig({ [field]: value } as Pick<AIMcpConfig, typeof field>)
  void persistMcpConfigAndRefreshStatus()
}

async function handleCopyMcpToken(): Promise<void> {
  try {
    await navigator.clipboard.writeText(mcp.value.authToken)
    notify('success', t('settings.ai.messages.tokenCopied'))
  } catch {
    notify('error', t('settings.ai.messages.tokenCopyFailed'))
  }
}

function handleRegenerateMcpToken(): void {
  aiSettings.regenerateMcpToken()
  void persistMcpConfigAndRefreshStatus()
  notify('success', t('settings.ai.messages.tokenRegenerated'))
}

function handleExitMcpSettings(): void {
  router.push('/settings').catch((error) => {
    console.error('退出 MCP 设置页面失败:', error)
  })
}

onMounted(async () => {
  await aiSettings.initFromStorage()
  await refreshMcpStatus()
})
</script>

<style scoped>
.mcp-settings-page {
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

.settings-card {
  max-width: 920px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
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
  min-width: 180px;
  flex: 0 0 180px;
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

.mcp-endpoint {
  display: grid;
  grid-template-columns: minmax(0, 420px) auto;
  gap: 10px;
  align-items: center;
  width: min(100%, 640px);
}

.mcp-token-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  width: min(100%, 640px);
}

.mcp-limits {
  display: grid;
  gap: 12px;
}

.number-input {
  width: 180px;
}

@media (max-width: 768px) {
  .mcp-settings-page {
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

  .mcp-endpoint,
  .mcp-token-row {
    grid-template-columns: 1fr;
  }
}
</style>
