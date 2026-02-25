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
    </div>

    <!-- 档案列表 -->
    <div class="list-body">
      <transition-group name="archive-item-motion" tag="div" class="archive-item-group">
        <div
          v-for="archive in archives"
          :key="archive.id"
          class="archive-item"
          :class="{ active: archive.id === selectedId }"
          @click="$emit('select', archive)"
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
            <div class="item-name">{{ archive.name }}</div>
            <div v-if="archive.aliases?.length" class="item-alias">
              {{ archive.aliases.join('、') }}
            </div>
          </div>
          <n-tag :type="typeTagMap[archive.type]" size="tiny" round>
            {{ typeLabels[archive.type] }}
          </n-tag>
        </div>
      </transition-group>

      <div v-if="archives.length === 0 && !loading" class="list-empty">
        <n-empty size="small" :description="t('archiveList.empty')" />
      </div>

      <div v-if="loading" class="list-loading">
        <n-spin size="small" />
      </div>
    </div>

    <!-- 新建按钮 -->
    <div class="list-footer">
      <n-button block type="primary" ghost size="small" @click="$emit('create')">
        {{ t('archiveList.create') }}
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { NAvatar, NButton, NEmpty, NIcon, NInput, NSpin, NTag } from 'naive-ui'
import { SearchOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import type { Archive, ArchiveType } from '../../../types/model'

defineProps<{
  selectedId: string | null
}>()

defineEmits<{
  select: [archive: Archive]
  create: []
}>()

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
const loading = ref(false)
const searchKeyword = ref('')
const selectedType = ref<ArchiveType | 'all'>('all')

let searchTimer: ReturnType<typeof setTimeout> | null = null
let pendingReload = false

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

onMounted(() => {
  void loadArchives()
})

onBeforeUnmount(() => {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
})

defineExpose({ refresh })
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.list-footer {
  padding: 12px;
  border-top: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
}

.archive-item-motion-enter-active,
.archive-item-motion-leave-active {
  transition:
    transform var(--motion-normal) var(--ease-enter),
    opacity var(--motion-normal) var(--ease-standard);
}

.archive-item-motion-enter-from {
  opacity: 0;
  transform: translateY(var(--motion-distance-sm));
}

.archive-item-motion-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

.archive-item-motion-move {
  transition: transform var(--motion-normal) var(--ease-standard);
}
</style>
