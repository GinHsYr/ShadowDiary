<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NButton, NButtonGroup, NEmpty, NIcon, NPopover, NSpin } from 'naive-ui'
import { CloseOutline, ChevronBackOutline, ChevronForwardOutline } from '@vicons/ionicons5'
import type {
  MediaLibraryItem,
  MediaLibrarySourceRef,
  MediaLibrarySourceType
} from '../../../../types/model'

type MediaFilterType = 'all' | MediaLibrarySourceType

const PAGE_SIZE = 72
const VISIBLE_SOURCE_LIMIT = 2

const { t } = useI18n()
const router = useRouter()

const sourceFilter = ref<MediaFilterType>('all')
const mediaItems = ref<MediaLibraryItem[]>([])
const total = ref(0)
const loadingInitial = ref(false)
const loadingMore = ref(false)
const initialized = ref(false)
const requestId = ref(0)
const scrollContainerRef = ref<HTMLElement | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const lightboxIndex = ref<number | null>(null)
const lightboxOpen = computed(() => lightboxIndex.value !== null)
const currentItem = computed<MediaLibraryItem | null>(() => {
  const idx = lightboxIndex.value
  if (idx === null) return null
  return mediaItems.value[idx] ?? null
})

const ZOOM_MIN = 1
const ZOOM_MAX = 6
const ZOOM_STEP = 0.2
const zoomScale = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const viewerStageRef = ref<HTMLElement | null>(null)
let panStartX = 0
let panStartY = 0
let panOriginX = 0
let panOriginY = 0
let panMoved = false

const isZoomed = computed(() => zoomScale.value > 1.001)
const imageTransform = computed(
  () => `translate(${panX.value}px, ${panY.value}px) scale(${zoomScale.value})`
)

const hasMore = computed(() => mediaItems.value.length < total.value)
const isEmpty = computed(
  () => initialized.value && !loadingInitial.value && mediaItems.value.length === 0
)

function disconnectObserver(): void {
  if (observer) {
    observer.disconnect()
    observer = null
  }
}

function setupObserver(): void {
  disconnectObserver()
  if (!scrollContainerRef.value || !sentinelRef.value) return

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMediaItems()
      }
    },
    {
      root: scrollContainerRef.value,
      rootMargin: '320px 0px 320px 0px'
    }
  )

  observer.observe(sentinelRef.value)
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''

  return t('mediaPage.dateFormat', {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  })
}

function getItemSourceLabel(item: MediaLibraryItem): string {
  if (item.sourceTypes.length === 2) {
    return `${t('mediaPage.sourceDiary')} + ${t('mediaPage.sourceArchive')}`
  }
  if (item.sourceTypes.includes('diary')) return t('mediaPage.sourceDiary')
  return t('mediaPage.sourceArchive')
}

function getSourceTitle(source: MediaLibrarySourceRef): string {
  const trimmed = source.title.trim()
  if (trimmed) return trimmed
  return source.type === 'diary' ? t('common.noTitle') : t('mediaPage.untitledArchive')
}

function getSourceLinkText(source: MediaLibrarySourceRef): string {
  return `${source.type === 'diary' ? t('mediaPage.sourceDiary') : t('mediaPage.sourceArchive')} · ${getSourceTitle(source)}`
}

function getVisibleSources(item: MediaLibraryItem): MediaLibrarySourceRef[] {
  return item.sources.slice(0, VISIBLE_SOURCE_LIMIT)
}

function getHiddenSources(item: MediaLibraryItem): MediaLibrarySourceRef[] {
  return item.sources.slice(VISIBLE_SOURCE_LIMIT)
}

function openSource(source: MediaLibrarySourceRef): void {
  if (source.type === 'diary') {
    router.push({ path: '/today', query: { id: source.id } }).catch((error) => {
      console.error('打开日记来源失败:', error)
    })
    return
  }

  router.push({ path: '/archives', query: { id: source.id } }).catch((error) => {
    console.error('打开档案来源失败:', error)
  })
}

