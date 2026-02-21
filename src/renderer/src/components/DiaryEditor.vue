<template>
  <div ref="editorRootRef" class="diary-editor-wrapper" @contextmenu="handleContextMenu">
    <froala v-model:value="content" :tag="'textarea'" :config="editorConfig" />
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
import { ref, watch, computed, h, onMounted, onBeforeUnmount, type Component } from 'vue'
import { NDropdown, NIcon, useDialog } from 'naive-ui'
import {
  CopyOutline,
  CutOutline,
  ClipboardOutline,
  TextOutline,
  RemoveCircleOutline
} from '@vicons/ionicons5'
import { useThemeStore } from '@renderer/stores/themes'

const themeStore = useThemeStore()
const isDark = computed(() => themeStore.isDark)
const isEditorDebugEnabled = import.meta.env.DEV
const dialog = useDialog()

const debugLog = (...args: unknown[]): void => {
  if (isEditorDebugEnabled) {
    console.debug('[DiaryEditor]', ...args)
  }
}

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editorRootRef = ref<HTMLElement | null>(null)
const content = ref(props.modelValue || '')

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}
const SUPPORTED_IMAGE_TYPES = new Set(Object.values(IMAGE_MIME_BY_EXT))
const SUPPORTED_IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_MIME_BY_EXT))
const IMAGE_MAX_SIZE = 10 * 1024 * 1024
const IMAGE_SAVE_CONCURRENCY = 2

interface FroalaDragEventLike {
  preventDefault?: () => void
  stopPropagation?: () => void
  dataTransfer?: DataTransfer | null
  originalEvent?: DragEvent
}

interface FroalaEditorInstance {
  html: {
    insert(text: string): void
    get(): string
  }
  commands: {
    bold(): void
    italic(): void
    underline(): void
    strikeThrough(): void
    clearFormatting(): void
  }
  image: {
    insert(src: string, sanitize?: boolean, data?: unknown, response?: unknown): void
    get(): unknown
  }
  opts: {
    theme: string
  }
  toolbar: {
    hide(): void
    show(): void
  }
}

interface NativeFile extends File {
  path?: string
}

const editorInstance = ref<FroalaEditorInstance | null>(null)

function syncContentFromEditor(editor: FroalaEditorInstance | null): void {
  if (!editor) return
  const html = editor.html.get()
  if (html !== content.value) {
    content.value = html
  }
}

function getFileExtension(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext && ext.length > 0 ? ext : null
}

function getFileMimeType(file: File): string | null {
  if (file.type && file.type.trim()) return file.type.trim().toLowerCase()
  const ext = getFileExtension(file.name)
  if (!ext) return null
  return IMAGE_MIME_BY_EXT[ext] ?? null
}

function isSupportedImageFile(file: File): boolean {
  const mimeType = getFileMimeType(file)
  if (mimeType && SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    return true
  }

  const ext = getFileExtension(file.name)
  return Boolean(ext && SUPPORTED_IMAGE_EXTENSIONS.has(ext))
}

function getNativeFilePath(file: File): string | null {
  const path = (file as NativeFile).path
  return typeof path === 'string' && path.trim() ? path : null
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return

  const limit = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index], index)
    }
  })

  await Promise.all(runners)
}

async function saveImageFile(
  file: File
): Promise<{ success: boolean; path?: string; error?: string }> {
  const nativePath = getNativeFilePath(file)
  if (nativePath) {
    return await window.api.saveImageFromFile(nativePath)
  }

  const mimeType = getFileMimeType(file)
  if (!mimeType) {
    return { success: false, error: '无法识别图片类型' }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  return await window.api.saveImageFromBytes(bytes, mimeType)
}

function parseImageMimeTypeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;,]+);base64,/i.exec(dataUrl)
  if (!match) return null
  return match[1].trim().toLowerCase()
}

async function saveImageDataUrl(dataUrl: string): Promise<string | null> {
  const mimeType = parseImageMimeTypeFromDataUrl(dataUrl)
  if (!mimeType) return null

  const response = await fetch(dataUrl)
  const buffer = await response.arrayBuffer()
  const result = await window.api.saveImageFromBytes(new Uint8Array(buffer), mimeType)
  return result.success && result.path ? result.path : null
}

