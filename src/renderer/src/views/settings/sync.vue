<template>
  <div class="sync-page">
    <header class="page-header">
      <n-button quaternary circle :aria-label="t('settings.sync.back')" @click="goBack">
        <template #icon
          ><n-icon><ArrowBackOutline /></n-icon
        ></template>
      </n-button>
      <div>
        <h1>{{ t('settings.sync.title') }}</h1>
        <p>{{ t('settings.sync.subtitle') }}</p>
      </div>
    </header>

    <main class="sync-content">
      <section class="sync-hero" :class="`is-${syncState.phase}`">
        <div class="hero-copy">
          <div class="hero-title-row">
            <h2>{{ statusLabel }}</h2>
            <n-tag :type="statusTagType" round size="small">{{ statusShortLabel }}</n-tag>
          </div>
          <p>{{ statusDescription }}</p>
          <div v-if="syncState.phase === 'syncing'" class="transfer-progress">
            <n-progress type="line" :percentage="progressPercent" :show-indicator="true" />
          </div>
          <div class="hero-controls">
            <div>
              <strong>{{ t('settings.sync.enable') }}</strong>
              <span>{{ t('settings.sync.enableDescription') }}</span>
            </div>
            <n-switch :value="syncState.enabled" :loading="busy" @update:value="toggleEnabled" />
          </div>
        </div>
      </section>

      <section class="secure-note">
        <n-icon :size="20"><ShieldCheckmarkOutline /></n-icon>
        <span>{{ t('settings.sync.secure') }}</span>
      </section>

      <n-alert v-if="syncState.error" type="error" :title="t('settings.sync.errorTitle')">
        {{ errorLabel(syncState.error) }}
      </n-alert>

      <n-card :bordered="false" class="panel pairing-panel">
        <template #header>
          <div class="panel-heading">
            <div>
              <h3>{{ t('settings.sync.pairNew') }}</h3>
              <p>{{ t('settings.sync.pairDescription') }}</p>
            </div>
            <n-button
              type="primary"
              :disabled="!syncState.enabled"
              :loading="busy && !syncState.pairingCode"
              @click="beginPairing"
            >
              {{ t('settings.sync.createCode') }}
            </n-button>
          </div>
        </template>

        <transition name="code-reveal" mode="out-in">
          <div v-if="syncState.pairingCode" :key="syncState.pairingCode" class="pairing-code-wrap">
            <span class="code-kicker">{{ t('settings.sync.pairingCode') }}</span>
            <div class="pairing-code" :aria-label="syncState.pairingCode">
              <span v-for="(digit, index) in syncState.pairingCode" :key="index">{{ digit }}</span>
            </div>
            <div class="expiry-row">
              <span>{{ t('settings.sync.expires', { seconds: pairingSecondsLeft }) }}</span>
              <n-progress type="line" :percentage="pairingPercent" :show-indicator="false" />
            </div>
          </div>
          <div v-else class="pairing-placeholder">
            <n-icon :size="28"><PhonePortraitOutline /></n-icon>
            <span>{{ t('settings.sync.pairHint') }}</span>
          </div>
        </transition>
      </n-card>

      <n-card :bordered="false" class="panel">
        <template #header>
          <div class="panel-heading compact">
            <div>
              <h3>{{ t('settings.sync.pairedDevices') }}</h3>
              <p>{{ t('settings.sync.pairedDescription') }}</p>
            </div>
            <n-tag round>{{ syncState.pairedDevices.length }}</n-tag>
          </div>
        </template>

        <n-empty
          v-if="syncState.pairedDevices.length === 0"
          :description="t('settings.sync.noPairedDevices')"
        />
        <div v-else class="device-list">
          <article
            v-for="(device, index) in syncState.pairedDevices"
            :key="device.deviceId"
            class="device-row entrance-row"
            :style="{ '--row-index': index }"
          >
            <div class="device-icon">
              <n-icon :size="22"><PhonePortraitOutline /></n-icon>
            </div>
            <div class="device-copy">
              <strong>{{ device.name }}</strong>
              <span>{{ formatLastSync(device.lastSyncAt) }}</span>
            </div>
            <span
              class="presence-dot"
              :class="{ active: syncState.activeDeviceId === device.deviceId }"
            />
            <n-button text type="error" @click="confirmUnpair(device.deviceId, device.name)">
              {{ t('settings.sync.unpair') }}
            </n-button>
          </article>
        </div>
      </n-card>

      <n-card v-if="conflicts.length > 0" :bordered="false" class="panel conflict-panel">
        <template #header>
          <div class="panel-heading compact">
            <div>
              <h3>{{ t('settings.sync.conflicts') }}</h3>
              <p>{{ t('settings.sync.conflictsDescription', { count: conflicts.length }) }}</p>
            </div>
            <n-tag type="warning" round>{{ conflicts.length }}</n-tag>
          </div>
        </template>
        <div class="conflict-list">
          <button
            v-for="conflict in conflicts"
            :key="conflict.id"
            type="button"
            class="conflict-row"
            @click="selectedConflict = conflict"
          >
            <n-icon :size="20"><GitCompareOutline /></n-icon>
            <span>
              <strong>{{ conflictTitle(conflict) }}</strong>
              <small>{{
                conflict.entityType === 'diary'
                  ? t('settings.sync.diary')
                  : t('settings.sync.archive')
              }}</small>
            </span>
            <n-icon><ChevronForwardOutline /></n-icon>
          </button>
        </div>
      </n-card>
    </main>

    <n-modal
      :show="Boolean(selectedConflict)"
      preset="card"
      :title="t('settings.sync.resolveConflict')"
      class="conflict-modal"
      style="width: min(960px, calc(100vw - 40px))"
      :closable="!resolvingConflict"
      :mask-closable="!resolvingConflict"
      :close-on-esc="!resolvingConflict"
      @close="closeConflictReview"
    >
      <div v-if="selectedConflict && selectedDiff" class="conflict-review">
        <header class="diff-review-heading">
          <span class="diff-review-icon" aria-hidden="true">
            <n-icon :size="22"><GitCompareOutline /></n-icon>
          </span>
          <div>
            <strong>{{ conflictTitle(selectedConflict) }}</strong>
            <span>{{
              selectedConflict.entityType === 'diary'
                ? t('settings.sync.diary')
                : t('settings.sync.archive')
            }}</span>
          </div>
          <n-tag type="warning" round size="small">{{ t('settings.sync.diff.changed') }}</n-tag>
        </header>

        <div
          class="diff-document"
          role="region"
          :aria-label="t('settings.sync.diff.reviewLabel')"
          tabindex="0"
        >
          <div class="diff-version is-local">
            <code>--- {{ t('settings.sync.desktopVersion') }}</code>
          </div>
          <div class="diff-version is-remote">
            <code>+++ {{ t('settings.sync.phoneVersion') }}</code>
          </div>
          <div class="diff-hunk">
            <code
              >@@ -1,{{ selectedDiff.localLines.length }} +1,{{
                selectedDiff.remoteLines.length
              }}
              @@</code
            >
          </div>
          <div
            v-for="(line, index) in selectedDiff.lines"
            :key="[line.kind, line.localLine ?? 'x', line.remoteLine ?? 'x', index].join('-')"
            class="diff-line"
            :class="'is-' + line.kind"
          >
            <span class="diff-line-number" aria-hidden="true">{{ line.localLine ?? '' }}</span>
            <span class="diff-line-number" aria-hidden="true">{{ line.remoteLine ?? '' }}</span>
            <span class="diff-prefix" aria-hidden="true">{{ diffPrefix(line.kind) }}</span>
            <code>{{ line.text }}</code>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="conflict-actions">
          <span>{{ t('settings.sync.saveConfirmationHint') }}</span>
          <n-space justify="end" wrap>
            <n-button :disabled="resolvingConflict" @click="requestResolution('keepLocal')">
              {{ t('settings.sync.keepDesktop') }}
            </n-button>
            <n-button :disabled="resolvingConflict" @click="requestResolution('keepRemote')">
              {{ t('settings.sync.keepPhone') }}
            </n-button>
            <n-button
              type="primary"
              :disabled="resolvingConflict"
              @click="requestResolution('keepBoth')"
            >
              {{ t('settings.sync.keepBoth') }}
            </n-button>
          </n-space>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NIcon,
  NModal,
  NProgress,
  NSpace,
  NSwitch,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import {
  ArrowBackOutline,
  ChevronForwardOutline,
  GitCompareOutline,
  PhonePortraitOutline,
  ShieldCheckmarkOutline
} from '@vicons/ionicons5'
import type { SyncConflict, SyncConflictChoice, SyncRuntimeState } from '../../../../types/api'
import {
  buildConflictDiff,
  type ConflictDiffLineKind,
  type ConflictDiffResult
} from './syncConflictDiff'

