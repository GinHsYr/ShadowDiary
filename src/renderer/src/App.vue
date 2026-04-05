<script setup lang="ts">
import {
  NButton,
  NCard,
  NConfigProvider,
  NDialogProvider,
  NInput,
  NInputOtp,
  NLayout,
  NLayoutContent,
  NSkeleton,
  dateEnUS,
  dateJaJP,
  dateKoKR,
  dateZhCN,
  enUS,
  jaJP,
  koKR,
  zhCN
} from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import TitleBar from './components/TitleBar.vue'
import AppSidebar from './components/AppSidebar.vue'
import AppHeader from './components/AppHeader.vue'
import { useThemeStore } from './stores/themes'
import {
  isPrivacyManualLockShortcutMatch,
  isValidPrivacyPassword,
  usePrivacyStore
} from './stores/privacy'
import { isDisguiseShortcutMatch, useDisguiseStore } from './stores/disguise'
import { useStartupStore } from './stores/startup'

const { t, locale } = useI18n()
const theme = useThemeStore()
const privacy = usePrivacyStore()
const disguise = useDisguiseStore()
const startup = useStartupStore()
const route = useRoute()
const OTP_LENGTH = 6
const USER_ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const
  // 调试开关：设置 VITE_DEBUG_BYPASS_PRIVACY_LOCK=1 可临时跳过隐私锁屏流程。
const DEBUG_BYPASS_PRIVACY_LOCK = import.meta.env.VITE_DEBUG_BYPASS_PRIVACY_LOCK === '1'
const password = ref<string[]>([])
const windowsPassword = ref('')
const unlockError = ref('')
const unlocking = ref(false)
const passwordValue = computed(() =>
  privacy.usesWindowsPassword ? windowsPassword.value : password.value.join('')
)
const unlockStatus = computed<'error' | undefined>(() => (unlockError.value ? 'error' : undefined))
let idleTimer: number | null = null
let lastActivityAt = Date.now()
let removeSystemLockListener: (() => void) | null = null
let removeBeforeQuitListener: (() => void) | null = null
let isHandlingBeforeQuit = false
let removeReducedMotionListener: (() => void) | null = null
const switchingDisguiseMode = ref(false)

type FlushableRouteView = {
  flushSave?: () => Promise<void>
}

const activeRouteViewRef = ref<FlushableRouteView | null>(null)
const routeTransitionName = ref('page-fade')
const previousNavOrder = ref<number | null>(null)
const systemPrefersReducedMotion = ref(false)

const showLockOverlay = computed(
  () => !DEBUG_BYPASS_PRIVACY_LOCK && privacy.isInitialized && privacy.isLocked
)
const canRenderUnlockedContent = computed(
  () => privacy.isInitialized && (DEBUG_BYPASS_PRIVACY_LOCK || privacy.isUnlocked)
)
const shouldReduceMotion = computed(() => systemPrefersReducedMotion.value || theme.isMotionReduced)
const naiveLocale = computed(() => {
  if (locale.value === 'en-US') return enUS
  if (locale.value === 'ja-JP') return jaJP
  if (locale.value === 'ko-KR') return koKR
  return zhCN
})
const naiveDateLocale = computed(() => {
  if (locale.value === 'en-US') return dateEnUS
  if (locale.value === 'ja-JP') return dateJaJP
  if (locale.value === 'ko-KR') return dateKoKR
  return dateZhCN
})

function getNavOrder(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function applyAccentStyleVars(vars: Record<string, string>): void {
  for (const [key, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, value)
  }
}

function setupReducedMotionListener(): void {
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const updateReducedMotionPreference = (): void => {
    systemPrefersReducedMotion.value = mediaQuery.matches
  }

  updateReducedMotionPreference()

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', updateReducedMotionPreference)
    removeReducedMotionListener = () =>
      mediaQuery.removeEventListener('change', updateReducedMotionPreference)
    return
  }

  mediaQuery.addListener(updateReducedMotionPreference)
  removeReducedMotionListener = () => mediaQuery.removeListener(updateReducedMotionPreference)
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

function handleWindowsPasswordInput(value: string): void {
  windowsPassword.value = value
  if (unlockError.value) {
    unlockError.value = ''
  }
}

function canAutoLockByPrivacy(): boolean {
   if (DEBUG_BYPASS_PRIVACY_LOCK) return false
  return privacy.isInitialized && privacy.isEnabled && privacy.hasCredential
}

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer)
    idleTimer = null
  }
}

