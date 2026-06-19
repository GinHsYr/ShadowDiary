<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon } from 'naive-ui'
import { CloseOutline, ChevronBackOutline, ChevronForwardOutline } from '@vicons/ionicons5'

const props = defineProps<{
  modelValue: number | null
  images: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

const { t } = useI18n()

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

const isOpen = computed(() => props.modelValue !== null)
const currentSrc = computed(() => {
  const idx = props.modelValue
  if (idx === null) return null
  return props.images[idx] ?? null
})
const isZoomed = computed(() => zoomScale.value > 1.001)
const imageTransform = computed(
  () => `translate(${panX.value}px, ${panY.value}px) scale(${zoomScale.value})`
)

function close(): void {
  resetZoom()
  emit('update:modelValue', null)
}

function next(): void {
  const idx = props.modelValue
  if (idx === null) return
  const n = idx + 1
  if (n < props.images.length) {
    resetZoom()
    emit('update:modelValue', n)
  }
}

function prev(): void {
  const idx = props.modelValue
  if (idx === null) return
  if (idx > 0) {
    resetZoom()
    emit('update:modelValue', idx - 1)
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

function handleWheel(event: WheelEvent): void {
  if (!isOpen.value) return
  event.preventDefault()
  const stage = viewerStageRef.value
  if (!stage) return

  const direction = event.deltaY < 0 ? 1 : -1
  const factor = 1 + direction * ZOOM_STEP
  const oldScale = zoomScale.value
  const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldScale * factor))
  if (newScale === oldScale) return

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

function handleDoubleClick(event: MouseEvent): void {
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
  if (isZoomed.value) return
  if (panMoved) {
    panMoved = false
    return
  }
  if (event.target !== event.currentTarget) return
  close()
}

function handleKeydown(event: KeyboardEvent): void {
  if (!isOpen.value) return
  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      close()
      break
    case 'ArrowRight':
      event.preventDefault()
      if (!isZoomed.value) next()
      break
    case 'ArrowLeft':
      event.preventDefault()
      if (!isZoomed.value) prev()
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

watch(isOpen, (open) => {
  if (typeof document === 'undefined') return
  document.documentElement.style.overflow = open ? 'hidden' : ''
})

watch(
  () => props.modelValue,
  () => {
    resetZoom()
  }
)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (typeof document !== 'undefined') {
    document.documentElement.style.overflow = ''
  }
})
</script>

<template>
  <teleport to="body">
    <div v-if="isOpen && currentSrc" class="image-lightbox" @click.self="close">
      <div class="lightbox-topbar">
        <span class="lightbox-counter">{{
          t('imageLightbox.counter', {
            current: (modelValue ?? 0) + 1,
            total: images.length
          })
        }}</span>
        <button
          type="button"
          class="lightbox-icon-btn lightbox-close"
          :title="t('imageLightbox.close')"
          @click="close"
        >
          <n-icon size="22"><CloseOutline /></n-icon>
        </button>
      </div>

      <button
        type="button"
        class="lightbox-nav lightbox-prev"
        :title="t('imageLightbox.prev')"
        :disabled="modelValue === 0"
        @click="prev"
      >
        <n-icon size="26"><ChevronBackOutline /></n-icon>
      </button>
      <button
        type="button"
        class="lightbox-nav lightbox-next"
        :title="t('imageLightbox.next')"
        :disabled="modelValue === images.length - 1"
        @click="next"
      >
        <n-icon size="26"><ChevronForwardOutline /></n-icon>
      </button>

      <div
        ref="viewerStageRef"
        class="lightbox-stage"
        :class="{ 'is-zoomed': isZoomed, 'is-panning': isPanning }"
        @wheel.prevent="handleWheel"
        @pointerdown="handlePanStart"
        @pointermove="handlePanMove"
        @pointerup="handlePanEnd"
        @pointercancel="handlePanEnd"
        @click="handleStageClick"
      >
        <img
          :key="currentSrc"
          class="lightbox-image"
          :src="currentSrc"
          :style="{ transform: imageTransform }"
          draggable="false"
          @dblclick="handleDoubleClick"
        />
      </div>
    </div>
  </teleport>
</template>

<style>
/* Lightbox is teleported to <body>, styles must be global. */
.image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.92);
  animation: image-lightbox-fade var(--motion-fast, 160ms) var(--ease-enter, ease) forwards;
}

.image-lightbox .lightbox-stage {
  position: absolute;
  inset: 60px 80px 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
  cursor: zoom-in;
}

.image-lightbox .lightbox-stage.is-zoomed {
  cursor: grab;
}

.image-lightbox .lightbox-stage.is-panning {
  cursor: grabbing;
}

.image-lightbox .lightbox-image {
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

.image-lightbox .is-panning .lightbox-image {
  transition: none;
}

.image-lightbox .lightbox-topbar {
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

.image-lightbox .lightbox-counter {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.82);
}

.image-lightbox .lightbox-icon-btn {
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

.image-lightbox .lightbox-icon-btn:hover {
  background: rgba(255, 255, 255, 0.26);
}

.image-lightbox .lightbox-nav {
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
  z-index: 1;
}

.image-lightbox .lightbox-nav:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.22);
}

.image-lightbox .lightbox-nav:disabled {
  opacity: 0.3;
  cursor: default;
}

.image-lightbox .lightbox-prev {
  left: 18px;
}

.image-lightbox .lightbox-next {
  right: 18px;
}

@keyframes image-lightbox-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .image-lightbox .lightbox-stage {
    inset: 56px 16px 40px;
  }

  .image-lightbox .lightbox-nav {
    width: 40px;
    height: 52px;
  }

  .image-lightbox .lightbox-prev {
    left: 8px;
  }

  .image-lightbox .lightbox-next {
    right: 8px;
  }
}
</style>