const { t, locale } = useI18n()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const emptyState: SyncRuntimeState = {
  enabled: false,
  phase: 'disabled',
  pairedDevices: [],
  conflictCount: 0,
  completedRecords: 0,
  totalRecords: 0,
  completedBytes: 0,
  totalBytes: 0
}
const syncState = ref<SyncRuntimeState>(emptyState)
const conflicts = ref<SyncConflict[]>([])
const selectedConflict = ref<SyncConflict | null>(null)
const busy = ref(false)
const resolvingConflict = ref(false)
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
let removeStateListener: (() => void) | null = null

const statusLabel = computed(() => t(`settings.sync.status.${syncState.value.phase}`))
const statusShortLabel = computed(() =>
  syncState.value.enabled ? t('settings.sync.running') : t('settings.sync.stopped')
)
const statusDescription = computed(() => {
  if (syncState.value.lastSyncAt) {
    return t('settings.sync.lastSync', { time: formatDate(syncState.value.lastSyncAt) })
  }
  return t('settings.sync.statusDescription')
})
const statusTagType = computed<'default' | 'success' | 'warning' | 'error'>(() => {
  if (syncState.value.phase === 'failed') return 'error'
  if (syncState.value.phase === 'conflicts') return 'warning'
  if (syncState.value.enabled) return 'success'
  return 'default'
})
const progressPercent = computed(() => {
  if (syncState.value.totalBytes > 0) {
    return Math.min(
      100,
      Math.round((syncState.value.completedBytes / syncState.value.totalBytes) * 100)
    )
  }
  if (syncState.value.totalRecords > 0) {
    return Math.min(
      100,
      Math.round((syncState.value.completedRecords / syncState.value.totalRecords) * 100)
    )
  }
  return 0
})
const pairingSecondsLeft = computed(() =>
  syncState.value.pairingExpiresAt
    ? Math.max(0, Math.ceil((syncState.value.pairingExpiresAt - now.value) / 1000))
    : 0
)
const pairingPercent = computed(() => Math.round((pairingSecondsLeft.value / 120) * 100))
const selectedDiff = computed<ConflictDiffResult | null>(() => {
  const conflict = selectedConflict.value
  if (!conflict) return null
  return buildConflictDiff(conflict, {
    deleted: t('settings.sync.diff.deleted'),
    localSide: t('settings.sync.desktopVersion'),
    remoteSide: t('settings.sync.phoneVersion'),
    omitted: (count) => t('settings.sync.diff.omitted', { count }),
    timestamp: formatDate,
    mood: localizedMood,
    archiveType: localizedArchiveType,
    fields: {
      title: t('settings.sync.diff.title'),
      date: t('settings.sync.diff.date'),
      mood: t('settings.sync.diff.mood'),
      weather: t('settings.sync.diff.weather'),
      tags: t('settings.sync.diff.tags'),
      content: t('settings.sync.diff.content'),
      images: t('settings.sync.diff.images'),
      richText: t('settings.sync.diff.richText'),
      name: t('settings.sync.diff.name'),
      aliases: t('settings.sync.diff.aliases'),
      type: t('settings.sync.diff.type'),
      description: t('settings.sync.diff.description'),
      mainImage: t('settings.sync.diff.mainImage'),
      gallery: t('settings.sync.diff.gallery'),
      createdAt: t('settings.sync.diff.createdAt'),
      updatedAt: t('settings.sync.diff.updatedAt'),
      other: t('settings.sync.diff.other')
    }
  })
})

