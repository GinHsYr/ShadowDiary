<script setup lang="ts">
import { h, onBeforeUnmount, onMounted, ref, computed } from 'vue'
import { NLayoutSider, NMenu, NButton, NAvatar, NIcon, NModal, NInput, NSpace } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  BookOutline,
  SettingsOutline,
  Add,
  CloudUploadOutline,
  PencilOutline,
  FolderOpenOutline,
  ImagesOutline
} from '@vicons/ionicons5'
import { useUserStore } from '../stores/user'
import { useRouter, useRoute } from 'vue-router'

const COLLAPSE_WIDTH = 900
const { t } = useI18n()

// 使用用户信息 store
const userStore = useUserStore()

// 使用路由
const router = useRouter()
const route = useRoute()

// 根据窗口大小更新 sidebar 状态
const updateCollapsedByWindow = (): void => {
  collapsed.value = window.innerWidth < COLLAPSE_WIDTH
}

onMounted(() => {
  updateCollapsedByWindow()
  window.addEventListener('resize', updateCollapsedByWindow)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateCollapsedByWindow)
})

// 定义菜单项
const menuOptions = computed(() => [
  {
    label: t('sidebar.menu.dashboard'),
    key: 'dashboard',
    icon: () => h(NIcon, null, () => h(BookOutline))
  },
  {
    label: t('sidebar.menu.today'),
    key: 'today',
    icon: () => h(NIcon, null, () => h(PencilOutline))
  },
  {
    label: t('sidebar.menu.archives'),
    key: 'archives',
    icon: () => h(NIcon, null, () => h(FolderOpenOutline))
  },
  {
    label: t('sidebar.menu.media'),
    key: 'media',
    icon: () => h(NIcon, null, () => h(ImagesOutline))
  },
  {
    label: t('sidebar.menu.settings'),
    key: 'settings',
    icon: () => h(NIcon, null, () => h(SettingsOutline))
  }
])

// 根据当前路由计算 activeKey
const activeKey = computed(() => {
  const path = route.path
  if (path.startsWith('/dashboard')) return 'dashboard'
  if (path.startsWith('/today')) return 'today'
  if (path.startsWith('/archives')) return 'archives'
  if (path.startsWith('/media')) return 'media'
  if (path.startsWith('/settings')) return 'settings'
  return 'dashboard'
})

