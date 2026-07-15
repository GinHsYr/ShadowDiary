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
    <div class="list-body-shell">
      <div
        ref="listRef"
        class="list-body"
        :class="{ 'has-fast-scroll': showFastScroller }"
        @scroll="handleScroll"
        @wheel.passive="handleUserScrollIntent"
        @touchstart.passive="handleUserScrollIntent"
      >
        <transition-group name="diary-item-motion" tag="div" class="diary-item-group">
          <div
            v-for="entry in displayEntries"
            :key="entry.id"
            class="diary-item"
            :class="{ active: entry.id === selectedId, 'is-draft': isDraftEntry(entry) }"
            :data-diary-id="entry.id"
            @click="handleItemClick(entry)"
            @contextmenu.prevent="handleContextMenu($event, entry)"
          >
            <div class="item-header">
              <span class="item-date">{{ formatDate(entry.createdAt) }}</span>
              <div class="item-header-right">
                <n-tag
                  v-if="isDraftEntry(entry)"
                  size="tiny"
                  round
                  type="warning"
                  class="draft-tag"
                >
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

      <div
        v-if="showFastScroller"
        ref="fastScrollRailRef"
        class="fast-scroll-rail"
        :class="{ 'is-dragging': fastScrollDragging }"
        role="scrollbar"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="t('diaryList.quickScroll')"
        :aria-valuemin="1"
        :aria-valuemax="Math.max(totalCount, 1)"
        :aria-valuenow="Math.min(fastScrollDisplayIndex + 1, Math.max(totalCount, 1))"
        @pointerdown="handleFastScrollPointerDown"
        @pointermove="handleFastScrollPointerMove"
        @pointerup="handleFastScrollPointerUp"
        @pointercancel="handleFastScrollPointerCancel"
        @keydown="handleFastScrollKeydown"
      >
        <div class="fast-scroll-track" aria-hidden="true" />
        <div class="fast-scroll-thumb" :style="fastScrollThumbStyle" aria-hidden="true" />
        <div
          v-if="fastScrollDragging"
          class="fast-scroll-date-bubble"
          :style="fastScrollBubbleStyle"
          aria-hidden="true"
        >
          {{ fastScrollPreviewDate || '…' }}
        </div>
      </div>

      <!-- 定位当前日记 -->
      <n-button
        v-if="showLocateButton"
        class="locate-selected-btn"
        :class="{ 'with-fast-scroll': showFastScroller }"
        type="primary"
        size="small"
        circle
        secondary
        :title="t('diaryList.locateSelected')"
        :aria-label="t('diaryList.locateSelected')"
        :loading="locatingSelected"
        @click="handleLocateSelectedClick"
      >
        <template #icon>
          <n-icon :component="LocateOutline" />
        </template>
      </n-button>
    </div>

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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { NButton, NDatePicker, NDropdown, NIcon, NPopover, NSpin, NTag } from 'naive-ui'
import { LocateOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import type { DiaryEntry, Mood } from '../../../types/model'
const { t, tm, locale } = useI18n()

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
type DiaryListScrollBehavior = 'auto' | 'smooth'

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
const PAGE_SIZE = 10 // 减少每页加载数量，从 20 降到 10
const JUMP_WINDOW_SIZE = 40
const MAX_WINDOW_SIZE = 200
const TRIM_BATCH_SIZE = 40
const FAST_SCROLL_THUMB_HEIGHT = 32
const listRef = ref<HTMLElement | null>(null)
const fastScrollRailRef = ref<HTMLElement | null>(null)
const windowStartOffset = ref(0)
const totalCount = ref(0)
const displayEntries = computed<DiaryListItem[]>(() => [...draftEntries.value, ...entries.value])
const hasMoreNewer = computed(() => windowStartOffset.value > 0)
const hasMoreOlder = computed(
  () => windowStartOffset.value + entries.value.length < totalCount.value
)
const locatingSelected = ref(false)
const selectedNeedsLocation = ref(false)
const userDetachedSelected = ref(false)
const showFastScroller = ref(false)
const fastScrollCurrentIndex = ref(0)
const fastScrollTargetIndex = ref<number | null>(null)
const fastScrollDragging = ref(false)
const fastScrollRailHeight = ref(0)
const fastScrollPreviewDate = ref('')
const fastScrollDisplayIndex = computed(
  () => fastScrollTargetIndex.value ?? fastScrollCurrentIndex.value
)
const fastScrollProgress = computed(() => {
  const travel = Math.max(0, fastScrollRailHeight.value - FAST_SCROLL_THUMB_HEIGHT)
  const denominator = Math.max(1, totalCount.value - 1)
  const progress = Math.min(1, Math.max(0, fastScrollDisplayIndex.value / denominator))
  return { progress, travel }
})
const fastScrollThumbStyle = computed<CSSProperties>(() => {
  return {
    height: `${FAST_SCROLL_THUMB_HEIGHT}px`,
    transform: `translateY(${Math.round(fastScrollProgress.value.travel * fastScrollProgress.value.progress)}px)`
  }
})
const fastScrollBubbleStyle = computed<CSSProperties>(() => {
  return {
    top: `${Math.round(
      fastScrollProgress.value.travel * fastScrollProgress.value.progress +
        FAST_SCROLL_THUMB_HEIGHT / 2
    )}px`
  }
})
const showLocateButton = computed(
  () => Boolean(props.selectedId) && (selectedNeedsLocation.value || userDetachedSelected.value)
)

let programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null
let isProgrammaticScroll = false
let locationFrame = 0
let fastScrollFrame = 0
let listResizeObserver: ResizeObserver | null = null
let fastScrollPointerOffset = FAST_SCROLL_THUMB_HEIGHT / 2
let fastScrollPreviewPendingIndex: number | null = null
let fastScrollPreviewRequestInFlight = false
let fastScrollPreviewTimer: ReturnType<typeof setTimeout> | null = null
let fastScrollPreviewGeneration = 0

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

function formatFastScrollDate(ts: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(new Date(ts))
}

function getSelectedItemElement(): HTMLElement | null {
  const el = listRef.value
  const selectedId = props.selectedId
  if (!el || !selectedId) return null

  return (
    Array.from(el.querySelectorAll<HTMLElement>('.diary-item')).find(
      (item) => item.dataset.diaryId === selectedId
    ) ?? null
  )
}

function isElementComfortablyVisible(item: HTMLElement): boolean {
  const el = listRef.value
  if (!el) return false

  const margin = 12
  const itemTop = item.offsetTop
  const itemBottom = itemTop + item.offsetHeight
  const viewportTop = el.scrollTop + margin
  const viewportBottom = el.scrollTop + el.clientHeight - margin

  return itemTop >= viewportTop && itemBottom <= viewportBottom
}

function markProgrammaticScroll(): void {
  isProgrammaticScroll = true
  if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer)
  programmaticScrollTimer = setTimeout(() => {
    isProgrammaticScroll = false
    programmaticScrollTimer = null
    updateSelectedLocationState()
  }, 420)
}

