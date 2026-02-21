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

        <!-- 数据管理 -->
        <n-card title="数据管理" :bordered="false" class="settings-card">
          <n-space vertical :size="16">
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">导出数据</label>
                <span class="setting-description">
                  导出数据库和图片/附件为 ZIP 备份文件，建议定期备份
                </span>
              </div>
              <n-button
                :loading="exportingData"
                :disabled="importingData"
                @click="handleExportData"
              >
                导出数据
              </n-button>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">导入数据</label>
                <span class="setting-description">从 ZIP 备份文件恢复数据，会覆盖当前本地数据</span>
              </div>
              <n-button
                type="warning"
                :loading="importingData"
                :disabled="exportingData"
                @click="handleImportData"
              >
                导入数据
              </n-button>
            </div>

            <div v-if="dataMessage" class="update-message" :class="dataMessageType">
              <span class="message-text">{{ dataMessage }}</span>
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
            <div class="about-item">
              <span class="about-label">开源地址</span>
              <a
                class="about-link"
                href="https://github.com/GinHsYr/ShadowDiary"
                target="_blank"
                rel="noopener noreferrer"
                >https://github.com/GinHsYr/ShadowDiary
              </a>
            </div>
            <div class="setting-item">
              <div class="setting-info">
                <span class="about-label">检查是否有新版本可用</span>
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
      </n-space>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NCard, NSpace, NSwitch, NProgress, useDialog } from 'naive-ui'
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
const exportingData = ref(false)
const importingData = ref(false)
const dataMessage = ref('')
const dataMessageType = ref<'success' | 'error' | 'info'>('info')
const removeUpdateListeners: Array<() => void> = []
const dialog = useDialog()

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

const handleExportData = async (): Promise<void> => {
  exportingData.value = true
  dataMessage.value = '正在导出数据...'
  dataMessageType.value = 'info'

  try {
    const result = await window.api.exportData()
    if (result.canceled) {
      dataMessage.value = '已取消导出'
      dataMessageType.value = 'info'
      return
    }

    if (result.success) {
      dataMessage.value = `导出成功：${result.path}`
      dataMessageType.value = 'success'
      return
    }

    dataMessage.value = `导出失败：${result.error || '未知错误'}`
    dataMessageType.value = 'error'
  } catch (error) {
    dataMessage.value = `导出失败：${String(error)}`
    dataMessageType.value = 'error'
  } finally {
    exportingData.value = false
  }
}

const runImportData = async (): Promise<void> => {
  importingData.value = true
  dataMessage.value = '正在导入数据...'
  dataMessageType.value = 'info'

  try {
    const result = await window.api.importData()
    if (result.canceled) {
      dataMessage.value = '已取消导入'
      dataMessageType.value = 'info'
      return
    }

    if (result.success) {
      dataMessage.value = '导入成功，正在刷新页面...'
      dataMessageType.value = 'success'
      setTimeout(() => {
        window.location.reload()
      }, 300)
      return
    }

    dataMessage.value = `导入失败：${result.error || '未知错误'}`
    dataMessageType.value = 'error'
  } catch (error) {
    dataMessage.value = `导入失败：${String(error)}`
    dataMessageType.value = 'error'
  } finally {
    importingData.value = false
  }
}

const handleImportData = (): void => {
  dialog.warning({
    title: '导入确认',
    content: '导入 ZIP 会覆盖当前本地数据，建议先执行一次导出备份。确认继续吗？',
    positiveText: '继续导入',
    negativeText: '取消',
    onPositiveClick: async () => {
      await runImportData()
    }
  })
}
</script>

<style scoped>
.settings-page {
  padding: 32px;
  max-width: 800px;
  margin: 0 auto;
  height: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
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

.message-text {
  width: 100%;
  word-break: break-word;
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

.about-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--n-primary-color);
  text-decoration: none;
}

.about-link:hover {
  text-decoration: underline;
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
