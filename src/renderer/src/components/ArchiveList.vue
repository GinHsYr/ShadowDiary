<template>
  <div class="archive-list">
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

    <div class="list-body-shell">
      <div
        ref="listBodyRef"
        class="list-body"
        :class="{ 'has-index': showIndexRail }"
        @scroll.passive="handleListScroll"
      >
        <div class="archive-scroll-content">
          <div
            v-for="section in archiveSections"
            :key="section.letter"
            class="archive-section"
            :data-archive-letter="section.letter"
          >
            <div class="archive-section-header">{{ section.letter }}</div>
            <transition-group name="archive-item-motion" tag="div" class="archive-item-group">
              <div
                v-for="archive in section.items"
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
                    <span class="item-name-text">
                      {{ archive.name || t('archiveList.untitledDraft') }}
                    </span>
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
          </div>
        </div>

        <div v-if="displayArchives.length === 0 && !loading" class="list-empty">
          <n-empty size="small" :description="t('archiveList.empty')" />
        </div>

        <div v-if="loading" class="list-loading">
          <n-spin size="small" />
        </div>
      </div>

      <div
        v-if="showIndexRail"
        ref="indexRailRef"
        class="archive-index-rail"
        :class="{ 'is-dragging': indexDragging }"
        aria-label="Archive quick index"
        @pointerdown="startIndexDrag"
      >
        <button
          v-for="letter in INDEX_LETTERS"
          :key="letter"
          type="button"
          class="archive-index-letter"
          :class="{
            active: letter === activeIndexLetter,
            unavailable: !availableIndexLetterSet.has(letter)
          }"
          :aria-disabled="!availableIndexLetterSet.has(letter)"
          :data-index-letter="letter"
        >
          {{ letter }}
        </button>
      </div>

      <div v-if="indexDragging && activeIndexLetter" class="archive-index-bubble">
        {{ activeIndexLetter }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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

const INDEX_LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  '#'
] as const

type ArchiveIndexLetter = (typeof INDEX_LETTERS)[number]

const INDEX_LETTER_ORDER = new Map<string, number>(
  INDEX_LETTERS.map((letter, index) => [letter, index])
)

const PINYIN_BOUNDARIES: { letter: Exclude<ArchiveIndexLetter, '#'>; char: string }[] = [
  { letter: 'A', char: '阿' },
  { letter: 'B', char: '八' },
  { letter: 'C', char: '擦' },
  { letter: 'D', char: '搭' },
  { letter: 'E', char: '蛾' },
  { letter: 'F', char: '发' },
  { letter: 'G', char: '噶' },
  { letter: 'H', char: '哈' },
  { letter: 'J', char: '击' },
  { letter: 'K', char: '喀' },
  { letter: 'L', char: '垃' },
  { letter: 'M', char: '妈' },
  { letter: 'N', char: '拿' },
  { letter: 'O', char: '哦' },
  { letter: 'P', char: '啪' },
  { letter: 'Q', char: '期' },
  { letter: 'R', char: '然' },
  { letter: 'S', char: '撒' },
  { letter: 'T', char: '塌' },
  { letter: 'W', char: '挖' },
  { letter: 'X', char: '昔' },
  { letter: 'Y', char: '压' },
  { letter: 'Z', char: '匝' }
]

const archiveNameCollator = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base'
})
const pinyinInitialCollator = new Intl.Collator('zh-Hans-CN', {
  sensitivity: 'base'
})

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
const listBodyRef = ref<HTMLElement | null>(null)
const indexRailRef = ref<HTMLElement | null>(null)
const activeIndexLetter = ref<ArchiveIndexLetter | null>(null)
const indexDragging = ref(false)

const displayArchives = computed<ArchiveListItem[]>(() => {
  return [...draftArchives.value, ...archives.value].sort(compareArchiveItems)
})

const archiveSections = computed<{ letter: ArchiveIndexLetter; items: ArchiveListItem[] }[]>(() => {
  const groups = new Map<ArchiveIndexLetter, ArchiveListItem[]>()

  for (const archive of displayArchives.value) {
    const letter = getArchiveInitial(archive)
    const group = groups.get(letter)
    if (group) {
      group.push(archive)
    } else {
      groups.set(letter, [archive])
    }
  }

  return INDEX_LETTERS.map((letter) => ({
    letter,
    items: groups.get(letter) ?? []
  })).filter((section) => section.items.length > 0)
})

const availableIndexLetters = computed<ArchiveIndexLetter[]>(() =>
  archiveSections.value.map((section) => section.letter)
)

const availableIndexLetterSet = computed<Set<ArchiveIndexLetter>>(
  () => new Set(availableIndexLetters.value)
)