function scheduleIdleLock(): void {
  clearIdleTimer()
  if (!canAutoLockByPrivacy() || privacy.isLocked) return

  const idleLockMs = privacy.idleLockMs
  const elapsed = Date.now() - lastActivityAt
  const remaining = idleLockMs - elapsed
  if (remaining <= 0) {
    privacy.lock()
    return
  }

  idleTimer = window.setTimeout(() => {
    idleTimer = null
    if (!canAutoLockByPrivacy() || privacy.isLocked) return
    if (Date.now() - lastActivityAt >= idleLockMs) {
      privacy.lock()
      return
    }
    scheduleIdleLock()
  }, remaining)
}

function recordActivity(): void {
  if (!canAutoLockByPrivacy() || privacy.isLocked) return
  lastActivityAt = Date.now()
  scheduleIdleLock()
}

function evaluateIdleLock(): void {
  if (!canAutoLockByPrivacy() || privacy.isLocked) {
    clearIdleTimer()
    return
  }

  if (Date.now() - lastActivityAt >= privacy.idleLockMs) {
    privacy.lock()
    clearIdleTimer()
    return
  }

  scheduleIdleLock()
}

function handleUserActivity(): void {
  recordActivity()
}

function handleWindowFocus(): void {
  evaluateIdleLock()
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    evaluateIdleLock()
  }
}

function handleManualLockShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.repeat || privacy.isLocked) return
  if (!canAutoLockByPrivacy()) return
  if (!isPrivacyManualLockShortcutMatch(event, privacy.manualLockShortcut)) return

  event.preventDefault()
  privacy.lock()
  clearIdleTimer()
}

function handleDisguiseModeShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.repeat || privacy.isLocked) return
  if (!disguise.isInitialized || switchingDisguiseMode.value) return
  if (!isDisguiseShortcutMatch(event, disguise.shortcut)) return

  event.preventDefault()
  switchingDisguiseMode.value = true

  void disguise
    .setEnabled(!disguise.isEnabled)
    .then(() => {
      window.location.reload()
    })
    .catch((error) => {
      console.error('切换伪装模式失败:', error)
      switchingDisguiseMode.value = false
    })
}

async function flushBeforeQuit(): Promise<void> {
  if (isHandlingBeforeQuit) return
  isHandlingBeforeQuit = true

  try {
    await activeRouteViewRef.value?.flushSave?.()
  } catch (error) {
    console.error('退出前保存失败:', error)
  } finally {
    window.api.notifyAppBeforeQuitDone()
  }
}

