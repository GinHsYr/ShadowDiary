<template>
  <div class="settings-page">
    <div class="page-header">
      <h1 class="page-title">{{ t('settings.title') }}</h1>
      <p class="page-subtitle">{{ t('settings.subtitle') }}</p>
    </div>

    <div class="settings-container">
      <n-space vertical :size="24">
        <!-- 外观设置 -->
        <n-card :title="t('settings.appearance')" :bordered="false" class="settings-card">
          <n-space vertical :size="20">
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.darkMode') }}</label>
                <span class="setting-description">{{ t('settings.darkModeDescription') }}</span>
              </div>
              <n-switch :value="theme.isDark" @update:value="handleThemeChange" />
            </div>

            <div class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.themeAccent') }}</label>
                <span class="setting-description">
                  {{
                    theme.isDark ? t('settings.themeAccentDarkHint') : t('settings.themeAccentHint')
                  }}
                </span>
              </div>

              <div class="accent-palette">
                <button
                  v-for="option in visibleAccentOptions"
                  :key="option.value"
                  type="button"
                  class="accent-chip"
                  :class="{ 'accent-chip--active': theme.accent === option.value }"
                  :style="{ '--accent-color': option.color }"
                  :aria-label="option.label"
                  :title="option.label"
                  @click="handleAccentChange(option.value)"
                >
                  <span class="accent-chip-dot" />
                </button>
              </div>
            </div>

            <div class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.language') }}</label>
                <span class="setting-description">{{ t('settings.languageDescription') }}</span>
              </div>

              <div class="privacy-actions privacy-actions--end">
                <n-select
                  :value="localeStore.preference"
                  :options="localePreferenceOptions"
                  :disabled="localeSaving"
                  style="width: 210px"
                  @update:value="handleLocalePreferenceChange"
                />
              </div>
            </div>
          </n-space>
        </n-card>

        <n-card :title="t('settings.navigation.ai')" :bordered="false" class="settings-card">
          <div class="setting-item">
            <div class="setting-info">
              <label class="setting-label">{{ t('settings.ai.title') }}</label>
              <span class="setting-description">{{ t('settings.ai.subtitle') }}</span>
            </div>
            <n-button @click="handleOpenAISettings">{{ t('settings.navigation.ai') }}</n-button>
          </div>
        </n-card>

        <!-- 隐私保护 -->
        <n-card :title="t('settings.privacy.card')" :bordered="false" class="settings-card">
          <n-space vertical :size="16">
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.privacy.enabled') }}</label>
                <span class="setting-description">
                  {{ t('settings.privacy.enabledDescription') }}
                </span>
              </div>
              <n-switch
                :value="privacy.isEnabled"
                :loading="privacyLoading"
                @update:value="handlePrivacyToggle"
              />
            </div>

            <div class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.privacy.authMethod') }}</label>
                <span class="setting-description">
                  {{
                    privacy.isWindowsPasswordSupported
                      ? t('settings.privacy.authMethodSupported')
                      : t('settings.privacy.authMethodPinOnly')
                  }}
                </span>
              </div>

              <div class="privacy-actions privacy-actions--end">
                <n-select
                  :value="privacy.authMethod"
                  :options="privacyAuthMethodOptions"
                  :disabled="privacyLoading"
                  style="width: 210px"
                  @update:value="handlePrivacyAuthMethodChange"
                />
              </div>
            </div>

            <div v-if="privacy.isEnabled" class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.privacy.idleLock') }}</label>
                <span class="setting-description">
                  {{ t('settings.privacy.idleLockDescription') }}
                </span>
              </div>

              <div class="privacy-actions privacy-actions--end">
                <n-select
                  :value="privacy.idleLockMinutes"
                  :options="privacyIdleMinuteOptions"
                  :disabled="privacyLoading"
                  style="width: 160px"
                  @update:value="handlePrivacyIdleMinuteChange"
                />
              </div>
            </div>

            <div v-if="privacy.isEnabled" class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.privacy.manualLockShortcut') }}</label>
                <span class="setting-description">
                  {{ t('settings.privacy.manualLockShortcutDescription') }}
                </span>
              </div>

              <div class="privacy-actions privacy-actions--end privacy-actions--shortcut">
                <n-input
                  :value="privacy.manualLockShortcut"
                  class="privacy-shortcut-input"
                  readonly
                  :disabled="privacyLoading"
                  @keydown="handleManualLockShortcutInput"
                />
                <n-button :disabled="privacyLoading" @click="handleResetManualLockShortcut">
                  {{ t('settings.privacy.resetManualLockShortcut') }}
                </n-button>
              </div>
            </div>

            <div class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.privacy.disguiseEnabled') }}</label>
                <span class="setting-description">
                  {{ t('settings.privacy.disguiseEnabledDescription') }}
                </span>
              </div>
              <n-switch
                :value="disguise.isEnabled"
                :loading="disguiseLoading"
                @update:value="handleDisguiseToggle"
              />
            </div>

            <div class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">
                  {{ t('settings.privacy.disguiseAutoEnableOnLaunch') }}
                </label>
                <span class="setting-description">
                  {{ t('settings.privacy.disguiseAutoEnableOnLaunchDescription') }}
                </span>
              </div>
              <n-switch
                :value="disguise.autoEnableOnLaunch"
                :disabled="disguiseLoading"
                @update:value="handleDisguiseAutoEnableOnLaunchToggle"
              />
            </div>

            <div class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.privacy.disguiseShortcut') }}</label>
                <span class="setting-description">
                  {{ t('settings.privacy.disguiseShortcutDescription') }}
                </span>
              </div>

              <div class="privacy-actions privacy-actions--end privacy-actions--shortcut">
                <n-input
                  :value="disguise.shortcut"
                  class="privacy-shortcut-input"
                  readonly
                  :disabled="disguiseLoading"
                  @keydown="handleDisguiseShortcutInput"
                />
                <n-button :disabled="disguiseLoading" @click="handleResetDisguiseShortcut">
                  {{ t('settings.privacy.resetDisguiseShortcut') }}
                </n-button>
              </div>
            </div>

            <div v-if="disguise.isEnabled" class="setting-item setting-item-top">
              <div class="setting-info">
                <label class="setting-label">
                  {{ t('settings.privacy.regenerateDisguiseData') }}
                </label>
                <span class="setting-description">
                  {{ t('settings.privacy.regenerateDisguiseDataDescription') }}
                </span>
              </div>
              <div class="privacy-actions privacy-actions--end">
                <n-button :loading="disguiseLoading" @click="handleRegenerateDisguiseData">
                  {{ t('settings.privacy.regenerateDisguiseDataAction') }}
                </n-button>
              </div>
            </div>

            <div
              v-if="privacy.isEnabled && privacy.authMethod === 'pin'"
              class="setting-item setting-item-top"
            >
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.privacy.passwordSetup') }}</label>
                <span class="setting-description">
                  {{
                    privacy.hasPassword
                      ? t('settings.privacy.passwordSetupHint')
                      : t('settings.privacy.passwordMissingHint')
                  }}
                </span>
              </div>

              <div class="privacy-actions privacy-actions--end">
                <n-button
                  :loading="privacyLoading"
                  :disabled="privacyLoading"
                  @click="handleOpenPasswordModal"
                >
                  {{
                    privacy.hasPassword
                      ? t('settings.privacy.resetPassword')
                      : t('settings.privacy.setPassword')
                  }}
                </n-button>
              </div>
            </div>

            <div
              v-if="privacy.isEnabled && privacy.authMethod === 'windows'"
              class="setting-item setting-item-top"
            >
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.privacy.windowsPassword') }}</label>
                <span class="setting-description">
                  {{ t('settings.privacy.windowsPasswordDescription') }}
                </span>
              </div>
            </div>

            <transition name="settings-message">
              <div
                v-if="privacyMessage"
                class="update-message privacy-update-message"
                :class="[privacyMessageType, `is-${privacyMessageType}`]"
              >
                <span class="message-text">{{ privacyMessage }}</span>
              </div>
            </transition>
          </n-space>
        </n-card>

        <!-- 数据管理 -->
        <n-card :title="t('settings.data.card')" :bordered="false" class="settings-card">
          <n-space vertical :size="16">
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.data.export') }}</label>
                <span class="setting-description">
                  {{ t('settings.data.exportDescription') }}
                </span>
              </div>
              <n-button
                :loading="exportingData"
                :disabled="importingData"
                @click="handleExportData"
              >
                {{ t('settings.data.export') }}
              </n-button>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.data.import') }}</label>
                <span class="setting-description">
                  {{ t('settings.data.importDescription') }}
                </span>
              </div>
              <n-button
                type="warning"
                :loading="importingData"
                :disabled="exportingData"
                @click="handleImportData"
              >
                {{ t('settings.data.import') }}
              </n-button>
            </div>

            <transition name="settings-message">
              <div
                v-if="dataMessage"
                class="update-message"
                :class="[dataMessageType, `is-${dataMessageType}`]"
              >
                <span class="message-text">{{ dataMessage }}</span>
              </div>
            </transition>
          </n-space>
        </n-card>

        <!-- 关于 -->
        <n-card :title="t('settings.about.card')" :bordered="false" class="settings-card">
          <n-space vertical :size="16">
            <div class="about-item">
              <span class="about-label">{{ t('settings.about.version') }}</span>
              <span class="about-value">{{ appInfo.version }}</span>
            </div>
            <div class="about-item">
              <span class="about-label">{{ t('settings.about.source') }}</span>
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
                <span class="about-label">{{ t('settings.about.checkUpdate') }}</span>
              </div>
              <n-button
                :loading="checkingUpdate"
                :disabled="downloading"
                @click="handleCheckUpdate"
              >
                {{ t('settings.about.checkUpdateButton') }}
              </n-button>
            </div>
            <transition name="settings-message">
              <div
                v-if="updateMessage"
                class="update-message"
                :class="[updateMessageType, `is-${updateMessageType}`]"
              >
                <span>{{ updateMessage }}</span>
                <template v-if="hasUpdate && !downloading && !downloaded">
                  <n-button class="update-btn" @click="handleDownloadUpdate">
                    {{ t('settings.about.downloadUpdate') }}
                  </n-button>
                </template>
                <template v-if="downloaded">
                  <n-button type="primary" class="update-btn" @click="handleInstallUpdate">
                    {{ t('settings.about.installNow') }}
                  </n-button>
                </template>
              </div>
            </transition>
            <div v-if="downloading" class="download-progress">
              <n-progress type="line" :percentage="downloadProgress" :show-indicator="true" />
              <div class="download-progress-meta">
                <span class="progress-message">{{ downloadProgressText }}</span>
                <n-button
                  size="small"
                  tertiary
                  :loading="cancelingUpdateDownload"
                  :disabled="cancelingUpdateDownload"
                  @click="handleCancelUpdateDownload"
                >
                  {{ t('common.cancel') }}
                </n-button>
              </div>
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
          <label class="setting-label">{{ t('settings.privacy.modal.currentPassword') }}</label>
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
          <label class="setting-label">{{ t('settings.privacy.modal.newPassword') }}</label>
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
          <label class="setting-label">{{ t('settings.privacy.modal.confirmPassword') }}</label>
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
          <n-button :disabled="privacyLoading" @click="handleClosePasswordModal">
            {{ t('common.cancel') }}
          </n-button>
          <n-button type="primary" :loading="privacyLoading" @click="handleSubmitPasswordModal">
            {{
              passwordModalMode === 'disable'
                ? t('settings.privacy.modal.confirmDisable')
                : t('common.save')
            }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showWindowsPasswordModal"
      preset="card"
      :title="windowsPasswordModalTitle"
      :bordered="false"
      style="width: 440px; border-radius: 12px"
      @close="handleCloseWindowsPasswordModal"
    >
      <n-space vertical :size="12">
        <p class="privacy-modal-desc">{{ windowsPasswordModalDescription }}</p>

        <div class="setting-info">
          <label class="setting-label">{{
            t('settings.privacy.modal.windowsPasswordLabel')
          }}</label>
          <n-input
            :value="windowsPasswordForDisable"
            type="password"
            show-password-on="mousedown"
            :status="windowsPasswordStatus"
            :placeholder="t('settings.privacy.modal.windowsPasswordPlaceholder')"
            @update:value="handleWindowsPasswordInput"
          />
        </div>
      </n-space>

      <template #footer>
        <n-space justify="end">
          <n-button :disabled="privacyLoading" @click="handleCloseWindowsPasswordModal">{{
            t('common.cancel')
          }}</n-button>
          <n-button
            type="primary"
            :loading="privacyLoading"
            @click="handleSubmitWindowsPasswordModal"
          >
            {{
              windowsPasswordModalMode === 'enable'
                ? t('settings.privacy.modal.verifyAndEnable')
                : t('settings.privacy.modal.confirmDisable')
            }}
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
          <label class="setting-label">{{ t('settings.data.backupPassword') }}</label>
          <n-input
            v-model:value="backupPassword"
            type="password"
            show-password-on="mousedown"
            :status="backupPasswordStatus"
            :placeholder="t('settings.data.minLength', { count: MIN_BACKUP_PASSWORD_LENGTH })"
          />
        </div>

        <div v-if="backupPasswordMode === 'export'" class="setting-info">
          <label class="setting-label">{{ t('settings.data.confirmPassword') }}</label>
          <n-input
            v-model:value="confirmBackupPassword"
            type="password"
            show-password-on="mousedown"
            :status="confirmBackupPasswordStatus"
            :placeholder="t('settings.data.reenterPassword')"
          />
        </div>
      </n-space>

      <template #footer>
        <n-space justify="end">
          <n-button
            :disabled="exportingData || importingData || backupPasswordSubmitting"
            @click="handleCloseBackupPasswordModal"
          >
            {{ t('common.cancel') }}
          </n-button>
          <n-button
            type="primary"
            :loading="backupPasswordSubmitting"
            @click="handleConfirmBackupPassword"
          >
            {{
              backupPasswordMode === 'export'
                ? t('settings.data.confirmExport')
                : t('settings.data.confirmImport')
            }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showExportProgressDialog"
      preset="dialog"
      :title="t('settings.data.exportInProgress')"
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
          {{ t('common.cancel') }}
        </n-button>
        <n-button v-else type="primary" @click="handleCloseExportProgressDialog">{{
          t('common.done')
        }}</n-button>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showImportProgressDialog"
      preset="dialog"
      :title="t('settings.data.importInProgress')"
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
          {{ t('common.cancel') }}
        </n-button>
        <n-button v-else type="primary" @click="handleCloseImportProgressDialog">{{
          t('common.done')
        }}</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NButton,
  NCard,
  NModal,
  NInput,
  NInputOtp,
  NProgress,
  NSelect,
  NSpace,
  NSwitch,
  useDialog
} from 'naive-ui'
import {
  ThemeAccent,
  ThemeMode,
  THEME_ACCENT_PALETTES,
  useThemeStore
} from '@renderer/stores/themes'
import {
  buildPrivacyManualLockShortcutFromEvent,
  DEFAULT_PRIVACY_MANUAL_LOCK_SHORTCUT,
  isModifierOnlyKey,
  normalizePrivacyManualLockShortcut,
  isValidPrivacyPassword,
  type PrivacyAuthMethod,
  PRIVACY_IDLE_LOCK_MINUTE_OPTIONS,
  usePrivacyStore
} from '@renderer/stores/privacy'
import {
  buildDisguiseShortcutFromEvent,
  DEFAULT_DISGUISE_SHORTCUT,
  isModifierOnlyKey as isDisguiseModifierOnlyKey,
  useDisguiseStore
} from '@renderer/stores/disguise'
import { useLocaleStore } from '@renderer/stores/locale'
import type { LocalePreference } from '@renderer/i18n'
import type {
  DataTransferProgress,
  DataTransferResult,
  UpdateDownloadProgress
} from '../../../../types/api'

interface AppInfo {
  name: string
  version: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

interface AccentOption {
  value: ThemeAccent
  label: string
  color: string
}

const theme = useThemeStore()
const privacy = usePrivacyStore()
const disguise = useDisguiseStore()
const localeStore = useLocaleStore()
const router = useRouter()
const { t } = useI18n()
const OTP_LENGTH = 6
const privacyIdleMinuteOptions = computed(() =>
  PRIVACY_IDLE_LOCK_MINUTE_OPTIONS.map((minutes) => ({
    label: t('common.minutes', { count: minutes }),
    value: minutes
  }))
)
const accentOptions: AccentOption[] = [
  {
    value: ThemeAccent.Green,
    label: t('settings.accents.green'),
    color: THEME_ACCENT_PALETTES[ThemeAccent.Green].primaryColor
  },
  {
    value: ThemeAccent.Blue,
    label: t('settings.accents.blue'),
    color: THEME_ACCENT_PALETTES[ThemeAccent.Blue].primaryColor
  },
  {
    value: ThemeAccent.Black,
    label: t('settings.accents.black'),
    color: THEME_ACCENT_PALETTES[ThemeAccent.Black].primaryColor
  },
  {
    value: ThemeAccent.Orange,
    label: t('settings.accents.orange'),
    color: THEME_ACCENT_PALETTES[ThemeAccent.Orange].primaryColor
  },
  {
    value: ThemeAccent.Red,
    label: t('settings.accents.red'),
    color: THEME_ACCENT_PALETTES[ThemeAccent.Red].primaryColor
  },
  {
    value: ThemeAccent.Purple,
    label: t('settings.accents.purple'),
    color: THEME_ACCENT_PALETTES[ThemeAccent.Purple].primaryColor
  },
  {
    value: ThemeAccent.Teal,
    label: t('settings.accents.teal'),
    color: THEME_ACCENT_PALETTES[ThemeAccent.Teal].primaryColor
  }
]
const visibleAccentOptions = computed(() =>
  theme.isDark
    ? accentOptions.filter((option) => option.value !== ThemeAccent.Black)
    : accentOptions
)
const localePreferenceOptions = computed(() => [
  { label: t('settings.followSystem'), value: 'system' as LocalePreference },
  { label: '中文', value: 'zh-CN' as LocalePreference },
  { label: 'English', value: 'en-US' as LocalePreference },
  { label: '日本語', value: 'ja-JP' as LocalePreference },
  { label: '한국어', value: 'ko-KR' as LocalePreference }
])
const localeSaving = ref(false)
const checkingUpdate = ref(false)
const updateMessage = ref('')
const updateMessageType = ref<'success' | 'error' | 'info'>('info')
const hasUpdate = ref(false)
const downloading = ref(false)
const cancelingUpdateDownload = ref(false)
const downloadProgress = ref(0)
const downloadedBytes = ref(0)
const totalBytes = ref(0)
const downloaded = ref(false)
const exportingData = ref(false)
const importingData = ref(false)
const dataMessage = ref('')
const dataMessageType = ref<'success' | 'error' | 'info'>('info')
const showExportProgressDialog = ref(false)
const exportProgress = ref(0)
const exportProgressMessage = ref(t('settings.data.preparingExport'))
const exportTransferDone = ref(false)
const exportCanceling = ref(false)
const showImportProgressDialog = ref(false)
const importProgress = ref(0)
const importProgressMessage = ref(t('settings.data.preparingImport'))
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
const disguiseLoading = ref(false)
const privacyMessage = ref('')
const privacyMessageType = ref<'success' | 'error' | 'info'>('info')
const showPasswordModal = ref(false)
const passwordModalMode = ref<'setup' | 'reset' | 'disable'>('setup')
const showWindowsPasswordModal = ref(false)
const windowsPasswordModalMode = ref<'enable' | 'disable'>('disable')
const windowsPasswordForDisable = ref('')
const windowsPasswordStatus = ref<'error' | undefined>(undefined)
const currentPassword = ref<string[]>([])
const newPassword = ref<string[]>([])
const confirmPassword = ref<string[]>([])
const currentPasswordStatus = ref<'error' | undefined>(undefined)
const newPasswordStatus = ref<'error' | undefined>(undefined)
const confirmPasswordStatus = ref<'error' | undefined>(undefined)
const pendingEnableAfterSet = ref(false)
const pendingAuthMethodAfterSet = ref<PrivacyAuthMethod | null>(null)
const removeUpdateListeners: Array<() => void> = []
const dialog = useDialog()
const currentPasswordValue = computed(() => currentPassword.value.join(''))
const newPasswordValue = computed(() => newPassword.value.join(''))
const confirmPasswordValue = computed(() => confirmPassword.value.join(''))
const downloadProgressText = computed(() =>
  t('settings.about.downloadProgressDetail', {
    transferred: formatFileSize(downloadedBytes.value),
    total: formatFileSize(totalBytes.value)
  })
)
const backupPasswordModalTitle = computed(() =>
  backupPasswordMode.value === 'export'
    ? t('settings.data.exportPasswordTitle')
    : t('settings.data.importPasswordTitle')
)
const backupPasswordModalDescription = computed(() =>
  backupPasswordMode.value === 'export'
    ? t('settings.data.exportPasswordDesc')
    : t('settings.data.importPasswordDesc')
)
const privacyAuthMethodOptions = computed(() => {
  const options: Array<{ label: string; value: PrivacyAuthMethod }> = [
    { label: t('settings.privacy.pinOption'), value: 'pin' }
  ]

  if (privacy.isWindowsPasswordSupported) {
    options.push({ label: t('settings.privacy.windowsOption'), value: 'windows' })
  }

  return options
})

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

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '--'

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const fractionDigits = unitIndex === 0 ? 0 : 1
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

function isUpdateDownloadCanceledError(error: unknown): boolean {
  const message = unwrapIpcErrorMessage(error).toLowerCase()
  return (
    message.includes('cancel') ||
    message.includes('abort') ||
    message.includes('取消') ||
    message.includes('キャンセル') ||
    message.includes('취소')
  )
}

onMounted(() => {
  loadAppInfo()

  // 监听下载进度
  removeUpdateListeners.push(
    window.api.onDownloadProgress((progress: UpdateDownloadProgress) => {
      downloadProgress.value = Math.max(0, Math.min(100, Math.round(progress.percent)))
      downloadedBytes.value = Math.max(0, Math.round(progress.transferred))
      totalBytes.value = Math.max(0, Math.round(progress.total))
    })
  )

  // 监听下载取消
  removeUpdateListeners.push(
    window.api.onUpdateDownloadCanceled(() => {
      downloading.value = false
      cancelingUpdateDownload.value = false
      downloaded.value = false
      updateMessage.value = t('settings.about.downloadCanceled')
      updateMessageType.value = 'info'
    })
  )

  // 监听下载完成
  removeUpdateListeners.push(
    window.api.onUpdateDownloaded(() => {
      downloading.value = false
      cancelingUpdateDownload.value = false
      downloaded.value = true
      updateMessage.value = t('settings.about.downloaded')
      updateMessageType.value = 'success'
    })
  )

  removeUpdateListeners.push(
    window.api.onExportProgress((progress: DataTransferProgress) => {
      if (!exportingData.value) return
      showExportProgressDialog.value = true
      exportProgress.value = Math.max(0, Math.min(100, Math.round(progress.percent)))
      exportProgressMessage.value = progress.message || t('settings.data.exporting')
    })
  )

  removeUpdateListeners.push(
    window.api.onImportProgress((progress: DataTransferProgress) => {
      if (!importingData.value) return
      showImportProgressDialog.value = true
      importProgress.value = Math.max(0, Math.min(100, Math.round(progress.percent)))
      importProgressMessage.value = progress.message || t('settings.data.importing')
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

const handleAccentChange = (accent: ThemeAccent): void => {
  theme.setAccent(accent)
}

const handleOpenAISettings = (): void => {
  router.push('/settings/ai').catch((error) => {
    console.error('打开 AI 设置页面失败:', error)
  })
}

const handleLocalePreferenceChange = async (value: string | number | null): Promise<void> => {
  if (
    value !== 'system' &&
    value !== 'zh-CN' &&
    value !== 'en-US' &&
    value !== 'ja-JP' &&
    value !== 'ko-KR'
  ) {
    return
  }
  if (localeSaving.value || value === localeStore.preference) return

  localeSaving.value = true
  try {
    await localeStore.setPreference(value)
  } catch (error) {
    console.error('更新语言设置失败:', error)
  } finally {
    localeSaving.value = false
  }
}

const passwordModalTitle = computed(() => {
  if (passwordModalMode.value === 'setup') return t('settings.privacy.modal.setupTitle')
  if (passwordModalMode.value === 'disable') return t('settings.privacy.modal.disableTitle')
  return t('settings.privacy.modal.resetTitle')
})

const passwordModalDescription = computed(() => {
  if (passwordModalMode.value === 'setup') {
    if (pendingAuthMethodAfterSet.value === 'pin' && privacy.authMethod !== 'pin') {
      return t('settings.privacy.modal.setupSwitchDesc')
    }
    return t('settings.privacy.modal.setupDesc')
  }
  if (passwordModalMode.value === 'disable') return t('settings.privacy.modal.disableDesc')
  return t('settings.privacy.modal.resetDesc')
})

const windowsPasswordModalTitle = computed(() =>
  windowsPasswordModalMode.value === 'enable'
    ? t('settings.privacy.modal.windowsEnableTitle')
    : t('settings.privacy.modal.windowsDisableTitle')
)

const windowsPasswordModalDescription = computed(() =>
  windowsPasswordModalMode.value === 'enable'
    ? t('settings.privacy.modal.windowsEnableDesc')
    : t('settings.privacy.modal.windowsDisableDesc')
)

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

const handleWindowsPasswordInput = (value: string): void => {
  windowsPasswordForDisable.value = value
  windowsPasswordStatus.value = undefined
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

const resetWindowsPasswordModalForm = (): void => {
  windowsPasswordForDisable.value = ''
  windowsPasswordStatus.value = undefined
}

const openPasswordModal = (
  mode: 'setup' | 'reset' | 'disable',
  pendingEnable = false,
  pendingAuthMethod: PrivacyAuthMethod | null = null
): void => {
  passwordModalMode.value = mode
  pendingEnableAfterSet.value = pendingEnable
  pendingAuthMethodAfterSet.value = pendingAuthMethod
  resetPasswordModalForm()
  showPasswordModal.value = true
}

const handleClosePasswordModal = (): void => {
  showPasswordModal.value = false
  pendingEnableAfterSet.value = false
  pendingAuthMethodAfterSet.value = null
  resetPasswordModalForm()
}

const openWindowsPasswordModal = (mode: 'enable' | 'disable'): void => {
  windowsPasswordModalMode.value = mode
  resetWindowsPasswordModalForm()
  showWindowsPasswordModal.value = true
}

const handleCloseWindowsPasswordModal = (): void => {
  showWindowsPasswordModal.value = false
  windowsPasswordModalMode.value = 'disable'
  resetWindowsPasswordModalForm()
}

const enablePrivacy = async (): Promise<void> => {
  if (privacyLoading.value) return

  privacyLoading.value = true
  try {
    await privacy.enablePrivacy()
    privacyMessage.value = t('settings.privacy.enabledSuccess')
    privacyMessageType.value = 'success'
  } catch (error) {
    console.error('开启隐私保护失败:', error)
    privacyMessage.value = t('settings.data.openFailedWithReason', { reason: String(error) })
    privacyMessageType.value = 'error'
  } finally {
    privacyLoading.value = false
  }
}

const handlePrivacyToggle = (value: boolean): void => {
  if (value) {
    if (privacy.authMethod === 'pin' && !privacy.hasPassword) {
      openPasswordModal('setup', true)
      return
    }
    if (privacy.authMethod === 'windows') {
      openWindowsPasswordModal('enable')
      return
    }
    void enablePrivacy()
    return
  }
  if (privacy.usesWindowsPassword) {
    openWindowsPasswordModal('disable')
    return
  }
  openPasswordModal('disable')
}

const handleOpenPasswordModal = (): void => {
  openPasswordModal(privacy.hasPassword ? 'reset' : 'setup')
}

const handlePrivacyAuthMethodChange = async (value: string | number | null): Promise<void> => {
  if (value !== 'pin' && value !== 'windows') return
  if (privacyLoading.value || value === privacy.authMethod) return

  if (value === 'pin' && !privacy.hasPassword) {
    openPasswordModal('setup', privacy.isEnabled, value)
    return
  }

  privacyLoading.value = true
  try {
    await privacy.setAuthMethod(value)
    privacyMessage.value =
      value === 'windows'
        ? t('settings.privacy.switchToWindows')
        : t('settings.privacy.switchToPin')
    privacyMessageType.value = 'success'
  } catch (error) {
    console.error('更新隐私解锁方式失败:', error)
    privacyMessage.value = t('settings.data.updateFailedWithReason', { reason: String(error) })
    privacyMessageType.value = 'error'
  } finally {
    privacyLoading.value = false
  }
}

const handlePrivacyIdleMinuteChange = async (value: number | null): Promise<void> => {
  if (value === null || privacyLoading.value || value === privacy.idleLockMinutes) return

  privacyLoading.value = true
  try {
    await privacy.setIdleLockMinutes(value)
    privacyMessage.value = t('settings.privacy.idleLockUpdated')
    privacyMessageType.value = 'success'
  } catch (error) {
    console.error('更新自动锁定时长失败:', error)
    privacyMessage.value = t('settings.data.updateFailedWithReason', { reason: String(error) })
    privacyMessageType.value = 'error'
  } finally {
    privacyLoading.value = false
  }
}

const updateManualLockShortcut = async (shortcut: string): Promise<void> => {
  if (privacyLoading.value || shortcut === privacy.manualLockShortcut) return

  privacyLoading.value = true
  try {
    await privacy.setManualLockShortcut(shortcut)
    privacyMessage.value = t('settings.privacy.manualLockShortcutUpdated', { shortcut })
    privacyMessageType.value = 'success'
  } catch (error) {
    console.error('更新手动锁定快捷键失败:', error)
    privacyMessage.value = t('settings.data.updateFailedWithReason', { reason: String(error) })
    privacyMessageType.value = 'error'
  } finally {
    privacyLoading.value = false
  }
}

const handleManualLockShortcutInput = (event: KeyboardEvent): void => {
  event.preventDefault()
  event.stopPropagation()

  const shortcut = buildPrivacyManualLockShortcutFromEvent(event)
  if (!shortcut) {
    if (!isModifierOnlyKey(event.key)) {
      privacyMessage.value = t('settings.privacy.manualLockShortcutInvalid')
      privacyMessageType.value = 'error'
    }
    return
  }

  void updateManualLockShortcut(shortcut)
}

const handleResetManualLockShortcut = (): void => {
  void updateManualLockShortcut(DEFAULT_PRIVACY_MANUAL_LOCK_SHORTCUT)
}

function reloadForDisguiseMode(): void {
  window.location.reload()
}

const handleDisguiseToggle = async (value: boolean): Promise<void> => {
  if (disguiseLoading.value || value === disguise.isEnabled) return

  disguiseLoading.value = true
  try {
    await disguise.setEnabled(value)
    privacyMessage.value = value
      ? t('settings.privacy.disguiseEnabledSuccess')
      : t('settings.privacy.disguiseDisabledSuccess')
    privacyMessageType.value = 'success'
    reloadForDisguiseMode()
  } catch (error) {
    console.error('切换伪装模式失败:', error)
    privacyMessage.value = t('settings.data.updateFailedWithReason', {
      reason: unwrapIpcErrorMessage(error)
    })
    privacyMessageType.value = 'error'
  } finally {
    disguiseLoading.value = false
  }
}

const handleDisguiseAutoEnableOnLaunchToggle = async (value: boolean): Promise<void> => {
  if (disguiseLoading.value || value === disguise.autoEnableOnLaunch) return

  disguiseLoading.value = true
  try {
    await disguise.setAutoEnableOnLaunch(value)
    privacyMessage.value = t('settings.privacy.disguiseAutoEnableUpdated')
    privacyMessageType.value = 'success'
  } catch (error) {
    console.error('更新伪装模式自动启动失败:', error)
    privacyMessage.value = t('settings.data.updateFailedWithReason', {
      reason: unwrapIpcErrorMessage(error)
    })
    privacyMessageType.value = 'error'
  } finally {
    disguiseLoading.value = false
  }
}

const updateDisguiseShortcut = async (shortcut: string): Promise<void> => {
  if (disguiseLoading.value || shortcut === disguise.shortcut) return

  if (shortcut === normalizePrivacyManualLockShortcut(privacy.manualLockShortcut)) {
    privacyMessage.value = t('settings.privacy.disguiseShortcutConflict')
    privacyMessageType.value = 'error'
    return
  }

  disguiseLoading.value = true
  try {
    await disguise.setShortcut(shortcut)
    privacyMessage.value = t('settings.privacy.disguiseShortcutUpdated', { shortcut })
    privacyMessageType.value = 'success'
  } catch (error) {
    console.error('更新伪装模式快捷键失败:', error)
    privacyMessage.value = t('settings.data.updateFailedWithReason', {
      reason: unwrapIpcErrorMessage(error)
    })
    privacyMessageType.value = 'error'
  } finally {
    disguiseLoading.value = false
  }
}

const handleDisguiseShortcutInput = (event: KeyboardEvent): void => {
  event.preventDefault()
  event.stopPropagation()

  const shortcut = buildDisguiseShortcutFromEvent(event)
  if (!shortcut) {
    if (!isDisguiseModifierOnlyKey(event.key)) {
      privacyMessage.value = t('settings.privacy.disguiseShortcutInvalid')
      privacyMessageType.value = 'error'
    }
    return
  }

  void updateDisguiseShortcut(shortcut)
}

const handleResetDisguiseShortcut = (): void => {
  void updateDisguiseShortcut(DEFAULT_DISGUISE_SHORTCUT)
}

const handleRegenerateDisguiseData = async (): Promise<void> => {
  if (disguiseLoading.value || !disguise.isEnabled) return

  disguiseLoading.value = true
  try {
    await disguise.regenerateData()
    privacyMessage.value = t('settings.privacy.disguiseDataRegenerated')
    privacyMessageType.value = 'success'
    reloadForDisguiseMode()
  } catch (error) {
    console.error('重建伪装数据失败:', error)
    privacyMessage.value = t('settings.data.updateFailedWithReason', {
      reason: unwrapIpcErrorMessage(error)
    })
    privacyMessageType.value = 'error'
  } finally {
    disguiseLoading.value = false
  }
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
      privacyMessage.value = t('settings.privacy.disabledSuccess')
      privacyMessageType.value = 'success'
      handleClosePasswordModal()
    } catch (error) {
      console.error('关闭隐私保护失败:', error)
      if (String(error).includes('原密码错误')) {
        currentPasswordStatus.value = 'error'
      } else {
        privacyMessage.value = t('settings.data.closeFailedWithReason', { reason: String(error) })
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
      privacyMessage.value = t('settings.privacy.passwordResetSuccess')
    } else {
      await privacy.setPassword(newPasswordValue.value)
      if (
        pendingAuthMethodAfterSet.value &&
        pendingAuthMethodAfterSet.value !== privacy.authMethod
      ) {
        await privacy.setAuthMethod(pendingAuthMethodAfterSet.value)
      }
      if (pendingEnableAfterSet.value && !privacy.isEnabled) {
        await privacy.enablePrivacy()
        privacyMessage.value = t('settings.privacy.passwordSetAndEnabled')
      } else if (pendingAuthMethodAfterSet.value === 'pin') {
        privacyMessage.value = t('settings.privacy.passwordSetAndSwitched')
      } else {
        privacyMessage.value = t('settings.privacy.passwordSetSuccess')
      }
    }

    privacyMessageType.value = 'success'
    handleClosePasswordModal()
  } catch (error) {
    console.error('保存隐私密码失败:', error)
    if (String(error).includes('原密码错误')) {
      currentPasswordStatus.value = 'error'
    } else {
      privacyMessage.value = t('settings.data.saveFailedWithReason', { reason: String(error) })
      privacyMessageType.value = 'error'
    }
  } finally {
    privacyLoading.value = false
  }
}

const handleSubmitWindowsPasswordModal = async (): Promise<void> => {
  if (privacyLoading.value) return

  windowsPasswordStatus.value = undefined
  if (!windowsPasswordForDisable.value) {
    windowsPasswordStatus.value = 'error'
    return
  }

  privacyLoading.value = true
  try {
    const verified = await window.api.verifyWindowsPassword(windowsPasswordForDisable.value)
    if (!verified) {
      windowsPasswordStatus.value = 'error'
      return
    }

    if (windowsPasswordModalMode.value === 'enable') {
      await privacy.enablePrivacy()
      privacyMessage.value = t('settings.privacy.enabledSuccess')
    } else {
      await privacy.disablePrivacy()
      privacyMessage.value = t('settings.privacy.disabledSuccess')
    }
    privacyMessageType.value = 'success'
    handleCloseWindowsPasswordModal()
  } catch (error) {
    console.error('处理隐私保护失败:', error)
    privacyMessage.value = t('settings.data.failedWithReason', {
      action:
        windowsPasswordModalMode.value === 'enable'
          ? t('settings.privacy.modal.windowsEnableTitle')
          : t('settings.privacy.modal.windowsDisableTitle'),
      reason: String(error)
    })
    privacyMessageType.value = 'error'
  } finally {
    privacyLoading.value = false
  }
}

const handleCheckUpdate = async (): Promise<void> => {
  checkingUpdate.value = true
  updateMessage.value = ''
  hasUpdate.value = false
  downloading.value = false
  cancelingUpdateDownload.value = false
  downloadProgress.value = 0
  downloadedBytes.value = 0
  totalBytes.value = 0
  downloaded.value = false
  try {
    const result = await window.api.checkForUpdates()
    if (result.success) {
      if (result.updateInfo) {
        updateMessage.value = t('settings.about.updateFound', {
          version: result.updateInfo.version
        })
        updateMessageType.value = 'success'
        hasUpdate.value = true
      } else {
        updateMessage.value = t('settings.about.latest')
        updateMessageType.value = 'info'
      }
    } else {
      updateMessage.value = t('settings.data.checkUpdateFailedWithReason', {
        reason: result.error || t('settings.data.unknownError')
      })
      updateMessageType.value = 'error'
    }
  } catch (error) {
    updateMessage.value = t('settings.data.checkUpdateFailedWithReason', {
      reason: unwrapIpcErrorMessage(error)
    })
    updateMessageType.value = 'error'
  } finally {
    checkingUpdate.value = false
  }
}

function unwrapIpcErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const prefix = "Error invoking remote method '"
  if (!raw.startsWith(prefix)) return raw
  const separator = raw.indexOf(': ')
  if (separator === -1) return raw
  return raw.slice(separator + 2)
}

const handleDownloadUpdate = async (): Promise<void> => {
  downloading.value = true
  cancelingUpdateDownload.value = false
  downloadProgress.value = 0
  downloadedBytes.value = 0
  totalBytes.value = 0
  downloaded.value = false
  updateMessage.value = t('settings.about.downloading')
  updateMessageType.value = 'info'
  try {
    await window.api.downloadUpdate()
  } catch (error) {
    downloading.value = false
    cancelingUpdateDownload.value = false
    if (isUpdateDownloadCanceledError(error)) {
      updateMessage.value = t('settings.about.downloadCanceled')
      updateMessageType.value = 'info'
      return
    }
    updateMessage.value = t('settings.data.downloadUpdateFailedWithReason', {
      reason: unwrapIpcErrorMessage(error)
    })
    updateMessageType.value = 'error'
  }
}

const handleCancelUpdateDownload = async (): Promise<void> => {
  if (!downloading.value || cancelingUpdateDownload.value) return

  cancelingUpdateDownload.value = true
  updateMessage.value = t('settings.about.cancelingDownload')
  updateMessageType.value = 'info'

  try {
    const canceled = await window.api.cancelUpdateDownload()
    if (!canceled) {
      downloading.value = false
      cancelingUpdateDownload.value = false
      updateMessage.value = t('settings.about.downloadCanceled')
      updateMessageType.value = 'info'
    }
  } catch (error) {
    cancelingUpdateDownload.value = false
    updateMessage.value = t('settings.data.downloadUpdateFailedWithReason', {
      reason: unwrapIpcErrorMessage(error)
    })
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

function resolveTransferErrorMessage(
  action: 'export' | 'import',
  result: DataTransferResult
): string {
  const actionLabel =
    action === 'export' ? t('settings.data.exportAction') : t('settings.data.importAction')

  if (!result.errorCode) {
    return t('settings.data.failedWithReason', {
      action: actionLabel,
      reason: result.error || t('settings.data.unknownError')
    })
  }

  if (result.errorCode === 'VALIDATION_FAILED') {
    return (
      result.error ||
      t('settings.data.backupPasswordTooShort', { count: MIN_BACKUP_PASSWORD_LENGTH })
    )
  }
  if (result.errorCode === 'UNSUPPORTED_BACKUP_FORMAT') {
    return result.error || t('settings.data.unsupportedBackup')
  }
  if (result.errorCode === 'MISSING_KEY_ENVELOPE') {
    return result.error || t('settings.data.missingEnvelope')
  }
  if (result.errorCode === 'WRONG_BACKUP_PASSWORD') {
    return t('settings.data.wrongBackupPassword')
  }
  if (result.errorCode === 'TRANSFER_IN_PROGRESS') {
    return result.error || t('settings.data.transferInProgress')
  }
  return t('settings.data.failedWithReason', {
    action: actionLabel,
    reason: result.error || t('settings.data.unknownError')
  })
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
  exportProgressMessage.value = t('settings.data.cancelingExport')
  try {
    await window.api.cancelDataTransfer()
  } finally {
    exportCanceling.value = false
  }
}

const handleCancelImportTransfer = async (): Promise<void> => {
  if (!importingData.value || importTransferDone.value || importCanceling.value) return
  importCanceling.value = true
  importProgressMessage.value = t('settings.data.cancelingImport')
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
  exportProgressMessage.value = t('settings.data.preparingExport')
  dataMessage.value = t('settings.data.exporting')
  dataMessageType.value = 'info'

  try {
    const result = await window.api.exportData({ backupPassword: backupPasswordValue })
    if (result.canceled) {
      exportProgress.value = 100
      exportProgressMessage.value = t('settings.data.exportCanceled')
      dataMessage.value = t('settings.data.canceledExportMessage')
      dataMessageType.value = 'info'
      return
    }

    if (result.success) {
      exportProgress.value = 100
      exportProgressMessage.value = t('settings.data.exportCompleted')
      dataMessage.value = t('settings.data.exportSuccessWithPath', { path: result.path })
      dataMessageType.value = 'success'
      return
    }

    exportProgress.value = 100
    exportProgressMessage.value = t('settings.data.exportFailed')
    dataMessage.value = resolveTransferErrorMessage('export', result)
    dataMessageType.value = 'error'
  } catch (error) {
    exportProgress.value = 100
    exportProgressMessage.value = t('settings.data.exportFailed')
    dataMessage.value = t('settings.data.failedWithReason', {
      action: t('settings.data.exportAction'),
      reason: String(error)
    })
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
  importProgressMessage.value = t('settings.data.preparingImport')
  dataMessage.value = t('settings.data.importing')
  dataMessageType.value = 'info'

  try {
    const result = await window.api.importData({ backupPassword: backupPasswordValue })
    if (result.canceled) {
      importProgress.value = 100
      importProgressMessage.value = t('settings.data.importCanceled')
      dataMessage.value = t('settings.data.canceledImportMessage')
      dataMessageType.value = 'info'
      return
    }

    if (result.success) {
      importProgress.value = 100
      importProgressMessage.value = t('settings.data.importCompleted')
      dataMessage.value = t('settings.data.importSuccessAndReload')
      dataMessageType.value = 'success'
      reloadAfterImportComplete.value = true
      return
    }

    importProgress.value = 100
    importProgressMessage.value = t('settings.data.importFailed')
    dataMessage.value = resolveTransferErrorMessage('import', result)
    dataMessageType.value = 'error'
  } catch (error) {
    importProgress.value = 100
    importProgressMessage.value = t('settings.data.importFailed')
    dataMessage.value = t('settings.data.failedWithReason', {
      action: t('settings.data.importAction'),
      reason: String(error)
    })
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
    title: t('settings.data.importConfirmTitle'),
    content: t('settings.data.importConfirmContent'),
    positiveText: t('settings.data.continueImport'),
    negativeText: t('common.cancel'),
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
  gap: 8px;
  padding: 12px;
  border-radius: 6px;
  font-size: 14px;
}

.update-message::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
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
  transition:
    box-shadow var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.settings-card:hover {
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
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

.accent-palette {
  width: min(360px, 100%);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.accent-chip {
  --accent-color: #18a058;
  border: 1px solid var(--n-border-color);
  border-radius: 50%;
  background: var(--n-color-modal);
  width: 30px;
  height: 30px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  align-items: center;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.accent-chip:hover {
  transform: translateY(-1px);
}

.accent-chip--active {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 1px var(--accent-color) inset;
}

.accent-chip-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent-color);
}

.privacy-actions {
  width: min(240px, 100%);
  display: flex;
  gap: 10px;
}

.privacy-actions--end {
  justify-content: flex-end;
}

.privacy-actions--shortcut {
  width: min(320px, 100%);
}

.privacy-shortcut-input {
  width: 80px;
  max-width: 100%;
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

.update-message.success {
  background-color: var(--app-accent-12, rgba(24, 160, 88, 0.12));
  color: var(--app-accent-color, #18a058);
}

.privacy-update-message.success {
  background-color: var(--app-accent-12, rgba(24, 160, 88, 0.12));
  border: 1px solid var(--app-accent-20, rgba(24, 160, 88, 0.2));
  color: var(--app-accent-color, #18a058);
}

.update-message.error {
  background-color: rgba(208, 48, 80, 0.1);
  color: #d03050;
}

.update-message.info {
  background-color: rgba(42, 148, 229, 0.1);
  color: #2a94e5;
}

.update-message.is-success::before {
  animation: message-dot-pulse var(--motion-normal) var(--ease-enter);
}

.update-message.is-error {
  animation: message-shake var(--motion-fast) var(--ease-standard) 2;
}

.settings-message-enter-active,
.settings-message-leave-active {
  transition:
    opacity var(--motion-normal) var(--ease-standard),
    transform var(--motion-normal) var(--ease-enter);
}

.settings-message-enter-from,
.settings-message-leave-to {
  opacity: 0;
  transform: translateY(calc(var(--motion-distance-sm) * -1));
}

.download-progress {
  padding: 8px 0;
}

.download-progress-meta {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.progress-message {
  font-size: 13px;
  color: var(--n-text-color-2);
  word-break: break-word;
}

@keyframes message-dot-pulse {
  0% {
    transform: scale(0.65);
    opacity: 0.55;
  }
  70% {
    transform: scale(1.2);
    opacity: 1;
  }
  100% {
    transform: scale(1);
  }
}

@keyframes message-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-2px);
  }
  75% {
    transform: translateX(2px);
  }
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

  .download-progress-meta {
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
  }

  .accent-palette {
    width: 100%;
    justify-content: flex-start;
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
