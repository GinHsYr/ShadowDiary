<template>
  <div class="archive-detail">
    <div class="detail-scroll">
      <!-- 身份行：头像 + 姓名/别名/类型 -->
      <section class="identity-row">
        <div
          class="identity-avatar"
          :class="{ 'is-empty': !form.mainImage }"
          @click="selectMainImage"
        >
          <n-avatar v-if="form.mainImage" :src="form.mainImage" :size="120" round />
          <div v-else class="avatar-placeholder">
            <n-icon :component="CameraOutline" :size="30" />
            <span>{{ t('archiveDetail.uploadAvatar') }}</span>
          </div>
        </div>

        <div class="identity-main">
          <!-- 姓名 + 编辑 -->
          <div class="name-line" :class="{ 'is-editing': isEditingName }">
            <Transition name="name-swap" mode="out-in">
              <div v-if="!isEditingName" key="display" class="name-display">
                <h1 class="archive-name" :class="{ 'is-untitled': !form.name }">
                  {{ form.name || t('archiveDetail.untitled') }}
                </h1>
                <button
                  type="button"
                  class="name-edit-btn"
                  :title="t('archiveDetail.editName')"
                  @click="startNameEdit"
                >
                  <n-icon :component="PencilOutline" :size="16" />
                </button>
              </div>
              <div v-else key="edit" class="name-edit">
                <input
                  ref="nameInputRef"
                  v-model="nameDraft"
                  class="name-input"
                  :placeholder="t('archiveDetail.namePlaceholder')"
                  maxlength="80"
                  @blur="commitNameEdit"
                  @keydown.enter.prevent="commitNameEdit"
                  @keydown.esc.prevent="cancelNameEdit"
                />
              </div>
            </Transition>
          </div>

          <!-- 别名 -->
          <div class="aliases-line">
            <n-dynamic-tags
              v-model:value="form.aliases"
              size="small"
              :input-props="{ placeholder: t('archiveDetail.aliasPlaceholder') }"
              @update:value="scheduleSave"
            />
            <span class="aliases-hint" :class="{ 'is-floating': form.aliases.length > 0 }">
              {{ t('archiveDetail.aliasesHint') }}
            </span>
          </div>

          <!-- 类型小药丸 -->
          <div class="type-line">
            <button
              v-for="opt in typeOptions"
              :key="opt.value"
              type="button"
              class="type-pill"
              :class="{ 'is-active': form.type === opt.value }"
              @click="setType(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </section>

      <!-- 简介卡片 -->
      <section
        ref="descCardRef"
        class="description-card"
        :class="{
          'is-empty': !form.description,
          'is-clamped': isDescOverflow && !showDescEditor,
          'is-editing': showDescEditor
        }"
        :title="t('archiveDetail.editDescription')"
        @click="openDescEditor"
      >
        <div class="description-card-header">
          <span class="description-label">{{ t('archiveDetail.description') }}</span>
          <n-icon :component="PencilOutline" :size="14" class="description-edit-icon" />
        </div>
        <p
          v-if="form.description"
          ref="descTextRef"
          class="description-text"
          :class="{ 'is-clamped': isDescOverflow && !showDescEditor }"
        >
          {{ form.description }}
        </p>
        <p v-else class="description-empty">
          {{ t('archiveDetail.descriptionEmpty') }}
        </p>
      </section>

      <!-- 图片瀑布流 -->
      <section class="gallery-section">
        <div class="gallery-header">
          <span class="gallery-label">
            {{ t('archiveDetail.images') }}
            <span v-if="form.images.length > 0" class="gallery-count">
              · {{ t('archiveDetail.imageCount', { count: form.images.length }) }}
            </span>
          </span>
          <n-button size="small" tertiary @click="addImage">
            <template #icon>
              <n-icon :component="AddOutline" />
            </template>
            {{ t('archiveDetail.addImage') }}
          </n-button>
        </div>

        <div v-if="form.images.length === 0" class="gallery-empty" @click="addImage">
          <n-icon :component="AddOutline" :size="22" />
          <span>{{ t('archiveDetail.galleryEmpty') }}</span>
        </div>

        <div v-else class="gallery-masonry">
          <button
            v-for="(img, idx) in form.images"
            :key="img + idx"
            type="button"
            class="gallery-tile"
            @click="openLightbox(idx)"
          >
            <img :src="img" loading="lazy" decoding="async" alt="" />
            <span class="tile-remove" @click.stop="removeImage(idx)">
              <n-icon :component="CloseOutline" :size="14" />
            </span>
          </button>
          <button
            type="button"
            class="gallery-tile gallery-add-tile"
            @click="addImage"
          >
            <n-icon :component="AddOutline" :size="22" />
          </button>
        </div>
      </section>
    </div>

    <!-- 底部操作栏 -->
    <div class="detail-footer">
      <n-button v-if="isCreating" size="small" @click="$emit('cancelCreate')">
        {{ t('common.cancel') }}
      </n-button>
      <n-popconfirm v-if="!isCreating && archiveId" @positive-click="handleDelete">
        <template #trigger>
          <n-button type="error" size="small" ghost>
            {{ t('archiveDetail.deleteArchive') }}
          </n-button>
        </template>
        {{ t('archiveDetail.deleteConfirm') }}
      </n-popconfirm>
      <div
        class="save-status"
        :class="[`is-${saveState}`, { 'is-dirty': isDirty, 'is-visible': !!saveStatusText }]"
      >
        <span class="status-icon" aria-hidden="true">{{ saveStatusIcon }}</span>
        <span class="status-text">{{ saveStatusText }}</span>
      </div>
    </div>

    <!-- 简介悬浮编辑框 -->
    <n-modal
      v-model:show="showDescEditor"
      preset="card"
      :title="t('archiveDetail.descriptionTitle')"
      :bordered="false"
      :segmented="{ content: 'soft', footer: 'soft' }"
      :mask-closable="false"
      style="width: min(680px, 92vw); border-radius: 16px"
      class="description-editor-modal"
      @after-leave="handleDescEditorClosed"
    >
      <n-input
        ref="descEditorRef"
        v-model:value="descEditDraft"
        type="textarea"
        :placeholder="t('archiveDetail.descriptionPlaceholder')"
        :autosize="{ minRows: 8, maxRows: 24 }"
      />
      <template #footer>
        <div class="description-editor-footer">
          <n-button size="small" @click="cancelDescEditor">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" size="small" @click="confirmDescEditor">
            {{ t('common.save') }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 灯箱 -->
    <image-lightbox v-model="lightboxIndex" :images="form.images" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  NInput,
  NButton,
  NPopconfirm,
  NAvatar,
  NIcon,
  NDynamicTags,
  NModal
} from 'naive-ui'
import { CameraOutline, CloseOutline, AddOutline, PencilOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import type { Archive, ArchiveType } from '../../../types/model'
import ImageLightbox from './ImageLightbox.vue'

const { t } = useI18n()

const props = defineProps<{
  archiveId: string | null
  isCreating: boolean
}>()

const emit = defineEmits<{
  saved: [archive: Archive]
  deleted: []
  cancelCreate: []
}>()

interface FormData {
  name: string
  aliases: string[]
  type: ArchiveType
  description: string
  mainImage: string
  images: string[]
}

const form = reactive<FormData>({
  name: '',
  aliases: [],
  type: 'person',
  description: '',
  mainImage: '',
  images: []
})

const typeOptions = computed<{ value: ArchiveType; label: string }[]>(() => [
  { value: 'person', label: t('archiveDetail.person') },
  { value: 'object', label: t('archiveDetail.object') },
  { value: 'other', label: t('archiveDetail.other') }
])

const saving = ref(false)
const isDirty = ref(false)
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const saveState = ref<SaveState>('idle')
let saveTimer: ReturnType<typeof setTimeout> | null = null
let currentEditingId: string | null = null
let saveStateTimer: ReturnType<typeof setTimeout> | null = null

// 姓名内联编辑
const isEditingName = ref(false)
const nameDraft = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)