async function handleUnlock(): Promise<void> {
  if (unlocking.value) return

  if (privacy.usesWindowsPassword && !passwordValue.value) {
    unlockError.value = t('app.privacy.requireWindowsPassword')
    return
  }

  if (!privacy.usesWindowsPassword && !isValidPrivacyPassword(passwordValue.value)) {
    unlockError.value = t('app.privacy.requirePin')
    return
  }

  unlocking.value = true
  try {
    const ok = await privacy.unlockWithPassword(passwordValue.value)
    if (!ok) {
      unlockError.value = privacy.usesWindowsPassword
        ? t('app.privacy.windowsPasswordIncorrect')
        : t('app.privacy.pinIncorrect')
      password.value = []
      windowsPassword.value = ''
      return
    }
    password.value = []
    windowsPassword.value = ''
    unlockError.value = ''
  } catch (error) {
    console.error('解锁失败:', error)
    unlockError.value = t('app.privacy.unlockFailed')
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

watch(
  () => shouldReduceMotion.value,
  (reduced) => {
    document.documentElement.classList.toggle('reduced-motion', reduced)
  },
  { immediate: true }
)

watch(
  () =>
    [
      privacy.isInitialized,
      privacy.isEnabled,
      privacy.hasCredential,
      privacy.isLocked,
      privacy.idleLockMs
    ] as const,
  ([isInitialized, isEnabled, hasCredential, isLocked], previous) => {
    const shouldMonitor = isInitialized && isEnabled && hasCredential
    if (!shouldMonitor || isLocked) {
      clearIdleTimer()
      return
    }

    if (!previous || previous[3]) {
      lastActivityAt = Date.now()
    }

    scheduleIdleLock()
  },
  { immediate: true }
)

watch(
  () => route.fullPath,
  () => {
    const currentNavOrder = getNavOrder(route.meta.navOrder)
    const lastNavOrder = previousNavOrder.value

    if (lastNavOrder === null || currentNavOrder === null || currentNavOrder === lastNavOrder) {
      routeTransitionName.value = 'page-fade'
    } else {
      routeTransitionName.value =
        currentNavOrder > lastNavOrder ? 'page-slide-forward' : 'page-slide-back'
    }

    previousNavOrder.value = currentNavOrder
  },
  { immediate: true }
)

onMounted(() => {
  if (DEBUG_BYPASS_PRIVACY_LOCK && privacy.isLocked) {
    privacy.isLocked = false
  }
  setupReducedMotionListener()

  for (const eventName of USER_ACTIVITY_EVENTS) {
    window.addEventListener(eventName, handleUserActivity)
  }
  window.addEventListener('focus', handleWindowFocus)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  document.addEventListener('keydown', handleManualLockShortcut)
  document.addEventListener('keydown', handleDisguiseModeShortcut)

  removeSystemLockListener = window.api.onSystemLock(() => {
    if (!canAutoLockByPrivacy() || privacy.isLocked) return
    privacy.lock()
    clearIdleTimer()
  })
  removeBeforeQuitListener = window.api.onAppBeforeQuit(() => {
    void flushBeforeQuit()
  })

  evaluateIdleLock()
})

onBeforeUnmount(() => {
  if (removeReducedMotionListener) {
    removeReducedMotionListener()
    removeReducedMotionListener = null
  }

  for (const eventName of USER_ACTIVITY_EVENTS) {
    window.removeEventListener(eventName, handleUserActivity)
  }
  window.removeEventListener('focus', handleWindowFocus)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  document.removeEventListener('keydown', handleManualLockShortcut)
  document.removeEventListener('keydown', handleDisguiseModeShortcut)
  clearIdleTimer()

  if (removeSystemLockListener) {
    removeSystemLockListener()
    removeSystemLockListener = null
  }
  if (removeBeforeQuitListener) {
    removeBeforeQuitListener()
    removeBeforeQuitListener = null
  }
})
</script>

<template>
  <n-config-provider
    :theme="theme.getTheme"
    :theme-overrides="theme.themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
    <n-dialog-provider>
      <div class="app-shell" :class="{ 'app-shell--locked': showLockOverlay }">
        <div v-if="startup.isBooting" class="startup-skeleton">
          <div class="startup-skeleton-titlebar">
            <n-skeleton width="100%" height="32px" />
          </div>
          <div class="startup-skeleton-layout">
            <aside class="startup-skeleton-sidebar">
              <n-skeleton class="startup-skeleton-avatar" width="56px" height="56px" />
              <n-skeleton class="startup-skeleton-line" width="100%" height="12px" />
              <n-skeleton class="startup-skeleton-line" width="100%" height="12px" />
              <n-skeleton class="startup-skeleton-line" width="86%" height="12px" />
              <n-skeleton class="startup-skeleton-line" width="100%" height="12px" />
              <n-skeleton class="startup-skeleton-line" width="68%" height="12px" />
            </aside>
            <main class="startup-skeleton-main">
              <div class="startup-skeleton-header">
                <n-skeleton class="startup-skeleton-search" width="420px" height="34px" />
              </div>
              <div class="startup-skeleton-content">
                <n-skeleton class="startup-skeleton-card tall" width="100%" height="100%" />
                <n-skeleton class="startup-skeleton-card" width="100%" height="100%" />
                <n-skeleton class="startup-skeleton-card" width="100%" height="100%" />
              </div>
            </main>
          </div>
        </div>

        <template v-else>
          <TitleBar />
          <n-layout has-sider position="absolute" style="top: var(--app-title-bar-height)">
            <AppSidebar />

            <n-layout>
              <AppHeader />
              <n-layout-content class="main-content">
                <router-view
                  v-if="canRenderUnlockedContent"
                  v-slot="{ Component, route: currentRoute }"
                >
                  <transition :name="routeTransitionName" mode="out-in">
                    <div :key="currentRoute.fullPath" class="route-page">
                      <component :is="Component" ref="activeRouteViewRef" />
                    </div>
                  </transition>
                </router-view>
              </n-layout-content>
            </n-layout>
          </n-layout>

          <transition name="privacy-lock-fade" :duration="{ enter: 640, leave: 260 }">
            <div v-if="showLockOverlay" class="privacy-lock-overlay">
              <n-card class="privacy-lock-card" :bordered="false">
                <h2 class="privacy-lock-title">{{ t('app.privacy.title') }}</h2>
                <p class="privacy-lock-description">
                  {{
                    privacy.usesWindowsPassword
                      ? t('app.privacy.unlockWithWindowsPassword')
                      : t('app.privacy.unlockWithPin')
                  }}
                </p>

                <div
                  class="privacy-lock-form"
                  :class="{ 'privacy-lock-form--windows': privacy.usesWindowsPassword }"
                >
                  <n-input-otp
                    v-if="!privacy.usesWindowsPassword"
                    :value="password"
                    :length="OTP_LENGTH"
                    mask
                    :allow-input="allowDigitInput"
                    size="large"
                    :status="unlockStatus"
                    @update:value="handlePasswordInput"
                    @finish="handlePasswordFinish"
                  />
                  <template v-else>
                    <n-input
                      :value="windowsPassword"
                      type="password"
                      show-password-on="mousedown"
                      clearable
                      :disabled="unlocking"
                      :status="unlockStatus"
                      :placeholder="t('app.privacy.windowsPasswordPlaceholder')"
                      @update:value="handleWindowsPasswordInput"
                      @keyup.enter="handleUnlock"
                    />
                    <n-button type="primary" :loading="unlocking" @click="handleUnlock">{{
                      t('app.privacy.unlock')
                    }}</n-button>
                  </template>
                </div>
              </n-card>
            </div>
          </transition>
        </template>
      </div>
    </n-dialog-provider>
  </n-config-provider>
</template>

<style>
:root {
  --app-title-bar-height: 32px;
}

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

.app-shell--locked .title-bar {
  z-index: 5000 !important;
}

.startup-skeleton {
  height: 100%;
  background:
    radial-gradient(
      120% 70% at 15% -20%,
      var(--app-accent-12, rgba(24, 160, 88, 0.12)) 0%,
      transparent 60%
    ),
    radial-gradient(
      110% 80% at 100% 120%,
      var(--app-accent-08, rgba(24, 160, 88, 0.08)) 0%,
      transparent 58%
    ),
    var(--n-body-color, #f5f7fa);
}

.startup-skeleton-titlebar {
  height: var(--app-title-bar-height);
}

.startup-skeleton-layout {
  height: calc(100% - var(--app-title-bar-height));
  display: flex;
}

.startup-skeleton-sidebar {
  width: 220px;
  padding: 24px 14px 16px;
  border-right: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.08));
  box-sizing: border-box;
}

.startup-skeleton-avatar {
  border-radius: 50%;
  overflow: hidden;
  margin: 0 auto 22px;
}

.startup-skeleton-line {
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 14px;
}

.startup-skeleton-main {
  flex: 1;
  padding: 14px 18px 18px;
  box-sizing: border-box;
}

.startup-skeleton-header {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 42px;
}

.startup-skeleton-search {
  width: min(420px, 56vw) !important;
  max-width: 100%;
  border-radius: 999px;
  overflow: hidden;
}

.startup-skeleton-content {
  margin-top: 18px;
  height: calc(100% - 60px);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(140px, 1fr));
  gap: 14px;
}

