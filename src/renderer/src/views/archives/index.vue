<template>
  <div class="archives-page">
    <!-- 左侧档案列表 -->
    <div class="left-panel" :style="{ width: leftWidth + 'px' }">
      <ArchiveList
        ref="archiveListRef"
        :selected-id="selectedArchiveId"
        @select="handleSelectArchive"
        @create="handleCreate"
      />
    </div>

    <!-- 可拖拽分割线 -->
    <div class="resize-handle" @mousedown="startResize" />

    <!-- 右侧详情区 -->
    <div class="right-panel">
      <ArchiveDetail
        v-if="selectedArchiveId || isCreating"
        ref="archiveDetailRef"
        :archive-id="selectedArchiveId"
        :is-creating="isCreating"
        @saved="handleSaved"
        @deleted="handleDeleted"
        @cancel-create="handleCancelCreate"
      />
      <div v-else class="empty-state">
        <n-empty description="选择或新建一个档案" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NEmpty } from 'naive-ui'
import type { Archive } from '../../../../types/model'
import ArchiveList from '../../components/ArchiveList.vue'
import ArchiveDetail from '../../components/ArchiveDetail.vue'

const route = useRoute()

const archiveListRef = ref<InstanceType<typeof ArchiveList> | null>(null)
const archiveDetailRef = ref<InstanceType<typeof ArchiveDetail> | null>(null)

const selectedArchiveId = ref<string | null>(null)
const isCreating = ref(false)

// 监听路由参数变化，支持从全局搜索跳转
watch(
  () => route.query.id,
  (id) => {
    if (id && typeof id === 'string') {
      selectedArchiveId.value = id
      isCreating.value = false
    }
  }
)

onMounted(() => {
  // 初始化时检查路由参数
  const id = route.query.id
  if (id && typeof id === 'string') {
    selectedArchiveId.value = id
  }
})

// ========== 可拖拽分割线 ==========
const leftWidth = ref(280)
const MIN_LEFT = 200
const MAX_LEFT = 480

let resizeMoveHandler: ((ev: MouseEvent) => void) | null = null
let resizeUpHandler: (() => void) | null = null

function cleanupResizeListeners(): void {
  if (resizeMoveHandler) {
    document.removeEventListener('mousemove', resizeMoveHandler)
    resizeMoveHandler = null
  }
  if (resizeUpHandler) {
    document.removeEventListener('mouseup', resizeUpHandler)
    resizeUpHandler = null
  }
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function startResize(e: MouseEvent): void {
  e.preventDefault()
  const startX = e.clientX
  const startWidth = leftWidth.value

  cleanupResizeListeners()

  resizeMoveHandler = (ev: MouseEvent): void => {
    const delta = ev.clientX - startX
    leftWidth.value = Math.min(MAX_LEFT, Math.max(MIN_LEFT, startWidth + delta))
  }

  resizeUpHandler = (): void => {
    cleanupResizeListeners()
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', resizeMoveHandler)
  document.addEventListener('mouseup', resizeUpHandler)
}

// ========== 档案操作 ==========
async function handleSelectArchive(archive: Archive): Promise<void> {
  await archiveDetailRef.value?.flushSave()
  isCreating.value = false
  selectedArchiveId.value = archive.id
}

async function handleCreate(): Promise<void> {
  await archiveDetailRef.value?.flushSave()
  selectedArchiveId.value = null
  isCreating.value = true
}

function handleSaved(archive: Archive): void {
  if (isCreating.value) {
    isCreating.value = false
    selectedArchiveId.value = archive.id
  }
  archiveListRef.value?.refresh()
}

function handleDeleted(): void {
  selectedArchiveId.value = null
  isCreating.value = false
  archiveListRef.value?.refresh()
}

function handleCancelCreate(): void {
  isCreating.value = false
}

onBeforeUnmount(() => {
  cleanupResizeListeners()
})
</script>

<style scoped>
.archives-page {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.left-panel {
  flex-shrink: 0;
  height: 100%;
  min-width: 200px;
  max-width: 480px;
}

.resize-handle {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  flex-shrink: 0;
  transition: background 0.15s;
}

.resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 1px;
  width: 2px;
  background: var(--n-border-color, rgba(0, 0, 0, 0.09));
  transition: background 0.15s;
}

.resize-handle:hover::after,
.resize-handle:active::after {
  background: #10b981;
  width: 3px;
  left: 0;
}

.right-panel {
  flex: 1;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 768px) {
  .archives-page {
    flex-direction: column;
  }

  .left-panel {
    width: 100% !important;
    min-width: unset;
    max-width: unset;
    height: 200px;
  }

  .resize-handle {
    display: none;
  }
}
</style>