function updateSelectedLocationState(): void {
  if (!props.selectedId) {
    selectedNeedsLocation.value = false
    userDetachedSelected.value = false
    return
  }

  const item = getSelectedItemElement()
  selectedNeedsLocation.value = !item || !isElementComfortablyVisible(item)
}

function queueSelectedLocationStateUpdate(): void {
  if (locationFrame) return
  locationFrame = window.requestAnimationFrame(() => {
    locationFrame = 0
    updateSelectedLocationState()
  })
}

function handleUserScrollIntent(): void {
  if (!props.selectedId || isProgrammaticScroll) return
  userDetachedSelected.value = true
  queueSelectedLocationStateUpdate()
}

function getPersistedItemElements(): HTMLElement[] {
  return listRef.value
    ? Array.from(listRef.value.querySelectorAll<HTMLElement>('.diary-item:not(.is-draft)'))
    : []
}

function updateFastScrollState(): void {
  const el = listRef.value
  if (!el) return

  const itemElements = getPersistedItemElements()
  const viewportMiddle = el.scrollTop + el.clientHeight / 2
  let localIndex = 0
  if (el.scrollTop > 1) {
    for (let index = 0; index < itemElements.length; index += 1) {
      const item = itemElements[index]
      if (item.offsetTop + item.offsetHeight / 2 <= viewportMiddle) {
        localIndex = index
      } else {
        break
      }
    }
  }

  if (!fastScrollDragging.value) {
    const isAtAbsoluteEnd =
      !hasMoreOlder.value && el.scrollTop + el.clientHeight >= el.scrollHeight - 1
    fastScrollCurrentIndex.value = isAtAbsoluteEnd
      ? Math.max(0, totalCount.value - 1)
      : Math.min(
          Math.max(0, windowStartOffset.value + localIndex),
          Math.max(0, totalCount.value - 1)
        )
  }

  showFastScroller.value =
    totalCount.value > entries.value.length || el.scrollHeight > el.clientHeight + 1

  void nextTick(() => {
    fastScrollRailHeight.value = fastScrollRailRef.value?.clientHeight ?? 0
  })
}