function openLightbox(index: number): void {
  if (index < 0 || index >= mediaItems.value.length) return
  resetZoom()
  lightboxIndex.value = index
}

function closeLightbox(): void {
  resetZoom()
  lightboxIndex.value = null
}

function nextImage(): void {
  if (lightboxIndex.value === null) return
  const next = lightboxIndex.value + 1
  if (next < mediaItems.value.length) {
    resetZoom()
    lightboxIndex.value = next
  }
}

function prevImage(): void {
  if (lightboxIndex.value === null) return
  if (lightboxIndex.value > 0) {
    resetZoom()
    lightboxIndex.value = lightboxIndex.value - 1
  }
}

function resetZoom(): void {
  zoomScale.value = 1
  panX.value = 0
  panY.value = 0
  isPanning.value = false
}

function clampPan(): void {
  const stage = viewerStageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const halfW = (rect.width * (zoomScale.value - 1)) / 2
  const halfH = (rect.height * (zoomScale.value - 1)) / 2
  if (halfW <= 0) panX.value = 0
  else panX.value = Math.max(-halfW, Math.min(halfW, panX.value))
  if (halfH <= 0) panY.value = 0
  else panY.value = Math.max(-halfH, Math.min(halfH, panY.value))
}

function handleViewerWheel(event: WheelEvent): void {
  if (!lightboxOpen.value) return
  event.preventDefault()
  const stage = viewerStageRef.value
  if (!stage) return

  const direction = event.deltaY < 0 ? 1 : -1
  const factor = 1 + direction * ZOOM_STEP
  const oldScale = zoomScale.value
  const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldScale * factor))
  if (newScale === oldScale) return

  // Keep the point under the cursor fixed while zooming.
  const rect = stage.getBoundingClientRect()
  const cursorX = event.clientX - rect.left - rect.width / 2
  const cursorY = event.clientY - rect.top - rect.height / 2
  const ratio = newScale / oldScale
  panX.value = cursorX - (cursorX - panX.value) * ratio
  panY.value = cursorY - (cursorY - panY.value) * ratio
  zoomScale.value = newScale

  if (newScale <= ZOOM_MIN + 0.001) {
    panX.value = 0
    panY.value = 0
  } else {
    clampPan()
  }
}

function handleImageDoubleClick(event: MouseEvent): void {
  const stage = viewerStageRef.value
  if (!stage) return
  if (isZoomed.value) {
    resetZoom()
    return
  }
  const targetScale = 2.5
  const rect = stage.getBoundingClientRect()
  const cursorX = event.clientX - rect.left - rect.width / 2
  const cursorY = event.clientY - rect.top - rect.height / 2
  panX.value = -cursorX * (targetScale - 1)
  panY.value = -cursorY * (targetScale - 1)
  zoomScale.value = targetScale
  clampPan()
}