// 简介编辑悬浮框
const showDescEditor = ref(false)
const descEditDraft = ref('')

// 简介卡片折叠探测
const descCardRef = ref<HTMLElement | null>(null)
const descTextRef = ref<HTMLElement | null>(null)
const isDescOverflow = ref(false)
let descResizeObserver: ResizeObserver | null = null

// 灯箱
const lightboxIndex = ref<number | null>(null)

const saveStatusText = computed(() => {
  if (saveState.value === 'saving') return t('archiveDetail.saving')
  if (saveState.value === 'error') return t('sidebar.saveFailed')
  if (isDirty.value) return t('archiveDetail.unsaved')
  if (saveState.value === 'saved' || currentEditingId || props.archiveId) {
    return t('archiveDetail.saved')
  }
  return ''
})

const saveStatusIcon = computed(() => {
  if (saveState.value === 'saving') return '●'
  if (saveState.value === 'saved') return '✓'
  if (saveState.value === 'error') return '!'
  if (isDirty.value) return '●'
  return '✓'
})

function clearSaveStateTimer(): void {
  if (saveStateTimer) {
    clearTimeout(saveStateTimer)
    saveStateTimer = null
  }
}

function setSaveState(nextState: SaveState, resetDelay = 0): void {
  clearSaveStateTimer()
  saveState.value = nextState
  if (resetDelay > 0) {
    saveStateTimer = setTimeout(() => {
      if (saveState.value === nextState) {
        saveState.value = 'idle'
      }
      saveStateTimer = null
    }, resetDelay)
  }
}

