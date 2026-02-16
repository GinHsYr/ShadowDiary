<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import {
  NAvatar,
  NButton,
  NIcon,
  NInput,
  NLayoutHeader,
  NSpace,
  NPopover,
  NList,
  NListItem,
  NThing,
  NTag,
  NEmpty,
  NSelect,
  NDatePicker,
  NBadge,
  NDivider,
  NSpin
} from 'naive-ui'
import {
  Moon,
  SearchOutline,
  Sunny,
  FunnelOutline,
  CloseCircleOutline,
  TimeOutline,
  CloseOutline
} from '@vicons/ionicons5'
import { ThemeMode, useThemeStore } from '../stores/themes'
import { useRouter } from 'vue-router'
import type { Archive, DiaryEntry, Mood } from '../../../types/model'

const theme = useThemeStore()
const router = useRouter()

// --- Search state ---
const searchKeyword = ref('')
const searchResults = ref<DiaryEntry[]>([])
const searchTotal = ref(0)
const archiveResults = ref<Archive[]>([])
const expandedKeywords = ref<string[]>([]) // 扩展后的关键词（包含档案别名）
const showPopover = ref(false)
const searching = ref(false)
const isFocused = ref(false)
const searchInputRef = ref<InstanceType<typeof NInput> | null>(null)

// --- Filter state ---
const showFilter = ref(false)
const filterMood = ref<Mood | null>(null)
const filterTags = ref<string[]>([])
const filterDateRange = ref<[number, number] | null>(null)
const allTags = ref<{ label: string; value: string }[]>([])

const moodLabels: Record<string, string> = {
  happy: '😊 开心',
  calm: '😌 平静',
  sad: '😢 难过',
  excited: '🤩 兴奋',
  tired: '😴 疲惫'
}

const moodOptions = [
  { label: '😊 开心', value: 'happy' },
  { label: '😌 平静', value: 'calm' },
  { label: '😢 难过', value: 'sad' },
  { label: '🤩 兴奋', value: 'excited' },
  { label: '😴 疲惫', value: 'tired' }
]

const activeFilterCount = computed(() => {
  let count = 0
  if (filterMood.value) count++
  if (filterTags.value.length > 0) count++
  if (filterDateRange.value) count++
  return count
})

// --- Keyboard navigation ---
const activeIndex = ref(-1)

// --- Search history ---
const HISTORY_KEY = 'diary-search-history'
const MAX_HISTORY = 10
const searchHistory = ref<string[]>([])

const showingHistory = computed(() => {
  return (
    showPopover.value &&
    !searchKeyword.value.trim() &&
    searchHistory.value.length > 0 &&
    searchResults.value.length === 0 &&
    !searching.value
  )
})

function loadHistory(): void {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    searchHistory.value = raw ? JSON.parse(raw) : []
  } catch {
    searchHistory.value = []
  }
}

function saveToHistory(keyword: string): void {
  const trimmed = keyword.trim()
  if (!trimmed) return
  const list = searchHistory.value.filter((h) => h !== trimmed)
  list.unshift(trimmed)
  searchHistory.value = list.slice(0, MAX_HISTORY)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory.value))
}

function clearHistory(): void {
  searchHistory.value = []
  localStorage.removeItem(HISTORY_KEY)
}

function removeHistoryItem(keyword: string): void {
  searchHistory.value = searchHistory.value.filter((h) => h !== keyword)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory.value))
  if (searchHistory.value.length === 0) {
    showPopover.value = false
  }
}

function clickHistory(keyword: string): void {
  searchKeyword.value = keyword
  triggerSearch(keyword)
  // Clicking history counts as explicit search, save it
  saveToHistory(keyword)
}

// --- Multi-keyword helpers ---
/** Split search input into individual keywords */
function getKeywords(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean)
}

// --- Utility functions ---
// stripHtml function removed - no longer needed with lightweight mode