.startup-skeleton-card {
  border-radius: 16px;
  overflow: hidden;
}

.startup-skeleton-card.tall {
  grid-row: span 2;
}

/* 禁止 Naive UI 布局组件的滚动 */
.n-layout,
.n-layout-scroll-container {
  overflow: hidden !important;
}

.main-content {
  height: calc(100vh - var(--app-title-bar-height)); /* 仅减去 TitleBar 高度 */
  overflow: hidden;
  position: relative;
}

.route-page {
  height: 100%;
  will-change: opacity, transform;
}

.page-slide-forward-enter-active,
.page-slide-forward-leave-active,
.page-slide-back-enter-active,
.page-slide-back-leave-active,
.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity var(--motion-normal) var(--ease-enter),
    transform var(--motion-normal) var(--ease-enter);
}

.page-slide-forward-leave-active,
.page-slide-back-leave-active,
.page-fade-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
}

.page-slide-forward-enter-from {
  opacity: 0;
  transform: translateX(var(--motion-distance-md));
}

.page-slide-forward-leave-to {
  opacity: 0;
  transform: translateX(calc(var(--motion-distance-md) * -1));
}

.page-slide-back-enter-from {
  opacity: 0;
  transform: translateX(calc(var(--motion-distance-md) * -1));
}