function handlePanStart(event: PointerEvent): void {
  if (!isZoomed.value) return
  if (event.button !== 0) return
  isPanning.value = true
  panMoved = false
  panStartX = event.clientX
  panStartY = event.clientY
  panOriginX = panX.value
  panOriginY = panY.value
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function handlePanMove(event: PointerEvent): void {
  if (!isPanning.value) return
  const dx = event.clientX - panStartX
  const dy = event.clientY - panStartY
  if (!panMoved && Math.hypot(dx, dy) > 3) panMoved = true
  panX.value = panOriginX + dx
  panY.value = panOriginY + dy
  clampPan()
}

function handlePanEnd(event: PointerEvent): void {
  if (!isPanning.value) return
  isPanning.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

function handleStageClick(event: MouseEvent): void {
  // Don't close while zoomed in — the user is interacting with the image.
  if (isZoomed.value) return
  // Suppress click that follows a pan drag.
  if (panMoved) {
    panMoved = false
    return
  }
  if (event.target !== event.currentTarget) return
  closeLightbox()
}

function handleViewerKeydown(event: KeyboardEvent): void {
  if (!lightboxOpen.value) return
  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      closeLightbox()
      break
    case 'ArrowRight':
      event.preventDefault()
      if (!isZoomed.value) nextImage()
      break
    case 'ArrowLeft':
      event.preventDefault()
      if (!isZoomed.value) prevImage()
      break
    case '+':
    case '=':
      event.preventDefault()
      zoomScale.value = Math.min(ZOOM_MAX, zoomScale.value * (1 + ZOOM_STEP))
      clampPan()
      break
    case '-':
    case '_':
      event.preventDefault()
      zoomScale.value = Math.max(ZOOM_MIN, zoomScale.value * (1 - ZOOM_STEP))
      if (zoomScale.value <= ZOOM_MIN + 0.001) {
        panX.value = 0
        panY.value = 0
      } else {
        clampPan()
      }
      break
    case '0':
      event.preventDefault()
      resetZoom()
      break
  }
}

function handleImageError(event: Event, item: MediaLibraryItem): void {
  const imageEl = event.currentTarget as HTMLImageElement | null
  if (!imageEl) return
  if (imageEl.dataset.fallbackApplied === '1') return

  imageEl.dataset.fallbackApplied = '1'
  imageEl.src = item.imagePath
}

async function loadMediaItems(reset = false): Promise<void> {
  if (loadingInitial.value || loadingMore.value) return
  if (!reset && !hasMore.value) return

  const nextRequestId = requestId.value + 1
  requestId.value = nextRequestId

  if (reset) {
    loadingInitial.value = true
  } else {
    loadingMore.value = true
  }

  try {
    const result = await window.api.getMediaLibrary({
      limit: PAGE_SIZE,
      offset: reset ? 0 : mediaItems.value.length,
      source: sourceFilter.value
    })

    if (nextRequestId !== requestId.value) return

    total.value = result.total
    mediaItems.value = reset ? result.items : mediaItems.value.concat(result.items)
    initialized.value = true
  } catch (error) {
    if (nextRequestId === requestId.value) {
      console.error('加载媒体库失败:', error)
      initialized.value = true
    }
  } finally {
    if (nextRequestId === requestId.value) {
      loadingInitial.value = false
      loadingMore.value = false
    }
  }
}

watch(sourceFilter, () => {
  lightboxIndex.value = null
  mediaItems.value = []
  total.value = 0
  initialized.value = false
  void loadMediaItems(true)
})

watch(
  [() => scrollContainerRef.value, () => sentinelRef.value],
  () => {
    nextTick(() => {
      setupObserver()
    })
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('keydown', handleViewerKeydown)
  void loadMediaItems(true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleViewerKeydown)
  disconnectObserver()
})

watch(lightboxOpen, (open) => {
  if (typeof document === 'undefined') return
  document.documentElement.style.overflow = open ? 'hidden' : ''
})
</script>

<template>
  <div class="media-page">
    <header class="media-hero">
      <div class="hero-main">
        <h2 class="hero-title">{{ t('mediaPage.title') }}</h2>
        <p class="hero-subtitle">{{ t('mediaPage.subtitle') }}</p>
      </div>
      <div class="hero-total">{{ t('mediaPage.totalImages', { count: total }) }}</div>
    </header>

    <div class="media-toolbar">
      <n-button-group>
        <n-button
          :type="sourceFilter === 'all' ? 'primary' : 'default'"
          @click="sourceFilter = 'all'"
        >
          {{ t('mediaPage.filterAll') }}
        </n-button>
        <n-button
          :type="sourceFilter === 'diary' ? 'primary' : 'default'"
          @click="sourceFilter = 'diary'"
        >
          {{ t('mediaPage.filterDiary') }}
        </n-button>
        <n-button
          :type="sourceFilter === 'archive' ? 'primary' : 'default'"
          @click="sourceFilter = 'archive'"
        >
          {{ t('mediaPage.filterArchive') }}
        </n-button>
      </n-button-group>
    </div>

    <div ref="scrollContainerRef" class="media-scroll">
      <div v-if="loadingInitial && !initialized" class="state-wrap">
        <n-spin size="large" />
      </div>

      <div v-else-if="isEmpty" class="state-wrap">
        <n-empty :description="t('mediaPage.empty')">
          <template #extra>
            <span class="empty-hint">{{ t('mediaPage.emptyHint') }}</span>
          </template>
        </n-empty>
      </div>

      <div v-else class="media-masonry">
        <button
          v-for="(item, index) in mediaItems"
          :key="item.id"
          type="button"
          class="media-tile"
          :title="t('mediaPage.openSource')"
          @click="openLightbox(index)"
        >
          <img
            :src="item.previewPath"
            :alt="getItemSourceLabel(item)"
            loading="lazy"
            decoding="async"
            @error="handleImageError($event, item)"
          />
          <span class="media-source-pill">{{ getItemSourceLabel(item) }}</span>
        </button>
      </div>

      <div v-if="loadingMore" class="loading-more">
        <n-spin size="small" />
        <span>{{ t('mediaPage.loadingMore') }}</span>
      </div>

      <div ref="sentinelRef" class="scroll-sentinel" aria-hidden="true" />
    </div>

    <teleport to="body">
      <div v-if="lightboxOpen && currentItem" class="media-viewer" @click.self="closeLightbox">
        <div class="viewer-topbar">
          <span class="viewer-source-pill">{{ getItemSourceLabel(currentItem) }}</span>
          <span class="viewer-counter">{{
            t('mediaPage.viewerIndex', {
              current: (lightboxIndex ?? 0) + 1,
              total: mediaItems.length
            })
          }}</span>
          <button
            type="button"
            class="viewer-icon-btn viewer-close"
            :title="t('mediaPage.closeViewer')"
            @click="closeLightbox"
          >
            <n-icon size="22"><CloseOutline /></n-icon>
          </button>
        </div>

        <button
          type="button"
          class="viewer-nav viewer-prev"
          :title="t('mediaPage.prevImage')"
          :disabled="lightboxIndex === 0"
          @click="prevImage"
        >
          <n-icon size="26"><ChevronBackOutline /></n-icon>
        </button>
        <button
          type="button"
          class="viewer-nav viewer-next"
          :title="t('mediaPage.nextImage')"
          :disabled="lightboxIndex === mediaItems.length - 1"
          @click="nextImage"
        >
          <n-icon size="26"><ChevronForwardOutline /></n-icon>
        </button>

        <div
          ref="viewerStageRef"
          class="viewer-stage"
          :class="{ 'is-zoomed': isZoomed, 'is-panning': isPanning }"
          @wheel.prevent="handleViewerWheel"
          @pointerdown="handlePanStart"
          @pointermove="handlePanMove"
          @pointerup="handlePanEnd"
          @pointercancel="handlePanEnd"
          @click="handleStageClick"
        >
          <img
            :key="currentItem.id"
            class="viewer-image"
            :class="{ 'is-zoomed': isZoomed }"
            :src="currentItem.imagePath"
            :alt="getItemSourceLabel(currentItem)"
            :style="{ transform: imageTransform }"
            draggable="false"
            @error="handleImageError($event, currentItem)"
            @dblclick="handleImageDoubleClick"
          />
        </div>

        <div class="viewer-bottombar">
          <div class="viewer-date">{{ formatDate(currentItem.latestAt) }}</div>
          <div class="viewer-sources">
            <button
              v-for="source in getVisibleSources(currentItem)"
              :key="`${source.type}-${source.id}`"
              type="button"
              class="viewer-source-btn"
              @click="openSource(source)"
            >
              {{ t('mediaPage.openSource') }} · {{ getSourceTitle(source) }}
            </button>

            <n-popover v-if="currentItem.sources.length > VISIBLE_SOURCE_LIMIT" trigger="click">
              <template #trigger>
                <button type="button" class="viewer-source-btn viewer-source-more">
                  {{
                    t('mediaPage.moreSources', {
                      count: currentItem.sources.length - VISIBLE_SOURCE_LIMIT
                    })
                  }}
                </button>
              </template>
              <div class="more-source-list">
                <button
                  v-for="source in getHiddenSources(currentItem)"
                  :key="`more-${source.type}-${source.id}`"
                  type="button"
                  class="more-source-item"
                  @click="openSource(source)"
                >
                  {{ getSourceLinkText(source) }}
                </button>
              </div>
            </n-popover>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.media-page {
  --media-card-bg: var(--n-color-embedded, rgba(255, 255, 255, 0.78));
  --media-meta-bg: transparent;
  --media-title-color: var(--n-text-color-1, #111827);
  --media-subtitle-color: var(--n-text-color-3, #6b7280);
  --media-link-bg: var(--app-accent-08, rgba(24, 160, 88, 0.08));
  --media-link-bg-hover: var(--app-accent-16, rgba(24, 160, 88, 0.16));
  --media-link-color: var(--app-accent-color, #18a058);
  --media-link-border: transparent;

  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px 18px 0;
  gap: 12px;
  background:
    radial-gradient(
      160% 90% at 0% -10%,
      var(--app-accent-06, rgba(24, 160, 88, 0.06)) 0%,
      transparent 60%
    ),
    radial-gradient(
      120% 70% at 100% 0%,
      var(--app-accent-08, rgba(24, 160, 88, 0.08)) 0%,
      transparent 62%
    ),
    var(--n-color, #fff);
}

.media-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 14px;
  border-radius: 12px;
  padding: 14px 16px;
  background: var(--n-color-embedded, rgba(255, 255, 255, 0.74));
  border: 1px solid var(--n-border-color, rgba(15, 23, 42, 0.08));
  backdrop-filter: blur(10px);
}

.hero-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--media-title-color);
}

.hero-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--media-subtitle-color);
}

