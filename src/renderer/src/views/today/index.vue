<template>
  <div class="today-page">
    <!-- 左侧日记列表 -->
    <div class="left-panel" :style="{ width: leftWidth + 'px' }">
      <DiaryList
        ref="diaryListRef"
        :selected-id="existingEntryId"
        @select="handleSelectEntry"
        @create="handleCreate"
        @delete="handleDeleteEntry"
      />
    </div>

    <!-- 可拖拽分割线 -->
    <div class="resize-handle" @mousedown="startResize" />

    <!-- 右侧编辑区 -->
    <div class="right-panel">
      <div class="editor-area">
        <!-- 标题 + 日期 -->
        <div class="title-row">
          <input
            v-model="diaryTitle"
            class="title-input"
            placeholder="无标题"
            @input="scheduleSave"
          />
          <span class="date-label">{{ currentDate }}</span>
        </div>

        <!-- 心情选择 -->
        <div class="mood-row">
          <button
            v-for="mood in moods"
            :key="mood.value"
            class="mood-btn"
            :class="{ active: selectedMood === mood.value }"
            @click="switchMood(mood.value)"
          >
            {{ mood.emoji }} {{ mood.label }}
          </button>
        </div>

        <div class="editor-body">
          <DiaryEditor
            ref="diaryEditorRef"
            v-model="diaryContent"
            @update:model-value="scheduleSave"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDialog } from 'naive-ui'
import type { DiaryEntry, Mood } from '../../../../types/model'
import DiaryList from '../../components/DiaryList.vue'
import DiaryEditor from '../../components/DiaryEditor.vue'

interface MoodOption {
  value: Mood
  label: string
  emoji: string
}

const moods: MoodOption[] = [
  { value: 'happy', label: '开心', emoji: '😊' },
  { value: 'calm', label: '平静', emoji: '😌' },
  { value: 'sad', label: '难过', emoji: '😢' },
  { value: 'excited', label: '兴奋', emoji: '🤩' },
  { value: 'tired', label: '疲惫', emoji: '😴' }
]

const dialog = useDialog()
const diaryListRef = ref<InstanceType<typeof DiaryList> | null>(null)
const diaryEditorRef = ref<{ scrollToKeyword: (keyword: string) => boolean } | null>(null)

const route = useRoute()
const selectedMood = ref<Mood>('calm')
const diaryTitle = ref('')
const diaryContent = ref('')
const existingEntryId = ref<string | null>(null)
const selectedDate = ref<Date>(new Date())

// ========== 可拖拽分割线 ==========
const leftWidth = ref(280)
const MIN_LEFT = 200
const MAX_LEFT = 480

// 用于清理的事件处理函数引用
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

  // 先清理可能存在的旧监听器
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

// ========== 自动保存 ==========
let saveTimer: ReturnType<typeof setTimeout> | null = null
const AUTO_SAVE_DELAY = 1500
const isDirty = ref(false)
const isReady = ref(false)

function syncListEntry(): void {
  if (existingEntryId.value) {
    diaryListRef.value?.updateEntry(existingEntryId.value, {
      title: diaryTitle.value,
      content: toPlainPreviewText(diaryContent.value),
      mood: selectedMood.value
    })
  }
}

function toPlainPreviewText(content: string): string {
  if (!content) return ''
  const temp = document.createElement('div')
  temp.innerHTML = content
  return (temp.textContent || temp.innerText || '').replace(/\s+/g, ' ').trim()
}

function scheduleSave(): void {
  if (!isReady.value) return
  isDirty.value = true
  syncListEntry()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    doSave()
  }, AUTO_SAVE_DELAY)
}

function switchMood(mood: Mood): void {
  selectedMood.value = mood
  scheduleSave()
}

async function doSave(): Promise<void> {
  if (!isDirty.value) return
  if (!diaryTitle.value.trim() && (!diaryContent.value || diaryContent.value === '<p></p>')) return

  try {
    const wasNewEntry = !existingEntryId.value
    const d = new Date(selectedDate.value)
    d.setHours(12, 0, 0, 0)

    const saved = await window.api.saveDiaryEntry({
      id: existingEntryId.value ?? undefined,
      title: diaryTitle.value,
      content: diaryContent.value,
      mood: selectedMood.value,
      createdAt: existingEntryId.value ? undefined : d.getTime()
    })
    existingEntryId.value = saved.id
    isDirty.value = false
    const updatedInList =
      diaryListRef.value?.updateEntry(saved.id, {
        title: saved.title,
        content: saved.content,
        mood: saved.mood,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt
      }) ?? false

    if (!updatedInList || wasNewEntry) {
      void diaryListRef.value?.refresh().catch((error) => {
        console.error('刷新日记列表失败:', error)
      })
    }
  } catch (error) {
    console.error('自动保存失败:', error)
  }
}

async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (isDirty.value) {
    await doSave()
  }
}

// ========== 日记操作 ==========
const currentDate = computed((): string => {
  const d = selectedDate.value
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return `${year}年${month}月${day}日 ${weekdays[d.getDay()]}`
})

function resetEditorState(date: Date = new Date()): void {
  existingEntryId.value = null
  diaryTitle.value = ''
  diaryContent.value = ''
  selectedMood.value = 'calm'
  selectedDate.value = date
  isDirty.value = false
}

