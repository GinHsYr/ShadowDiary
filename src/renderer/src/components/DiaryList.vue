<template>
  <div class="diary-list">
    <div class="list-topbar">
      <n-popover
        trigger="click"
        placement="bottom"
        :show="showDatePicker"
        @update:show="showDatePicker = $event"
      >
        <template #trigger>
          <n-button block type="primary" ghost size="small">
            {{ t('diaryList.create') }}
          </n-button>
        </template>
        <div class="date-picker-popup">
          <p class="date-picker-label">{{ t('diaryList.selectDate') }}</p>
          <n-date-picker v-model:value="newDiaryDate" type="date" :actions="[]" panel />
          <n-button
            type="primary"
            size="small"
            block
            style="margin-top: 8px"
            @click="confirmCreate"
          >
            {{ t('diaryList.confirm') }}
          </n-button>
        </div>
      </n-popover>
    </div>

    <!-- 日记列表 -->
    <div ref="listRef" class="list-body" @scroll="handleScroll">
      <transition-group name="diary-item-motion" tag="div" class="diary-item-group">
        <div
          v-for="entry in displayEntries"
          :key="entry.id"
          class="diary-item"
          :class="{ active: entry.id === selectedId, 'is-draft': isDraftEntry(entry) }"
          @click="handleItemClick(entry)"
          @contextmenu.prevent="handleContextMenu($event, entry)"
        >
          <div class="item-header">
            <span class="item-date">{{ formatDate(entry.createdAt) }}</span>
            <div class="item-header-right">
              <n-tag v-if="isDraftEntry(entry)" size="tiny" round type="warning" class="draft-tag">
                {{ t('diaryList.draft') }}
              </n-tag>
              <span class="item-mood">{{ moodEmoji[entry.mood] || '' }}</span>
            </div>
          </div>
          <div class="item-title">{{ entry.title || t('common.noTitle') }}</div>
          <div class="item-preview">{{ stripHtml(entry.content) }}</div>
        </div>
      </transition-group>

      <div v-if="displayEntries.length === 0 && !loading" class="list-empty">
        <p>{{ t('diaryList.empty') }}</p>
      </div>

      <div v-if="loading" class="list-loading">
        <n-spin size="small" />
      </div>
    </div>

    <!-- 右键菜单 -->
    <n-dropdown
      placement="bottom-start"
      trigger="manual"
      :x="contextMenuX"
      :y="contextMenuY"
      :options="contextMenuOptions"
      :show="showContextMenu"
      @select="handleContextMenuSelect"
      @clickoutside="showContextMenu = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NDatePicker, NDropdown, NPopover, NSpin, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { DiaryEntry, Mood } from '../../../types/model'
const { t, tm } = useI18n()

const props = defineProps<{
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [entry: DiaryEntry]
  create: [dateStr: string]
  delete: [entry: DiaryEntry]
}>()

interface DiaryEntryDraftItem extends DiaryEntry {
  isDraft: true
}

interface DiaryEntryDraftInput {
  id: string
  title: string
  content: string
  mood: Mood
  createdAt: number
  updatedAt: number
}

type DiaryListItem = DiaryEntry | DiaryEntryDraftItem

const showDatePicker = ref(false)
const newDiaryDate = ref<number>(Date.now())

// 右键菜单
const showContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuEntry = ref<DiaryEntry | null>(null)
const contextMenuOptions = [{ label: t('diaryList.delete'), key: 'delete' }]

function isDraftEntry(entry: DiaryListItem): entry is DiaryEntryDraftItem {
  return 'isDraft' in entry && entry.isDraft
}

function handleItemClick(entry: DiaryListItem): void {
  if (isDraftEntry(entry)) return
  emit('select', entry)
}

function handleContextMenu(e: MouseEvent, entry: DiaryListItem): void {
  if (isDraftEntry(entry)) return
  contextMenuX.value = e.clientX
  contextMenuY.value = e.clientY
  contextMenuEntry.value = entry
  showContextMenu.value = true
}

function handleContextMenuSelect(key: string): void {
  showContextMenu.value = false
  if (key === 'delete' && contextMenuEntry.value) {
    emit('delete', contextMenuEntry.value)
  }
}

function confirmCreate(): void {
  const d = new Date(newDiaryDate.value)
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  showDatePicker.value = false
  emit('create', dateStr)
}

