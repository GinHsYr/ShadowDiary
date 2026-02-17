<script setup lang="ts">
import { h, onBeforeUnmount, onMounted, ref, computed } from 'vue'
import { NLayoutSider, NMenu, NButton, NAvatar, NIcon, NModal, NInput, NSpace } from 'naive-ui'
import {
  BookOutline,
  SettingsOutline,
  Add,
  CloudUploadOutline,
  PencilOutline,
  FolderOpenOutline
} from '@vicons/ionicons5'
import { useUserStore } from '../stores/user'
import { useRouter, useRoute } from 'vue-router'

const COLLAPSE_WIDTH = 900

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
const menuOptions = [
  {
    label: '概览',
    key: 'dashboard',
    icon: () => h(NIcon, null, () => h(BookOutline))
  },
  {
    label: '今日',
    key: 'today',
    icon: () => h(NIcon, null, () => h(PencilOutline))
  },
  {
    label: '档案',
    key: 'archives',
    icon: () => h(NIcon, null, () => h(FolderOpenOutline))
  },
  {
    label: '设置',
    key: 'settings',
    icon: () => h(NIcon, null, () => h(SettingsOutline))
  }
]

// 根据当前路由计算 activeKey
const activeKey = computed(() => {
  const path = route.path
  if (path.startsWith('/dashboard')) return 'dashboard'
  if (path.startsWith('/today')) return 'today'
  if (path.startsWith('/archives')) return 'archives'
  if (path.startsWith('/settings')) return 'settings'
  return 'dashboard'
})

const collapsed = ref(false)
const showModal = ref(false)
const menuKey = ref(0)

// 从 store 获取用户信息
const userName = computed(() => userStore.name)
const userAvatar = computed(() => userStore.avatar)

// 编辑表单的临时数据
const newName = ref('')
const newAvatar = ref('')
const avatarType = ref<'upload'>('upload')

const handleSave = (): void => {
  userStore.updateUserInfo({
    name: newName.value || userName.value,
    avatar: newAvatar.value
  })
  showModal.value = false
  console.log('保存成功:', userStore.getUserInfo)
}

const selectAvatar = async (): Promise<void> => {
  try {
    const result = await window.api.selectAvatar()

    if (result.canceled || !result.dataUrl) {
      return
    }

    newAvatar.value = result.dataUrl
    avatarType.value = 'upload'
  } catch (error) {
    console.error('选择头像失败:', error)
    alert('选择头像失败，请重试')
  }
}

const openModal = (): void => {
  newName.value = userName.value
  newAvatar.value = userAvatar.value
  showModal.value = true
}

const resetAvatar = (): void => {
  newAvatar.value = ''
  avatarType.value = 'upload'
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
        :src="avatarType === 'upload' ? userAvatar : undefined"
        @click="openModal"
      >
        <span v-if="!userAvatar">{{ userName.charAt(0) }}</span>
      </n-avatar>
      <span v-if="!collapsed" class="app-name">影迹</span>
    </div>

    <!-- 写日记按钮 -->
    <div class="action-btn">
      <n-button type="primary" block :round="collapsed" @click="handleTodayClick">
        <template #icon>
          <n-icon><Add /></n-icon>
        </template>
        <span v-if="!collapsed">今日日记</span>
      </n-button>
    </div>

    <!-- 菜单 -->
    <n-menu
      :key="menuKey"
      :value="activeKey"
      :collapsed="collapsed"
      :collapsed-width="64"
      :collapsed-icon-size="22"
      :options="menuOptions"
      @update:value="handleMenuUpdate"
    />

    <n-modal
      v-model:show="showModal"
      preset="card"
      title="编辑个人资料"
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
            <n-avatar
              :size="96"
              round
              :src="avatarType === 'upload' ? newAvatar : undefined"
              class="preview-avatar"
            >
              <span v-if="!newAvatar" class="avatar-placeholder">{{
                newName.charAt(0) || '?'
              }}</span>
            </n-avatar>
            <div class="avatar-actions">
              <n-button size="small" class="avatar-action-btn" secondary @click="selectAvatar">
                <template #icon>
                  <n-icon><CloudUploadOutline /></n-icon>
                </template>
                上传图片
              </n-button>
              <n-button
                v-if="newAvatar"
                class="avatar-action-btn ghost"
                size="small"
                secondary
                @click="resetAvatar"
              >
                重置
              </n-button>
            </div>
          </div>
        </div>

        <div class="form-item">
          <label class="form-label">昵称</label>
          <n-input
            v-model:value="newName"
            placeholder="请输入昵称"
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
          <n-button @click="showModal = false"> 取消 </n-button>
          <n-button type="primary" @click="handleSave"> 保存 </n-button>
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
