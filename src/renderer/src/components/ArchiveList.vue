<template>
  <div class="archive-list">
    <!-- 搜索和筛选 -->
    <div class="list-header">
      <n-input
        v-model:value="searchKeyword"
        :placeholder="t('archiveList.searchPlaceholder')"
        clearable
        size="small"
        @update:value="handleSearch"
      >
        <template #prefix>
          <n-icon :component="SearchOutline" />
        </template>
      </n-input>
      <div class="type-filter">
        <n-tag
          v-for="typeOption in typeOptions"
          :key="typeOption.value"
          :type="selectedType === typeOption.value ? 'primary' : 'default'"
          :bordered="selectedType === typeOption.value"
          size="small"
          round
          clickable
          @click="handleTypeFilter(typeOption.value)"
        >
          {{ typeOption.label }}
        </n-tag>
      </div>
      <div class="create-row">
        <n-button block type="primary" ghost size="small" @click="$emit('create')">
          {{ t('archiveList.create') }}
        </n-button>
      </div>
    </div>

    <!-- 档案列表 -->
    <div class="list-body">
      <transition-group name="archive-item-motion" tag="div" class="archive-item-group">
        <div
          v-for="archive in displayArchives"
          :key="archive.id"
          class="archive-item"
          :class="{ active: archive.id === selectedId, 'is-draft': isDraftArchive(archive) }"
          @click="handleSelectArchive(archive)"
        >
          <n-avatar
            :src="archive.mainImage || undefined"
            :size="40"
            round
            :style="{ background: archive.mainImage ? 'transparent' : '#10b98120' }"
          >
            <template v-if="!archive.mainImage">
              {{ archive.name.charAt(0) }}
            </template>
          </n-avatar>
          <div class="item-info">
            <div class="item-name">
              <span class="item-name-text">{{
                archive.name || t('archiveList.untitledDraft')
              }}</span>
              <n-tag
                v-if="isDraftArchive(archive)"
                size="tiny"
                round
                type="warning"
                class="draft-tag"
              >
                {{ t('archiveList.draft') }}
              </n-tag>
            </div>
            <div v-if="archive.aliases?.length" class="item-alias">
              {{ archive.aliases.join('、') }}
            </div>
          </div>
          <n-tag :type="typeTagMap[archive.type]" size="tiny" round>
            {{ typeLabels[archive.type] }}
          </n-tag>
        </div>
      </transition-group>

      <div v-if="displayArchives.length === 0 && !loading" class="list-empty">
        <n-empty size="small" :description="t('archiveList.empty')" />
      </div>

      <div v-if="loading" class="list-loading">
        <n-spin size="small" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NAvatar, NButton, NEmpty, NIcon, NInput, NSpin, NTag } from 'naive-ui'
import { SearchOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import type { Archive, ArchiveType } from '../../../types/model'

defineProps<{
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [archive: Archive]
  create: []
}>()

interface ArchiveDraftItem extends Archive {
  isDraft: true
}

interface ArchiveDraftInput {
  id: string
  name: string
  aliases: string[]
  type: ArchiveType
  description?: string
  mainImage?: string
  images: string[]
  createdAt: number
  updatedAt: number
}

type ArchiveListItem = Archive | ArchiveDraftItem

const { t } = useI18n()

const typeOptions: { value: ArchiveType | 'all'; label: string }[] = [
  { value: 'all', label: t('archiveList.all') },
  { value: 'person', label: t('archiveList.person') },
  { value: 'object', label: t('archiveList.object') },
  { value: 'other', label: t('archiveList.other') }
]

const typeLabels: Record<ArchiveType, string> = {
  person: t('archiveList.person'),
  object: t('archiveList.object'),
  other: t('archiveList.other')
}

const typeTagMap: Record<ArchiveType, 'info' | 'success' | 'warning'> = {
  person: 'info',
  object: 'success',
  other: 'warning'
}

const archives = ref<Archive[]>([])
const draftArchives = ref<ArchiveDraftItem[]>([])
const loading = ref(false)
const searchKeyword = ref('')
const selectedType = ref<ArchiveType | 'all'>('all')
const displayArchives = computed<ArchiveListItem[]>(() => [
  ...draftArchives.value,
  ...archives.value
])

let searchTimer: ReturnType<typeof setTimeout> | null = null
let pendingReload = false

function isDraftArchive(archive: ArchiveListItem): archive is ArchiveDraftItem {
  return 'isDraft' in archive && archive.isDraft
}

function handleSelectArchive(archive: ArchiveListItem): void {
  if (isDraftArchive(archive)) return
  emit('select', archive)
}

function handleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void loadArchives()
  }, 300)
}