function resetForm(): void {
  form.name = ''
  form.aliases = []
  form.type = 'person'
  form.description = ''
  form.mainImage = ''
  form.images = []
  isDirty.value = false
  isEditingName.value = false
  showDescEditor.value = false
  lightboxIndex.value = null
  setSaveState('idle')
}

async function loadArchive(): Promise<void> {
  if (!props.archiveId) {
    resetForm()
    currentEditingId = null
    return
  }
  try {
    const archive = await window.api.getArchive(props.archiveId)
    if (archive) {
      form.name = archive.name
      form.aliases = archive.aliases || []
      form.type = archive.type
      form.description = archive.description || ''
      form.mainImage = archive.mainImage || ''
      form.images = archive.images || []
      isDirty.value = false
      currentEditingId = archive.id
      lightboxIndex.value = null
      void nextTick(measureDescOverflow)
    } else {
      resetForm()
      currentEditingId = null
    }
  } catch (error) {
    console.error('加载档案失败:', error)
  }
}

function scheduleSave(): void {
  isDirty.value = true
  if (saveState.value === 'saved') {
    saveState.value = 'idle'
  }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void doSave()
  }, 1500)
}

async function doSave(targetId?: string | null): Promise<void> {
  if (!form.name.trim()) return
  if (saving.value) return

  setSaveState('saving')
  saving.value = true
  try {
    const data: Partial<Archive> = {
      name: form.name.trim(),
      aliases: [...form.aliases].filter((a) => a.trim()),
      type: form.type,
      description: form.description.trim() || undefined,
      mainImage: form.mainImage || undefined,
      images: [...form.images]
    }

    const idToUse = targetId !== undefined ? targetId : currentEditingId
    if (idToUse && !props.isCreating) {
      data.id = idToUse
    }

    const saved = await window.api.saveArchive(data)
    isDirty.value = false
    currentEditingId = saved.id
    emit('saved', saved)
    setSaveState('saved', 800)
  } catch (error) {
    console.error('保存档案失败:', error)
    setSaveState('error', 1200)
  } finally {
    saving.value = false
  }
}

