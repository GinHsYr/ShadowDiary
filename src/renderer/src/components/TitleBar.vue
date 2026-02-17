<template>
  <div class="title-bar">
    <div class="title-bar-drag-region">
      <div class="title-bar-title"></div>
    </div>
    <div class="title-bar-controls">
      <button class="title-bar-button minimize" title="最小化" @click="minimize">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="0" y="5" width="12" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        class="title-bar-button maximize"
        :title="isMaximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12">
          <rect
            x="1"
            y="1"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          />
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12">
          <rect
            x="2"
            y="0"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          />
          <rect
            x="0"
            y="2"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          />
        </svg>
      </button>
      <button class="title-bar-button close" title="关闭" @click="close">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" stroke-width="1" />
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const isMaximized = ref(false)

onMounted(async () => {
  isMaximized.value = await window.api.windowIsMaximized()
})

const minimize = (): void => {
  window.api.windowMinimize()
}

const toggleMaximize = async (): Promise<void> => {
  await window.api.windowMaximize()
  isMaximized.value = await window.api.windowIsMaximized()
}

const close = (): void => {
  window.api.windowClose()
}
</script>

<style scoped>
.title-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  height: 32px;
  background: #ffffff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  user-select: none;
  -webkit-app-region: drag;
}

.title-bar-drag-region {
  flex: 1;
  display: flex;
  align-items: center;
  padding-left: 12px;
}

.title-bar-title {
  font-size: 13px;
  color: var(--n-text-color);
  font-weight: 500;
}

.title-bar-controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.title-bar-button {
  width: 46px;
  height: 32px;
  border: none;
  background: transparent;
  color: #333333;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.title-bar-button:hover {
  background: rgba(0, 0, 0, 0.05);
}

.title-bar-button.close:hover {
  background: #e81123;
  color: white;
}

.title-bar-button svg {
  pointer-events: none;
}

/* 暗色主题适配 */
html.dark .title-bar {
  background: #18181c;
  border-bottom-color: rgba(255, 255, 255, 0.12);
}

html.dark .title-bar-button {
  color: #ffffffd1;
}

html.dark .title-bar-button:hover {
  background: rgba(255, 255, 255, 0.1);
}

html.dark .title-bar-button.close:hover {
  background: #e81123;
  color: white;
}
</style>