/** Escape special regex characters */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Highlight all keywords in text (supports multi-keyword and expanded keywords) */
// 在 highlightText 函数中对输入进行 HTML 转义
function highlightText(text: string, keyword: string, extraKeywords?: string[]): string {
  const escapeHtml = (str: string): string => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }

    return str.replace(/[&<>"']/g, (m) => map[m])
  }

  const escapedText = escapeHtml(text)

  // 收集所有需要高亮的关键词
  const allKeywords = new Set<string>()

  // 添加原始关键词
  const originalKeywords = keyword.trim().split(/\s+/).filter(Boolean)
  for (const kw of originalKeywords) {
    allKeywords.add(escapeHtml(kw))
  }

  // 添加扩展的关键词（档案别名）
  if (extraKeywords && extraKeywords.length > 0) {
    for (const kw of extraKeywords) {
      allKeywords.add(escapeHtml(kw))
    }
  }

  let result = escapedText

  for (const kw of allKeywords) {
    const regex = new RegExp(`(${escapeRegex(kw)})`, 'gi')
    result = result.replace(regex, '<mark>$1</mark>')
  }

  return result
}
/** Extract snippet around the first matching keyword */
function extractSnippet(
  html: string,
  rawKeyword: string,
  around = 40,
  extraKeywords?: string[]
): string {
  // lightweight 模式下 html 已经是纯文本
  const plain = html

  // 收集所有关键词（原始 + 扩展）
  const allKeywords = [...getKeywords(rawKeyword)]
  if (extraKeywords && extraKeywords.length > 0) {
    allKeywords.push(...extraKeywords)
  }

  if (allKeywords.length === 0) return plain.slice(0, around * 2)

  // Find the earliest match among all keywords
  const lower = plain.toLowerCase()
  let bestIdx = -1
  let bestKw = allKeywords[0]
  for (const kw of allKeywords) {
    const idx = lower.indexOf(kw.toLowerCase())
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx
      bestKw = kw
    }
  }

  if (bestIdx === -1) return plain.slice(0, around * 2)
  const start = Math.max(0, bestIdx - around)
  const end = Math.min(plain.length, bestIdx + bestKw.length + around)
  let snippet = ''
  if (start > 0) snippet += '...'
  snippet += plain.slice(start, end)
  if (end < plain.length) snippet += '...'
  return snippet
}

// --- Search logic ---
let searchTimer: ReturnType<typeof setTimeout> | null = null

async function triggerSearch(keyword?: string): Promise<void> {
  const kw = (keyword ?? searchKeyword.value).trim()
  const hasFilters = filterMood.value || filterTags.value.length > 0 || filterDateRange.value

  if (!kw && !hasFilters) {
    searchResults.value = []
    searchTotal.value = 0
    archiveResults.value = []
    showPopover.value = searchHistory.value.length > 0
    return
  }

  searching.value = true
  showPopover.value = true
  try {
    const params: Record<string, unknown> = { limit: 20, lightweight: true }
    if (kw) params.keyword = kw
    if (filterMood.value) params.mood = filterMood.value
    if (filterTags.value.length > 0) params.tags = filterTags.value
    if (filterDateRange.value) {
      params.dateFrom = filterDateRange.value[0]
      params.dateTo = filterDateRange.value[1]
    }

    // 同时搜索日记和档案
    const [diaryResult, archives] = await Promise.all([
      window.api.searchDiaries(params as never),
      kw ? window.api.getArchives({ search: kw }) : Promise.resolve([])
    ])

    searchResults.value = diaryResult.entries
    searchTotal.value = diaryResult.total
    archiveResults.value = archives
    // 保存扩展后的关键词用于高亮
    expandedKeywords.value = diaryResult.expandedKeywords || []
    showPopover.value = true
  } catch (error) {
    console.error('搜索失败:', error)
  } finally {
    searching.value = false
  }
}

