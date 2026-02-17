<template>
  <div class="settings-page">
    <div class="page-header">
      <h1 class="page-title">设置</h1>
      <p class="page-subtitle">个性化你的日记应用</p>
    </div>

    <div class="settings-container">
      <n-space vertical :size="24">
        <!-- 外观设置 -->
        <n-card title="外观设置" :bordered="false" class="settings-card">
          <n-space vertical :size="20">
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">深色模式</label>
                <span class="setting-description">切换应用主题颜色</span>
              </div>
              <n-switch :value="theme.isDark" @update:value="handleThemeChange" />
            </div>
          </n-space>
        </n-card>

        <!-- 关于 -->
        <n-card title="关于" :bordered="false" class="settings-card">
          <n-space vertical :size="16">
            <div class="about-item">
              <span class="about-label">版本</span>
              <span class="about-value">{{ appInfo.version }}</span>
            </div>
          </n-space>

          <n-space vertical :size="16">
            <div class="setting-item">
              <div class="setting-info">
                <span class="setting-description">检查是否有新版本可用</span>
              </div>
              <n-button
                :loading="checkingUpdate"
                :disabled="downloading"
                @click="handleCheckUpdate"
              >
                检查更新
              </n-button>
            </div>
            <div v-if="updateMessage" class="update-message" :class="updateMessageType">
              <span>{{ updateMessage }}</span>
              <template v-if="hasUpdate && !downloading && !downloaded">
                <n-button class="update-btn" @click="handleDownloadUpdate"> 下载更新 </n-button>
              </template>
              <template v-if="downloaded">
                <n-button type="primary" class="update-btn" @click="handleInstallUpdate">
                  立即安装
                </n-button>
              </template>
            </div>
            <div v-if="downloading" class="download-progress">
              <n-progress type="line" :percentage="downloadProgress" :show-indicator="true" />
            </div>
          </n-space>
        </n-card>

        <!-- 通用设置 -->
        <!--        <n-card title="通用设置" :bordered="false" class="settings-card">-->
        <!--          <n-space vertical :size="20">-->
        <!--            <div class="setting-item">-->
        <!--              <div class="setting-info">-->
        <!--                <label class="setting-label">语言</label>-->
        <!--                <span class="setting-description">选择应用显示语言</span>-->
        <!--              </div>-->
        <!--              <n-select-->
        <!--                v-model:value="settings.language"-->
        <!--                :options="languageOptions"-->
        <!--                style="width: 120px"-->
        <!--              />-->
        <!--            </div>-->
        <!--          </n-space>-->
        <!--        </n-card>-->
      </n-space>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NCard, NSpace, NSwitch, NProgress } from 'naive-ui'
import { ThemeMode, useThemeStore } from '@renderer/stores/themes'

interface AppInfo {
  name: string
  version: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

const theme = useThemeStore()
const checkingUpdate = ref(false)
const updateMessage = ref('')
const updateMessageType = ref<'success' | 'error' | 'info'>('info')
const hasUpdate = ref(false)
const downloading = ref(false)
const downloadProgress = ref(0)
const downloaded = ref(false)
const removeUpdateListeners: Array<() => void> = []

const appInfo = ref<AppInfo>({
  name: '',
  version: '',
  electronVersion: '',
  chromeVersion: '',
  nodeVersion: ''
})

// 加载应用信息
async function loadAppInfo(): Promise<void> {
  try {
    appInfo.value = await window.api.getAppInfo()
  } catch (error) {
    console.error('加载应用信息失败:', error)
  }
}

onMounted(() => {
  loadAppInfo()

  // 监听下载进度
  removeUpdateListeners.push(
    window.api.onDownloadProgress((progress) => {
      downloadProgress.value = Math.round(progress.percent)
    })
  )

  // 监听下载完成
  removeUpdateListeners.push(
    window.api.onUpdateDownloaded(() => {
      downloading.value = false
      downloaded.value = true
      updateMessage.value = '更新已下载完成，点击安装后将重启应用'
      updateMessageType.value = 'success'
    })
  )
})

onBeforeUnmount(() => {
  while (removeUpdateListeners.length > 0) {
    const removeListener = removeUpdateListeners.pop()
    removeListener?.()
  }
})

const handleThemeChange = (value: boolean): void => {
  theme.setMode(value ? ThemeMode.Dark : ThemeMode.Light)
}

const handleCheckUpdate = async (): Promise<void> => {
  checkingUpdate.value = true
  updateMessage.value = ''
  hasUpdate.value = false
  downloaded.value = false
  try {
    const result = await window.api.checkForUpdates()
    if (result.success) {
      if (result.updateInfo) {
        updateMessage.value = `发现新版本 ${result.updateInfo.version}`
        updateMessageType.value = 'success'
        hasUpdate.value = true
      } else {
        updateMessage.value = '当前已是最新版本'
        updateMessageType.value = 'info'
      }
    } else {
      updateMessage.value = `检查更新失败: ${result.error || '未知错误'}`
      updateMessageType.value = 'error'
    }
  } catch (error) {
    updateMessage.value = `检查更新失败: ${error}`
    updateMessageType.value = 'error'
  } finally {
    checkingUpdate.value = false
  }
}

const handleDownloadUpdate = async (): Promise<void> => {
  downloading.value = true
  downloadProgress.value = 0
  updateMessage.value = '正在下载更新...'
  updateMessageType.value = 'info'
  try {
    await window.api.downloadUpdate()
  } catch (error) {
    downloading.value = false
    updateMessage.value = `下载更新失败: ${error}`
    updateMessageType.value = 'error'
  }
}

const handleInstallUpdate = (): void => {
  window.api.installUpdate()
}
</script>

<style scoped>
.settings-page {
  padding: 32px;
  max-width: 800px;
  margin: 0 auto;
  height: 100%;
  overflow: hidden;
}

.page-header {
  margin-bottom: 32px;
}

.page-title {
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--n-text-color);
}
.update-message {
  display: flex;
  align-items: center;
}

.update-btn {
  margin-left: auto;
}
.page-subtitle {
  font-size: 16px;
  color: var(--n-text-color-3);
  margin: 0;
}

.settings-container {
  width: 100%;
}

.settings-card {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.setting-label {
  font-size: 15px;
  font-weight: 500;
  color: var(--n-text-color);
}

.setting-description {
  font-size: 13px;
  color: var(--n-text-color-3);
}

.about-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.about-label {
  font-size: 14px;
  color: var(--n-text-color-2);
}

.about-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--n-text-color);
}

.update-message {
  padding: 12px;
  border-radius: 6px;
  font-size: 14px;
}

.update-message.success {
  background-color: rgba(24, 160, 88, 0.1);
  color: #18a058;
}

.update-message.error {
  background-color: rgba(208, 48, 80, 0.1);
  color: #d03050;
}

.update-message.info {
  background-color: rgba(42, 148, 229, 0.1);
  color: #2a94e5;
}

.download-progress {
  padding: 8px 0;
}

@media (max-width: 768px) {
  .settings-page {
    padding: 16px;
  }

  .page-title {
    font-size: 24px;
  }

  .setting-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
}
</style>