const showIndexRail = computed(() => availableIndexLetters.value.length > 1)

let searchTimer: ReturnType<typeof setTimeout> | null = null
let pendingReload = false
let scrollAnimationFrame = 0
let indexMoveHandler: ((ev: PointerEvent) => void) | null = null
let indexUpHandler: (() => void) | null = null

function isDraftArchive(archive: ArchiveListItem): archive is ArchiveDraftItem {
  return 'isDraft' in archive && archive.isDraft
}

function getArchiveName(archive: ArchiveListItem): string {
  const name = archive.name.trim()
  return name || t('archiveList.untitledDraft')
}

function getPinyinInitial(char: string): ArchiveIndexLetter {
  for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i -= 1) {
    if (pinyinInitialCollator.compare(char, PINYIN_BOUNDARIES[i].char) >= 0) {
      return PINYIN_BOUNDARIES[i].letter
    }
  }

  return '#'
}

function getArchiveInitial(archive: ArchiveListItem): ArchiveIndexLetter {
  const [firstChar] = Array.from(getArchiveName(archive).trim())
  if (!firstChar) return '#'

  const normalized = firstChar.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  const firstNormalizedChar = normalized.charAt(0)

  if (/^[A-Za-z]$/.test(firstNormalizedChar)) {
    return firstNormalizedChar.toUpperCase() as ArchiveIndexLetter
  }

  if (/^\d$/.test(firstNormalizedChar)) {
    return '#'
  }

  if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(firstChar)) {
    return getPinyinInitial(firstChar)
  }

  return '#'
}

function getIndexOrder(letter: ArchiveIndexLetter): number {
  return INDEX_LETTER_ORDER.get(letter) ?? INDEX_LETTERS.length
}