function queueFastScrollStateUpdate(): void {
  if (fastScrollFrame) return
  fastScrollFrame = window.requestAnimationFrame(() => {
    fastScrollFrame = 0
    updateFastScrollState()
  })
}

function getFastScrollIndexFromPointer(clientY: number): number {
  const rail = fastScrollRailRef.value
  if (!rail || totalCount.value <= 1) return 0

  const rect = rail.getBoundingClientRect()
  const travel = Math.max(1, rect.height - FAST_SCROLL_THUMB_HEIGHT)
  const position = clientY - rect.top - fastScrollPointerOffset
  const progress = Math.min(1, Math.max(0, position / travel))
  return Math.round(progress * (totalCount.value - 1))
}

function getLoadedEntryAtAbsoluteIndex(index: number): DiaryEntry | undefined {
  const localIndex = index - windowStartOffset.value
  return localIndex >= 0 ? entries.value[localIndex] : undefined
}

function scheduleNextFastScrollPreviewRequest(): void {
  if (fastScrollPreviewPendingIndex === null || fastScrollPreviewTimer) return
  fastScrollPreviewTimer = setTimeout(() => {
    fastScrollPreviewTimer = null
    void runFastScrollPreviewRequest()
  }, 80)
}

async function runFastScrollPreviewRequest(): Promise<void> {
  if (fastScrollPreviewRequestInFlight || fastScrollPreviewPendingIndex === null) return

  const index = fastScrollPreviewPendingIndex
  const generation = fastScrollPreviewGeneration
  fastScrollPreviewPendingIndex = null
  fastScrollPreviewRequestInFlight = true
  try {
    const result = await window.api.getDiaryEntries({ limit: 1, offset: index, lightweight: true })
    if (
      generation === fastScrollPreviewGeneration &&
      fastScrollDragging.value &&
      fastScrollTargetIndex.value === index
    ) {
      const entry = result.entries[0]
      fastScrollPreviewDate.value = entry ? formatFastScrollDate(entry.createdAt) : ''
    }
  } catch (error) {
    console.error('加载快速滑动日期失败:', error)
  } finally {
    fastScrollPreviewRequestInFlight = false
    scheduleNextFastScrollPreviewRequest()
  }
}

function queueFastScrollDatePreview(index: number): void {
  const loadedEntry = getLoadedEntryAtAbsoluteIndex(index)
  if (loadedEntry) {
    fastScrollPreviewPendingIndex = null
    if (fastScrollPreviewTimer) {
      clearTimeout(fastScrollPreviewTimer)
      fastScrollPreviewTimer = null
    }
    fastScrollPreviewDate.value = formatFastScrollDate(loadedEntry.createdAt)
    return
  }

  fastScrollPreviewDate.value = ''
  fastScrollPreviewPendingIndex = index
  if (!fastScrollPreviewRequestInFlight && !fastScrollPreviewTimer) {
    void runFastScrollPreviewRequest()
  }
}

function resetFastScrollDatePreview(): void {
  fastScrollPreviewGeneration += 1
  fastScrollPreviewPendingIndex = null
  fastScrollPreviewDate.value = ''
  if (fastScrollPreviewTimer) {
    clearTimeout(fastScrollPreviewTimer)
    fastScrollPreviewTimer = null
  }
}

