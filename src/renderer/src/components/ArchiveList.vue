<template>
  <div class="archive-list">
    <!-- 搜索和筛选 -->
    <div class="list-header">
      <n-input
        v-model:value="searchKeyword"
        placeholder="搜索档案..."
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
          v-for="t in typeOptions"
          :key="t.value"
          :type="selectedType === t.value ? 'primary' : 'default'"
          :bordered="selectedType === t.value"
          size="small"
          round
          clickable
          @click="handleTypeFilter(t.value)"
        >
          {{ t.label }}
        </n-tag>
      </div>
    </div>

    <!-- 档案列表 -->
    <div class="list-body">
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

      <div v-if="archives.length === 0 && !loading" class="list-empty">
        <n-empty size="small" description="暂无档案" />
      </div>

      <div v-if="loading" class="list-loading">
        <n-spin size="small" />
      </div>
    </div>

    <!-- 新建按钮 -->
    <div class="list-footer">
      <n-button block type="primary" ghost size="small" @click="$emit('create')">
        + 新建档案
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAvatar, NButton, NEmpty, NIcon, NInput, NSpin, NTag } from 'naive-ui'
import { SearchOutline } from '@vicons/ionicons5'
import type { Archive, ArchiveType } from '../../../types/model'

defineProps<{
  selectedId: string | null
}>()

defineEmits<{
  select: [archive: Archive]
  create: []
}>()

const typeOptions: { value: ArchiveType | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'person', label: '人物' },
  { value: 'object', label: '物品' },
  { value: 'other', label: '其他' }
]

const typeLabels: Record<ArchiveType, string> = {
  person: '人物',
  object: '物品',
  other: '其他'
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

function handleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    loadArchives()
  }, 300)
}

function handleTypeFilter(type: ArchiveType | 'all'): void {
  selectedType.value = type
  loadArchives()
}

async function loadArchives(): Promise<void> {
  if (loading.value) return

  loading.value = true
  try {
    archives.value = await window.api.getArchives({
      search: searchKeyword.value || undefined,
      type: selectedType.value === 'all' ? undefined : selectedType.value
    })
  } catch (error) {
    console.error('加载档案列表失败:', error)
  } finally {
    loading.value = false
  }
}

async function refresh(): Promise<void> {
  await loadArchives()
}

onMounted(() => {
  loadArchives()
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
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 4px;
}

.archive-item:hover {
  background: rgba(16, 185, 129, 0.06);
}

.archive-item.active {
  background: rgba(16, 185, 129, 0.12);
  box-shadow: inset 3px 0 0 #10b981;
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
</style>