function compareArchiveItems(a: ArchiveListItem, b: ArchiveListItem): number {
  const aIsDraft = isDraftArchive(a)
  const bIsDraft = isDraftArchive(b)

  if (aIsDraft !== bIsDraft) {
    return aIsDraft ? -1 : 1
  }

  const initialDelta = getIndexOrder(getArchiveInitial(a)) - getIndexOrder(getArchiveInitial(b))
  if (initialDelta !== 0) return initialDelta

  const nameDelta = archiveNameCollator.compare(getArchiveName(a), getArchiveName(b))
  if (nameDelta !== 0) return nameDelta

  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return a.id.localeCompare(b.id)
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

function getNearestAvailableLetter(letter: ArchiveIndexLetter): ArchiveIndexLetter | null {
  if (availableIndexLetterSet.value.has(letter)) return letter

  const targetIndex = getIndexOrder(letter)
  const available = availableIndexLetters.value
  const next = available.find((candidate) => getIndexOrder(candidate) > targetIndex)
  if (next) return next

  for (let i = available.length - 1; i >= 0; i -= 1) {
    if (getIndexOrder(available[i]) < targetIndex) return available[i]
  }

  return null
}

async function scrollToLetter(letter: ArchiveIndexLetter): Promise<void> {
  const targetLetter = getNearestAvailableLetter(letter)
  if (!targetLetter) return

  activeIndexLetter.value = targetLetter
  await nextTick()

  const listBody = listBodyRef.value
  const section = listBody?.querySelector<HTMLElement>(`[data-archive-letter="${targetLetter}"]`)
  if (!listBody || !section) return

  listBody.scrollTo({
    top: section.offsetTop - 6,
    behavior: indexDragging.value ? 'auto' : 'smooth'
  })
}

function getLetterFromPointer(clientY: number): ArchiveIndexLetter {
  const rail = indexRailRef.value
  if (!rail) return INDEX_LETTERS[0]

  const rect = rail.getBoundingClientRect()
  const ratio = (clientY - rect.top) / Math.max(rect.height, 1)
  const index = Math.min(
    INDEX_LETTERS.length - 1,
    Math.max(0, Math.floor(ratio * INDEX_LETTERS.length))
  )

  return INDEX_LETTERS[index]
}

function handleIndexPointerMove(ev: PointerEvent): void {
  const letter = getLetterFromPointer(ev.clientY)
  void scrollToLetter(letter)
}

function cleanupIndexDrag(): void {
  if (indexMoveHandler) {
    document.removeEventListener('pointermove', indexMoveHandler)
    indexMoveHandler = null
  }
  if (indexUpHandler) {
    document.removeEventListener('pointerup', indexUpHandler)
    document.removeEventListener('pointercancel', indexUpHandler)
    indexUpHandler = null
  }

  document.body.style.userSelect = ''
  indexDragging.value = false
}

function startIndexDrag(ev: PointerEvent): void {
  ev.preventDefault()
  cleanupIndexDrag()

  indexDragging.value = true
  document.body.style.userSelect = 'none'
  handleIndexPointerMove(ev)

  indexMoveHandler = (moveEvent: PointerEvent): void => {
    moveEvent.preventDefault()
    handleIndexPointerMove(moveEvent)
  }

  indexUpHandler = (): void => {
    cleanupIndexDrag()
  }

  document.addEventListener('pointermove', indexMoveHandler)
  document.addEventListener('pointerup', indexUpHandler)
  document.addEventListener('pointercancel', indexUpHandler)
}

function updateActiveIndexFromScroll(): void {
  const listBody = listBodyRef.value
  if (!listBody) return

  const sections = Array.from(listBody.querySelectorAll<HTMLElement>('[data-archive-letter]'))
  const currentTop = listBody.scrollTop + 16
  let currentLetter: ArchiveIndexLetter | null = archiveSections.value[0]?.letter ?? null

  for (const section of sections) {
    if (section.offsetTop <= currentTop) {
      currentLetter = section.dataset.archiveLetter as ArchiveIndexLetter
    } else {
      break
    }
  }

  activeIndexLetter.value = currentLetter
}

function handleListScroll(): void {
  if (scrollAnimationFrame) return

  scrollAnimationFrame = window.requestAnimationFrame(() => {
    scrollAnimationFrame = 0
    updateActiveIndexFromScroll()
  })
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
    await nextTick()
    updateActiveIndexFromScroll()
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
  void nextTick(updateActiveIndexFromScroll)
}

function commitDraftArchive(tempId: string, saved: Archive): boolean {
  const draftIdx = draftArchives.value.findIndex((archive) => archive.id === tempId)
  if (draftIdx === -1) return false
  draftArchives.value.splice(draftIdx, 1)

  const existingIdx = archives.value.findIndex((archive) => archive.id === saved.id)
  if (existingIdx !== -1) {
    archives.value[existingIdx] = saved
    void nextTick(updateActiveIndexFromScroll)
    return true
  }

  archives.value.push(saved)
  void nextTick(updateActiveIndexFromScroll)
  return true
}

function removeDraftArchive(tempId: string): void {
  const draftIdx = draftArchives.value.findIndex((archive) => archive.id === tempId)
  if (draftIdx !== -1) {
    draftArchives.value.splice(draftIdx, 1)
    void nextTick(updateActiveIndexFromScroll)
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

  if (scrollAnimationFrame) {
    window.cancelAnimationFrame(scrollAnimationFrame)
    scrollAnimationFrame = 0
  }

  cleanupIndexDrag()
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
  background: var(--app-list-panel-surface, var(--n-color, #fff));
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

.list-body.has-index .archive-scroll-content {
  padding-right: 22px;
}

.archive-section {
  position: relative;
}

.archive-section-header {
  position: sticky;
  top: -8px;
  z-index: 1;
  height: 24px;
  display: flex;
  align-items: center;
  padding: 2px 4px 4px;
  margin: 2px 0 4px;
  color: var(--n-text-color-3, #8a8f98);
  font-size: 11px;
  font-weight: 700;
  background: color-mix(
    in srgb,
    var(--app-list-panel-surface, var(--n-color, #fff)) 86%,
    transparent
  );
  backdrop-filter: blur(8px);
}

.archive-index-rail {
  position: absolute;
  right: 8px;
  top: 50%;
  z-index: 3;
  width: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 4px 2px;
  border-radius: 999px;
  background: color-mix(
    in srgb,
    var(--app-list-panel-surface, var(--n-color, #fff)) 78%,
    transparent
  );
  border: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.08));
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  transform: translateY(-50%);
  user-select: none;
  touch-action: none;
}

.archive-index-rail.is-dragging {
  box-shadow:
    0 0 0 1px var(--app-accent-20, rgba(24, 160, 88, 0.2)),
    0 10px 24px rgba(15, 23, 42, 0.14);
}

.archive-index-letter {
  width: 14px;
  height: 13px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--n-text-color-3, #8a8f98);
  font-size: 9px;
  line-height: 13px;
  font-weight: 700;
  text-align: center;
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.archive-index-letter.unavailable {
  opacity: 0.34;
}

.archive-index-letter.active {
  color: #fff;
  background: var(--app-accent-color, #18a058);
  transform: scale(1.08);
}

.archive-index-bubble {
  position: absolute;
  right: 42px;
  top: 50%;
  z-index: 4;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: var(--app-accent-color, #18a058);
  font-size: 22px;
  font-weight: 800;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
  transform: translateY(-50%);
  pointer-events: none;
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