.hero-total {
  font-size: 12px;
  font-weight: 500;
  color: var(--app-accent-color, #18a058);
  white-space: nowrap;
}

.media-toolbar {
  display: flex;
  justify-content: flex-start;
}

.media-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 2px 24px;
}

.state-wrap {
  min-height: calc(100% - 20px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-hint {
  font-size: 12px;
  color: var(--n-text-color-3, #64748b);
}

.media-masonry {
  column-count: 4;
  column-gap: 6px;
}

.media-tile {
  display: block;
  width: 100%;
  margin: 0 0 6px;
  padding: 0;
  border: none;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  background: rgba(148, 163, 184, 0.12);
  break-inside: avoid;
  -webkit-column-break-inside: avoid;
  page-break-inside: avoid;
  opacity: 0;
  animation: media-tile-fade var(--motion-normal) var(--ease-enter) forwards;
}

.media-tile img {
  width: 100%;
  height: auto;
  display: block;
  transition: transform var(--motion-normal) var(--ease-standard);
}

.media-tile:hover img {
  transform: scale(1.02);
}

.media-source-pill {
  position: absolute;
  left: 6px;
  bottom: 6px;
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 999px;
  color: #fff;
  background: rgba(17, 24, 39, 0.62);
  backdrop-filter: blur(2px);
  opacity: 0;
  transition: opacity var(--motion-fast) var(--ease-standard);
  pointer-events: none;
}

.media-tile:hover .media-source-pill,
.media-tile:focus-visible .media-source-pill {
  opacity: 1;
}

.more-source-list {
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 2px;
}

.more-source-item {
  text-align: left;
  border: none;
  border-radius: 10px;
  padding: 9px 10px;
  background: rgba(148, 163, 184, 0.12);
  color: var(--n-text-color, #334155);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.more-source-item:hover {
  transform: translateY(-1px);
}

.loading-more {
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--n-text-color-3, #64748b);
}

.scroll-sentinel {
  height: 1px;
}

html.dark .media-page {
  --media-card-bg: rgba(22, 28, 36, 0.92);
  --media-meta-bg: linear-gradient(180deg, rgba(22, 28, 36, 0.12) 0%, rgba(22, 28, 36, 0.94) 28%);
  --media-title-color: #f1f5f9;
  --media-subtitle-color: #cbd5e1;
  --media-link-bg: rgba(51, 65, 85, 0.52);
  --media-link-bg-hover: rgba(71, 85, 105, 0.64);
  --media-link-color: #e2e8f0;
  --media-link-border: rgba(148, 163, 184, 0.28);

  background:
    radial-gradient(180% 90% at 0% -8%, rgba(24, 160, 88, 0.14) 0%, transparent 60%),
    radial-gradient(120% 80% at 100% 0%, rgba(15, 118, 110, 0.2) 0%, transparent 64%),
    var(--n-color, #0f1115);
}

html.dark .media-hero {
  background: rgba(31, 35, 41, 0.86);
  border-color: rgba(148, 163, 184, 0.24);
}

html.dark .media-tile {
  background: rgba(71, 85, 105, 0.22);
}

html.dark .media-source-pill {
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.24);
}

html.dark .more-source-item {
  background: rgba(51, 65, 85, 0.35);
  color: var(--n-text-color-1, #e2e8f0);
}

@keyframes media-tile-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .media-page {
    padding: 12px 12px 0;
    gap: 10px;
  }

  .media-hero {
    flex-direction: column;
    align-items: flex-start;
    border-radius: 12px;
    padding: 14px;
  }

  .media-masonry {
    column-count: 2;
  }
}

@media (min-width: 769px) and (max-width: 1200px) {
  .media-masonry {
    column-count: 3;
  }
}

@media (min-width: 1600px) {
  .media-masonry {
    column-count: 5;
  }
}
</style>

<style>
/* Lightbox viewer is teleported to <body>, so these styles are global. */
.media-viewer {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.92);
  animation: media-viewer-fade var(--motion-fast, 160ms) var(--ease-enter, ease) forwards;
}

.media-viewer .viewer-stage {
  position: absolute;
  inset: 60px 80px 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
  cursor: zoom-in;
}

.media-viewer .viewer-stage.is-zoomed {
  cursor: grab;
}

.media-viewer .viewer-stage.is-panning {
  cursor: grabbing;
}

.media-viewer .viewer-image {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  border-radius: 6px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  transform-origin: center center;
  transition: transform 80ms ease-out;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: auto;
  will-change: transform;
}

.media-viewer .is-panning .viewer-image {
  transition: none;
}

.media-viewer .viewer-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.55) 0%, transparent 100%);
  color: #fff;
}