async function refreshConflicts(): Promise<void> {
  conflicts.value = await window.api.getSyncConflicts()
}

async function toggleEnabled(value: boolean): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    syncState.value = await window.api.setSyncEnabled(value)
  } catch (error) {
    message.error(errorLabel(String(error)))
  } finally {
    busy.value = false
  }
}

async function beginPairing(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    syncState.value = await window.api.beginSyncPairing()
  } catch (error) {
    message.error(errorLabel(String(error)))
  } finally {
    busy.value = false
  }
}

function confirmUnpair(deviceId: string, name: string): void {
  dialog.warning({
    title: t('settings.sync.unpairTitle'),
    content: t('settings.sync.unpairDescription', { name }),
    positiveText: t('settings.sync.unpair'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      syncState.value = await window.api.unpairSyncDevice(deviceId)
      await refreshConflicts()
    }
  })
}

function closeConflictReview(): void {
  if (!resolvingConflict.value) selectedConflict.value = null
}

function resolutionChoiceLabel(choice: SyncConflictChoice): string {
  if (choice === 'keepLocal') return t('settings.sync.keepDesktop')
  if (choice === 'keepRemote') return t('settings.sync.keepPhone')
  return t('settings.sync.keepBoth')
}

function requestResolution(choice: SyncConflictChoice): void {
  const conflict = selectedConflict.value
  if (!conflict || resolvingConflict.value) return
  dialog.warning({
    title: t('settings.sync.confirmResolutionTitle'),
    content: t('settings.sync.confirmResolutionDescription', {
      choice: resolutionChoiceLabel(choice)
    }),
    positiveText: t('settings.sync.confirmSave'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => applyResolution(conflict, choice)
  })
}

async function applyResolution(
  conflict: SyncConflict,
  choice: SyncConflictChoice
): Promise<false | void> {
  resolvingConflict.value = true
  try {
    try {
      syncState.value = await window.api.resolveSyncConflict(conflict.id, choice)
    } catch (error) {
      message.error(errorLabel(String(error)))
      return false
    }
    if (selectedConflict.value?.id === conflict.id) selectedConflict.value = null
    try {
      await refreshConflicts()
    } catch (error) {
      message.error(errorLabel(String(error)))
    }
  } finally {
    resolvingConflict.value = false
  }
}

function conflictTitle(conflict: SyncConflict): string {
  return (
    payloadTitle(conflict.localPayload) ?? payloadTitle(conflict.remotePayload) ?? conflict.entityId
  )
}

function payloadTitle(payload?: Record<string, unknown>): string | null {
  if (!payload) return null
  const title = String(payload.title ?? payload.name ?? '').trim()
  return title || null
}

function localizedMood(value: string): string {
  if (['happy', 'calm', 'sad', 'excited', 'tired'].includes(value)) {
    return t('today.mood.' + value)
  }
  return value
}

function localizedArchiveType(value: string): string {
  if (['person', 'object', 'other'].includes(value)) return t('archiveDetail.' + value)
  return value
}

function diffPrefix(kind: ConflictDiffLineKind): string {
  if (kind === 'removed') return '-'
  if (kind === 'added') return '+'
  return ' '
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    timestamp
  )
}

