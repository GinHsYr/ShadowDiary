<template>
  <div class="archive-detail">
    <div class="detail-scroll">
      <!-- 主图片上传区域 -->
      <div class="image-section">
        <div class="image-upload" @click="selectMainImage">
          <n-avatar
            v-if="form.mainImage"
            :src="form.mainImage"
            :size="120"
            round
          />
          <div v-else class="image-placeholder">
            <n-icon :component="CameraOutline" :size="32" />
            <span>点击上传头像</span>
          </div>
        </div>
      </div>

      <!-- 表单区域 -->
      <div class="form-section">
        <div class="form-item">
          <label class="form-label">名称 <span class="required">*</span></label>
          <n-input
            v-model:value="form.name"
            placeholder="请输入名称"
            @update:value="scheduleSave"
          />
        </div>

        <div class="form-item">
          <label class="form-label">别名</label>
          <n-dynamic-tags v-model:value="form.aliases" @update:value="scheduleSave" />
          <div class="form-hint">按回车添加多个别名</div>
        </div>

        <div class="form-item">
          <label class="form-label">类型</label>
          <n-radio-group v-model:value="form.type" @update:value="scheduleSave">
            <n-radio-button value="person">人物</n-radio-button>
            <n-radio-button value="object">物品</n-radio-button>
            <n-radio-button value="other">其他</n-radio-button>
          </n-radio-group>
        </div>

        <div class="form-item">
          <label class="form-label">具体内容</label>
          <n-input
            v-model:value="form.description"
            type="textarea"
            placeholder="请输入具体内容..."
            :autosize="{ minRows: 6, maxRows: 20 }"
            @update:value="scheduleSave"
          />
        </div>

        <!-- 其他图片 -->
        <div class="form-item">
          <label class="form-label">其他图片</label>
          <div class="images-grid">
            <n-image-group>
              <div
                v-for="(img, idx) in form.images"
                :key="idx"
                class="image-item"
              >
                <n-image :src="img" object-fit="cover" />
                <n-button
                  class="remove-btn"
                  size="tiny"
                  circle
                  type="error"
                  @click.stop="removeImage(idx)"
                >
                  <template #icon>
                    <n-icon :component="CloseOutline" />
                  </template>
                </n-button>
              </div>
            </n-image-group>
            <div class="image-add" @click="addImage">
              <n-icon :component="AddOutline" :size="24" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="detail-footer">
      <n-button v-if="isCreating" size="small" @click="$emit('cancelCreate')">
        取消
      </n-button>
      <n-popconfirm
        v-if="!isCreating && archiveId"
        @positive-click="handleDelete"
      >
        <template #trigger>
          <n-button type="error" size="small" ghost>
            删除档案
          </n-button>
        </template>
        确定要删除这个档案吗？
      </n-popconfirm>
      <div class="save-status">
        <span v-if="saving" class="status-text">保存中...</span>
        <span v-else-if="isDirty" class="status-text">未保存</span>
        <span v-else-if="archiveId" class="status-text saved">已保存</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import {
  NInput,
  NRadioGroup,
  NRadioButton,
  NButton,
  NPopconfirm,
  NAvatar,
  NIcon,
  NDynamicTags,
  NImage,
  NImageGroup
} from 'naive-ui'
import { CameraOutline, CloseOutline, AddOutline } from '@vicons/ionicons5'
import type { Archive, ArchiveType } from '../../../types/model'

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

const saving = ref(false)
const isDirty = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let currentEditingId: string | null = null

function resetForm(): void {
  form.name = ''
  form.aliases = []
  form.type = 'person'
  form.description = ''
  form.mainImage = ''
  form.images = []
  isDirty.value = false
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
    }
  } catch (error) {
    console.error('加载档案失败:', error)
  }
}

function scheduleSave(): void {
  isDirty.value = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    doSave()
  }, 1500)
}

async function doSave(targetId?: string | null): Promise<void> {
  if (!form.name.trim()) return
  if (saving.value) return

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
  } catch (error) {
    console.error('保存档案失败:', error)
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
    const result = await window.api.selectAvatar()
    if (!result.canceled && result.dataUrl) {
      form.mainImage = result.dataUrl
      scheduleSave()
    }
  } catch (error) {
    console.error('选择图片失败:', error)
  }
}

async function addImage(): Promise<void> {
  try {
    const result = await window.api.selectImage()
    if (!result.canceled && result.dataUrl) {
      form.images.push(result.dataUrl)
      scheduleSave()
    }
  } catch (error) {
    console.error('选择图片失败:', error)
  }
}

function removeImage(idx: number): void {
  form.images.splice(idx, 1)
  scheduleSave()
}

watch(
  () => props.archiveId,
  async (_, oldId) => {
    const idToSave = currentEditingId ?? oldId
    await flushSave(idToSave)
    loadArchive()
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

onMounted(() => {
  if (props.archiveId) {
    loadArchive()
  }
})

defineExpose({ flushSave })
</script>

<style scoped>
.archive-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--n-color, #fff);
}

.detail-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.image-section {
  display: flex;
  justify-content: center;
  margin-bottom: 24px;
}

.image-upload {
  cursor: pointer;
  transition: opacity 0.2s;
}

.image-upload:hover {
  opacity: 0.8;
}

.image-placeholder {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--n-color-modal, #f5f5f5);
  border: 2px dashed var(--n-border-color, #ddd);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--n-text-color-3, #999);
  font-size: 12px;
}

.form-section {
  max-width: 500px;
  margin: 0 auto;
}

.form-item {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--n-text-color, #333);
  margin-bottom: 8px;
}

.form-label .required {
  color: #e74c3c;
}

.form-hint {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
  margin-top: 4px;
}

.images-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.image-item {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
}

.image-item :deep(.n-image) {
  width: 100%;
  height: 100%;
}

.image-item :deep(.n-image img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: pointer;
}

.image-item .remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.image-item:hover .remove-btn {
  opacity: 1;
}

.image-add {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  border: 2px dashed var(--n-border-color, #ddd);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--n-text-color-3, #999);
  transition: all 0.2s;
}

.image-add:hover {
  border-color: #667eea;
  color: #667eea;
}

.detail-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  border-top: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
}

.save-status {
  margin-left: auto;
}

.status-text {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
}

.status-text.saved {
  color: #18a058;
}
</style>