const moodEmoji: Record<string, string> = {
  happy: '😊',
  calm: '😌',
  sad: '😢',
  excited: '🤩',
  tired: '😴'
}

const entries = ref<DiaryEntry[]>([])
const draftEntries = ref<DiaryEntryDraftItem[]>([])
const loading = ref(false)
const hasMore = ref(true)
const PAGE_SIZE = 10 // 减少每页加载数量，从 20 降到 10
const MAX_WINDOW_SIZE = 200
const TRIM_BATCH_SIZE = 40
const listRef = ref<HTMLElement | null>(null)
const loadedCount = ref(0)
const displayEntries = computed<DiaryListItem[]>(() => [...draftEntries.value, ...entries.value])

function stripHtml(html: string): string {
  if (!html) return ''
  const temp = document.createElement('div')
  temp.innerHTML = html
  const plain = (temp.textContent || temp.innerText || '').replace(/\s+/g, ' ').trim()
  return plain.slice(0, 80)
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekdays = tm('diaryList.weekdayShort') as string[]
  return t('diaryList.dateFormat', { month, day, weekday: weekdays[d.getDay()] })
}

async function loadEntries(reset = false): Promise<void> {
  if (loading.value) return
  if (!reset && !hasMore.value) return

  loading.value = true
  try {
    const offset = reset ? 0 : loadedCount.value
    // 使用 lightweight 模式：只加载元数据和纯文本，不加载图片
    const result = await window.api.getDiaryEntries({ limit: PAGE_SIZE, offset, lightweight: true })
    if (reset) {
      entries.value = result.entries
      loadedCount.value = result.entries.length
    } else {
      entries.value.push(...result.entries)
      loadedCount.value += result.entries.length
      await trimEntriesWindow()
    }
    hasMore.value = loadedCount.value < result.total
  } catch (error) {
    console.error('加载日记列表失败:', error)
  } finally {
    loading.value = false
  }
}

async function trimEntriesWindow(): Promise<void> {
  const overflow = entries.value.length - MAX_WINDOW_SIZE
  if (overflow <= 0) return

  let removeCount = Math.min(overflow, TRIM_BATCH_SIZE)
  if (props.selectedId) {
    const selectedIndex = entries.value.findIndex((entry) => entry.id === props.selectedId)
    if (selectedIndex >= 0 && selectedIndex < removeCount) {
      removeCount = selectedIndex
    }
  }
  if (removeCount <= 0) return

  const el = listRef.value
  let removedHeight = 0
  if (el) {
    const itemNodes = el.querySelectorAll<HTMLElement>('.diary-item:not(.is-draft)')
    for (let i = 0; i < removeCount && i < itemNodes.length; i += 1) {
      removedHeight += itemNodes[i].offsetHeight
    }
  }

  entries.value.splice(0, removeCount)
  await nextTick()

  if (el && removedHeight > 0) {
    el.scrollTop = Math.max(0, el.scrollTop - removedHeight)
  }
}

let scrollTimer: ReturnType<typeof setTimeout> | null = null

function handleScroll(): void {
  const el = listRef.value
  if (!el) return

  // 防抖优化：避免滚动时频繁触发
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      loadEntries()
    }
  }, 100)
}

async function refresh(): Promise<void> {
  hasMore.value = true
  loadedCount.value = 0
  await loadEntries(true)
}

onMounted(() => {
  loadEntries(true)
})

onBeforeUnmount(() => {
  if (scrollTimer) {
    clearTimeout(scrollTimer)
    scrollTimer = null
  }
})

function updateEntry(id: string, patch: Partial<DiaryEntry>): boolean {
  const idx = entries.value.findIndex((e) => e.id === id)
  if (idx !== -1) {
    entries.value[idx] = { ...entries.value[idx], ...patch }
    return true
  }

  const draftIdx = draftEntries.value.findIndex((e) => e.id === id)
  if (draftIdx !== -1) {
    draftEntries.value[draftIdx] = { ...draftEntries.value[draftIdx], ...patch }
    return true
  }

  return false
}

function removeEntry(id: string): void {
  const idx = entries.value.findIndex((e) => e.id === id)
  if (idx !== -1) {
    entries.value.splice(idx, 1)
    loadedCount.value = Math.max(loadedCount.value - 1, 0)
  }

  removeDraftEntry(id)
}

