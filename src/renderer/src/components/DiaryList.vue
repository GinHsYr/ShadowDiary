<template>
  <div class="diary-list">
    <!-- 日记列表 -->
    <div ref="listRef" class="list-body" @scroll="handleScroll">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="diary-item"
        :class="{ active: entry.id === selectedId }"
        @click="$emit('select', entry)"
      >
        <div class="item-header">
          <span class="item-date">{{ formatDate(entry.createdAt) }}</span>
          <span class="item-mood">{{ moodEmoji[entry.mood] || '' }}</span>
        </div>
        <div class="item-title">{{ entry.title || '无标题' }}</div>
        <div class="item-preview">{{ stripHtml(entry.content) }}</div>
      </div>

      <div v-if="entries.length === 0 && !loading" class="list-empty">
        <p>还没有日记</p>
      </div>

      <div v-if="loading" class="list-loading">
        <n-spin size="small" />
      </div>
    </div>

    <!-- 新建按钮 -->
    <div class="list-footer">
      <n-popover trigger="click" placement="top" :show="showDatePicker" @update:show="showDatePicker = $event">
        <template #trigger>
          <n-button block type="primary" ghost size="small">
            + 新建日记
          </n-button>
        </template>
        <div class="date-picker-popup">
          <p class="date-picker-label">选择日期</p>
          <n-date-picker
            v-model:value="newDiaryDate"
            type="date"
            :actions="[]"
            panel
          />
          <n-button
            type="primary"
            size="small"
            block
            style="margin-top: 8px"
            @click="confirmCreate"
          >
            确定
          </n-button>
        </div>
      </n-popover>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NButton, NSpin, NPopover, NDatePicker } from 'naive-ui'
import type { DiaryEntry } from '../../../types/model'

defineProps<{
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [entry: DiaryEntry]
  create: [dateStr: string]
}>()

const showDatePicker = ref(false)
const newDiaryDate = ref<number>(Date.now())

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
const loading = ref(false)
const hasMore = ref(true)
const PAGE_SIZE = 10 // 减少每页加载数量，从 20 降到 10
const listRef = ref<HTMLElement | null>(null)

function stripHtml(html: string): string {
  if (!html) return ''
  // lightweight 模式下 content 已经是 plain_content，直接截取
  return html.slice(0, 80)
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${month}月${day}日 周${weekdays[d.getDay()]}`
}

async function loadEntries(reset = false): Promise<void> {
  if (loading.value) return
  if (!reset && !hasMore.value) return

  loading.value = true
  try {
    const offset = reset ? 0 : entries.value.length
    // 使用 lightweight 模式：只加载元数据和纯文本，不加载图片
    const result = await window.api.getDiaryEntries({ limit: PAGE_SIZE, offset, lightweight: true })
    if (reset) {
      entries.value = result.entries
    } else {
      entries.value.push(...result.entries)
    }
    hasMore.value = entries.value.length < result.total
  } catch (error) {
    console.error('加载日记列表失败:', error)
  } finally {
    loading.value = false
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
  await loadEntries(true)
}

onMounted(() => {
  loadEntries(true)
})

function updateEntry(id: string, patch: Partial<DiaryEntry>): void {
  const idx = entries.value.findIndex((e) => e.id === id)
  if (idx !== -1) {
    entries.value[idx] = { ...entries.value[idx], ...patch }
  }
}

defineExpose({ refresh, updateEntry })
</script>

<style scoped>
.diary-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--n-color, #fff);
}

.list-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.diary-item {
  padding: 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 4px;
}

.diary-item:hover {
  background: rgba(102, 126, 234, 0.06);
}

.diary-item.active {
  background: rgba(102, 126, 234, 0.12);
  box-shadow: inset 3px 0 0 #667eea;
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

.list-footer {
  padding: 12px;
  border-top: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
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
</style>