function updateFastScrollTarget(clientY: number): void {
  const targetIndex = getFastScrollIndexFromPointer(clientY)
  fastScrollTargetIndex.value = targetIndex
  queueFastScrollDatePreview(targetIndex)
}

function handleFastScrollPointerDown(event: PointerEvent): void {
  if (loading.value || totalCount.value <= 1) return
  event.preventDefault()
  fastScrollDragging.value = true
  if (props.selectedId) userDetachedSelected.value = true
  const target = event.target as HTMLElement | null
  const thumb = target?.closest<HTMLElement>('.fast-scroll-thumb')
  fastScrollPointerOffset = thumb
    ? Math.min(
        FAST_SCROLL_THUMB_HEIGHT,
        Math.max(0, event.clientY - thumb.getBoundingClientRect().top)
      )
    : FAST_SCROLL_THUMB_HEIGHT / 2
  fastScrollRailRef.value?.setPointerCapture(event.pointerId)
  updateFastScrollTarget(event.clientY)
}

function handleFastScrollPointerMove(event: PointerEvent): void {
  if (!fastScrollDragging.value) return
  updateFastScrollTarget(event.clientY)
}

function finishFastScrollPointer(event: PointerEvent, shouldJump: boolean): void {
  if (!fastScrollDragging.value) return
  const rail = fastScrollRailRef.value
  if (rail?.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId)

  const targetIndex = fastScrollTargetIndex.value
  fastScrollDragging.value = false
  fastScrollTargetIndex.value = null
  fastScrollPointerOffset = FAST_SCROLL_THUMB_HEIGHT / 2
  resetFastScrollDatePreview()
  if (shouldJump && targetIndex !== null) void jumpToAbsoluteIndex(targetIndex)
}

function handleFastScrollPointerUp(event: PointerEvent): void {
  finishFastScrollPointer(event, true)
}

function handleFastScrollPointerCancel(event: PointerEvent): void {
  finishFastScrollPointer(event, false)
}

function handleFastScrollKeydown(event: KeyboardEvent): void {
  if (loading.value || totalCount.value <= 1) return

  const el = listRef.value
  const viewportTop = el?.scrollTop ?? 0
  const viewportBottom = viewportTop + (el?.clientHeight ?? 0)
  const visibleItems = Math.max(
    1,
    getPersistedItemElements().filter(
      (item) => item.offsetTop + item.offsetHeight > viewportTop && item.offsetTop < viewportBottom
    ).length
  )
  let targetIndex = fastScrollCurrentIndex.value

  if (event.key === 'ArrowUp') targetIndex -= 1
  else if (event.key === 'ArrowDown') targetIndex += 1
  else if (event.key === 'PageUp') targetIndex -= visibleItems
  else if (event.key === 'PageDown') targetIndex += visibleItems
  else if (event.key === 'Home') targetIndex = 0
  else if (event.key === 'End') targetIndex = totalCount.value - 1
  else return

  event.preventDefault()
  if (props.selectedId) userDetachedSelected.value = true
  void jumpToAbsoluteIndex(Math.min(totalCount.value - 1, Math.max(0, targetIndex)))
}

async function loadUntilSelectedEntry(): Promise<boolean> {
  if (!props.selectedId) return false
  if (getSelectedItemElement()) return true

  if (windowStartOffset.value > 0) {
    await loadEntries(true)
    await nextTick()
  }

  while (hasMoreOlder.value && !getSelectedItemElement()) {
    const beforeWindowEnd = windowStartOffset.value + entries.value.length
    await loadEntries()
    await nextTick()

    const nextWindowEnd = windowStartOffset.value + entries.value.length
    if (nextWindowEnd === beforeWindowEnd || loading.value) break
  }

  return Boolean(getSelectedItemElement())
}