async function insertImagesWithLimit(files: File[]): Promise<void> {
  const imageFiles = files.filter((file) => isSupportedImageFile(file))
  await runWithConcurrency(imageFiles, IMAGE_SAVE_CONCURRENCY, async (file) => {
    await insertImage(file)
  })
}

function getDroppedFiles(dropEvent: FroalaDragEventLike): File[] {
  const dataTransfer = dropEvent.dataTransfer ?? dropEvent.originalEvent?.dataTransfer
  if (!dataTransfer?.files || dataTransfer.files.length === 0) return []
  return Array.from(dataTransfer.files)
}

function hasDraggedFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false
  if (dataTransfer.files && dataTransfer.files.length > 0) return true
  return Array.from(dataTransfer.types || []).includes('Files')
}

function preventFileDropDefault(event: DragEvent): void {
  if (!hasDraggedFiles(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleEditorDrop(event: DragEvent): void {
  if (!hasDraggedFiles(event.dataTransfer)) return

  event.preventDefault()
  event.stopPropagation()

  const files = Array.from(event.dataTransfer?.files || [])
  void insertImagesWithLimit(files)
}

// 右键菜单状态
const showContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)

// 渲染图标
const renderIcon = (icon: Component) => {
  return () => h(NIcon, null, { default: () => h(icon) })
}

// 右键菜单选项
const contextMenuOptions = computed(() => [
  {
    label: '剪切',
    key: 'cut',
    icon: renderIcon(CutOutline)
  },
  {
    label: '复制',
    key: 'copy',
    icon: renderIcon(CopyOutline)
  },
  {
    label: '粘贴',
    key: 'paste',
    icon: renderIcon(ClipboardOutline)
  },
  { type: 'divider', key: 'd1' },
  {
    label: '加粗',
    key: 'bold',
    icon: renderIcon(TextOutline)
  },
  {
    label: '斜体',
    key: 'italic',
    icon: renderIcon(TextOutline)
  },
  {
    label: '下划线',
    key: 'underline',
    icon: renderIcon(TextOutline)
  },
  {
    label: '删除线',
    key: 'strikethrough',
    icon: renderIcon(TextOutline)
  },
  { type: 'divider', key: 'd2' },
  {
    label: '清除格式',
    key: 'clearFormatting',
    icon: renderIcon(RemoveCircleOutline)
  }
])

// 处理右键菜单
const handleContextMenu = (e: MouseEvent): void => {
  // 检查是否在编辑区域内
  const target = e.target as HTMLElement
  if (!target.closest('.fr-element')) {
    return
  }

  e.preventDefault()
  showContextMenu.value = false

  // 延迟显示以确保位置正确
  setTimeout(() => {
    contextMenuX.value = e.clientX
    contextMenuY.value = e.clientY
    showContextMenu.value = true
  }, 0)
}

// 处理菜单选择
const handleContextMenuSelect = async (key: string): Promise<void> => {
  showContextMenu.value = false

  if (!editorInstance.value) return

  const editor = editorInstance.value

  switch (key) {
    case 'cut':
      document.execCommand('cut')
      break
    case 'copy':
      document.execCommand('copy')
      break
    case 'paste':
      try {
        const text = await navigator.clipboard.readText()
        editor.html.insert(text)
      } catch {
        document.execCommand('paste')
      }
      break
    case 'bold':
      editor.commands.bold()
      break
    case 'italic':
      editor.commands.italic()
      break
    case 'underline':
      editor.commands.underline()
      break
    case 'strikethrough':
      editor.commands.strikeThrough()
      break
    case 'clearFormatting':
      editor.commands.clearFormatting()
      break
  }
}

function scrollToKeyword(keyword: string): boolean {
  const keywords = keyword
    .trim()
    .split(/\s+/)
    .map((item) => item.toLowerCase())
    .filter(Boolean)
  if (keywords.length === 0) return false

  const contentEl = editorRootRef.value?.querySelector('.fr-element.fr-view') as HTMLElement | null
  if (!contentEl) return false

  const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT)
  let foundNode: Text | null = null

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text
    const text = textNode.textContent?.toLowerCase() ?? ''
    if (keywords.some((kw) => text.includes(kw))) {
      foundNode = textNode
      break
    }
  }

  if (!foundNode?.parentElement) return false

  const target = foundNode.parentElement
  const containerRect = contentEl.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetScrollTop =
    contentEl.scrollTop + (targetRect.top - containerRect.top) - contentEl.clientHeight / 2

  contentEl.scrollTo({
    top: Math.max(targetScrollTop, 0),
    behavior: 'smooth'
  })

  target.classList.add('keyword-scroll-highlight')
  setTimeout(() => {
    target.classList.remove('keyword-scroll-highlight')
  }, 1500)

  return true
}