async function handleSelectEntry(entry: DiaryEntry): Promise<void> {
  await flushSave()
  let targetEntry = entry
  // 列表使用 lightweight 模式，选中后统一按 id 拉取完整内容，避免覆盖原始富文本/图片
  try {
    const fullEntry = await window.api.getDiaryEntry(entry.id)
    if (fullEntry) {
      targetEntry = fullEntry
    }
  } catch (error) {
    console.error('加载完整日记内容失败:', error)
  }

  existingEntryId.value = targetEntry.id
  diaryTitle.value = targetEntry.title
  diaryContent.value = targetEntry.content
  selectedMood.value = targetEntry.mood
  selectedDate.value = new Date(targetEntry.createdAt)
  isDirty.value = false
}

async function handleCreate(dateStr?: string): Promise<void> {
  await flushSave()
  if (dateStr) {
    await loadOrCreateForDate(dateStr)
  } else {
    const dateParam = route.query.date as string | undefined
    const targetDate = dateParam ? new Date(dateParam + 'T12:00:00') : new Date()
    resetEditorState(targetDate)
  }
}

async function handleDeleteEntry(entry: DiaryEntry): Promise<void> {
  dialog.warning({
    title: '删除确认',
    content: `确定要删除「${entry.title || '无标题'}」吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await window.api.deleteDiaryEntry(entry.id)
        diaryListRef.value?.removeEntry(entry.id)
        if (existingEntryId.value === entry.id) {
          resetEditorState(new Date(selectedDate.value))
        }
      } catch (error) {
        console.error('删除日记失败:', error)
      }
    }
  })
}

// ========== 搜索跳转 + 关键词定位 ==========

function scrollToKeyword(keyword: string): void {
  if (!keyword.trim()) return

  // Wait for editor DOM to update
  nextTick(() => {
    setTimeout(() => {
      diaryEditorRef.value?.scrollToKeyword(keyword)
    }, 200)
  })
}
// 从搜索结果跳转
async function loadEntryById(id: string, keyword?: string): Promise<void> {
  try {
    const entry = await window.api.getDiaryEntry(id)
    if (entry) {
      await handleSelectEntry(entry)
      if (keyword) {
        scrollToKeyword(keyword)
      }
    } else {
      resetEditorState()
      dialog.warning({
        title: '提示',
        content: '日记不存在或已删除',
        positiveText: '知道了'
      })
    }
  } catch (error) {
    console.error('加载日记失败:', error)
  }
}

// 从日历跳转：加载指定日期的日记，若无则初始化为该日期的新日记
async function loadOrCreateForDate(dateStr: string): Promise<void> {
  await flushSave()

  const targetDate = new Date(dateStr + 'T12:00:00')
  selectedDate.value = targetDate
  try {
    const entry = await window.api.getDiaryByDate(dateStr)
    if (entry) {
      existingEntryId.value = entry.id
      diaryTitle.value = entry.title
      diaryContent.value = entry.content
      selectedMood.value = entry.mood
      selectedDate.value = new Date(entry.createdAt)
      isDirty.value = false
    } else {
      resetEditorState(targetDate)
    }
  } catch (error) {
    console.error('加载日记失败:', error)
  }
}

async function handleRouteQuery(query: Record<string, unknown>): Promise<void> {
  const id = query.id as string | undefined
  const keyword = query.keyword as string | undefined
  const date = query.date as string | undefined

  if (id) {
    await loadEntryById(id, keyword)
  } else if (date) {
    await loadOrCreateForDate(date)
  }
}

onMounted(() => {
  handleRouteQuery(route.query as Record<string, unknown>)
  nextTick(() => {
    isReady.value = true
  })
})

watch(
  () => route.query,
  (query) => {
    if (route.path === '/today') {
      handleRouteQuery(query as Record<string, unknown>)
    }
  }
)

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  // 清理可能残留的 resize 事件监听器
  cleanupResizeListeners()
  // 离开页面时异步保存
  void flushSave().catch((error) => {
    console.error('离开页面保存失败:', error)
  })
})
</script>

<style scoped>
.today-page {
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

.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 28px 48px 0;
}

.title-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 28px;
  font-weight: 700;
  color: var(--n-text-color, #37352f);
  background: transparent;
  font-family: inherit;
  line-height: 1.2;
}

.title-input::placeholder {
  color: var(--n-text-color-3, rgba(55, 53, 47, 0.3));
}

html.dark .title-input::placeholder {
  color: #c1bebe61;
}

.date-label {
  font-size: 13px;
  color: var(--n-text-color-3, #999);
  white-space: nowrap;
  font-weight: 500;
}

.mood-row {
  display: flex;
  gap: 6px;
  padding: 12px 48px 8px;
  flex-wrap: wrap;
}

.mood-btn {
  padding: 3px 12px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: var(--n-color-modal, rgba(0, 0, 0, 0.03));
  cursor: pointer;
  font-size: 13px;
  color: var(--n-text-color-2, #666);
  transition: all 0.15s ease;
}

.mood-btn:hover {
  background: rgba(16, 185, 129, 0.08);
}

.mood-btn.active {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.4);
  color: #10b981;
  font-weight: 600;
}

.editor-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-body :deep(.diary-editor-wrapper) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-body :deep(.editor-scroll) {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

@media (max-width: 768px) {
  .today-page {
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

  .title-row,
  .mood-row {
    padding-left: 20px;
    padding-right: 20px;
  }
}
</style>