const handleSearchInput = (value: string): void => {
  searchKeyword.value = value
  activeIndex.value = -1
  if (searchTimer) clearTimeout(searchTimer)

  if (!value.trim() && !filterMood.value && !filterTags.value.length && !filterDateRange.value) {
    searchResults.value = []
    searchTotal.value = 0
    archiveResults.value = []
    showPopover.value = searchHistory.value.length > 0
    return
  }

  searchTimer = setTimeout(() => triggerSearch(), 300)
}

// Re-search when filters change
watch([filterMood, filterTags, filterDateRange], () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => triggerSearch(), 300)
})

/** Navigate to diary entry, passing keyword for in-editor highlight */
const goToEntry = (entry: DiaryEntry): void => {
  const kw = searchKeyword.value.trim()
  const query: Record<string, string> = { id: entry.id }
  if (kw) query.keyword = kw
  router.push({ path: '/today', query })
  closeSearch()
}

/** Navigate to archive detail */
const goToArchive = (archive: Archive): void => {
  router.push({ path: '/archives', query: { id: archive.id } })
  closeSearch()
}

/** Close search popover and reset state */
function closeSearch(): void {
  showPopover.value = false
  showFilter.value = false
  searchKeyword.value = ''
  searchResults.value = []
  searchTotal.value = 0
  archiveResults.value = []
}

const formatDate = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// --- Filter panel ---
function toggleFilter(): void {
  showFilter.value = !showFilter.value
  if (showFilter.value) {
    showPopover.value = true
    loadTags()
  }
}

async function loadTags(): Promise<void> {
  try {
    const tags = await window.api.getAllTags()
    allTags.value = tags.map((t) => ({ label: t.name, value: t.name }))
  } catch (e) {
    console.error('加载标签失败:', e)
  }
}

function clearFilters(): void {
  filterMood.value = null
  filterTags.value = []
  filterDateRange.value = null
}

// --- Keyboard navigation ---
function handleKeydown(e: KeyboardEvent): void {
  const totalItems = showingHistory.value ? searchHistory.value.length : searchResults.value.length

  if (e.key === 'Enter') {
    e.preventDefault()
    if (activeIndex.value >= 0) {
      // Navigate to selected item
      if (showingHistory.value) {
        clickHistory(searchHistory.value[activeIndex.value])
      } else if (searchResults.value.length > 0) {
        goToEntry(searchResults.value[activeIndex.value])
      }
      activeIndex.value = -1
    } else {
      // No item selected — just save to history on Enter
      const kw = searchKeyword.value.trim()
      if (kw) {
        saveToHistory(kw)
        triggerSearch()
      }
    }
    return
  }

  if (!showPopover.value || totalItems === 0) {
    if (e.key === 'Escape') {
      showPopover.value = false
      showFilter.value = false
    }
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % totalItems
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + totalItems) % totalItems
  } else if (e.key === 'Escape') {
    showPopover.value = false
    showFilter.value = false
    activeIndex.value = -1
  }
}

// --- Global shortcut Ctrl+K / Cmd+K ---
function handleGlobalKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    nextTick(() => {
      const el = searchInputRef.value?.$el?.querySelector('input') as HTMLInputElement | undefined
      el?.focus()
    })
  }
}

// --- Theme ---
const changeTheme = (): void => {
  if (theme.isDark) {
    theme.setMode(ThemeMode.Light)
  } else {
    theme.setMode(ThemeMode.Dark)
  }
}

// --- Lifecycle ---
onMounted(() => {
  loadHistory()
  document.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
})
</script>