async function locateSelectedEntry(
  force = false,
  behavior: DiaryListScrollBehavior = 'smooth'
): Promise<void> {
  if (!props.selectedId || locatingSelected.value) return

  locatingSelected.value = true
  try {
    await nextTick()
    await loadUntilSelectedEntry()
    await nextTick()

    const el = listRef.value
    const item = getSelectedItemElement()
    if (!el || !item) {
      updateSelectedLocationState()
      return
    }

    if (!force && isElementComfortablyVisible(item)) {
      selectedNeedsLocation.value = false
      userDetachedSelected.value = false
      return
    }

    const targetTop = Math.max(
      0,
      item.offsetTop - Math.max(16, (el.clientHeight - item.offsetHeight) / 2)
    )
    markProgrammaticScroll()
    el.scrollTo({ top: targetTop, behavior })
    userDetachedSelected.value = false
    selectedNeedsLocation.value = false
  } finally {
    locatingSelected.value = false
    setTimeout(updateSelectedLocationState, 460)
  }
}

function handleLocateSelectedClick(): void {
  void locateSelectedEntry(true)
}

function syncSelectedLocationAfterMutation(): void {
  void nextTick(() => {
    if (props.selectedId && !userDetachedSelected.value) {
      void locateSelectedEntry(false, 'auto')
    } else {
      updateSelectedLocationState()
    }
  })
}

async function loadEntries(reset = false): Promise<void> {
  if (loading.value) return
  if (!reset && !hasMoreOlder.value) return

  loading.value = true
  try {
    const offset = reset ? 0 : windowStartOffset.value + entries.value.length
    // 使用 lightweight 模式：只加载元数据和纯文本，不加载图片
    const result = await window.api.getDiaryEntries({ limit: PAGE_SIZE, offset, lightweight: true })
    totalCount.value = result.total
    if (reset) {
      entries.value = result.entries
      windowStartOffset.value = 0
    } else {
      const existingIds = new Set(entries.value.map((entry) => entry.id))
      entries.value.push(...result.entries.filter((entry) => !existingIds.has(entry.id)))
      await trimEntriesWindowFromStart()
    }
  } catch (error) {
    console.error('加载日记列表失败:', error)
  } finally {
    loading.value = false
    await nextTick()
    if (reset && listRef.value) listRef.value.scrollTop = 0
    updateFastScrollState()
    if (props.selectedId && !locatingSelected.value && !userDetachedSelected.value) {
      void locateSelectedEntry(false, 'auto')
    } else {
      updateSelectedLocationState()
    }
  }
}

async function loadNewerEntries(): Promise<void> {
  if (loading.value || !hasMoreNewer.value) return

  const previousStart = windowStartOffset.value
  const limit = Math.min(PAGE_SIZE, previousStart)
  const offset = previousStart - limit
  const el = listRef.value
  const anchorEntry = entries.value[0]
  const anchorElement = anchorEntry
    ? el?.querySelector<HTMLElement>(`.diary-item[data-diary-id="${anchorEntry.id}"]`)
    : null
  const previousAnchorTop = anchorElement?.offsetTop ?? 0

  loading.value = true
  try {
    const result = await window.api.getDiaryEntries({ limit, offset, lightweight: true })
    totalCount.value = result.total
    const existingIds = new Set(entries.value.map((entry) => entry.id))
    const newerEntries = result.entries.filter((entry) => !existingIds.has(entry.id))
    entries.value.unshift(...newerEntries)
    windowStartOffset.value = offset
    trimEntriesWindowFromEnd()
    await nextTick()

    const nextAnchorElement = anchorEntry
      ? el?.querySelector<HTMLElement>(`.diary-item[data-diary-id="${anchorEntry.id}"]`)
      : null
    if (el && nextAnchorElement) {
      markProgrammaticScroll()
      el.scrollTop += Math.max(0, nextAnchorElement.offsetTop - previousAnchorTop)
    }
  } catch (error) {
    console.error('加载较新的日记列表失败:', error)
  } finally {
    loading.value = false
    await nextTick()
    updateFastScrollState()
  }
}