async function flushSave(targetId?: string | null): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (isDirty.value && form.name.trim()) {
    await doSave(targetId)
  }
}

async function handleDelete(): Promise<void> {
  if (!props.archiveId) return
  try {
    await window.api.deleteArchive(props.archiveId)
    emit('deleted')
  } catch (error) {
    console.error('删除档案失败:', error)
  }
}

async function selectMainImage(): Promise<void> {
  try {
    const result = await window.api.selectArchiveAvatar()
    if (!result.canceled && result.path) {
      form.mainImage = result.path
      scheduleSave()
    }
  } catch (error) {
    console.error('选择图片失败:', error)
  }
}

async function addImage(): Promise<void> {
  try {
    const result = await window.api.selectImage()
    if (!result.canceled && result.path) {
      form.images.push(result.path)
      scheduleSave()
    }
  } catch (error) {
    console.error('选择图片失败:', error)
  }
}

function removeImage(idx: number): void {
  form.images.splice(idx, 1)
  if (lightboxIndex.value !== null) {
    if (idx === lightboxIndex.value) {
      lightboxIndex.value = null
    } else if (idx < lightboxIndex.value) {
      lightboxIndex.value = lightboxIndex.value - 1
    }
  }
  scheduleSave()
}

function openLightbox(idx: number): void {
  if (idx < 0 || idx >= form.images.length) return
  lightboxIndex.value = idx
}

// 姓名编辑
function startNameEdit(): void {
  nameDraft.value = form.name
  isEditingName.value = true
  void nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

function commitNameEdit(): void {
  if (!isEditingName.value) return
  const next = nameDraft.value.trim()
  if (next && next !== form.name) {
    form.name = next
    scheduleSave()
  } else if (!next && form.name) {
    // 空值不接受，回退
  }
  isEditingName.value = false
}

function cancelNameEdit(): void {
  isEditingName.value = false
}

// 类型切换
function setType(value: ArchiveType): void {
  if (form.type === value) return
  form.type = value
  scheduleSave()
}

// 简介编辑器
function openDescEditor(): void {
  if (showDescEditor.value) return
  descEditDraft.value = form.description
  showDescEditor.value = true
}

function cancelDescEditor(): void {
  showDescEditor.value = false
}

function confirmDescEditor(): void {
  const next = descEditDraft.value
  if (next !== form.description) {
    form.description = next
    scheduleSave()
  }
  showDescEditor.value = false
}

function handleDescEditorClosed(): void {
  void nextTick(measureDescOverflow)
}

// 折叠探测
function measureDescOverflow(): void {
  const el = descTextRef.value
  if (!el) {
    isDescOverflow.value = false
    return
  }
  // 临时去掉 line-clamp 来取真实高度
  const wasClamped = el.classList.contains('is-clamped')
  if (wasClamped) el.classList.remove('is-clamped')
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
  const realHeight = el.scrollHeight
  if (wasClamped) el.classList.add('is-clamped')
  isDescOverflow.value = realHeight > lineHeight * 5 + 1
}

watch(
  () => props.archiveId,
  async (_, oldId) => {
    const idToSave = currentEditingId ?? oldId
    await flushSave(idToSave)
    await loadArchive()
  }
)

watch(
  () => props.isCreating,
  (val) => {
    if (val) {
      resetForm()
    }
  }
)

watch(
  () => form.description,
  () => {
    void nextTick(measureDescOverflow)
  }
)

onMounted(() => {
  if (props.archiveId) {
    void loadArchive()
  }
  if (typeof ResizeObserver !== 'undefined') {
    descResizeObserver = new ResizeObserver(() => {
      measureDescOverflow()
    })
    if (descCardRef.value) descResizeObserver.observe(descCardRef.value)
  }
  void nextTick(measureDescOverflow)
})

onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  clearSaveStateTimer()
  descResizeObserver?.disconnect()
  descResizeObserver = null
})