<template>
  <n-layout-header bordered class="app-header">
    <!-- 左侧搜索 -->
    <div class="header-left no-drag">
      <n-popover
        :show="showPopover"
        trigger="manual"
        placement="bottom-start"
        :show-arrow="false"
        raw
        style="width: 440px"
        @clickoutside="
          () => {
            showPopover = false
            showFilter = false
          }
        "
      >
        <template #trigger>
          <n-space :size="4" align="center" :wrap="false">
            <n-input
              ref="searchInputRef"
              :value="searchKeyword"
              round
              placeholder="搜索记忆... (Ctrl+K)"
              size="small"
              :class="['search-input', { 'search-input--focused': isFocused }]"
              :loading="searching"
              @update:value="handleSearchInput"
              @focus="
                () => {
                  isFocused = true
                  showPopover = true
                  if (!searchKeyword.trim()) loadHistory()
                }
              "
              @blur="isFocused = false"
              @keydown="handleKeydown"
            >
              <template #prefix>
                <n-icon :component="SearchOutline" />
              </template>
              <template v-if="searchKeyword" #suffix>
                <n-icon
                  :component="CloseCircleOutline"
                  class="search-clear"
                  @mousedown.prevent="
                    () => {
                      searchKeyword = ''
                      searchResults = []
                      searchTotal = 0
                      archiveResults = []
                      showPopover = searchHistory.length > 0
                    }
                  "
                />
              </template>
            </n-input>
            <n-badge :value="activeFilterCount" :show="activeFilterCount > 0" :offset="[-4, 4]">
              <n-button
                circle
                size="small"
                :type="showFilter ? 'primary' : 'default'"
                tertiary
                @click="toggleFilter"
              >
                <template #icon>
                  <n-icon :component="FunnelOutline" />
                </template>
              </n-button>
            </n-badge>
          </n-space>
        </template>

        <div class="search-popover">
          <!-- 筛选面板 -->
          <div v-if="showFilter" class="filter-panel">
            <div class="filter-header">
              <span class="filter-title">高级筛选</span>
              <n-button text size="tiny" type="primary" @click="clearFilters">重置</n-button>
            </div>
            <div class="filter-body">
              <div class="filter-row">
                <span class="filter-label">心情</span>
                <n-select
                  v-model:value="filterMood"
                  :options="moodOptions"
                  placeholder="选择心情"
                  size="small"
                  clearable
                  style="flex: 1"
                />
              </div>
              <div class="filter-row">
                <span class="filter-label">标签</span>
                <n-select
                  v-model:value="filterTags"
                  :options="allTags"
                  placeholder="选择标签"
                  size="small"
                  multiple
                  clearable
                  style="flex: 1"
                />
              </div>
              <div class="filter-row">
                <span class="filter-label">日期</span>
                <n-date-picker
                  v-model:value="filterDateRange"
                  type="daterange"
                  size="small"
                  clearable
                  style="flex: 1"
                />
              </div>
            </div>
            <n-divider style="margin: 8px 0" />
          </div>

          <!-- 搜索中 loading -->
          <div v-if="searching" class="search-loading">
            <n-spin size="small" />
            <span>搜索中...</span>
          </div>

          <!-- 搜索历史 -->
          <div v-else-if="showingHistory" class="history-section">
            <div class="history-header">
              <span class="history-title">
                <n-icon :component="TimeOutline" style="vertical-align: -2px" />
                搜索历史
              </span>
              <n-button text size="tiny" type="warning" @click="clearHistory">清除</n-button>
            </div>
            <div class="history-list">
              <div
                v-for="(item, index) in searchHistory"
                :key="item"
                class="history-item"
                :class="{ active: activeIndex === index }"
                @click="clickHistory(item)"
              >
                <span class="history-text">{{ item }}</span>
                <n-icon
                  :component="CloseOutline"
                  class="history-remove"
                  @click.stop="removeHistoryItem(item)"
                />
              </div>
            </div>
          </div>

          <!-- 搜索结果 -->
          <div v-else class="search-results">
            <!-- 档案结果 -->
            <template v-if="archiveResults.length > 0">
              <div class="result-section-title">档案</div>
              <n-list hoverable clickable size="small" class="archive-result-list">
                <n-list-item
                  v-for="archive in archiveResults.slice(0, 5)"
                  :key="archive.id"
                  @click="goToArchive(archive)"
                >
                  <template #prefix>
                    <n-avatar
                      :src="archive.mainImage || undefined"
                      :size="28"
                      round
                      :style="{ background: archive.mainImage ? 'transparent' : '#e7f5ee' }"
                    >
                      <template v-if="!archive.mainImage">
                        {{ archive.name.charAt(0) }}
                      </template>
                    </n-avatar>
                  </template>
                  <n-thing>
                    <template #header>
                      <span v-html="highlightText(archive.name, searchKeyword)" />
                    </template>
                    <template #description>
                      <n-space size="small" align="center">
                        <n-tag
                          :type="
                            archive.type === 'person'
                              ? 'info'
                              : archive.type === 'object'
                                ? 'success'
                                : 'warning'
                          "
                          size="tiny"
                        >
                          {{
                            archive.type === 'person'
                              ? '人物'
                              : archive.type === 'object'
                                ? '物品'
                                : '其他'
                          }}
                        </n-tag>
                        <span
                          v-if="archive.aliases?.length"
                          class="archive-alias"
                          v-html="highlightText(archive.aliases.join('、'), searchKeyword)"
                        />
                      </n-space>
                    </template>
                  </n-thing>
                </n-list-item>
              </n-list>
              <div v-if="archiveResults.length > 5" class="result-more">
                还有 {{ archiveResults.length - 5 }} 个档案
              </div>
            </template>

            <!-- 日记结果 -->
            <template v-if="searchResults.length > 0 || activeFilterCount > 0">
              <div v-if="archiveResults.length > 0" class="result-section-title">日记</div>
              <div v-if="searchResults.length > 0" class="result-count">
                找到 {{ searchTotal }} 条相关日记
                <span v-if="searchTotal > searchResults.length" class="result-hint">
                  （显示前 {{ searchResults.length }} 条）
                </span>
              </div>

              <n-list v-if="searchResults.length > 0" hoverable clickable size="small">
                <n-list-item
                  v-for="(entry, index) in searchResults"
                  :key="entry.id"
                  :class="{ active: activeIndex === index }"
                  @click="goToEntry(entry)"
                >
                  <n-thing>
                    <template #header>
                      <span
                        v-html="
                          highlightText(entry.title || '无标题', searchKeyword, expandedKeywords)
                        "
                      />
                    </template>
                    <template #description>
                      <n-space size="small" style="margin-bottom: 4px" align="center">
                        <n-tag size="tiny" :bordered="false">{{
                          formatDate(entry.createdAt)
                        }}</n-tag>
                        <n-tag size="tiny" type="success" :bordered="false">{{
                          moodLabels[entry.mood] || entry.mood
                        }}</n-tag>
                        <n-tag
                          v-for="tag in entry.tags.slice(0, 3)"
                          :key="tag"
                          size="tiny"
                          type="info"
                          :bordered="false"
                        >
                          {{ tag }}
                        </n-tag>
                        <span v-if="entry.tags.length > 3" class="more-tags"
                          >+{{ entry.tags.length - 3 }}</span
                        >
                      </n-space>
                      <div
                        v-if="searchKeyword.trim()"
                        class="content-snippet"
                        v-html="
                          highlightText(
                            extractSnippet(entry.content, searchKeyword, 40, expandedKeywords),
                            searchKeyword,
                            expandedKeywords
                          )
                        "
                      />
                    </template>
                  </n-thing>
                </n-list-item>
              </n-list>
            </template>

            <n-empty
              v-if="
                !searching &&
                searchResults.length === 0 &&
                archiveResults.length === 0 &&
                (searchKeyword.trim() || activeFilterCount > 0)
              "
              description="没有找到相关内容，换个关键词试试？"
              size="small"
              style="padding: 24px 0"
            />
          </div>

          <!-- 底部快捷键提示 -->
          <div
            v-if="
              showPopover &&
              (searchResults.length > 0 || archiveResults.length > 0 || showingHistory)
            "
            class="search-footer"
          >
            <span class="shortcut-hint">
              <kbd>↑</kbd><kbd>↓</kbd> 导航 <kbd>Enter</kbd> 选择 <kbd>Esc</kbd> 关闭
            </span>
          </div>
        </div>
      </n-popover>
    </div>

    <!-- 右侧工具 -->
    <div class="header-right no-drag">
      <n-space>
        <n-button circle size="small" tertiary @click="changeTheme">
          <template #icon>
            <n-icon>
              <Sunny v-if="theme.mode === ThemeMode.Light" />
              <Moon v-else-if="theme.mode === ThemeMode.Dark" />
            </n-icon>
          </template>
        </n-button>
      </n-space>
    </div>
  </n-layout-header>