function prependDraftEntry(draft: DiaryEntryDraftInput): void {
  const next: DiaryEntryDraftItem = {
    ...draft,
    tags: [],
    isDraft: true
  }
  draftEntries.value = [next, ...draftEntries.value.filter((entry) => entry.id !== draft.id)]
}

function commitDraftEntry(tempId: string, saved: DiaryEntry): boolean {
  const draftIdx = draftEntries.value.findIndex((entry) => entry.id === tempId)
  if (draftIdx === -1) return false
  draftEntries.value.splice(draftIdx, 1)

  const existingIdx = entries.value.findIndex((entry) => entry.id === saved.id)
  if (existingIdx !== -1) {
    entries.value[existingIdx] = saved
    return true
  }

  const insertIdx = entries.value.findIndex((entry) => entry.createdAt < saved.createdAt)
  if (insertIdx === -1) {
    entries.value.push(saved)
  } else {
    entries.value.splice(insertIdx, 0, saved)
  }
  loadedCount.value += 1
  return true
}

function removeDraftEntry(tempId: string): void {
  const draftIdx = draftEntries.value.findIndex((entry) => entry.id === tempId)
  if (draftIdx !== -1) {
    draftEntries.value.splice(draftIdx, 1)
  }
}

defineExpose({
  refresh,
  updateEntry,
  removeEntry,
  prependDraftEntry,
  commitDraftEntry,
  removeDraftEntry
})
</script>

<style scoped>
.diary-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--n-color, #fff);
}

.list-topbar {
  padding: 12px;
  border-bottom: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
}

.list-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.diary-item {
  position: relative;
  padding: 12px;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
  margin-bottom: 4px;
}

.diary-item:hover {
  background: var(--app-accent-06, rgba(24, 160, 88, 0.06));
}

.diary-item.is-draft {
  background: var(--app-accent-08, rgba(24, 160, 88, 0.08));
  box-shadow: inset 0 0 0 1px var(--app-accent-20, rgba(24, 160, 88, 0.2));
}

.diary-item.is-draft::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  border: 1px solid var(--app-accent-24, rgba(24, 160, 88, 0.24));
  opacity: 0;
  animation: draft-sheen var(--motion-spring-normal) var(--ease-enter);
  pointer-events: none;
}

.diary-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 999px;
  background: var(--app-accent-color, #18a058);
  opacity: 0;
  transform: scaleY(0.5);
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.diary-item.active {
  background: var(--app-accent-12, rgba(24, 160, 88, 0.12));
}

.diary-item.active::before {
  opacity: 1;
  transform: scaleY(1);
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.item-date {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
  font-weight: 500;
}

.item-header-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.draft-tag {
  line-height: 1;
}

.item-mood {
  font-size: 14px;
}

.item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--n-text-color, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.item-preview {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.list-empty {
  text-align: center;
  padding: 40px 16px;
  color: var(--n-text-color-3, #999);
  font-size: 13px;
}

.list-loading {
  display: flex;
  justify-content: center;
  padding: 16px;
}

.date-picker-popup {
  padding: 4px;
}

.date-picker-label {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--n-text-color, #333);
}

.diary-item-motion-enter-active,
.diary-item-motion-leave-active {
  transition:
    transform var(--motion-spring-fast) var(--ease-spring-soft),
    opacity var(--motion-normal) var(--ease-standard),
    filter var(--motion-normal) var(--ease-standard);
}

.diary-item-motion-enter-from {
  opacity: 0;
  filter: blur(1px);
  transform: translateY(var(--motion-distance-md)) scale(var(--motion-scale-pop-start));
}

.diary-item-motion-enter-to {
  opacity: 1;
  filter: blur(0);
  transform: translateY(0) scale(1);
}

.diary-item-motion-leave-to {
  opacity: 0;
  filter: blur(1px);
  transform: translateY(calc(var(--motion-distance-sm) * -1)) scale(0.985);
}

.diary-item-motion-move {
  transition: transform var(--motion-spring-fast) var(--ease-spring-soft);
}

@keyframes draft-sheen {
  0% {
    opacity: 0.4;
  }
  100% {
    opacity: 0;
  }
}

:global(:root.reduced-motion) .diary-item-motion-enter-from,
:global(:root.reduced-motion) .diary-item-motion-leave-to {
  filter: none;
  transform: none;
}
</style>
