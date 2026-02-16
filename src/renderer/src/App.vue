<script setup lang="ts">
import { NConfigProvider, NDialogProvider, NLayout, NLayoutContent } from 'naive-ui'
import { watch } from 'vue'
import TitleBar from './components/TitleBar.vue'
import AppSidebar from './components/AppSidebar.vue'
import AppHeader from './components/AppHeader.vue'
import { useThemeStore } from './stores/themes'

const theme = useThemeStore()

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
</script>

<template>
  <n-config-provider :theme="theme.getTheme">
    <n-dialog-provider>
      <TitleBar />
      <n-layout has-sider position="absolute" style="top: 32px">
        <AppSidebar />

        <n-layout>
          <AppHeader />
          <n-layout-content class="main-content">
            <router-view />
          </n-layout-content>
        </n-layout>
      </n-layout>
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
</style>