function handleTypeFilter(type: ArchiveType | 'all'): void {
  selectedType.value = type
  void loadArchives()
}

async function loadArchives(): Promise<void> {
  if (loading.value) {
    pendingReload = true
    return
  }

  loading.value = true
  const requestSearch = searchKeyword.value || undefined
  const requestType = selectedType.value === 'all' ? undefined : selectedType.value

  try {
    const result = await window.api.getArchives({
      search: requestSearch,
      type: requestType
    })
    const latestSearch = searchKeyword.value || undefined
    const latestType = selectedType.value === 'all' ? undefined : selectedType.value
    if (requestSearch !== latestSearch || requestType !== latestType) {
      pendingReload = true
      return
    }
    archives.value = result
  } catch (error) {
    console.error('加载档案列表失败:', error)
  } finally {
    loading.value = false
    if (pendingReload) {
      pendingReload = false
      void loadArchives()
    }
  }
}

async function refresh(): Promise<void> {
  await loadArchives()
}

function prependDraftArchive(draft: ArchiveDraftInput): void {
  const next: ArchiveDraftItem = { ...draft, isDraft: true }
  draftArchives.value = [next, ...draftArchives.value.filter((archive) => archive.id !== draft.id)]
}

function commitDraftArchive(tempId: string, saved: Archive): boolean {
  const draftIdx = draftArchives.value.findIndex((archive) => archive.id === tempId)
  if (draftIdx === -1) return false
  draftArchives.value.splice(draftIdx, 1)

  const existingIdx = archives.value.findIndex((archive) => archive.id === saved.id)
  if (existingIdx !== -1) {
    archives.value[existingIdx] = saved
    return true
  }

  const insertIdx = archives.value.findIndex((archive) => archive.createdAt < saved.createdAt)
  if (insertIdx === -1) {
    archives.value.push(saved)
  } else {
    archives.value.splice(insertIdx, 0, saved)
  }
  return true
}

function removeDraftArchive(tempId: string): void {
  const draftIdx = draftArchives.value.findIndex((archive) => archive.id === tempId)
  if (draftIdx !== -1) {
    draftArchives.value.splice(draftIdx, 1)
  }
}

onMounted(() => {
  void loadArchives()
})

onBeforeUnmount(() => {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
})

defineExpose({
  refresh,
  prependDraftArchive,
  commitDraftArchive,
  removeDraftArchive
})
</script>

<style scoped>
.archive-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--n-color, #fff);
}

.list-header {
  padding: 12px;
  border-bottom: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
}

.create-row {
  margin-top: 10px;
}

.type-filter {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.list-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.archive-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
  margin-bottom: 4px;
}

.archive-item:hover {
  background: var(--app-accent-06, rgba(24, 160, 88, 0.06));
}

.archive-item.is-draft {
  background: var(--app-accent-08, rgba(24, 160, 88, 0.08));
  box-shadow: inset 0 0 0 1px var(--app-accent-20, rgba(24, 160, 88, 0.2));
}

.archive-item.is-draft::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  border: 1px solid var(--app-accent-24, rgba(24, 160, 88, 0.24));
  opacity: 0;
  animation: draft-sheen var(--motion-spring-normal) var(--ease-enter);
  pointer-events: none;
}

.archive-item::before {
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

.archive-item.active {
  background: var(--app-accent-12, rgba(24, 160, 88, 0.12));
}

.archive-item.active::before {
  opacity: 1;
  transform: scaleY(1);
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--n-text-color, #333);
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.item-name-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.draft-tag {
  flex-shrink: 0;
  line-height: 1;
}

.item-alias {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.list-empty {
  padding: 40px 16px;
}

.list-loading {
  display: flex;
  justify-content: center;
  padding: 16px;
}

.archive-item-motion-enter-active,
.archive-item-motion-leave-active {
  transition:
    transform var(--motion-spring-fast) var(--ease-spring-soft),
    opacity var(--motion-normal) var(--ease-standard),
    filter var(--motion-normal) var(--ease-standard);
}

.archive-item-motion-enter-from {
  opacity: 0;
  filter: blur(1px);
  transform: translateY(var(--motion-distance-md)) scale(var(--motion-scale-pop-start));
}

.archive-item-motion-enter-to {
  opacity: 1;
  filter: blur(0);
  transform: translateY(0) scale(1);
}

.archive-item-motion-leave-to {
  opacity: 0;
  filter: blur(1px);
  transform: translateY(calc(var(--motion-distance-sm) * -1)) scale(0.985);
}

.archive-item-motion-move {
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

:global(:root.reduced-motion) .archive-item-motion-enter-from,
:global(:root.reduced-motion) .archive-item-motion-leave-to {
  filter: none;
  transform: none;
}
</style>