defineExpose({ flushSave })
</script>

<style scoped>
.archive-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--n-color, #fff);
  position: relative;
}

.detail-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 28px 28px 12px;
}

/* ========== 身份行 ========== */
.identity-row {
  display: flex;
  gap: 24px;
  align-items: flex-start;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
  animation: identity-enter var(--motion-normal) var(--ease-enter) both;
}

@keyframes identity-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.identity-avatar {
  flex: 0 0 auto;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    transform var(--motion-fast) var(--ease-spring-pop),
    box-shadow var(--motion-fast) var(--ease-standard);
}

.identity-avatar:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
}

.identity-avatar :deep(.n-avatar) {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
}

.avatar-placeholder {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--n-color-modal, var(--app-accent-06, rgba(24, 160, 88, 0.06)));
  border: 2px dashed var(--n-border-color, #ddd);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--n-text-color-3, #999);
  font-size: 11px;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    background var(--motion-fast) var(--ease-standard);
}

.identity-avatar:hover .avatar-placeholder {
  border-color: var(--app-accent-color, #18a058);
  color: var(--app-accent-color, #18a058);
  background: var(--app-accent-08, rgba(24, 160, 88, 0.08));
}

.identity-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
}

/* 姓名行 */
.name-line {
  position: relative;
  min-height: 36px;
  display: flex;
  align-items: center;
}

.name-display {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.archive-name {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--n-text-color-1, #111827);
  word-break: break-word;
  letter-spacing: 0.2px;
}

.archive-name.is-untitled {
  color: var(--n-text-color-3, #94a3b8);
  font-weight: 600;
  font-style: italic;
}

.name-edit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--n-text-color-3, #6b7280);
  cursor: pointer;
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard),
    background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}

.name-line:hover .name-edit-btn,
.name-line:focus-within .name-edit-btn {
  opacity: 1;
  transform: translateX(0);
}

.name-edit-btn:hover {
  background: var(--app-accent-12, rgba(24, 160, 88, 0.12));
  color: var(--app-accent-color, #18a058);
}

.name-edit {
  width: 100%;
}

.name-input {
  width: 100%;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--n-text-color-1, #111827);
  padding: 0 0 4px;
  margin: 0;
  background: transparent;
  border: none;
  border-bottom: 2px solid var(--app-accent-color, #18a058);
  outline: none;
  letter-spacing: 0.2px;
}

.name-input::placeholder {
  color: var(--n-text-color-3, #94a3b8);
  font-weight: 500;
  font-style: italic;
}

.name-swap-enter-active,
.name-swap-leave-active {
  transition:
    opacity 140ms var(--ease-standard),
    transform 140ms var(--ease-standard);
}

.name-swap-enter-from {
  opacity: 0;
  transform: translateY(2px);
}

.name-swap-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

/* 别名 */
.aliases-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  position: relative;
}

.aliases-line :deep(.n-dynamic-tags) {
  flex: 0 1 auto;
}

.aliases-line :deep(.n-tag) {
  background: var(--app-accent-08, rgba(24, 160, 88, 0.08));
  border: 1px solid transparent;
  color: var(--app-accent-color, #18a058);
  font-size: 12px;
  border-radius: 999px;
  transition: all var(--motion-fast) var(--ease-standard);
}

.aliases-line :deep(.n-tag:hover) {
  background: var(--app-accent-12, rgba(24, 160, 88, 0.12));
  transform: translateY(-1px);
}

.aliases-hint {
  font-size: 11px;
  color: var(--n-text-color-3, #9ca3af);
  white-space: nowrap;
  transition: opacity var(--motion-fast) var(--ease-standard);
}

.aliases-hint.is-floating {
  opacity: 0;
  pointer-events: none;
}

.aliases-line:hover .aliases-hint.is-floating {
  opacity: 0.7;
}

/* 类型小药丸 */
.type-line {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.type-pill {
  border: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.08));
  background: transparent;
  color: var(--n-text-color-2, #4b5563);
  font-size: 12px;
  line-height: 1;
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.type-pill:hover {
  background: var(--app-accent-06, rgba(24, 160, 88, 0.06));
  color: var(--app-accent-color, #18a058);
  border-color: var(--app-accent-20, rgba(24, 160, 88, 0.2));
  transform: translateY(-1px);
}

.type-pill.is-active {
  background: var(--app-accent-12, rgba(24, 160, 88, 0.12));
  color: var(--app-accent-color, #18a058);
  border-color: var(--app-accent-40, rgba(24, 160, 88, 0.4));
  font-weight: 600;
}

/* ========== 简介卡 ========== */
.description-card {
  position: relative;
  margin-top: 20px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.08));
  background: var(--n-color-embedded, rgba(255, 255, 255, 0.74));
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
  overflow: hidden;
  animation: card-enter var(--motion-normal) var(--ease-enter) both;
  animation-delay: 60ms;
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.description-card:hover {
  background: var(--app-accent-06, rgba(24, 160, 88, 0.06));
  border-color: var(--app-accent-20, rgba(24, 160, 88, 0.2));
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}

.description-card.is-editing {
  transform: scale(0.985);
  background: var(--app-accent-08, rgba(24, 160, 88, 0.08));
}

.description-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.description-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-2, #6b7280);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.description-edit-icon {
  color: var(--n-text-color-3, #9ca3af);
  opacity: 0;
  transform: translateX(-2px);
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.description-card:hover .description-edit-icon {
  opacity: 1;
  transform: translateX(0);
  color: var(--app-accent-color, #18a058);
}

.description-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--n-text-color-1, #1f2937);
  white-space: pre-wrap;
  word-break: break-word;
}

.description-text.is-clamped {
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  line-clamp: 5;
  overflow: hidden;
}

.description-card.is-clamped::after {
  content: '';
  position: absolute;
  left: 1px;
  right: 1px;
  bottom: 1px;
  height: 56px;
  border-radius: 0 0 12px 12px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    var(--n-color-embedded, rgba(255, 255, 255, 0.74)) 75%,
    var(--n-color-embedded, rgba(255, 255, 255, 0.74)) 100%
  );
  pointer-events: none;
  transition: background var(--motion-fast) var(--ease-standard);
}

.description-card.is-clamped:hover::after {
  background: linear-gradient(
    180deg,
    transparent 0%,
    var(--app-accent-06, rgba(24, 160, 88, 0.06)) 75%,
    var(--app-accent-06, rgba(24, 160, 88, 0.06)) 100%
  );
}

.description-empty {
  margin: 0;
  font-size: 13px;
  font-style: italic;
  color: var(--n-text-color-3, #9ca3af);
}

/* ========== 图片瀑布流 ========== */
.gallery-section {
  margin-top: 22px;
  animation: card-enter var(--motion-normal) var(--ease-enter) both;
  animation-delay: 120ms;
}

.gallery-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.gallery-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-2, #6b7280);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.gallery-count {
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: var(--n-text-color-3, #9ca3af);
}

.gallery-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 96px;
  border: 2px dashed var(--n-border-color, #e5e7eb);
  border-radius: 12px;
  color: var(--n-text-color-3, #9ca3af);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    background var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.gallery-empty:hover {
  border-color: var(--app-accent-color, #18a058);
  color: var(--app-accent-color, #18a058);
  background: var(--app-accent-06, rgba(24, 160, 88, 0.06));
  transform: translateY(-1px);
}

.gallery-masonry {
  column-count: 4;
  column-gap: 6px;
}

.gallery-tile {
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
  animation: tile-fade var(--motion-normal) var(--ease-enter) forwards;
}

.gallery-tile img {
  width: 100%;
  height: auto;
  display: block;
  transition: transform var(--motion-normal) var(--ease-standard);
}

.gallery-tile:hover img {
  transform: scale(1.03);
}

.tile-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.7);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.85);
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-spring-pop),
    background var(--motion-fast) var(--ease-standard);
  backdrop-filter: blur(2px);
}

.gallery-tile:hover .tile-remove,
.gallery-tile:focus-visible .tile-remove {
  opacity: 1;
  transform: scale(1);
}

.tile-remove:hover {
  background: rgba(208, 48, 80, 0.9);
}

.gallery-add-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 110px;
  border: 2px dashed var(--n-border-color, #e5e7eb);
  background: transparent;
  color: var(--n-text-color-3, #9ca3af);
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    background var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
  opacity: 1;
  animation: none;
}

.gallery-add-tile:hover {
  border-color: var(--app-accent-color, #18a058);
  color: var(--app-accent-color, #18a058);
  background: var(--app-accent-06, rgba(24, 160, 88, 0.06));
  transform: translateY(-1px);
}

@keyframes tile-fade {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ========== 底部 ========== */
.detail-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  border-top: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
  background: var(--n-color, #fff);
}

.save-status {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  color: var(--n-text-color-3, #999);
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}

.save-status.is-visible {
  opacity: 1;
}

.save-status.is-saving,
.save-status.is-saved,
.save-status.is-dirty {
  color: var(--app-accent-color, #18a058);
}

.save-status.is-error {
  color: var(--n-error-color, #d03050);
  animation: save-status-shake var(--motion-fast) var(--ease-standard) 2;
}

.status-icon {
  width: 12px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  transform-origin: center;
}

.save-status.is-saving .status-icon {
  animation: save-status-pulse 0.9s var(--ease-standard) infinite;
}

.save-status.is-saved .status-icon {
  animation: save-status-pop var(--motion-normal) var(--ease-enter);
}

.status-text {
  font-size: 12px;
}

@keyframes save-status-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.7;
  }
}

@keyframes save-status-pop {
  0% {
    transform: scale(0.8);
    opacity: 0.4;
  }
  60% {
    transform: scale(1.2);
    opacity: 1;
  }
  100% {
    transform: scale(1);
  }
}

@keyframes save-status-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-2px);
  }
  75% {
    transform: translateX(2px);
  }
}

/* 简介编辑器 footer */
.description-editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ========== 响应式 ========== */
@media (max-width: 1200px) {
  .gallery-masonry {
    column-count: 3;
  }
}

@media (max-width: 768px) {
  .detail-scroll {
    padding: 20px 18px 12px;
  }

  .identity-row {
    gap: 16px;
  }

  .identity-avatar,
  .avatar-placeholder {
    width: 88px;
    height: 88px;
  }

  .identity-avatar :deep(.n-avatar) {
    width: 88px !important;
    height: 88px !important;
  }

  .archive-name,
  .name-input {
    font-size: 22px;
  }

  .gallery-masonry {
    column-count: 2;
  }
}

@media (min-width: 1600px) {
  .gallery-masonry {
    column-count: 5;
  }
}

/* ========== 暗色 ========== */
:global(html.dark) .gallery-tile {
  background: rgba(71, 85, 105, 0.22);
}

:global(html.dark) .description-card.is-clamped::after {
  background: linear-gradient(
    180deg,
    transparent 0%,
    var(--n-color-embedded, rgba(22, 28, 36, 0.92)) 75%,
    var(--n-color-embedded, rgba(22, 28, 36, 0.92)) 100%
  );
}

:global(html.dark) .description-card.is-clamped:hover::after {
  background: linear-gradient(
    180deg,
    transparent 0%,
    var(--app-accent-08, rgba(24, 160, 88, 0.16)) 75%,
    var(--app-accent-08, rgba(24, 160, 88, 0.16)) 100%
  );
}
</style>