.media-viewer .viewer-source-pill {
  font-size: 11px;
  line-height: 1;
  padding: 6px 9px;
  border-radius: 999px;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.22);
}

.media-viewer .viewer-counter {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.82);
}

.media-viewer .viewer-icon-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
  transition: background var(--motion-fast, 140ms) var(--ease-standard, ease);
}

.media-viewer .viewer-icon-btn:hover {
  background: rgba(255, 255, 255, 0.26);
}

.media-viewer .viewer-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 64px;
  border: none;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  transition: background var(--motion-fast, 140ms) var(--ease-standard, ease);
}

.media-viewer .viewer-nav:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.22);
}

.media-viewer .viewer-nav:disabled {
  opacity: 0.3;
  cursor: default;
}

.media-viewer .viewer-prev {
  left: 18px;
}

.media-viewer .viewer-next {
  right: 18px;
}

.media-viewer .viewer-bottombar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 18px 22px;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.6) 0%, transparent 100%);
  color: #fff;
}

.media-viewer .viewer-date {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}

.media-viewer .viewer-sources {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.media-viewer .viewer-source-btn {
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  padding: 9px 14px;
  cursor: pointer;
  transition:
    background var(--motion-fast, 140ms) var(--ease-standard, ease),
    transform var(--motion-fast, 140ms) var(--ease-standard, ease);
}

.media-viewer .viewer-source-btn:hover {
  background: rgba(255, 255, 255, 0.24);
  transform: translateY(-1px);
}

.media-viewer .viewer-source-more {
  background: transparent;
}

@keyframes media-viewer-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .media-viewer .viewer-image {
    max-width: calc(100vw - 80px);
    max-height: calc(100vh - 180px);
  }

  .media-viewer .viewer-nav {
    width: 40px;
    height: 52px;
  }
}
</style>
