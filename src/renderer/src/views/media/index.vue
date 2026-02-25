<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NButton, NButtonGroup, NEmpty, NPopover, NSpin } from 'naive-ui'
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

function openPrimarySource(item: MediaLibraryItem): void {
  const source = item.sources[0]
  if (!source) return
  openSource(source)
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
  void loadMediaItems(true)
})

onBeforeUnmount(() => {
  disconnectObserver()
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

      <div v-else class="media-grid">
        <article
          v-for="(item, index) in mediaItems"
          :key="item.id"
          class="media-card"
          :style="{ '--enter-delay': `${Math.min(index, 18) * 26}ms` }"
        >
          <button
            type="button"
            class="media-cover"
            :title="t('mediaPage.openSource')"
            @click="openPrimarySource(item)"
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

          <div class="media-meta">
            <div class="media-date">{{ formatDate(item.latestAt) }}</div>
            <div class="media-links">
              <button
                v-for="source in getVisibleSources(item)"
                :key="`${source.type}-${source.id}`"
                type="button"
                class="source-link"
                @click="openSource(source)"
              >
                {{ getSourceTitle(source) }}
              </button>

              <n-popover v-if="item.sources.length > VISIBLE_SOURCE_LIMIT" trigger="click">
                <template #trigger>
                  <button type="button" class="source-link source-more">
                    {{
                      t('mediaPage.moreSources', {
                        count: item.sources.length - VISIBLE_SOURCE_LIMIT
                      })
                    }}
                  </button>
                </template>
                <div class="more-source-list">
                  <button
                    v-for="source in getHiddenSources(item)"
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
        </article>
      </div>

      <div v-if="loadingMore" class="loading-more">
        <n-spin size="small" />
        <span>{{ t('mediaPage.loadingMore') }}</span>
      </div>

      <div ref="sentinelRef" class="scroll-sentinel" aria-hidden="true" />
    </div>
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

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  align-content: start;
}

.media-card {
  border-radius: 14px;
  overflow: hidden;
  background: var(--media-card-bg);
  border: 1px solid var(--n-border-color, rgba(15, 23, 42, 0.08));
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.07);
  transform: translateY(8px);
  opacity: 0;
  animation: media-card-enter var(--motion-normal) var(--ease-enter) forwards;
  animation-delay: var(--enter-delay);
}

.media-cover {
  width: 100%;
  aspect-ratio: 1 / 1;
  padding: 0;
  border: none;
  display: block;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  background: rgba(148, 163, 184, 0.12);
}

.media-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition:
    transform var(--motion-normal) var(--ease-standard),
    filter var(--motion-normal) var(--ease-standard);
}

.media-cover:hover img {
  transform: scale(1.04);
  filter: saturate(1.04);
}

.media-source-pill {
  position: absolute;
  left: 10px;
  bottom: 10px;
  font-size: 11px;
  line-height: 1;
  padding: 6px 9px;
  border-radius: 999px;
  color: #fff;
  background: rgba(17, 24, 39, 0.62);
  backdrop-filter: blur(2px);
}

.media-meta {
  padding: 10px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--media-meta-bg);
}

.media-date {
  font-size: 12px;
  color: var(--n-text-color-3, #64748b);
  font-weight: 500;
}

.media-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.source-link,
.more-source-item {
  border: none;
  background: var(--media-link-bg);
  color: var(--media-link-color);
  box-shadow: inset 0 0 0 1px var(--media-link-border);
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  padding: 7px 10px;
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.source-link:hover,
.more-source-item:hover {
  background: var(--media-link-bg-hover);
  transform: translateY(-1px);
}

.source-more {
  background: rgba(100, 116, 139, 0.14);
  color: var(--n-text-color-2, #334155);
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
  border-radius: 10px;
  padding: 9px 10px;
  background: rgba(148, 163, 184, 0.12);
  color: var(--n-text-color, #334155);
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

html.dark .media-card {
  border-color: rgba(148, 163, 184, 0.2);
  box-shadow: 0 12px 24px rgba(2, 6, 23, 0.34);
}

html.dark .media-cover {
  background: rgba(71, 85, 105, 0.22);
}

html.dark .media-source-pill {
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.24);
}

html.dark .source-more {
  background: rgba(71, 85, 105, 0.32);
  color: var(--n-text-color-2, #cbd5e1);
}

html.dark .more-source-item {
  background: rgba(51, 65, 85, 0.35);
  color: var(--n-text-color-1, #e2e8f0);
}

@keyframes media-card-enter {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
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

  .media-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .media-meta {
    padding: 9px 8px 10px;
    gap: 6px;
  }

  .source-link {
    padding: 6px 8px;
  }
}
</style>