function formatLastSync(timestamp?: number): string {
  return timestamp
    ? t('settings.sync.lastSync', { time: formatDate(timestamp) })
    : t('settings.sync.neverSynced')
}

function errorLabel(error: string): string {
  if (error.includes('authentication')) return t('settings.sync.errors.authentication')
  if (error.includes('pair')) return t('settings.sync.errors.pairing')
  if (error.includes('asset')) return t('settings.sync.errors.asset')
  if (error.includes('port')) return t('settings.sync.errors.port')
  return t('settings.sync.errors.connection')
}

function goBack(): void {
  void router.push('/settings')
}

onMounted(async () => {
  syncState.value = await window.api.getSyncState()
  await refreshConflicts()
  removeStateListener = window.api.onSyncStateChanged((state) => {
    syncState.value = state
    if (state.conflictCount !== conflicts.value.length) void refreshConflicts()
  })
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  removeStateListener?.()
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<style scoped>
.sync-page {
  height: 100%;
  overflow-y: auto;
  padding: 24px;
  box-sizing: border-box;
  background: var(--app-content-surface);
}

.page-header {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  max-width: 980px;
  margin: 0 auto 22px;
}

.page-header h1 {
  margin: 0;
  font-size: 28px;
  letter-spacing: -0.025em;
}
.page-header p {
  margin: 5px 0 0;
  color: var(--n-text-color-3);
}
.sync-content {
  max-width: 980px;
  margin: 0 auto;
  display: grid;
  gap: 18px;
  padding-bottom: 30px;
}

.sync-hero {
  padding: 32px 40px;
  border-radius: 26px;
  overflow: hidden;
  position: relative;
  background: color-mix(in srgb, var(--n-card-color) 97%, var(--app-accent-color));
  box-shadow: 0 20px 50px color-mix(in srgb, var(--app-material-shadow) 34%, transparent);
}

.hero-copy h2 {
  margin: 0;
  font-size: 25px;
  letter-spacing: -0.02em;
}
.hero-copy > p {
  margin: 7px 0 22px;
  color: var(--n-text-color-3);
}
.hero-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.transfer-progress {
  margin: -7px 0 18px;
  max-width: 520px;
}
.hero-controls {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  padding-top: 18px;
  border-top: 1px solid var(--app-accent-16);
}
.hero-controls div {
  display: grid;
  gap: 3px;
}
.hero-controls span {
  color: var(--n-text-color-3);
  font-size: 13px;
}

.secure-note {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  color: var(--n-text-color-3);
  font-size: 13px;
}
.secure-note :deep(.n-icon) {
  color: var(--app-accent-color);
}
.panel {
  border-radius: 18px;
  box-shadow: 0 7px 24px rgba(0, 0, 0, 0.045);
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.panel-heading h3 {
  margin: 0;
  font-size: 17px;
}
.panel-heading p {
  margin: 4px 0 0;
  color: var(--n-text-color-3);
  font-size: 13px;
}
.panel-heading.compact {
  width: 100%;
}

.pairing-code-wrap {
  display: grid;
  justify-items: center;
  padding: 16px 0 8px;
}
.code-kicker {
  color: var(--n-text-color-3);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.13em;
}
.pairing-code {
  display: flex;
  gap: 9px;
  margin: 14px 0 16px;
}
.pairing-code span {
  width: 45px;
  height: 58px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  font:
    700 28px/1 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  background: var(--app-accent-08);
  border: 1px solid var(--app-accent-20);
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.15);
}
.expiry-row {
  width: min(390px, 100%);
  display: grid;
  gap: 7px;
  color: var(--n-text-color-3);
  font-size: 12px;
  text-align: center;
}
.pairing-placeholder {
  min-height: 112px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--n-text-color-3);
}

.device-list,
.conflict-list {
  display: grid;
  gap: 8px;
}
.device-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 13px;
  padding: 12px;
  border-radius: 14px;
  background: var(--app-accent-06);
}
.device-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--app-accent-12);
  color: var(--app-accent-color);
}
.device-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.device-copy strong {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.device-copy span {
  color: var(--n-text-color-3);
  font-size: 12px;
}
.presence-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--n-border-color);
}
.presence-dot.active {
  background: var(--app-accent-color);
  box-shadow: 0 0 10px var(--app-accent-color);
}
.entrance-row {
  animation: row-enter var(--motion-spring-normal) var(--ease-enter) both;
  animation-delay: calc(var(--row-index) * var(--motion-stagger));
}