</template>

<style scoped>
.app-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.search-input {
  width: 240px;
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.search-input--focused {
  width: 320px;
}

.search-clear {
  cursor: pointer;
  opacity: 0.4;
  transition: opacity 0.15s;
}

.search-clear:hover {
  opacity: 0.8;
}

.search-popover {
  background: var(--n-color, #fff);
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  border: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
  max-height: 480px;
  overflow-y: auto;
  overflow-x: hidden;
}

/* Filter panel */
.filter-panel {
  padding: 12px 14px 0;
}

.filter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.filter-title {
  font-size: 13px;
  font-weight: 600;
}

.filter-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
  width: 32px;
  flex-shrink: 0;
}

/* Loading */
.search-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  font-size: 13px;
  color: var(--n-text-color-3, #999);
}

/* History */
.history-section {
  padding: 10px 14px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.history-title {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
}

.history-list {
  display: flex;
  flex-direction: column;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.history-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item:hover,
.history-item.active {
  background: var(--n-color-hover, rgba(0, 0, 0, 0.04));
}

.history-remove {
  opacity: 0;
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;
  padding: 2px;
  border-radius: 4px;
  transition:
    opacity 0.15s,
    color 0.15s;
  color: var(--n-text-color-3, #999);
}

.history-item:hover .history-remove {
  opacity: 0.5;
}

.history-remove:hover {
  opacity: 1 !important;
  color: var(--n-error-color, #d03050);
}

/* Search results */
.result-section-title {
  padding: 8px 14px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-2, #666);
}

.result-count {
  padding: 4px 14px;
  font-size: 12px;
  color: var(--n-text-color-3, #999);
}

.result-hint {
  color: var(--n-text-color-4, #bbb);
}

.search-results {
  max-height: 380px;
  overflow-y: auto;
}

.search-results :deep(.n-list-item.active) {
  background: var(--n-color-hover, rgba(0, 0, 0, 0.04));
}

.more-tags {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
}

.content-snippet {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
  line-height: 1.5;
  margin-top: 2px;
  word-break: break-all;
}

.content-snippet :deep(mark),
.search-results :deep(mark) {
  background: rgba(var(--n-primary-color-rgb, 24, 160, 88), 0.2);
  color: var(--n-primary-color, #18a058);
  border-radius: 2px;
  padding: 0 1px;
}

/* Archive results */
.archive-result-list {
  margin-bottom: 8px;
}

.archive-alias {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
}

.result-more {
  padding: 4px 14px 8px;
  font-size: 11px;
  color: var(--n-text-color-4, #bbb);
  text-align: center;
}

/* Footer shortcuts hint */
.search-footer {
  padding: 6px 14px;
  border-top: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
  display: flex;
  justify-content: center;
}

.shortcut-hint {
  font-size: 11px;
  color: var(--n-text-color-4, #bbb);
  display: flex;
  align-items: center;
  gap: 4px;
}

.shortcut-hint kbd {
  display: inline-block;
  padding: 0 4px;
  font-size: 10px;
  font-family: inherit;
  line-height: 18px;
  background: var(--n-color-modal, rgba(0, 0, 0, 0.04));
  border: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.08));
  border-radius: 3px;
  min-width: 18px;
  text-align: center;
}
</style>
