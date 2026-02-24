<script setup lang="ts">
import {
  NCard,
  NConfigProvider,
  NDialogProvider,
  NInputOtp,
  NLayout,
  NLayoutContent
} from 'naive-ui'
import { computed, ref, watch } from 'vue'
import TitleBar from './components/TitleBar.vue'
import AppSidebar from './components/AppSidebar.vue'
import AppHeader from './components/AppHeader.vue'
import { useThemeStore } from './stores/themes'
import { isValidPrivacyPassword, usePrivacyStore } from './stores/privacy'

const theme = useThemeStore()
const privacy = usePrivacyStore()
const OTP_LENGTH = 6
const password = ref<string[]>([])
const unlockError = ref('')
const unlocking = ref(false)
const passwordValue = computed(() => password.value.join(''))
const unlockStatus = computed<'error' | undefined>(() => (unlockError.value ? 'error' : undefined))

const showLockOverlay = computed(() => privacy.isInitialized && privacy.isLocked)

function applyAccentStyleVars(vars: Record<string, string>): void {
  for (const [key, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, value)
  }
}

function allowDigitInput(char: string): boolean {
  return /^\d$/.test(char)
}

function handlePasswordInput(value: string[]): void {
  password.value = value
  if (unlockError.value) {
    unlockError.value = ''
  }
}

function handlePasswordFinish(value: string[]): void {
  password.value = value
  void handleUnlock()
}

async function handleUnlock(): Promise<void> {
  if (unlocking.value) return

  if (!isValidPrivacyPassword(passwordValue.value)) {
    unlockError.value = '请输入6位数字密码'
    return
  }

  unlocking.value = true
  try {
    const ok = await privacy.unlockWithPassword(passwordValue.value)
    if (!ok) {
      unlockError.value = '密码错误，请重试'
      password.value = []
      return
    }
    password.value = []
    unlockError.value = ''
  } catch (error) {
    console.error('解锁失败:', error)
    unlockError.value = '解锁失败，请稍后重试'
  } finally {
    unlocking.value = false
  }
}

// 监听主题变化,切换 html 的 dark 类
watch(
  () => theme.isDark,
  (isDark) => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },
  { immediate: true }
)

watch(
  () => theme.accentStyleVars,
  (vars) => {
    applyAccentStyleVars(vars)
  },
  { immediate: true }
)
</script>

<template>
  <n-config-provider :theme="theme.getTheme" :theme-overrides="theme.themeOverrides">
    <n-dialog-provider>
      <div class="app-shell">
        <TitleBar />
        <n-layout has-sider position="absolute" style="top: 32px">
          <AppSidebar />

          <n-layout>
            <AppHeader />
            <n-layout-content class="main-content">
              <router-view v-if="privacy.isUnlocked" />
            </n-layout-content>
          </n-layout>
        </n-layout>

        <div v-if="showLockOverlay" class="privacy-lock-overlay">
          <n-card class="privacy-lock-card" :bordered="false">
            <h2 class="privacy-lock-title">隐私保护</h2>
            <p class="privacy-lock-description">请输入 6 位数字密码以解锁应用</p>

            <div class="privacy-lock-form">
              <n-input-otp
                :value="password"
                :length="OTP_LENGTH"
                mask
                :allow-input="allowDigitInput"
                size="large"
                :status="unlockStatus"
                @update:value="handlePasswordInput"
                @finish="handlePasswordFinish"
              />
            </div>
          </n-card>
        </div>
      </div>
    </n-dialog-provider>
  </n-config-provider>
</template>

<style>
/* 全局重置 */
html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  font-family:
    v-sans,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

#app {
  height: 100%;
  overflow: hidden;
}

.app-shell {
  height: 100%;
  overflow: hidden;
}

/* 禁止 Naive UI 布局组件的滚动 */
.n-layout,
.n-layout-scroll-container {
  overflow: hidden !important;
}

.main-content {
  height: calc(100vh - 92px); /* 减去 TitleBar(32px) + Header(60px) 高度 */
  overflow: hidden;
}

/* 初始隐藏滚动条 */
*::-webkit-scrollbar {
  width: var(--scrollbar-size);
  height: var(--scrollbar-size);
}

.privacy-lock-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(14, 18, 24, 0.28);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.privacy-lock-card {
  width: min(420px, 100%);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
}

.privacy-lock-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
}

.privacy-lock-description {
  margin: 10px 0 0;
  font-size: 14px;
  color: var(--n-text-color-3);
}

.privacy-lock-form {
  margin-top: 18px;
  display: flex;
  justify-content: center;
}

@media (max-width: 768px) {
  .privacy-lock-form {
    justify-content: center;
  }
}
</style>