.conflict-row {
  width: 100%;
  border: 0;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 13px;
  border-radius: 13px;
  color: inherit;
  text-align: left;
  background: var(--app-accent-06);
  cursor: pointer;
  transition:
    transform var(--motion-fast) var(--ease-standard),
    background var(--motion-fast);
}
.conflict-row:hover {
  transform: translateX(3px);
  background: var(--app-accent-12);
}
.conflict-row:focus-visible {
  outline: 2px solid var(--app-accent-color);
  outline-offset: 2px;
}
.conflict-row span {
  display: grid;
  gap: 2px;
}
.conflict-row small {
  color: var(--n-text-color-3);
}

.conflict-review {
  display: grid;
  gap: 14px;
}
.diff-review-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 2px 2px 0;
}
.diff-review-heading > div {
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.diff-review-heading strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
}
.diff-review-heading span {
  color: var(--n-text-color-3);
  font-size: 12px;
}
.diff-review-icon {
  width: 38px;
  height: 38px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
  color: var(--app-accent-color);
  background: var(--app-accent-12);
  box-shadow: inset 0 0 0 1px var(--app-accent-20);
}

.diff-document {
  --diff-removed-foreground: #8c1d25;
  --diff-removed-background: color-mix(in srgb, #ff8182 17%, var(--n-card-color));
  --diff-added-foreground: #116329;
  --diff-added-background: color-mix(in srgb, #4ac26b 17%, var(--n-card-color));
  max-height: min(60vh, 620px);
  overflow: auto;
  border: 1px solid var(--n-border-color);
  border-radius: 13px;
  background: var(--n-card-color);
  box-shadow:
    inset 0 1px rgba(255, 255, 255, 0.04),
    0 16px 34px rgba(0, 0, 0, 0.06);
  scrollbar-color: var(--n-scrollbar-color) transparent;
}
:global(.dark) .diff-document {
  --diff-removed-foreground: #ffb3ad;
  --diff-removed-background: color-mix(in srgb, #f85149 18%, var(--n-card-color));
  --diff-added-foreground: #7ee787;
  --diff-added-background: color-mix(in srgb, #2ea043 20%, var(--n-card-color));
}
.diff-document:focus-visible {
  outline: 2px solid var(--app-accent-color);
  outline-offset: 2px;
}
.diff-version,
.diff-hunk,
.diff-line {
  font:
    12px/1.45 ui-monospace,
    SFMono-Regular,
    'Cascadia Code',
    Consolas,
    monospace;
}
.diff-version {
  padding: 5px 12px;
  background: var(--n-action-color);
}
.diff-version code,
.diff-hunk code,
.diff-line code {
  font: inherit;
}
.diff-version.is-local {
  color: var(--diff-removed-foreground);
}
.diff-version.is-remote {
  color: var(--diff-added-foreground);
}
.diff-hunk {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 6px 12px;
  color: var(--app-accent-color);
  background: color-mix(in srgb, var(--app-accent-color) 13%, var(--n-card-color));
  border-top: 1px solid var(--n-border-color);
  border-bottom: 1px solid var(--n-border-color);
}
.diff-line {
  display: grid;
  grid-template-columns: 46px 46px 24px minmax(0, 1fr);
  min-height: 30px;
  color: var(--n-text-color);
  background: var(--n-card-color);
}
.diff-line.is-removed {
  color: var(--diff-removed-foreground);
  background: var(--diff-removed-background);
  box-shadow: inset 3px 0 var(--diff-removed-foreground);
}
.diff-line.is-added {
  color: var(--diff-added-foreground);
  background: var(--diff-added-background);
  box-shadow: inset 3px 0 var(--diff-added-foreground);
}
.diff-line-number,
.diff-prefix {
  padding-top: 5px;
  color: currentColor;
  text-align: right;
  user-select: none;
  opacity: 0.68;
}
.diff-prefix {
  text-align: center;
  font-weight: 800;
  opacity: 1;
}
.diff-line > code {
  min-width: 0;
  padding: 5px 12px 5px 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.conflict-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.conflict-actions > span {
  color: var(--n-text-color-3);
  font-size: 12px;
}

.code-reveal-enter-active,
.code-reveal-leave-active {
  transition:
    opacity var(--motion-normal) var(--ease-standard),
    transform var(--motion-spring-fast) var(--ease-enter);
}
.code-reveal-enter-from,
.code-reveal-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

@keyframes row-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

:global(.reduced-motion) .entrance-row {
  animation: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .entrance-row {
    animation: none !important;
  }
}

@media (max-height: 680px) {
  .diff-document {
    max-height: 45vh;
  }
}

@media (max-width: 720px) {
  .sync-page {
    padding: 16px;
  }
  .sync-hero {
    padding: 24px;
  }
  .hero-copy {
    width: 100%;
    text-align: center;
  }
  .hero-title-row {
    justify-content: center;
  }
  .hero-controls {
    text-align: left;
  }
  .conflict-actions {
    align-items: flex-start;
    flex-direction: column;
  }
  .diff-line {
    grid-template-columns: 38px 38px 22px minmax(0, 1fr);
  }
  .panel-heading {
    align-items: flex-start;
  }
}
</style>