async function jumpToAbsoluteIndex(index: number): Promise<void> {
  if (loading.value || totalCount.value <= 0) return

  const targetIndex = Math.min(totalCount.value - 1, Math.max(0, Math.round(index)))
  const limit = Math.min(JUMP_WINDOW_SIZE, totalCount.value)
  const offset = Math.min(
    Math.max(0, targetIndex - Math.floor(limit / 2)),
    Math.max(0, totalCount.value - limit)
  )

  loading.value = true
  try {
    const result = await window.api.getDiaryEntries({ limit, offset, lightweight: true })
    totalCount.value = result.total
    entries.value = result.entries
    windowStartOffset.value = offset
    await nextTick()

    const el = listRef.value
    const targetEntry = result.entries[targetIndex - offset]
    const targetElement = targetEntry
      ? el?.querySelector<HTMLElement>(`.diary-item[data-diary-id="${targetEntry.id}"]`)
      : null
    if (el && targetElement) {
      const targetTop = Math.max(
        0,
        targetElement.offsetTop - (el.clientHeight - targetElement.offsetHeight) / 2
      )
      markProgrammaticScroll()
      el.scrollTop = targetTop
    }
    fastScrollCurrentIndex.value = targetIndex
  } catch (error) {
    console.error('跳转日记列表失败:', error)
  } finally {
    loading.value = false
    await nextTick()
    updateFastScrollState()
    updateSelectedLocationState()
  }
}

async function trimEntriesWindowFromStart(): Promise<void> {
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
  windowStartOffset.value += removeCount
  await nextTick()

  if (el && removedHeight > 0) {
    el.scrollTop = Math.max(0, el.scrollTop - removedHeight)
  }
}

function trimEntriesWindowFromEnd(): void {
  const overflow = entries.value.length - MAX_WINDOW_SIZE
  if (overflow <= 0) return

  let removeCount = Math.min(overflow, TRIM_BATCH_SIZE)
  if (props.selectedId) {
    const selectedIndex = entries.value.findIndex((entry) => entry.id === props.selectedId)
    const removalStart = entries.value.length - removeCount
    if (selectedIndex >= removalStart) {
      removeCount = entries.value.length - selectedIndex - 1
    }
  }
  if (removeCount > 0) entries.value.splice(entries.value.length - removeCount, removeCount)
}

let scrollTimer: ReturnType<typeof setTimeout> | null = null

function handleScroll(): void {
  const el = listRef.value
  if (!el) return

  // 防抖优化：避免滚动时频繁触发
  if (!isProgrammaticScroll && props.selectedId) {
    const selectedItem = getSelectedItemElement()
    if (selectedItem && !isElementComfortablyVisible(selectedItem)) {
      userDetachedSelected.value = true
    }
  }
  queueSelectedLocationStateUpdate()
  queueFastScrollStateUpdate()

  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    if (el.scrollTop <= 50 && hasMoreNewer.value) {
      void loadNewerEntries()
    } else if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      void loadEntries()
    }
  }, 100)
}

async function refresh(): Promise<void> {
  windowStartOffset.value = 0
  await loadEntries(true)
}

onMounted(() => {
  listResizeObserver = new ResizeObserver(() => queueFastScrollStateUpdate())
  if (listRef.value) listResizeObserver.observe(listRef.value)
  void loadEntries(true)
})

watch(
  () => props.selectedId,
  (selectedId) => {
    userDetachedSelected.value = false
    selectedNeedsLocation.value = false
    if (selectedId) {
      void locateSelectedEntry(false)
    } else {
      updateSelectedLocationState()
    }
  }
)

onBeforeUnmount(() => {
  if (scrollTimer) {
    clearTimeout(scrollTimer)
    scrollTimer = null
  }
  if (programmaticScrollTimer) {
    clearTimeout(programmaticScrollTimer)
    programmaticScrollTimer = null
  }
  if (locationFrame) {
    window.cancelAnimationFrame(locationFrame)
    locationFrame = 0
  }
  if (fastScrollFrame) {
    window.cancelAnimationFrame(fastScrollFrame)
    fastScrollFrame = 0
  }
  listResizeObserver?.disconnect()
  listResizeObserver = null
  resetFastScrollDatePreview()
})

function updateEntry(id: string, patch: Partial<DiaryEntry>): boolean {
  const idx = entries.value.findIndex((e) => e.id === id)
  if (idx !== -1) {
    entries.value[idx] = { ...entries.value[idx], ...patch }
    syncSelectedLocationAfterMutation()
    return true
  }

  const draftIdx = draftEntries.value.findIndex((e) => e.id === id)
  if (draftIdx !== -1) {
    draftEntries.value[draftIdx] = { ...draftEntries.value[draftIdx], ...patch }
    syncSelectedLocationAfterMutation()
    return true
  }

  return false
}

