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

        <!-- 隐私保护 -->
        <n-card title="隐私保护" :bordered="false" class="settings-card">
          <n-space vertical :size="16">
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">隐私保护开关</label>
                <span class="setting-description">
                  开启后，重启并重新进入应用时需要输入 6 位数字密码
                </span>
              </div>
              <n-switch
                :value="privacy.isEnabled"
                :loading="privacyLoading"
                @update:value="handlePrivacyToggle"
              />
            </div>

            <div v-if="privacy.isEnabled" class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">密码设置</label>
                <span class="setting-description">
                  {{
                    privacy.hasPassword
                      ? '点击后在弹窗中重设密码，需先输入原密码'
                      : '当前未设置密码，请先设置6位数字密码'
                  }}
                </span>
              </div>

              <div class="privacy-actions privacy-actions--end">
                <n-button
                  :loading="privacyLoading"
                  :disabled="privacyLoading"
                  @click="handleOpenPasswordModal"
                >
                  {{ privacy.hasPassword ? '重设密码' : '设置密码' }}
                </n-button>
              </div>
            </div>

            <div v-if="privacyMessage" class="update-message" :class="privacyMessageType">
              <span class="message-text">{{ privacyMessage }}</span>
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
                  导出数据库与附件为 ZIP 备份，图片目录会另打包为口令加密 ZIP
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
                <span class="setting-description">
                  从 ZIP 备份文件恢复数据，会覆盖当前本地数据，需输入备份口令
                </span>
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

    <n-modal
      v-model:show="showPasswordModal"
      preset="card"
      :title="passwordModalTitle"
      :bordered="false"
      style="width: 440px; border-radius: 12px"
      @close="handleClosePasswordModal"
    >
      <n-space vertical :size="12">
        <p class="privacy-modal-desc">
          {{ passwordModalDescription }}
        </p>

        <div
          v-if="passwordModalMode === 'reset' || passwordModalMode === 'disable'"
          class="setting-info"
        >
          <label class="setting-label">原密码</label>
          <n-input-otp
            :value="currentPassword"
            :length="OTP_LENGTH"
            block
            mask
            :status="currentPasswordStatus"
            :allow-input="allowDigitInput"
            @update:value="handleCurrentPasswordInput"
          />
        </div>

        <div v-if="passwordModalMode !== 'disable'" class="setting-info">
          <label class="setting-label">新密码</label>
          <n-input-otp
            :value="newPassword"
            :length="OTP_LENGTH"
            block
            mask
            :status="newPasswordStatus"
            :allow-input="allowDigitInput"
            @update:value="handleNewPasswordInput"
          />
        </div>

        <div v-if="passwordModalMode !== 'disable'" class="setting-info">
          <label class="setting-label">确认新密码</label>
          <n-input-otp
            :value="confirmPassword"
            :length="OTP_LENGTH"
            block
            mask
            :status="confirmPasswordStatus"
            :allow-input="allowDigitInput"
            @update:value="handleConfirmPasswordInput"
          />
        </div>
      </n-space>

      <template #footer>
        <n-space justify="end">
          <n-button :disabled="privacyLoading" @click="handleClosePasswordModal">取消</n-button>
          <n-button type="primary" :loading="privacyLoading" @click="handleSubmitPasswordModal">
            {{ passwordModalMode === 'disable' ? '确认关闭' : '保存' }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showBackupPasswordModal"
      preset="card"
      :title="backupPasswordModalTitle"
      :bordered="false"
      style="width: 440px; border-radius: 12px"
      @close="handleCloseBackupPasswordModal"
    >
      <n-space vertical :size="12">
        <p class="privacy-modal-desc">
          {{ backupPasswordModalDescription }}
        </p>
        <div class="setting-info">
          <label class="setting-label">备份口令</label>
          <n-input
            v-model:value="backupPassword"
            type="password"
            show-password-on="mousedown"
            :status="backupPasswordStatus"
            :placeholder="`至少 ${MIN_BACKUP_PASSWORD_LENGTH} 位`"
          />
        </div>

        <div v-if="backupPasswordMode === 'export'" class="setting-info">
          <label class="setting-label">确认口令</label>
          <n-input
            v-model:value="confirmBackupPassword"
            type="password"
            show-password-on="mousedown"
            :status="confirmBackupPasswordStatus"
            :placeholder="`再次输入口令`"
          />
        </div>
      </n-space>

      <template #footer>
        <n-space justify="end">
          <n-button
            :disabled="exportingData || importingData || backupPasswordSubmitting"
            @click="handleCloseBackupPasswordModal"
          >
            取消
          </n-button>
          <n-button
            type="primary"
            :loading="backupPasswordSubmitting"
            @click="handleConfirmBackupPassword"
          >
            {{ backupPasswordMode === 'export' ? '确认导出' : '确认导入' }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showExportProgressDialog"
      preset="dialog"
      title="导出备份中"
      :mask-closable="false"
      :closable="false"
      :close-on-esc="false"
    >
      <n-space vertical :size="12">
        <div class="progress-message">{{ exportProgressMessage }}</div>
        <n-progress type="line" :percentage="exportProgress" :show-indicator="true" />
      </n-space>
      <template #action>
        <n-button
          v-if="!exportTransferDone"
          :loading="exportCanceling"
          :disabled="exportCanceling"
          @click="handleCancelExportTransfer"
        >
          取消
        </n-button>
        <n-button v-else type="primary" @click="handleCloseExportProgressDialog">完成</n-button>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showImportProgressDialog"
      preset="dialog"
      title="导入备份中"
      :mask-closable="false"
      :closable="false"
      :close-on-esc="false"
    >
      <n-space vertical :size="12">
        <div class="progress-message">{{ importProgressMessage }}</div>
        <n-progress type="line" :percentage="importProgress" :show-indicator="true" />
      </n-space>
      <template #action>
        <n-button
          v-if="!importTransferDone"
          :loading="importCanceling"
          :disabled="importCanceling"
          @click="handleCancelImportTransfer"
        >
          取消
        </n-button>
        <n-button v-else type="primary" @click="handleCloseImportProgressDialog">完成</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NButton,
  NCard,
  NSpace,
  NSwitch,
  NProgress,
  NInputOtp,
  NInput,
  NModal,
  useDialog
} from 'naive-ui'
import { ThemeMode, useThemeStore } from '@renderer/stores/themes'
import { isValidPrivacyPassword, usePrivacyStore } from '@renderer/stores/privacy'
import type { DataTransferProgress, DataTransferResult } from '../../../../types/api'

interface AppInfo {
  name: string
  version: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

const theme = useThemeStore()
const privacy = usePrivacyStore()
const OTP_LENGTH = 6
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
const showExportProgressDialog = ref(false)
const exportProgress = ref(0)
const exportProgressMessage = ref('正在准备导出任务...')
const exportTransferDone = ref(false)
const exportCanceling = ref(false)
const showImportProgressDialog = ref(false)
const importProgress = ref(0)
const importProgressMessage = ref('正在准备导入任务...')
const importTransferDone = ref(false)
const importCanceling = ref(false)
const reloadAfterImportComplete = ref(false)
const MIN_BACKUP_PASSWORD_LENGTH = 8
const showBackupPasswordModal = ref(false)
const backupPasswordMode = ref<'export' | 'import'>('export')
const backupPassword = ref('')
const confirmBackupPassword = ref('')
const backupPasswordStatus = ref<'error' | undefined>(undefined)
const confirmBackupPasswordStatus = ref<'error' | undefined>(undefined)
const backupPasswordSubmitting = ref(false)
const privacyLoading = ref(false)
const privacyMessage = ref('')
const privacyMessageType = ref<'success' | 'error' | 'info'>('info')
const showPasswordModal = ref(false)
const passwordModalMode = ref<'setup' | 'reset' | 'disable'>('setup')
const currentPassword = ref<string[]>([])
const newPassword = ref<string[]>([])
const confirmPassword = ref<string[]>([])
const currentPasswordStatus = ref<'error' | undefined>(undefined)
const newPasswordStatus = ref<'error' | undefined>(undefined)
const confirmPasswordStatus = ref<'error' | undefined>(undefined)
const pendingEnableAfterSet = ref(false)
const removeUpdateListeners: Array<() => void> = []
const dialog = useDialog()
const currentPasswordValue = computed(() => currentPassword.value.join(''))
const newPasswordValue = computed(() => newPassword.value.join(''))
const confirmPasswordValue = computed(() => confirmPassword.value.join(''))
const backupPasswordModalTitle = computed(() =>
  backupPasswordMode.value === 'export' ? '导出备份口令' : '导入备份口令'
)
const backupPasswordModalDescription = computed(() =>
  backupPasswordMode.value === 'export'
    ? '请设置本次备份口令，导入此备份时需要该口令'
    : '请输入导出时设置的备份口令'
)

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

  removeUpdateListeners.push(
    window.api.onExportProgress((progress: DataTransferProgress) => {
      if (!exportingData.value) return
      showExportProgressDialog.value = true
      exportProgress.value = Math.max(0, Math.min(100, Math.round(progress.percent)))
      exportProgressMessage.value = progress.message || '正在导出数据...'
    })
  )

  removeUpdateListeners.push(
    window.api.onImportProgress((progress: DataTransferProgress) => {
      if (!importingData.value) return
      showImportProgressDialog.value = true
      importProgress.value = Math.max(0, Math.min(100, Math.round(progress.percent)))
      importProgressMessage.value = progress.message || '正在导入数据...'
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

const passwordModalTitle = computed(() => {
  if (passwordModalMode.value === 'setup') return '设置隐私密码'
  if (passwordModalMode.value === 'disable') return '关闭隐私保护'
  return '重设隐私密码'
})

const passwordModalDescription = computed(() => {
  if (passwordModalMode.value === 'setup') return '请设置6位数字密码'
  if (passwordModalMode.value === 'disable') return '请输入当前密码以关闭隐私保护'
  return '请先验证原密码，再设置新密码'
})

function allowDigitInput(char: string): boolean {
  return /^\d$/.test(char)
}

const handleCurrentPasswordInput = (value: string[]): void => {
  currentPassword.value = value
  currentPasswordStatus.value = undefined
}

const handleNewPasswordInput = (value: string[]): void => {
  newPassword.value = value
  newPasswordStatus.value = undefined
}

const handleConfirmPasswordInput = (value: string[]): void => {
  confirmPassword.value = value
  confirmPasswordStatus.value = undefined
}

const resetPasswordStatuses = (): void => {
  currentPasswordStatus.value = undefined
  newPasswordStatus.value = undefined
  confirmPasswordStatus.value = undefined
}

const resetPasswordModalForm = (): void => {
  currentPassword.value = []
  newPassword.value = []
  confirmPassword.value = []
  resetPasswordStatuses()
}

const openPasswordModal = (mode: 'setup' | 'reset' | 'disable', pendingEnable = false): void => {
  passwordModalMode.value = mode
  pendingEnableAfterSet.value = pendingEnable
  resetPasswordModalForm()
  showPasswordModal.value = true
}

const handleClosePasswordModal = (): void => {
  showPasswordModal.value = false
  pendingEnableAfterSet.value = false
  resetPasswordModalForm()
}

const enablePrivacy = async (): Promise<void> => {
  if (privacyLoading.value) return

  privacyLoading.value = true
  try {
    await privacy.enablePrivacy()
    privacyMessage.value = '隐私保护已开启'
    privacyMessageType.value = 'success'
  } catch (error) {
    console.error('开启隐私保护失败:', error)
    privacyMessage.value = `开启失败：${String(error)}`
    privacyMessageType.value = 'error'
  } finally {
    privacyLoading.value = false
  }
}

const handlePrivacyToggle = (value: boolean): void => {
  if (value) {
    if (!privacy.hasPassword) {
      openPasswordModal('setup', true)
      return
    }
    void enablePrivacy()
    return
  }
  openPasswordModal('disable')
}

const handleOpenPasswordModal = (): void => {
  openPasswordModal(privacy.hasPassword ? 'reset' : 'setup')
}

const handleSubmitPasswordModal = async (): Promise<void> => {
  if (privacyLoading.value) return

  resetPasswordStatuses()

  if (passwordModalMode.value === 'disable') {
    if (!isValidPrivacyPassword(currentPasswordValue.value)) {
      currentPasswordStatus.value = 'error'
      return
    }

    privacyLoading.value = true
    try {
      await privacy.disablePrivacyWithPassword(currentPasswordValue.value)
      privacyMessage.value = '隐私保护已关闭'
      privacyMessageType.value = 'success'
      handleClosePasswordModal()
    } catch (error) {
      console.error('关闭隐私保护失败:', error)
      if (String(error).includes('原密码错误')) {
        currentPasswordStatus.value = 'error'
      } else {
        privacyMessage.value = `关闭失败：${String(error)}`
        privacyMessageType.value = 'error'
      }
    } finally {
      privacyLoading.value = false
    }
    return
  }

  if (passwordModalMode.value === 'reset' && !isValidPrivacyPassword(currentPasswordValue.value)) {
    currentPasswordStatus.value = 'error'
    return
  }

  if (!isValidPrivacyPassword(newPasswordValue.value)) {
    newPasswordStatus.value = 'error'
    return
  }

  if (newPasswordValue.value !== confirmPasswordValue.value) {
    newPasswordStatus.value = 'error'
    confirmPasswordStatus.value = 'error'
    return
  }

  privacyLoading.value = true
  try {
    if (passwordModalMode.value === 'reset') {
      await privacy.updatePasswordWithCurrent(currentPasswordValue.value, newPasswordValue.value)
      privacyMessage.value = '密码重设成功'
    } else {
      await privacy.setPassword(newPasswordValue.value)
      if (pendingEnableAfterSet.value) {
        await privacy.enablePrivacy()
        privacyMessage.value = '密码设置成功，隐私保护已开启'
      } else {
        privacyMessage.value = '密码设置成功'
      }
    }

    privacyMessageType.value = 'success'
    handleClosePasswordModal()
  } catch (error) {
    console.error('保存隐私密码失败:', error)
    if (String(error).includes('原密码错误')) {
      currentPasswordStatus.value = 'error'
    } else {
      privacyMessage.value = `保存失败：${String(error)}`
      privacyMessageType.value = 'error'
    }
  } finally {
    privacyLoading.value = false
  }
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
  openBackupPasswordModal('export')
}

function resetBackupPasswordStatuses(): void {
  backupPasswordStatus.value = undefined
  confirmBackupPasswordStatus.value = undefined
}

function resetBackupPasswordForm(): void {
  backupPassword.value = ''
  confirmBackupPassword.value = ''
  resetBackupPasswordStatuses()
}

function openBackupPasswordModal(mode: 'export' | 'import'): void {
  backupPasswordMode.value = mode
  backupPasswordSubmitting.value = false
  resetBackupPasswordForm()
  showBackupPasswordModal.value = true
}

function handleCloseBackupPasswordModal(): void {
  showBackupPasswordModal.value = false
  backupPasswordSubmitting.value = false
  resetBackupPasswordForm()
}

function isValidBackupPassword(value: string): boolean {
  return value.trim().length >= MIN_BACKUP_PASSWORD_LENGTH
}

function resolveTransferErrorMessage(action: '导出' | '导入', result: DataTransferResult): string {
  if (!result.errorCode) return `${action}失败：${result.error || '未知错误'}`

  if (result.errorCode === 'VALIDATION_FAILED') {
    return result.error || `备份口令长度至少 ${MIN_BACKUP_PASSWORD_LENGTH} 位`
  }
  if (result.errorCode === 'UNSUPPORTED_BACKUP_FORMAT') {
    return result.error || '备份格式不受支持，仅可导入当前版本生成的备份'
  }
  if (result.errorCode === 'MISSING_KEY_ENVELOPE') {
    return result.error || '备份缺少密钥文件，无法导入'
  }
  if (result.errorCode === 'WRONG_BACKUP_PASSWORD') {
    return '备份口令错误，请重试'
  }
  if (result.errorCode === 'TRANSFER_IN_PROGRESS') {
    return result.error || '已有导入/导出任务进行中'
  }
  return `${action}失败：${result.error || '未知错误'}`
}

const handleCloseExportProgressDialog = (): void => {
  showExportProgressDialog.value = false
}

const handleCloseImportProgressDialog = (): void => {
  showImportProgressDialog.value = false
  if (reloadAfterImportComplete.value) {
    reloadAfterImportComplete.value = false
    window.location.reload()
  }
}

const handleCancelExportTransfer = async (): Promise<void> => {
  if (!exportingData.value || exportTransferDone.value || exportCanceling.value) return
  exportCanceling.value = true
  exportProgressMessage.value = '正在取消导出...'
  try {
    await window.api.cancelDataTransfer()
  } finally {
    exportCanceling.value = false
  }
}

const handleCancelImportTransfer = async (): Promise<void> => {
  if (!importingData.value || importTransferDone.value || importCanceling.value) return
  importCanceling.value = true
  importProgressMessage.value = '正在取消导入...'
  try {
    await window.api.cancelDataTransfer()
  } finally {
    importCanceling.value = false
  }
}

const runExportData = async (backupPasswordValue: string): Promise<void> => {
  exportingData.value = true
  exportTransferDone.value = false
  exportCanceling.value = false
  showExportProgressDialog.value = false
  exportProgress.value = 0
  exportProgressMessage.value = '正在准备导出任务...'
  dataMessage.value = '正在导出数据...'
  dataMessageType.value = 'info'

  try {
    const result = await window.api.exportData({ backupPassword: backupPasswordValue })
    if (result.canceled) {
      exportProgress.value = 100
      exportProgressMessage.value = '导出已取消'
      dataMessage.value = '已取消导出'
      dataMessageType.value = 'info'
      return
    }

    if (result.success) {
      exportProgress.value = 100
      exportProgressMessage.value = '导出完成'
      dataMessage.value = `导出成功：${result.path}`
      dataMessageType.value = 'success'
      return
    }

    exportProgress.value = 100
    exportProgressMessage.value = '导出失败'
    dataMessage.value = resolveTransferErrorMessage('导出', result)
    dataMessageType.value = 'error'
  } catch (error) {
    exportProgress.value = 100
    exportProgressMessage.value = '导出失败'
    dataMessage.value = `导出失败：${String(error)}`
    dataMessageType.value = 'error'
  } finally {
    exportingData.value = false
    exportTransferDone.value = true
  }
}

const runImportData = async (backupPasswordValue: string): Promise<void> => {
  importingData.value = true
  importTransferDone.value = false
  importCanceling.value = false
  reloadAfterImportComplete.value = false
  showImportProgressDialog.value = false
  importProgress.value = 0
  importProgressMessage.value = '正在准备导入任务...'
  dataMessage.value = '正在导入数据...'
  dataMessageType.value = 'info'

  try {
    const result = await window.api.importData({ backupPassword: backupPasswordValue })
    if (result.canceled) {
      importProgress.value = 100
      importProgressMessage.value = '导入已取消'
      dataMessage.value = '已取消导入'
      dataMessageType.value = 'info'
      return
    }

    if (result.success) {
      importProgress.value = 100
      importProgressMessage.value = '导入完成'
      dataMessage.value = '导入成功，点击完成后刷新页面'
      dataMessageType.value = 'success'
      reloadAfterImportComplete.value = true
      return
    }

    importProgress.value = 100
    importProgressMessage.value = '导入失败'
    dataMessage.value = resolveTransferErrorMessage('导入', result)
    dataMessageType.value = 'error'
  } catch (error) {
    importProgress.value = 100
    importProgressMessage.value = '导入失败'
    dataMessage.value = `导入失败：${String(error)}`
    dataMessageType.value = 'error'
  } finally {
    importingData.value = false
    importTransferDone.value = true
  }
}

const handleConfirmBackupPassword = async (): Promise<void> => {
  if (backupPasswordSubmitting.value) return

  resetBackupPasswordStatuses()

  if (!isValidBackupPassword(backupPassword.value)) {
    backupPasswordStatus.value = 'error'
    return
  }

  if (
    backupPasswordMode.value === 'export' &&
    backupPassword.value !== confirmBackupPassword.value
  ) {
    backupPasswordStatus.value = 'error'
    confirmBackupPasswordStatus.value = 'error'
    return
  }

  backupPasswordSubmitting.value = true
  showBackupPasswordModal.value = false
  const password = backupPassword.value
  resetBackupPasswordForm()

  try {
    if (backupPasswordMode.value === 'export') {
      await runExportData(password)
      return
    }
    await runImportData(password)
  } finally {
    backupPasswordSubmitting.value = false
  }
}

const handleImportData = (): void => {
  dialog.warning({
    title: '导入确认',
    content: '导入 ZIP 会覆盖当前本地数据，建议先执行一次导出备份。确认继续吗？',
    positiveText: '继续导入',
    negativeText: '取消',
    onPositiveClick: () => {
      openBackupPasswordModal('import')
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

.setting-item-top {
  align-items: flex-start;
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

.privacy-actions {
  width: min(240px, 100%);
  display: flex;
  gap: 10px;
}

.privacy-actions--end {
  justify-content: flex-end;
}

.privacy-modal-desc {
  margin: 0;
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

.progress-message {
  font-size: 13px;
  color: var(--n-text-color-2);
  word-break: break-word;
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

  .privacy-actions {
    width: 100%;
    flex-direction: column;
  }

  .privacy-actions--end {
    justify-content: flex-start;
  }
}
</style>