.page-slide-back-leave-to {
  opacity: 0;
  transform: translateX(var(--motion-distance-md));
}

.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .page-slide-forward-enter-active,
  .page-slide-forward-leave-active,
  .page-slide-back-enter-active,
  .page-slide-back-leave-active,
  .page-fade-enter-active,
  .page-fade-leave-active {
    transition: opacity var(--motion-fast) linear;
  }

  .page-slide-forward-enter-from,
  .page-slide-forward-leave-to,
  .page-slide-back-enter-from,
  .page-slide-back-leave-to {
    transform: none;
  }
}

@media (max-width: 900px) {
  .startup-skeleton-sidebar {
    width: 64px;
    padding: 16px 10px;
  }

  .startup-skeleton-avatar {
    width: 40px !important;
    height: 40px !important;
    margin-bottom: 16px;
  }

  .startup-skeleton-line {
    width: 100% !important;
    margin-bottom: 10px;
    height: 10px !important;
  }

  .startup-skeleton-search {
    width: min(320px, 70vw) !important;
  }

  .startup-skeleton-content {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: repeat(3, minmax(120px, 1fr));
  }

  .startup-skeleton-card.tall {
    grid-row: auto;
  }
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
  background:
    radial-gradient(130% 90% at 50% -15%, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 58%),
    rgba(14, 18, 24, 0.32);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.privacy-lock-fade-enter-active,
.privacy-lock-fade-leave-active {
  transition: opacity 260ms var(--ease-standard);
}

.privacy-lock-fade-enter-from,
.privacy-lock-fade-leave-to {
  opacity: 0;
}

.privacy-lock-fade-enter-active .privacy-lock-card {
  animation: privacy-lock-card-drop-bounce 640ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.privacy-lock-fade-leave-active .privacy-lock-card {
  animation: privacy-lock-card-leave 220ms var(--ease-standard) both;
}

.privacy-lock-fade-enter-active .privacy-lock-title {
  animation: privacy-lock-content-in 280ms var(--ease-out) 120ms both;
}

.privacy-lock-fade-enter-active .privacy-lock-description {
  animation: privacy-lock-content-in 280ms var(--ease-out) 160ms both;
}

.privacy-lock-fade-enter-active .privacy-lock-form {
  animation: privacy-lock-content-in 280ms var(--ease-out) 200ms both;
}

.privacy-lock-card {
  width: min(420px, 100%);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
  position: relative;
  overflow: hidden;
  transform-origin: center top;
  will-change: transform, opacity, box-shadow;
}

.privacy-lock-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0),
    rgba(120, 185, 255, 0.72),
    rgba(255, 255, 255, 0)
  );
  opacity: 0.9;
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

.privacy-lock-form--windows {
  flex-direction: column;
  gap: 10px;
}

@keyframes privacy-lock-card-drop-bounce {
  0% {
    opacity: 0;
    transform: translateY(-80px) scale(0.94);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
  }
  58% {
    opacity: 1;
    transform: translateY(14px) scale(1.01);
    box-shadow: 0 24px 58px rgba(0, 0, 0, 0.24);
  }
  78% {
    transform: translateY(-6px) scale(0.998);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
  }
}

@keyframes privacy-lock-card-leave {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(18px) scale(0.98);
  }
}

@keyframes privacy-lock-content-in {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .privacy-lock-form {
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .privacy-lock-fade-enter-active,
  .privacy-lock-fade-leave-active {
    transition: opacity var(--motion-fast) linear;
  }

  .privacy-lock-fade-enter-active .privacy-lock-card,
  .privacy-lock-fade-leave-active .privacy-lock-card,
  .privacy-lock-fade-enter-active .privacy-lock-title,
  .privacy-lock-fade-enter-active .privacy-lock-description,
  .privacy-lock-fade-enter-active .privacy-lock-form {
    animation: none;
  }
}
</style>
