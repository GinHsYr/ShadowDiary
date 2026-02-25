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
    <div
      class="resize-handle"
      :class="{ 'is-resizing': isResizing, 'just-released': isResizeJustReleased }"
      @mousedown="startResize"
    />

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
        <n-empty :description="t('archivesPage.empty')" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NEmpty } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Archive } from '../../../../types/model'
import ArchiveList from '../../components/ArchiveList.vue'
import ArchiveDetail from '../../components/ArchiveDetail.vue'

const { t } = useI18n()
const route = useRoute()

const archiveListRef = ref<InstanceType<typeof ArchiveList> | null>(null)
const archiveDetailRef = ref<InstanceType<typeof ArchiveDetail> | null>(null)

const selectedArchiveId = ref<string | null>(null)
const isCreating = ref(false)
const activeDraftArchiveId = ref<string | null>(null)

function createDraftArchiveId(): string {
  return `draft-archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function removeActiveDraftArchive(): void {
  const draftId = activeDraftArchiveId.value
  if (!draftId) return
  archiveListRef.value?.removeDraftArchive(draftId)
  if (selectedArchiveId.value === draftId) {
    selectedArchiveId.value = null
  }
  activeDraftArchiveId.value = null
}

function startCreateDraftArchive(): void {
  const draftId = createDraftArchiveId()
  const now = Date.now()
  activeDraftArchiveId.value = draftId
  selectedArchiveId.value = draftId
  isCreating.value = true
  archiveListRef.value?.prependDraftArchive({
    id: draftId,
    name: '',
    aliases: [],
    type: 'person',
    description: '',
    mainImage: '',
    images: [],
    createdAt: now,
    updatedAt: now
  })
}

// 监听路由参数变化，支持从全局搜索跳转
watch(
  () => route.query.id,
  (id) => {
    if (id && typeof id === 'string') {
      removeActiveDraftArchive()
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
const isResizing = ref(false)
const isResizeJustReleased = ref(false)
let resizeReleaseTimer: ReturnType<typeof setTimeout> | null = null

let resizeMoveHandler: ((ev: MouseEvent) => void) | null = null
let resizeUpHandler: (() => void) | null = null

function clearResizeReleaseTimer(): void {
  if (resizeReleaseTimer) {
    clearTimeout(resizeReleaseTimer)
    resizeReleaseTimer = null
  }
}

function cleanupResizeListeners(): void {
  const wasResizing = isResizing.value
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
  isResizing.value = false

  if (wasResizing) {
    clearResizeReleaseTimer()
    isResizeJustReleased.value = true
    resizeReleaseTimer = setTimeout(() => {
      isResizeJustReleased.value = false
      resizeReleaseTimer = null
    }, 140)
  }
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

  isResizing.value = true
  isResizeJustReleased.value = false
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', resizeMoveHandler)
  document.addEventListener('mouseup', resizeUpHandler)
}

// ========== 档案操作 ==========
async function handleSelectArchive(archive: Archive): Promise<void> {
  await archiveDetailRef.value?.flushSave()
  if (activeDraftArchiveId.value && activeDraftArchiveId.value !== archive.id) {
    removeActiveDraftArchive()
  }
  isCreating.value = false
  selectedArchiveId.value = archive.id
}

async function handleCreate(): Promise<void> {
  await archiveDetailRef.value?.flushSave()
  removeActiveDraftArchive()
  startCreateDraftArchive()
}

function handleSaved(archive: Archive): void {
  if (isCreating.value && activeDraftArchiveId.value) {
    const committed =
      archiveListRef.value?.commitDraftArchive(activeDraftArchiveId.value, archive) ?? false
    activeDraftArchiveId.value = null
    isCreating.value = false
    selectedArchiveId.value = archive.id
    if (!committed) {
      archiveListRef.value?.refresh()
    }
    return
  }
  archiveListRef.value?.refresh()
}

function handleDeleted(): void {
  selectedArchiveId.value = null
  isCreating.value = false
  archiveListRef.value?.refresh()
}

function handleCancelCreate(): void {
  removeActiveDraftArchive()
  selectedArchiveId.value = null
  isCreating.value = false
}

async function flushSave(): Promise<void> {
  await archiveDetailRef.value?.flushSave()
}

onBeforeUnmount(() => {
  void flushSave().catch((error) => {
    console.error('页面卸载时保存档案失败:', error)
  })
  clearResizeReleaseTimer()
  cleanupResizeListeners()
  clearResizeReleaseTimer()
})

defineExpose({ flushSave })
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
  transition: background var(--motion-fast) var(--ease-standard);
}

.resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 1px;
  width: 2px;
  background: var(--n-border-color, rgba(0, 0, 0, 0.09));
  transition:
    left var(--motion-fast) var(--ease-standard),
    width var(--motion-fast) var(--ease-standard),
    background var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}

.resize-handle:hover::after,
.resize-handle:active::after {
  background: var(--app-accent-color, #10b981);
  width: 3px;
  left: 0;
}

.resize-handle.is-resizing::after {
  background: var(--app-accent-color, #10b981);
  width: 3px;
  left: 0;
  box-shadow:
    0 0 0 1px var(--app-accent-20, rgba(24, 160, 88, 0.2)),
    0 0 12px var(--app-accent-40, rgba(24, 160, 88, 0.4));
}

.resize-handle.just-released::after {
  animation: resize-handle-release var(--motion-normal) var(--ease-exit);
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

@keyframes resize-handle-release {
  0% {
    transform: scaleX(1.16);
  }
  100% {
    transform: scaleX(1);
  }
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
