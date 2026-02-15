<template>
  <div class="diary-editor-wrapper" @contextmenu="handleContextMenu">
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
import { ref, watch, computed, h } from 'vue'
import { NDropdown, NIcon } from 'naive-ui'
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

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const content = ref(props.modelValue || '')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const editorInstance = ref<any>(null)

// 右键菜单状态
const showContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)

// 渲染图标
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderIcon = (icon: any) => {
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

// 将文件转换为 base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 插入图片到编辑器
const insertImage = async (file: File): Promise<void> => {
  console.log('insertImage called, editorInstance:', editorInstance.value)
  if (!editorInstance.value) {
    console.error('Editor instance not available')
    return
  }

  // 检查文件类型
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    console.warn('不支持的图片格式:', file.type)
    return
  }

  // 检查文件大小 (10MB)
  const maxSize = 10 * 1024 * 1024
  if (file.size > maxSize) {
    console.warn('图片大小超过限制:', file.size)
    return
  }

  try {
    console.log('Converting file to base64...')
    // 转换为 base64
    const base64 = await fileToBase64(file)
    console.log('Base64 conversion complete, length:', base64.length)

    // 保存为文件并获取 diary-image:// URL
    console.log('Saving image...')
    const result = await window.api.saveImage(base64)
    console.log('Save result:', result)

    if (result.success && result.path) {
      // 插入使用 diary-image:// 协议的 URL
      console.log('Inserting image with path:', result.path)
      editorInstance.value.image.insert(result.path, false, null, editorInstance.value.image.get())
      console.log('Image inserted successfully')
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
  placeholderText: '输入内容...',
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
  htmlAllowedTags: ['.*'],
  htmlAllowedAttrs: ['.*'],
  htmlRemoveTags: ['script'],
  // 事件处理
  events: {
    initialized: function (): void {
      editorInstance.value = this
      console.log('Froala Editor initialized')
    },
    contentChanged: function (): void {
      emit('update:modelValue', content.value)
    },
    'image.beforeUpload': function (files: FileList): boolean {
      console.log('image.beforeUpload triggered, files:', files)
      // 处理通过按钮选择的图片
      if (files && files.length > 0) {
        Array.from(files).forEach((file) => {
          console.log('Processing file:', file.name, file.type)
          insertImage(file)
        })
      }
      return false // 阻止默认上传行为
    },
    'image.error': function (error: unknown, response: unknown): void {
      console.error('Froala image error:', error, response)
    },
    'image.inserted': function ($img: unknown): void {
      console.log('Image inserted:', $img)
    },
    'paste.afterCleanup': async function (clipboardHtml: string): Promise<string> {
      // 处理粘贴的图片（base64）
      const imgRegex = /<img[^>]+src="(data:image\/[^;]+;base64,[^"]+)"[^>]*>/g
      let match
      const promises: Promise<void>[] = []

      while ((match = imgRegex.exec(clipboardHtml)) !== null) {
        const base64Data = match[1]
        promises.push(
          (async () => {
            try {
              const result = await window.api.saveImage(base64Data)
              if (result.success && result.path) {
                // 替换 base64 为 diary-image:// URL
                clipboardHtml = clipboardHtml.replace(base64Data, result.path)
              }
            } catch (error) {
              console.error('保存粘贴的图片失败:', error)
            }
          })()
        )
      }

      await Promise.all(promises)
      return clipboardHtml
    },
    drop: function (dropEvent: DragEvent): void {
      // 处理拖拽上传
      const files = dropEvent.dataTransfer?.files
      if (files && files.length > 0) {
        Array.from(files).forEach((file) => {
          if (file.type.startsWith('image/')) {
            insertImage(file)
          }
        })
      }
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