const collapsed = ref(false)
const showModal = ref(false)
const menuKey = ref(0)
const savingProfile = ref(false)
const sidebarMenuThemeOverrides = {
  borderRadius: '12px'
}
const sidebarButtonThemeOverrides = {
  borderRadiusTiny: '12px',
  borderRadiusSmall: '12px',
  borderRadiusMedium: '12px',
  borderRadiusLarge: '12px'
}
const createRipple = (
  container: HTMLElement,
  event: MouseEvent,
  variant: 'menu' | 'button'
): void => {
  const rect = container.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height) * 1.4
  const ripple = document.createElement('span')
  ripple.className = `sidebar-ripple-ink sidebar-ripple-ink--${variant}`
  ripple.style.width = `${size}px`
  ripple.style.height = `${size}px`
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`
  container.appendChild(ripple)
  ripple.addEventListener(
    'animationend',
    () => {
      ripple.remove()
    },
    { once: true }
  )
}
const handleTodayButtonMouseDown = (event: MouseEvent): void => {
  const buttonEl = event.currentTarget as HTMLElement | null
  if (!buttonEl || buttonEl.classList.contains('n-button--disabled')) return
  createRipple(buttonEl, event, 'button')
}
const handleMenuItemMouseDown = (event: MouseEvent): void => {
  const targetEl = event.target as HTMLElement | null
  if (!targetEl) return
  const contentEl = targetEl.closest<HTMLElement>('.n-menu-item-content')
  if (contentEl?.classList.contains('n-menu-item-content--disabled')) return
  if (!contentEl) return
  createRipple(contentEl, event, 'menu')
}

// 从 store 获取用户信息
const userName = computed(() => userStore.name.trim())
const displayUserName = computed(() => userName.value || t('sidebar.defaultNickname'))
const userAvatar = computed(() => userStore.avatar)

// 编辑表单的临时数据
const newName = ref('')
const newAvatar = ref('')

function notify(type: 'success' | 'error', message: string): void {
  const api = window.$message
  if (api) {
    api[type](message)
    return
  }
  if (type === 'error') {
    alert(message)
  }
}

const handleSave = async (): Promise<void> => {
  if (savingProfile.value) return
  savingProfile.value = true

  try {
    const nextName = newName.value.trim() || userName.value
    await userStore.updateUserInfo({
      name: nextName,
      avatar: newAvatar.value
    })
    showModal.value = false
    notify('success', t('sidebar.saveSuccess'))
  } catch (error) {
    console.error('保存个人信息失败:', error)
    notify('error', t('sidebar.saveFailed'))
  } finally {
    savingProfile.value = false
  }
}

const selectAvatar = async (): Promise<void> => {
  try {
    const result = await window.api.selectAvatar()

    if (result.canceled || !result.path) {
      return
    }

    newAvatar.value = result.path
  } catch (error) {
    console.error('选择头像失败:', error)
    alert(t('sidebar.selectAvatarFailed'))
  }
}

const openModal = (): void => {
  newName.value = userName.value
  newAvatar.value = userAvatar.value
  showModal.value = true
}

const resetAvatar = (): void => {
  newAvatar.value = ''
}

// 处理菜单点击，进行路由跳转
const handleMenuUpdate = (key: string): void => {
  // 折叠状态下菜单项的 Tooltip 可能残留，通过更新 key 强制重建菜单以关闭 Tooltip
  if (collapsed.value) {
    menuKey.value++
  }
  router.push(`/${key}`).catch((err) => {
    console.error('导航失败:', err)
  })
}

// 处理今日日记按钮点击
const handleTodayClick = (): void => {
  router.push('/today').catch((err) => {
    console.error('导航失败:', err)
  })
}
</script>

<template>
  <n-layout-sider
    bordered
    collapse-mode="width"
    :collapsed-width="64"
    :width="220"
    :collapsed="collapsed"
    show-trigger
    class="app-sidebar"
    @collapse="collapsed = true"
    @expand="collapsed = false"
  >
    <div class="logo-container" :class="{ collapsed }">
      <n-avatar
        size="large"
        style="cursor: pointer"
        :src="userAvatar || undefined"
        @click="openModal"
      >
        <span v-if="!userAvatar">{{ displayUserName.charAt(0) }}</span>
      </n-avatar>
      <span v-if="!collapsed" class="app-name">{{ t('common.appName') }}</span>
    </div>

    <!-- 写日记按钮 -->
    <div class="action-btn">
      <n-button
        class="sidebar-ripple-button"
        type="primary"
        block
        :round="collapsed"
        :theme-overrides="sidebarButtonThemeOverrides"
        @mousedown="handleTodayButtonMouseDown"
        @click="handleTodayClick"
      >
        <template #icon>
          <n-icon><Add /></n-icon>
        </template>
        <span v-if="!collapsed">{{ t('sidebar.todayDiary') }}</span>
      </n-button>
    </div>

    <!-- 菜单 -->
    <div class="menu-ripple-area" @mousedown="handleMenuItemMouseDown">
      <n-menu
        :key="menuKey"
        :value="activeKey"
        :collapsed="collapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :options="menuOptions"
        :theme-overrides="sidebarMenuThemeOverrides"
        @update:value="handleMenuUpdate"
      />
    </div>

    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="t('sidebar.editProfile')"
      :bordered="false"
      :segmented="{
        content: 'soft',
        footer: 'soft'
      }"
      style="width: 480px; border-radius: 16px"
      class="profile-modal-card"
    >
      <n-space vertical size="large" class="profile-modal">
        <div
          class="avatar-preview-section"
          :style="{
            '--bg-image': newAvatar ? `url(${newAvatar})` : 'url(resources/icon.png)'
          }"
        >
          <div class="avatar-preview">
            <n-avatar :size="96" round :src="newAvatar || undefined" class="preview-avatar">
              <span v-if="!newAvatar" class="avatar-placeholder">{{
                newName.charAt(0) || '?'
              }}</span>
            </n-avatar>
            <div class="avatar-actions">
              <n-button size="small" class="avatar-action-btn" secondary @click="selectAvatar">
                <template #icon>
                  <n-icon><CloudUploadOutline /></n-icon>
                </template>
                {{ t('sidebar.uploadImage') }}
              </n-button>
              <n-button
                v-if="newAvatar"
                class="avatar-action-btn ghost"
                size="small"
                secondary
                @click="resetAvatar"
              >
                {{ t('sidebar.resetAvatar') }}
              </n-button>
            </div>
          </div>
        </div>

        <div class="form-item">
          <label class="form-label">{{ t('sidebar.nickname') }}</label>
          <n-input
            v-model:value="newName"
            :placeholder="t('sidebar.nicknamePlaceholder')"
            maxlength="20"
            show-count
            clearable
            size="large"
          />
        </div>
      </n-space>

      <!-- footer -->
      <template #footer>
        <n-space justify="end" :size="12">
          <n-button @click="showModal = false"> {{ t('common.cancel') }} </n-button>
          <n-button type="primary" :loading="savingProfile" @click="handleSave">
            {{ t('common.save') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </n-layout-sider>
</template>

<style scoped>
.app-sidebar {
  background-color: var(--n-color);
  height: 100vh;
}

.logo-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
  gap: 10px;
  transition: all 0.3s;
}

.app-name {
  font-weight: bold;
  font-size: 16px;
  white-space: nowrap;
}

.action-btn {
  padding: 0 12px 20px;
}

:deep(.sidebar-ripple-button),
:deep(.n-menu-item-content) {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

:deep(.sidebar-ripple-ink) {
  position: absolute;
  border-radius: 50%;
  transform: scale(0);
  pointer-events: none;
  animation: sidebar-ripple 0.55s ease-out forwards;
}

:deep(.sidebar-ripple-ink--button) {
  background: rgba(255, 255, 255, 0.38);
}

:deep(.sidebar-ripple-ink--menu) {
  background: rgba(22, 38, 68, 0.14);
}

html.dark :deep(.sidebar-ripple-ink--button) {
  background: rgba(255, 255, 255, 0.44);
}

html.dark :deep(.sidebar-ripple-ink--menu) {
  background: rgba(255, 255, 255, 0.24);
}

@keyframes sidebar-ripple {
  0% {
    transform: scale(0);
    opacity: 0.85;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
}

.avatar-placeholder {
  font-size: 32px;
  font-weight: 600;
  color: var(--n-text-color);
}

/* 模态框样式 */
.profile-modal-card {
  overflow: hidden;
}

.profile-modal {
  padding: 8px 0;
}

.avatar-preview-section {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 0 32px;
  margin: -24px -24px 0;
  overflow: hidden;
  background: #ffffff;
}

/* 背景图 + 高斯模糊 */
.avatar-preview-section::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--bg-image);
  background-size: cover;
  background-position: center;
  filter: blur(22px);
  transform: scale(1.15);
  z-index: 0;
}

.avatar-preview-section::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.25));
  z-index: 0;
}
.preview-avatar:hover {
  transform: scale(1.06);
}
/* 前景内容 */
.avatar-preview-section > * {
  position: relative;
  z-index: 1;
}

.avatar-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.preview-avatar {
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  border: 4px solid rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(2px);
  transition: all 0.3s ease;
}

.preview-avatar:hover {
  transform: scale(1.05);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.16);
}

.avatar-actions {
  display: flex;
  gap: 8px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--n-text-color);
  padding-left: 2px;
}

.avatar-actions {
  display: flex;
  gap: 10px;
}

.avatar-action-btn {
  background: rgba(255, 255, 255, 0.85);
  color: #111;
  border: none;
  backdrop-filter: blur(6px);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  transition: all 0.25s ease;
}

.avatar-action-btn:hover {
  background: rgba(255, 255, 255, 0.95);
  transform: translateY(-1px);
}

/* 次级操作（重置） */
.avatar-action-btn.ghost {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

.avatar-action-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