// 插入图片到编辑器
const insertImage = async (file: File): Promise<void> => {
  debugLog('insertImage called, editorInstance:', editorInstance.value)
  if (!editorInstance.value) {
    console.error('Editor instance not available')
    return
  }

  // 检查文件类型
  if (!isSupportedImageFile(file)) {
    debugLog('不支持的图片格式:', file.type, file.name)
    return
  }

  // 检查文件大小 (10MB)
  if (file.size > IMAGE_MAX_SIZE) {
    dialog.warning({
      title: '图片过大',
      content: `图片「${file.name}」超过 10MB 限制，请压缩后再插入。`,
      positiveText: '知道了'
    })
    return
  }

  try {
    const result = await saveImageFile(file)

    if (result.success && result.path) {
      // 插入使用 diary-image:// 协议的 URL
      editorInstance.value.image.insert(result.path, false, null, editorInstance.value.image.get())
    } else {
      console.error('保存图片失败:', result.error)
    }
  } catch (error) {
    console.error('图片插入失败:', error)
  }
}

// Froala 配置
const editorConfig = {
  height: '100%',
  placeholderText: '写点什么呢?',
  charCounterCount: false,
  shortcutsEnabled: ['bold', 'italic', 'underline', 'undo', 'redo'],
  multiLine: true,
  // 文本选中时的编辑选项
  textEditButtons: ['bold', 'italic', 'underline', 'fontSize', 'textColor', 'clearFormatting'],
  toolbarButtons: [
    'bold',
    'italic',
    'underline',
    'fontSize',
    '|',
    'alignLeft',
    'alignCenter',
    'paragraphFormat',
    'quote',
    'insertImage',
    '|',
    'undo',
    'redo'
  ],
  quickInsertButtons: ['image', 'table', 'ul', 'ol', 'hr'],
  // 图片上传处理 - 使用自定义处理
  imageUploadURL: '/upload_image',
  imageUploadMethod: 'POST',
  imageAllowedTypes: ['jpeg', 'jpg', 'png', 'gif', 'webp'],
  imageMaxSize: 10 * 1024 * 1024, // 10MB
  imagePaste: true,
  imageInsertButtons: ['imageBack', '|', 'imageUpload', 'imageByURL'],
  imageEditButtons: [
    'imageReplace',
    'imageAlign',
    'imageCaption',
    'imageRemove',
    '|',
    'imageLink',
    'linkOpen',
    'linkEdit',
    'linkRemove',
    '-',
    'imageDisplay',
    'imageStyle',
    'imageAlt',
    'imageSize'
  ],
  // 启用拖拽上传
  dragInline: true,
  // 链接设置
  linkAlwaysBlank: true,
  linkAutoPrefix: 'https://',
  // 段落格式
  paragraphFormat: {
    N: '正文',
    H1: '标题 1',
    H2: '标题 2',
    H3: '标题 3',
    H4: '标题 4'
  },
  // 语言设置
  language: 'zh_cn',
  // 主题 - 根据当前主题动态设置
  theme: isDark.value ? 'dark' : 'gray',
  // 隐藏底部水印
  attribution: false,
  // 内容样式
  htmlAllowedTags: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'div',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'span',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'u',
    'ul'
  ],
  htmlAllowedAttrs: [
    'alt',
    'class',
    'colspan',
    'height',
    'href',
    'rel',
    'rowspan',
    'src',
    'style',
    'target',
    'title',
    'width'
  ],
  htmlAllowedStyleProps: [
    'background-color',
    'color',
    'font-size',
    'font-style',
    'font-weight',
    'height',
    'line-height',
    'max-height',
    'max-width',
    'min-height',
    'min-width',
    'text-align',
    'text-decoration',
    'width'
  ],
  htmlExecuteScripts: false,
  htmlRemoveTags: [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'option',
    'link',
    'meta',
    'base'
  ],
  pasteDeniedTags: ['script', 'style', 'iframe', 'object', 'embed'],
  // 事件处理
  events: {
    initialized: function (this: FroalaEditorInstance): void {
      editorInstance.value = this
    },
    // Some Froala actions (e.g. remove image) don't reliably trigger v-model updates in the wrapper.
    // Sync from editor HTML to keep parent state (and autosave) correct.
    contentChanged: function (this: FroalaEditorInstance): void {
      syncContentFromEditor(this)
    },
    'image.removed': function (this: FroalaEditorInstance): void {
      syncContentFromEditor(this)
    },
    'image.beforeUpload': function (files: FileList | File[]): boolean {
      // 处理通过按钮选择的图片
      if (files && files.length > 0) {
        void insertImagesWithLimit(Array.from(files))
      }
      return false // 阻止默认上传行为
    },
    'image.error': function (error: unknown, response: unknown): void {
      console.error('Froala image error:', error, response)
    },
    'paste.afterCleanup': async function (clipboardHtml: string): Promise<string> {
      // 处理粘贴的图片（base64），限制并发避免峰值内存抖动。
      const imgRegex = /<img[^>]+src=(['"])(data:image\/[^;]+;base64,[^'"]+)\1[^>]*>/gi
      const dataUrls = [...clipboardHtml.matchAll(imgRegex)].map((match) => match[2])
      const uniqueDataUrls = [...new Set(dataUrls)]
      const replacements = new Map<string, string>()

      await runWithConcurrency(uniqueDataUrls, IMAGE_SAVE_CONCURRENCY, async (dataUrl) => {
        try {
          const imagePath = await saveImageDataUrl(dataUrl)
          if (imagePath) {
            replacements.set(dataUrl, imagePath)
          }
        } catch (error) {
          console.error('保存粘贴的图片失败:', error)
        }
      })

      for (const [dataUrl, imagePath] of replacements) {
        clipboardHtml = clipboardHtml.split(dataUrl).join(imagePath)
      }
      return clipboardHtml
    },
    dragover: function (dragEvent: FroalaDragEventLike): boolean {
      const files = getDroppedFiles(dragEvent)
      if (files.length === 0) return true

      dragEvent.preventDefault?.()
      dragEvent.originalEvent?.preventDefault()
      return false
    },
    drop: function (dropEvent: FroalaDragEventLike): boolean {
      // 处理拖拽上传
      dropEvent.preventDefault?.()
      dropEvent.stopPropagation?.()
      dropEvent.originalEvent?.preventDefault()
      dropEvent.originalEvent?.stopPropagation()

      const files = getDroppedFiles(dropEvent)
      if (files.length > 0) {
        void insertImagesWithLimit(files)
        return false
      }
      return true
    }
  }
}

watch(
  () => props.modelValue,
  (val) => {
    if (val !== content.value) {
      content.value = val || ''
    }
  }
)

watch(content, (val) => {
  emit('update:modelValue', val)
})

// 监听主题变化,重新初始化编辑器
watch(isDark, () => {
  if (editorInstance.value) {
    // 更新编辑器主题
    editorInstance.value.opts.theme = isDark.value ? 'dark' : 'gray'
    // 重新渲染工具栏
    editorInstance.value.toolbar.hide()
    editorInstance.value.toolbar.show()
  }
})

onMounted(() => {
  const root = editorRootRef.value
  if (!root) return

  root.addEventListener('dragenter', preventFileDropDefault, true)
  root.addEventListener('dragover', preventFileDropDefault, true)
  root.addEventListener('drop', handleEditorDrop, true)
})

onBeforeUnmount(() => {
  const root = editorRootRef.value
  if (!root) return

  root.removeEventListener('dragenter', preventFileDropDefault, true)
  root.removeEventListener('dragover', preventFileDropDefault, true)
  root.removeEventListener('drop', handleEditorDrop, true)
})

defineExpose({
  scrollToKeyword
})
</script>

<style scoped>
.diary-editor-wrapper {
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  background: transparent;
  height: 100%;
  width: 100%;
}

.diary-editor-wrapper :deep(.fr-box) {
  border: none;
  border-radius: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.diary-editor-wrapper :deep(.fr-toolbar) {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: var(--n-color, transparent);
  border-top: none;
  border-left: none;
  border-right: none;
  flex-shrink: 0;
}

.diary-editor-wrapper :deep(.fr-wrapper) {
  background: transparent;
  border: none;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-top: none !important;
}

.diary-editor-wrapper :deep(.fr-view) {
  flex: 1;
  overflow-y: auto;
}

.diary-editor-wrapper :deep(.fr-second-toolbar),
.diary-editor-wrapper :deep(.fr-counter) {
  display: none !important;
}

.diary-editor-wrapper :deep(.fr-element) {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', Roboto, sans-serif;
  font-size: 16px;
  line-height: 1.75;
  color: var(--editor-text-color, #37352f);
  padding: 8px 16px;
}

.diary-editor-wrapper :deep(.fr-element h1) {
  font-size: 1.875em;
  font-weight: 700;
  margin: 1.4em 0 0.2em;
  line-height: 1.3;
}

.diary-editor-wrapper :deep(.fr-element h2) {
  font-size: 1.5em;
  font-weight: 600;
  margin: 1.2em 0 0.2em;
  line-height: 1.3;
}

.diary-editor-wrapper :deep(.fr-element h3) {
  font-size: 1.25em;
  font-weight: 600;
  margin: 1em 0 0.2em;
  line-height: 1.3;
}

.diary-editor-wrapper :deep(.fr-element p) {
  margin: 0.15em 0;
}

.diary-editor-wrapper :deep(.keyword-scroll-highlight) {
  background: rgba(16, 185, 129, 0.16);
  transition: background 0.3s ease;
}

.diary-editor-wrapper :deep(.fr-element blockquote) {
  border-left: 3px solid var(--editor-text-color, #37352f);
  padding-left: 14px;
  margin: 0.5em 0;
}

.diary-editor-wrapper :deep(.fr-element ul),
.diary-editor-wrapper :deep(.fr-element ol) {
  padding-left: 24px;
  margin: 0.2em 0;
}

.diary-editor-wrapper :deep(.fr-element li) {
  margin: 0.1em 0;
}

.diary-editor-wrapper :deep(.fr-element img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 8px 0;
  /* 图片懒加载效果 */
  loading: lazy;
  /* 占位背景 */
  background: var(--editor-img-placeholder, #f0f0f0);
  /* 加载时的模糊效果 */
  transition: filter 0.3s ease;
}

.diary-editor-wrapper :deep(.fr-element img[src^='diary-image://']) {
  /* 图片加载中显示占位色 */
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: loading 1.5s ease-in-out infinite;
}

@keyframes loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.diary-editor-wrapper :deep(.fr-element img[src^='diary-image://']:not([loading])) {
  /* 图片加载完成后移除动画 */
  animation: none;
  background: transparent;
}

.diary-editor-wrapper :deep(.fr-element code) {
  background: var(--editor-code-bg, rgba(135, 131, 120, 0.15));
  border-radius: 3px;
  padding: 2px 5px;
  font-size: 0.9em;
  color: var(--editor-code-color, #eb5757);
}

.diary-editor-wrapper :deep(.fr-element pre) {
  background: var(--editor-pre-bg, #f7f6f3);
  border-radius: 4px;
  padding: 16px 20px;
  margin: 0.5em 0;
  overflow-x: auto;
}

.diary-editor-wrapper :deep(.fr-element hr) {
  border: none;
  border-top: 1px solid var(--editor-hr-color, rgba(55, 53, 47, 0.09));
  margin: 1.2em 0;
}

/* 深色模式样式 */
:root {
  --editor-text-color: #37352f;
  --editor-code-bg: rgba(135, 131, 120, 0.15);
  --editor-code-color: #eb5757;
  --editor-pre-bg: #f7f6f3;
  --editor-hr-color: rgba(55, 53, 47, 0.09);
}

html.dark {
  --editor-text-color: rgba(255, 255, 255, 0.92);
  --editor-code-bg: rgba(255, 255, 255, 0.12);
  --editor-code-color: #ff6b6b;
  --editor-pre-bg: rgba(255, 255, 255, 0.08);
  --editor-hr-color: rgba(255, 255, 255, 0.09);
}

/* 深色模式下的 Froala 编辑器样式覆盖 */
html.dark .diary-editor-wrapper :deep(.fr-toolbar),
html.dark .diary-editor-wrapper :deep(.fr-second-toolbar) {
  background: #101014 !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09) !important;
  border-top: none !important;
  border-left: none !important;
  border-right: none !important;
}

html.dark .diary-editor-wrapper :deep(.fr-box.fr-basic .fr-element) {
  border-top: none !important;
  border: none !important;
}

html.dark .diary-editor-wrapper :deep(.fr-wrapper) {
  border-top: none !important;
  border: none !important;
}

html.dark .diary-editor-wrapper :deep(.fr-element) {
  border-top: none !important;
}

/* 移除 fr-newline 的白色边框 */
html.dark .diary-editor-wrapper :deep(.fr-newline) {
  border-top: none !important;
  border-bottom: none !important;
  background: transparent !important;
  height: 0 !important;
  display: none !important;
}

/* 强制移除所有可能的白色边框 */
html.dark .diary-editor-wrapper :deep(.fr-box *) {
  border-color: rgba(255, 255, 255, 0.09) !important;
}

html.dark .diary-editor-wrapper :deep(.fr-box .fr-wrapper),
html.dark .diary-editor-wrapper :deep(.fr-box .fr-element),
html.dark .diary-editor-wrapper :deep(.fr-box .fr-view) {
  border-top-color: transparent !important;
}

html.dark .diary-editor-wrapper :deep(.fr-command.fr-btn),
html.dark .diary-editor-wrapper :deep(.fr-btn) {
  color: rgba(255, 255, 255, 0.82) !important;
}

html.dark .diary-editor-wrapper :deep(.fr-command.fr-btn:hover),
html.dark .diary-editor-wrapper :deep(.fr-btn:hover) {
  background: rgba(255, 255, 255, 0.08) !important;
}

html.dark .diary-editor-wrapper :deep(.fr-command.fr-btn.fr-active),
html.dark .diary-editor-wrapper :deep(.fr-btn.fr-active) {
  background: rgba(255, 255, 255, 0.12) !important;
  color: #fff !important;
}

html.dark .diary-editor-wrapper :deep(.fr-separator) {
  background: rgba(255, 255, 255, 0.09) !important;
}

/* 下拉菜单 */
html.dark .diary-editor-wrapper :deep(.fr-dropdown-menu),
html.dark .diary-editor-wrapper :deep(.fr-popup) {
  background: #252526 !important;
  border-color: rgba(255, 255, 255, 0.09) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
}

html.dark .diary-editor-wrapper :deep(.fr-dropdown-menu .fr-dropdown-wrapper),
html.dark .diary-editor-wrapper :deep(.fr-popup .fr-dropdown-wrapper) {
  background: #252526 !important;
}

html.dark
  .diary-editor-wrapper
  :deep(.fr-dropdown-menu .fr-dropdown-wrapper .fr-dropdown-content ul.fr-dropdown-list li a),
html.dark .diary-editor-wrapper :deep(.fr-command.fr-dropdown-item) {
  color: rgba(255, 255, 255, 0.82) !important;
}

html.dark
  .diary-editor-wrapper
  :deep(.fr-dropdown-menu .fr-dropdown-wrapper .fr-dropdown-content ul.fr-dropdown-list li a:hover),
html.dark .diary-editor-wrapper :deep(.fr-command.fr-dropdown-item:hover) {
  background: rgba(255, 255, 255, 0.08) !important;
}

/* 底部栏 */
html.dark .diary-editor-wrapper :deep(.fr-counter),
html.dark .diary-editor-wrapper :deep(.fr-bottom) {
  background: #252526 !important;
  border-top-color: rgba(255, 255, 255, 0.09) !important;
  border-left: none !important;
  border-right: none !important;
  border-bottom: none !important;
  color: rgba(255, 255, 255, 0.6) !important;
}

html.dark .diary-editor-wrapper :deep(.fr-box.fr-basic .fr-wrapper) {
  border-left: none !important;
  border-top: none !important;
}

html.dark .diary-editor-wrapper :deep(.fr-box) {
  border: none !important;
}

html.dark .diary-editor-wrapper :deep(.fr-view) {
  border-top: none !important;
}

/* 占位符文本 */
html.dark .diary-editor-wrapper :deep(.fr-placeholder) {
  color: rgba(193, 190, 190, 0.38) !important;
}

/* 光标颜色 */
html.dark .diary-editor-wrapper :deep(.fr-element),
html.dark .diary-editor-wrapper :deep(.fr-view) {
  caret-color: rgba(255, 255, 255, 0.82) !important;
  color: rgba(255, 255, 255, 0.92) !important;
}

html.dark .diary-editor-wrapper :deep(.fr-element *) {
  color: rgb(198, 198, 198) !important;
}

/* 选中文本背景 */
html.dark .diary-editor-wrapper :deep(.fr-element ::selection),
html.dark .diary-editor-wrapper :deep(.fr-view ::selection) {
  background: rgba(99, 102, 241, 0.3) !important;
}

/* 弹出框输入框 */
html.dark .diary-editor-wrapper :deep(.fr-popup input[type='text']),
html.dark .diary-editor-wrapper :deep(.fr-popup textarea),
html.dark .diary-editor-wrapper :deep(.fr-input-line input) {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: rgba(255, 255, 255, 0.09) !important;
  color: rgba(255, 255, 255, 0.82) !important;
}

html.dark .diary-editor-wrapper :deep(.fr-popup input[type='text']:focus),
html.dark .diary-editor-wrapper :deep(.fr-popup textarea:focus) {
  border-color: rgba(99, 102, 241, 0.6) !important;
}

/* 弹出框标签 */
html.dark .diary-editor-wrapper :deep(.fr-popup label) {
  color: rgba(255, 255, 255, 0.82) !important;
}

/* 表格编辑器 */
html.dark .diary-editor-wrapper :deep(.fr-table-resizer),
html.dark .diary-editor-wrapper :deep(.fr-table-cell-selector) {
  background: rgba(99, 102, 241, 0.6) !important;
}

/* 颜色选择器 */
html.dark .diary-editor-wrapper :deep(.fr-color-hex-layer input) {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: rgba(255, 255, 255, 0.09) !important;
  color: rgba(255, 255, 255, 0.82) !important;
}

/* 链接编辑弹窗 */
html.dark .diary-editor-wrapper :deep(.fr-link-insert-layer) {
  background: #252526 !important;
}

/* 图片编辑工具栏 */
html.dark .diary-editor-wrapper :deep(.fr-image-resizer),
html.dark .diary-editor-wrapper :deep(.fr-image-overlay) {
  border-color: rgba(99, 102, 241, 0.6) !important;
}

/* 快速插入按钮 */
html.dark .diary-editor-wrapper :deep(.fr-quick-insert) {
  background: #252526 !important;
  border-color: rgba(255, 255, 255, 0.09) !important;
  color: rgba(255, 255, 255, 0.82) !important;
}

html.dark .diary-editor-wrapper :deep(.fr-quick-insert:hover) {
  background: rgba(255, 255, 255, 0.08) !important;
}
</style>