function removeEntry(id: string): void {
  const idx = entries.value.findIndex((e) => e.id === id)
  if (idx !== -1) {
    entries.value.splice(idx, 1)
    totalCount.value = Math.max(totalCount.value - 1, 0)
    queueFastScrollStateUpdate()
    syncSelectedLocationAfterMutation()
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
  syncSelectedLocationAfterMutation()
}

function commitDraftEntry(tempId: string, saved: DiaryEntry): boolean {
  const draftIdx = draftEntries.value.findIndex((entry) => entry.id === tempId)
  if (draftIdx === -1) return false
  draftEntries.value.splice(draftIdx, 1)

  const existingIdx = entries.value.findIndex((entry) => entry.id === saved.id)
  if (existingIdx !== -1) {
    entries.value[existingIdx] = saved
    syncSelectedLocationAfterMutation()
    return true
  }

  totalCount.value += 1
  const firstEntry = entries.value[0]
  const lastEntry = entries.value[entries.value.length - 1]
  const isBeforeWindow = firstEntry && saved.createdAt > firstEntry.createdAt
  const isAfterWindow = lastEntry && saved.createdAt < lastEntry.createdAt && hasMoreOlder.value

  if (isBeforeWindow && windowStartOffset.value > 0) {
    windowStartOffset.value += 1
  } else if (!isAfterWindow) {
    const insertIdx = entries.value.findIndex((entry) => entry.createdAt < saved.createdAt)
    if (insertIdx === -1) {
      entries.value.push(saved)
    } else {
      entries.value.splice(insertIdx, 0, saved)
    }
    trimEntriesWindowFromEnd()
  }
  queueFastScrollStateUpdate()
  syncSelectedLocationAfterMutation()
  return true
}

function removeDraftEntry(tempId: string): void {
  const draftIdx = draftEntries.value.findIndex((entry) => entry.id === tempId)
  if (draftIdx !== -1) {
    draftEntries.value.splice(draftIdx, 1)
    syncSelectedLocationAfterMutation()
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

.list-body-shell {
  position: relative;
  flex: 1;
  min-height: 0;
}

.list-body {
  height: 100%;
  overflow-y: auto;
  padding: 8px;
}

.list-body.has-fast-scroll {
  padding-right: 14px;
  scrollbar-width: none;
}

.list-body.has-fast-scroll::-webkit-scrollbar {
  width: 0;
}

.fast-scroll-rail {
  position: absolute;
  top: 8px;
  right: 2px;
  bottom: 8px;
  z-index: 3;
  width: 10px;
  cursor: pointer;
  touch-action: none;
  outline: none;
}

.fast-scroll-track {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--n-text-color-3, #999) 18%, transparent);
}

.fast-scroll-thumb {
  position: absolute;
  top: 0;
  left: 3px;
  width: 4px;
  min-height: 32px;
  border-radius: 999px;
  background: color-mix(
    in srgb,
    var(--app-accent-color, var(--n-primary-color, #18a058)) 72%,
    var(--n-text-color-3, #999)
  );
  transition:
    width var(--motion-fast) var(--ease-standard),
    left var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

.fast-scroll-rail:hover .fast-scroll-thumb,
.fast-scroll-rail:focus-visible .fast-scroll-thumb,
.fast-scroll-rail.is-dragging .fast-scroll-thumb {
  left: 2px;
  width: 6px;
  background: var(--app-accent-color, var(--n-primary-color, #18a058));
}

.fast-scroll-date-bubble {
  position: absolute;
  right: 16px;
  min-width: max-content;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(24, 24, 28, 0.9);
  color: #fff;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  pointer-events: none;
  transform: translateY(-50%);
}

.locate-selected-btn {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 2;
  box-shadow:
    0 0 0 1px var(--app-accent-20, rgba(24, 160, 88, 0.2)),
    0 10px 24px rgba(15, 23, 42, 0.14);
  backdrop-filter: blur(8px);
}

.locate-selected-btn.with-fast-scroll {
  right: 22px;
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
