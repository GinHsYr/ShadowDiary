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
              <n-button :loading="checkingUpdate" @click="handleCheckUpdate"> 检查更新 </n-button>
            </div>
            <div v-if="updateMessage" class="update-message" :class="updateMessageType">
              {{ updateMessage }}
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
import { onMounted, ref } from 'vue'
import { NButton, NCard, NSpace, NSwitch } from 'naive-ui'
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
})

const handleThemeChange = (value: boolean): void => {
  theme.setMode(value ? ThemeMode.Dark : ThemeMode.Light)
}

const handleCheckUpdate = async (): Promise<void> => {
  checkingUpdate.value = true
  updateMessage.value = ''
  try {
    const result = await window.api.checkForUpdates()
    if (result.success) {
      if (result.updateInfo) {
        updateMessage.value = `发现新版本 ${result.updateInfo.version}`
        updateMessageType.value = 'success'
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
