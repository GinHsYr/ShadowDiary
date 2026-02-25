<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NGrid,
  NGi,
  NCard,
  NStatistic,
  NSpace,
  NButton,
  NNumberAnimation,
  NIcon,
  NPopover,
  NModal,
  NTag,
  NSpin,
  NPagination,
  NProgress
} from 'naive-ui'
import { ChevronBackOutline, ChevronForwardOutline, TodayOutline } from '@vicons/ionicons5'
import { useRouter } from 'vue-router'
import type { DiaryEntry, PersonMentionDetailItem } from '../../../../types/model'
import { use } from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([PieChart, TitleComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const router = useRouter()
const { t, tm } = useI18n()

// 真实数据
const totalEntries = ref(0)
const currentStreak = ref(0)
const totalCharacters = ref(0)
const recentEntries = ref<DiaryEntry[]>([])
const diaryDates = ref<Set<string>>(new Set())
const personMentionData = ref<{ name: string; count: number }[]>([])
const showMentionModal = ref(false)
const mentionLoading = ref(false)
const selectedPerson = ref('')
const mentionKeywords = ref<string[]>([])
const mentionEntries = ref<PersonMentionDetailItem[]>([])
const mentionTotal = ref(0)
const mentionPage = ref(1)
const mentionPageSize = 20
const mentionListEpoch = ref(0)
const monthGridTransitionName = ref<'month-grid-next' | 'month-grid-prev' | 'month-grid-fade'>(
  'month-grid-fade'
)
const monthGridKey = ref('')
const statsEntered = ref(false)
const skipStatsEnterAnimation = ref(false)
const dashboardEntered = ref(false)
const STATS_ANIMATED_SESSION_KEY = 'dashboard.stats-entered'
const mentionPageCount = computed(() =>
  Math.max(1, Math.ceil(mentionTotal.value / mentionPageSize))
)
const mentionContentKey = computed(() => {
  if (mentionLoading.value) return 'loading'
  if (mentionEntries.value.length === 0) return `empty-${mentionListEpoch.value}`
  return `list-${mentionPage.value}-${mentionListEpoch.value}`
})
const mentionTagColor = {
  color: 'var(--app-accent-12, rgba(24, 160, 88, 0.12))',
  borderColor: 'var(--app-accent-20, rgba(24, 160, 88, 0.2))',
  textColor: 'var(--app-accent-color, var(--n-color-target, #18a058))'
}
const typedWelcome = ref('')
const welcomeTyping = ref(false)
const welcomeText = computed(() => t('dashboard.welcome'))
const WELCOME_TYPING_INTERVAL_MS = 60
let welcomeTypingTimer: ReturnType<typeof setTimeout> | null = null

function clearWelcomeTypingTimer(): void {
  if (welcomeTypingTimer) {
    clearTimeout(welcomeTypingTimer)
    welcomeTypingTimer = null
  }
}

function shouldReduceMotion(): boolean {
  return (
    document.documentElement.classList.contains('reduced-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function playWelcomeTyping(text: string): void {
  clearWelcomeTypingTimer()
  if (!text) {
    typedWelcome.value = ''
    welcomeTyping.value = false
    return
  }

  if (shouldReduceMotion()) {
    typedWelcome.value = text
    welcomeTyping.value = false
    return
  }

  const chars = Array.from(text)
  let charIndex = 0
  typedWelcome.value = ''
  welcomeTyping.value = true

  const typeNextChar = (): void => {
    typedWelcome.value += chars[charIndex]
    charIndex += 1
    if (charIndex < chars.length) {
      welcomeTypingTimer = setTimeout(typeNextChar, WELCOME_TYPING_INTERVAL_MS)
      return
    }
    welcomeTyping.value = false
    welcomeTypingTimer = null
  }

  typeNextChar()
}

// 加载统计数据
async function loadStats(): Promise<void> {
  try {
    const stats = await window.api.getStats()
    totalEntries.value = stats.totalEntries
    currentStreak.value = stats.currentStreak
    totalCharacters.value = stats.totalCharacters
  } catch (error) {
    console.error('加载统计失败:', error)
  }
}

// 加载最近日记
async function loadRecentEntries(): Promise<void> {
  try {
    // 使用 lightweight 模式加载列表
    const result = await window.api.getDiaryEntries({ limit: 5, offset: 0, lightweight: true })
    recentEntries.value = result.entries
  } catch (error) {
    console.error('加载最近日记失败:', error)
  }
}

// 加载当月日记日期
async function loadDiaryDates(): Promise<void> {
  try {
    const y = currentMonth.value.getFullYear()
    const m = String(currentMonth.value.getMonth() + 1).padStart(2, '0')
    const dates = await window.api.getDiaryDates(`${y}-${m}`)
    diaryDates.value = new Set(dates)
  } catch (error) {
    console.error('加载日记日期失败:', error)
  }
}

// 加载人物提及统计
async function loadPersonMentions(): Promise<void> {
  try {
    personMentionData.value = await window.api.getPersonMentionStats()
  } catch (error) {
    console.error('加载人物提及统计失败:', error)
  }
}

// 饼图配置
const pieChartOption = computed(() => {
  const top10 = personMentionData.value.slice(0, 10)
  const rest = personMentionData.value.slice(10)
  const restCount = rest.reduce((sum, item) => sum + item.count, 0)

  const chartData = top10.map((item) => ({
    name: item.name,
    value: item.count
  }))

  if (restCount > 0) {
    chartData.push({ name: t('dashboard.other'), value: restCount })
  }

  return {
    title: {
      text: t('dashboard.mentionChartTitle'),
      left: 'center',
      top: 8,
      textStyle: {
        fontSize: 14,
        fontWeight: 600
      }
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: { name: string; value: number; percent: number }) =>
        t('dashboard.mentionTooltip', {
          name: params.name,
          count: params.value,
          percent: params.percent
        })
    },
    legend: {
      type: 'scroll',
      orient: 'horizontal',
      left: 12,
      right: 12,
      bottom: 0
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['50%', '52%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#fff',
          borderWidth: 2
        },
        label: {
          show: false
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold'
          }
        },
        data: chartData
      }
    ]
  }
})

onMounted(() => {
  loadStats()
  loadRecentEntries()
  loadDiaryDates()
  loadPersonMentions()

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      dashboardEntered.value = true
    })
  })

  if (sessionStorage.getItem(STATS_ANIMATED_SESSION_KEY) === '1') {
    skipStatsEnterAnimation.value = true
    statsEntered.value = true
  } else {
    requestAnimationFrame(() => {
      statsEntered.value = true
      sessionStorage.setItem(STATS_ANIMATED_SESSION_KEY, '1')
    })
  }
})

watch(
  welcomeText,
  (value) => {
    playWelcomeTyping(value)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearWelcomeTypingTimer()
})

interface PieClickParams {
  componentType?: string
  seriesType?: string
  name?: string
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return str.replace(/[&<>"']/g, (m) => map[m])
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function getSnippet(text: string, keywords: string[], around = 40): string {
  const plain = text || ''
  if (!plain) return ''
  if (keywords.length === 0) return plain.slice(0, around * 2)

  const lower = plain.toLowerCase()
  let bestIdx = -1
  let bestLen = 0
  for (const kw of keywords) {
    const idx = lower.indexOf(kw.toLowerCase())
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx
      bestLen = kw.length
    }
  }

  if (bestIdx === -1) return plain.slice(0, around * 2)

  const start = Math.max(0, bestIdx - around)
  const end = Math.min(plain.length, bestIdx + bestLen + around)
  let snippet = ''
  if (start > 0) snippet += '...'
  snippet += plain.slice(start, end)
  if (end < plain.length) snippet += '...'
  return snippet
}

function highlightText(text: string, keywords: string[]): string {
  if (!text) return ''
  if (keywords.length === 0) return escapeHtml(text)

  let result = escapeHtml(text)
  const sortedKeywords = [...new Set(keywords)].sort((a, b) => b.length - a.length)
  for (const keyword of sortedKeywords) {
    const escaped = escapeRegex(escapeHtml(keyword))
    result = result.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>')
  }
  return result
}

function getHighlightedSnippet(entry: PersonMentionDetailItem): string {
  const entryKeywords =
    entry.matchedKeywords.length > 0 ? entry.matchedKeywords : mentionKeywords.value
  const snippet = getSnippet(entry.content, entryKeywords)
  return highlightText(snippet, entryKeywords)
}

async function fetchMentionDetailsPage(personName: string, page: number): Promise<void> {
  mentionLoading.value = true
  try {
    const result = await window.api.getPersonMentionDetails(personName, {
      limit: mentionPageSize,
      offset: (page - 1) * mentionPageSize
    })

    selectedPerson.value = result.personName
    mentionKeywords.value = result.keywords.length > 0 ? result.keywords : [personName]
    mentionEntries.value = result.entries
    mentionTotal.value = result.total
    mentionListEpoch.value++
  } catch (error) {
    console.error('加载人物提及明细失败:', error)
  } finally {
    mentionLoading.value = false
  }
}

async function loadMentionDetails(personName: string): Promise<void> {
  selectedPerson.value = personName
  showMentionModal.value = true
  mentionEntries.value = []
  mentionTotal.value = 0
  mentionKeywords.value = [personName]
  mentionPage.value = 1
  mentionListEpoch.value = 0
  await fetchMentionDetailsPage(personName, 1)
}

async function handleMentionPageChange(page: number): Promise<void> {
  if (!selectedPerson.value) return
  mentionPage.value = page
  await fetchMentionDetailsPage(selectedPerson.value, page)
}

async function handlePieClick(params: PieClickParams): Promise<void> {
  if (params.componentType !== 'series' || params.seriesType !== 'pie') return
  const personName = params.name?.trim()
  if (!personName || personName === t('dashboard.other')) return
  await loadMentionDetails(personName)
}

function openMentionDiary(entry: PersonMentionDetailItem): void {
  const keyword = mentionKeywords.value.join(' ').trim() || selectedPerson.value
  showMentionModal.value = false
  router.push({
    path: '/today',
    query: {
      id: entry.id,
      keyword
    }
  })
}

// ========== 日历相关 ==========
const currentMonth = ref(new Date())
monthGridKey.value = `${currentMonth.value.getFullYear()}-${currentMonth.value.getMonth() + 1}`

function setCurrentMonth(targetDate: Date, direction: 'next' | 'prev' | 'fade'): void {
  monthGridTransitionName.value =
    direction === 'next'
      ? 'month-grid-next'
      : direction === 'prev'
        ? 'month-grid-prev'
        : 'month-grid-fade'
  currentMonth.value = targetDate
  monthGridKey.value = `${targetDate.getFullYear()}-${targetDate.getMonth() + 1}`
  void loadDiaryDates()
}

const selectedMonthTotalDays = computed(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth()
  return new Date(year, month + 1, 0).getDate()
})
const selectedMonthWrittenDays = computed(() => diaryDates.value.size)
const selectedMonthWrittenPercent = computed(() => {
  if (selectedMonthTotalDays.value === 0) return 0
  return Number(((selectedMonthWrittenDays.value / selectedMonthTotalDays.value) * 100).toFixed(1))
})

const monthLabel = computed(() => {
  const y = currentMonth.value.getFullYear()
  const m = currentMonth.value.getMonth() + 1
  return t('dashboard.monthLabel', { year: y, month: m })
})

const weekDays = computed(() => tm('dashboard.weekDays') as string[])

interface CalendarDay {
  date: number
  fullDate: string
  isCurrentMonth: boolean
  isToday: boolean
  hasDiary: boolean
}

const calendarDays = computed((): CalendarDay[] => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth()
  const lastDay = new Date(year, month + 1, 0)
  const startWeekDay = new Date(year, month, 1).getDay()

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const days: CalendarDay[] = []

  // 上月填充
  const prevMonthLast = new Date(year, month, 0)
  for (let i = startWeekDay - 1; i >= 0; i--) {
    const d = prevMonthLast.getDate() - i
    const m = month === 0 ? 12 : month
    const y = month === 0 ? year - 1 : year
    const fullDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({
      date: d,
      fullDate,
      isCurrentMonth: false,
      isToday: fullDate === todayStr,
      hasDiary: diaryDates.value.has(fullDate)
    })
  }

  // 当月
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const fullDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({
      date: d,
      fullDate,
      isCurrentMonth: true,
      isToday: fullDate === todayStr,
      hasDiary: diaryDates.value.has(fullDate)
    })
  }

  // 下月填充（补满6行 = 42格）
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const m = month + 2 > 12 ? 1 : month + 2
    const y = month + 2 > 12 ? year + 1 : year
    const fullDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({
      date: d,
      fullDate,
      isCurrentMonth: false,
      isToday: fullDate === todayStr,
      hasDiary: diaryDates.value.has(fullDate)
    })
  }

  return days
})

const prevMonth = (): void => {
  const d = new Date(currentMonth.value)
  d.setMonth(d.getMonth() - 1)
  setCurrentMonth(d, 'prev')
}

const nextMonth = (): void => {
  const d = new Date(currentMonth.value)
  d.setMonth(d.getMonth() + 1)
  setCurrentMonth(d, 'next')
}

const goToToday = (): void => {
  setCurrentMonth(new Date(), 'fade')
}

// ========== 年月快速跳转 ==========
const showYearMonthPicker = ref(false)
const pickerYear = ref(new Date().getFullYear())

const months = computed(() => tm('dashboard.months') as string[])

const pickerPrevYear = (): void => {
  pickerYear.value--
}

const pickerNextYear = (): void => {
  pickerYear.value++
}

const isCurrentYearMonth = (monthIdx: number): boolean => {
  return (
    pickerYear.value === currentMonth.value.getFullYear() &&
    monthIdx === currentMonth.value.getMonth()
  )
}

const isNowYearMonth = (monthIdx: number): boolean => {
  const now = new Date()
  return pickerYear.value === now.getFullYear() && monthIdx === now.getMonth()
}

const selectMonth = (monthIdx: number): void => {
  const previousMonth = currentMonth.value.getMonth()
  const direction = monthIdx > previousMonth ? 'next' : monthIdx < previousMonth ? 'prev' : 'fade'
  setCurrentMonth(new Date(pickerYear.value, monthIdx, 1), direction)
  showYearMonthPicker.value = false
}

const openYearMonthPicker = (): void => {
  pickerYear.value = currentMonth.value.getFullYear()
  showYearMonthPicker.value = true
}

const handleDateClick = (day: CalendarDay): void => {
  router.push({ path: '/today', query: { date: day.fullDate } })
}

// ========== 快捷日期跳转 ==========
const jumpToYesterday = (): void => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  router.push({ path: '/today', query: { date: dateStr } })
}

const jumpToToday = (): void => {
  const d = new Date()
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  router.push({ path: '/today', query: { date: dateStr } })
}

const jumpToLastWeek = (): void => {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  router.push({ path: '/today', query: { date: dateStr } })
}

function shiftMonthKeepingDay(baseDate: Date, monthOffset: number): Date {
  const day = baseDate.getDate()
  const targetFirstDay = new Date(baseDate.getFullYear(), baseDate.getMonth() + monthOffset, 1)
  const targetYear = targetFirstDay.getFullYear()
  const targetMonth = targetFirstDay.getMonth()
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate()
  const safeDay = Math.min(day, lastDay)
  return new Date(targetYear, targetMonth, safeDay)
}

const jumpToLastMonth = (): void => {
  const d = shiftMonthKeepingDay(new Date(), -1)
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  router.push({ path: '/today', query: { date: dateStr } })
}
</script>

<template>
  <div class="home-view" :class="{ 'home-view--entered': dashboardEntered }">
    <div class="welcome-box motion-section" style="--section-index: 0">
      <h2>
        {{ typedWelcome }}
        <span
          v-if="welcomeTyping || typedWelcome.length > 0"
          class="typing-caret"
          aria-hidden="true"
        ></span>
      </h2>
    </div>

    <!-- 日历卡片 -->
    <n-card :bordered="false" class="calendar-card motion-section" style="--section-index: 1">
      <!-- 日历头部：月份导航 + 快捷跳转 -->
      <div class="calendar-top">
        <div class="month-nav">
          <n-button quaternary circle size="small" @click="prevMonth">
            <template #icon>
              <n-icon><ChevronBackOutline /></n-icon>
            </template>
          </n-button>

          <n-popover
            v-model:show="showYearMonthPicker"
            trigger="click"
            placement="bottom"
            :show-arrow="false"
            raw
            class="ym-popover"
          >
            <template #trigger>
              <span class="month-label clickable" @click="openYearMonthPicker">{{
                monthLabel
              }}</span>
            </template>
            <div class="ym-picker">
              <div class="ym-year-nav">
                <n-button quaternary circle size="tiny" @click="pickerPrevYear">
                  <template #icon>
                    <n-icon size="14"><ChevronBackOutline /></n-icon>
                  </template>
                </n-button>
                <span class="ym-year-label">{{
                  t('dashboard.yearLabel', { year: pickerYear })
                }}</span>
                <n-button quaternary circle size="tiny" @click="pickerNextYear">
                  <template #icon>
                    <n-icon size="14"><ChevronForwardOutline /></n-icon>
                  </template>
                </n-button>
              </div>
              <div class="ym-month-grid">
                <div
                  v-for="(m, idx) in months"
                  :key="idx"
                  class="ym-month-cell"
                  :class="{
                    'is-active': isCurrentYearMonth(idx),
                    'is-now': isNowYearMonth(idx)
                  }"
                  @click="selectMonth(idx)"
                >
                  {{ m }}
                </div>
              </div>
            </div>
          </n-popover>

          <n-button quaternary circle size="small" @click="nextMonth">
            <template #icon>
              <n-icon><ChevronForwardOutline /></n-icon>
            </template>
          </n-button>
          <n-button quaternary size="tiny" class="today-btn" @click="goToToday">
            <template #icon>
              <n-icon size="14"><TodayOutline /></n-icon>
            </template>
            {{ t('dashboard.backToToday') }}
          </n-button>
        </div>
        <n-space :size="8" class="quick-jump">
          <n-button size="tiny" secondary @click="jumpToToday">{{
            t('dashboard.quickJump.today')
          }}</n-button>
          <n-button size="tiny" secondary @click="jumpToYesterday">{{
            t('dashboard.quickJump.yesterday')
          }}</n-button>
          <n-button size="tiny" secondary @click="jumpToLastWeek">{{
            t('dashboard.quickJump.lastWeek')
          }}</n-button>
          <n-button size="tiny" secondary @click="jumpToLastMonth">{{
            t('dashboard.quickJump.lastMonth')
          }}</n-button>
        </n-space>
      </div>

      <!-- 星期头 -->
      <div class="weekday-row">
        <div v-for="w in weekDays" :key="w" class="weekday-cell">{{ w }}</div>
      </div>

      <!-- 日期格子 -->
      <transition :name="monthGridTransitionName" mode="out-in">
        <div :key="monthGridKey" class="days-grid">
          <div
            v-for="(day, idx) in calendarDays"
            :key="idx"
            class="day-cell"
            :class="{
              'other-month': !day.isCurrentMonth,
              'is-today': day.isToday,
              'has-diary': day.hasDiary && day.isCurrentMonth
            }"
            @click="handleDateClick(day)"
          >
            <span class="day-number">{{ day.date }}</span>
            <span v-if="day.hasDiary && day.isCurrentMonth" class="diary-dot"></span>
          </div>
        </div>
      </transition>

      <!-- 图例 -->
      <div class="calendar-legend">
        <div class="legend-item">
          <span class="legend-dot"></span>
          <span>{{ t('dashboard.legend.hasDiary') }}</span>
        </div>
        <div class="legend-item">
          <span class="legend-today-box"></span>
          <span>{{ t('dashboard.legend.today') }}</span>
        </div>
      </div>
    </n-card>

    <!-- 统计 -->
    <n-grid
      :x-gap="24"
      :cols="3"
      class="stats-grid motion-section"
      style="--section-index: 2"
      :class="{
        'stats-grid--entered': statsEntered,
        'stats-grid--skip-enter': skipStatsEnterAnimation
      }"
    >
      <n-gi>
        <n-card embedded :bordered="false" class="stat-card" style="--stat-index: 0">
          <n-statistic :label="t('dashboard.stats.totalEntriesLabel')" tabular-nums>
            <n-number-animation :from="0" :to="totalEntries" />
            <template #suffix> {{ t('dashboard.stats.totalEntriesSuffix') }} </template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card embedded :bordered="false" class="stat-card" style="--stat-index: 1">
          <n-statistic :label="t('dashboard.stats.streakLabel')" tabular-nums>
            <n-number-animation :from="0" :to="currentStreak" />
            <template #suffix>{{ t('dashboard.stats.streakSuffix') }}</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card embedded :bordered="false" class="stat-card" style="--stat-index: 2">
          <n-statistic :label="t('dashboard.stats.charsLabel')" tabular-nums>
            <n-number-animation :from="0" :to="totalCharacters" />
            <template #suffix>{{ t('dashboard.stats.charsSuffix') }}</template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 人物提及饼图 -->
    <n-card
      v-if="personMentionData.length > 0"
      :bordered="false"
      class="chart-card motion-section"
      style="--section-index: 3"
    >
      <div class="chart-content">
        <v-chart :option="pieChartOption" autoresize class="pie-chart" @click="handlePieClick" />
        <div class="month-progress-panel">
          <div class="month-progress-title">{{ t('dashboard.monthProgressTitle') }}</div>
          <n-progress
            type="circle"
            style="width: 150px"
            :percentage="selectedMonthWrittenPercent"
            :stroke-width="20"
            :color="'var(--app-accent-color, var(--n-color-target, #18a058))'"
            :rail-color="'var(--app-accent-12, var(--n-border-color, rgba(0, 0, 0, 0.12)))'"
          />
          <div class="month-progress-meta">
            {{
              t('dashboard.monthProgressMeta', {
                written: selectedMonthWrittenDays,
                total: selectedMonthTotalDays
              })
            }}
          </div>
        </div>
      </div>
    </n-card>

    <n-modal
      v-model:show="showMentionModal"
      preset="card"
      :title="t('dashboard.mentionModalTitle', { person: selectedPerson })"
      style="width: min(860px, 92vw); border-radius: 14px"
      class="mention-modal-card"
      :bordered="false"
      :segmented="{ content: 'soft' }"
    >
      <div class="mention-meta">{{ t('dashboard.mentionMeta', { count: mentionTotal }) }}</div>

      <transition name="mention-state-fade" mode="out-in">
        <div :key="mentionContentKey" class="mention-state-shell">
          <div v-if="mentionLoading" class="mention-loading">
            <n-spin size="small" />
          </div>

          <div v-else-if="mentionEntries.length === 0" class="mention-empty">
            {{ t('dashboard.mentionEmpty') }}
          </div>

          <transition-group v-else name="mention-item-motion" tag="div" class="mention-list">
            <div
              v-for="(entry, idx) in mentionEntries"
              :key="`${mentionListEpoch}-${entry.id}`"
              class="mention-item"
              :style="{ '--mention-index': String(idx) }"
            >
              <div class="mention-item-head">
                <span class="mention-item-date">{{ formatDate(entry.createdAt) }}</span>
                <span class="mention-item-count">{{
                  t('dashboard.mentionCount', { count: entry.mentionCount })
                }}</span>
              </div>
              <div class="mention-item-title">{{ entry.title || t('common.noTitle') }}</div>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div class="mention-item-snippet" v-html="getHighlightedSnippet(entry)" />
              <div class="mention-item-footer">
                <div class="mention-tags">
                  <n-tag
                    v-for="kw in entry.matchedKeywords"
                    :key="`${entry.id}-${kw}`"
                    size="small"
                    round
                    :color="mentionTagColor"
                    :bordered="false"
                  >
                    {{ kw }}
                  </n-tag>
                </div>
                <n-button size="tiny" tertiary type="primary" @click="openMentionDiary(entry)">
                  {{ t('dashboard.openDiary') }}
                </n-button>
              </div>
            </div>
          </transition-group>
        </div>
      </transition>

      <div v-if="mentionTotal > mentionPageSize" class="mention-pagination">
        <n-pagination
          :page="mentionPage"
          :page-count="mentionPageCount"
          :page-size="mentionPageSize"
          :item-count="mentionTotal"
          size="small"
          @update:page="handleMentionPageChange"
        />
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
.home-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  overflow-y: auto;
  height: 100%;
}

.motion-section {
  opacity: 0;
  transform: translateY(calc(var(--motion-distance-md) * 1.4)) scale(0.985);
}

.home-view--entered .motion-section {
  animation: dashboard-section-in var(--motion-spring-normal) var(--ease-spring-soft) both;
  animation-delay: calc(var(--section-index, 0) * 72ms);
}

.welcome-box {
  margin-bottom: 20px;
}

.welcome-box h2 {
  display: inline-flex;
  align-items: center;
  min-height: 1.4em;
}

.typing-caret {
  width: 0.6em;
  height: 1.1em;
  margin-left: 3px;
  border-right: 2px solid currentColor;
  animation: typing-caret-blink 1s steps(1, end) infinite;
}

/* ===== 日历卡片 ===== */
.calendar-card {
  margin-bottom: 24px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.calendar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}

.month-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.month-label {
  font-size: 16px;
  font-weight: 600;
  min-width: 90px;
  text-align: center;
  user-select: none;
}

.month-label.clickable {
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 6px;
  transition:
    background var(--motion-fast) var(--ease-standard),
    transform var(--motion-spring-fast) var(--ease-spring-soft);
}

.month-label.clickable:hover {
  background: var(--n-color-hover, rgba(0, 0, 0, 0.04));
  transform: translateY(-1px);
}

/* 年月选择器 */
.ym-picker {
  background: var(--n-color, #fff);
  border-radius: 10px;
  padding: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  border: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
  width: 240px;
}

.ym-year-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.ym-year-label {
  font-size: 14px;
  font-weight: 600;
  user-select: none;
}

.ym-month-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.ym-month-cell {
  text-align: center;
  padding: 6px 0;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    transform var(--motion-spring-fast) var(--ease-spring-soft);
  user-select: none;
}

.ym-month-cell:hover {
  background: var(--n-color-hover, rgba(0, 0, 0, 0.04));
  transform: translateY(-1px);
}

.ym-month-cell.is-active {
  background: var(--app-accent-color, var(--n-primary-color, #18a058));
  color: #fff;
  font-weight: 600;
}

.ym-month-cell.is-now:not(.is-active) {
  color: var(--app-accent-color, var(--n-primary-color, #18a058));
  font-weight: 600;
}

.today-btn {
  margin-left: 8px;
  font-size: 12px;
}

.quick-jump {
  flex-shrink: 0;
}

/* 星期行 */
.weekday-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 4px;
}

.weekday-cell {
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-3);
  padding: 6px 0;
}

/* 日期网格 */
.days-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.day-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  overflow: hidden;
  transition:
    background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    transform var(--motion-spring-fast) var(--ease-spring-soft);
  gap: 2px;
}

.day-cell:hover {
  background: var(--n-color-hover, rgba(0, 0, 0, 0.04));
  transform: translateY(-2px) scale(var(--motion-scale-hover));
  box-shadow: 0 8px 16px var(--app-accent-08, rgba(24, 160, 88, 0.08));
}

.day-cell:active {
  transform: translateY(0) scale(var(--motion-scale-press));
  box-shadow: none;
}

.day-cell.other-month {
  opacity: 0.28;
}

.day-cell.is-today {
  background: var(--n-color-target, #18a058);
  color: #fff;
  font-weight: 700;
  border-radius: 8px;
}

.home-view--entered .day-cell.is-today {
  animation: today-cell-pop var(--motion-spring-fast) var(--ease-spring-pop) both;
}

.day-cell.is-today:hover {
  opacity: 0.85;
}

.day-cell.is-today .diary-dot {
  background: rgba(255, 255, 255, 0.85);
}

.day-cell.has-diary:not(.is-today) {
  font-weight: 600;
}

.day-number {
  font-size: 13px;
  line-height: 1;
  position: relative;
  z-index: 1;
}

.diary-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--n-color-target, #18a058);
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

/* 图例 */
.calendar-legend {
  display: flex;
  gap: 20px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.06));
  font-size: 12px;
  color: var(--n-text-color-3);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--n-color-target, #18a058);
}

.legend-today-box {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: var(--n-color-target, #18a058);
}

/* ===== 统计 ===== */
.stats-grid {
  margin-bottom: 24px;
}

.stat-card {
  border-radius: 12px;
  opacity: 0;
  transform: translateY(var(--motion-distance-md)) scale(0.985);
}

.stats-grid--entered .stat-card {
  animation: stats-card-in var(--motion-spring-normal) var(--ease-spring-pop) both;
  animation-delay: calc(var(--stat-index, 0) * 60ms);
}

.stats-grid--skip-enter .stat-card {
  opacity: 1;
  transform: none;
  animation: none;
}

/* ===== 饼图 ===== */
.chart-card {
  margin-bottom: 24px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition:
    box-shadow var(--motion-fast) var(--ease-standard),
    transform var(--motion-spring-fast) var(--ease-spring-soft);
}

.chart-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px var(--app-accent-08, rgba(24, 160, 88, 0.08));
}

.chart-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 210px;
  align-items: center;
  gap: 24px;
  width: 100%;
}

.pie-chart {
  width: 100%;
  height: 230px;
}

.month-progress-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--n-text-color, #333);
  opacity: 0;
  transform: translateY(var(--motion-distance-md)) scale(0.985);
}

.home-view--entered .month-progress-panel {
  animation: month-progress-in var(--motion-spring-normal) var(--ease-spring-soft) both;
  animation-delay: 260ms;
}

.month-progress-title {
  font-size: 14px;
  font-weight: 600;
}

.month-progress-meta {
  font-size: 13px;
  color: var(--n-text-color-3, #888);
  text-align: center;
}

.month-progress-panel :deep(.n-progress-content) {
  color: var(--app-accent-color, var(--n-color-target, #18a058));
  font-weight: 700;
}

@media (max-width: 900px) {
  .chart-content {
    grid-template-columns: minmax(0, 1fr);
  }
}

.pie-chart {
  cursor: pointer;
}

/* ===== 提及明细弹窗 ===== */
.mention-meta {
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--n-text-color-3, #888);
}

.mention-loading,
.mention-empty {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--n-text-color-3, #999);
}

.mention-state-shell {
  min-height: 120px;
}

.mention-list {
  max-height: min(62vh, 560px);
  overflow-y: auto;
  padding-right: 4px;
}

.mention-item {
  border: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  background: var(--n-color, #fff);
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    transform var(--motion-spring-fast) var(--ease-spring-soft);
}

.mention-item:hover {
  transform: translateY(-1px);
  border-color: var(--app-accent-20, rgba(24, 160, 88, 0.2));
  box-shadow: 0 8px 18px var(--app-accent-08, rgba(24, 160, 88, 0.08));
}

.mention-item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--n-text-color-3, #999);
}

.mention-item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--n-text-color, #333);
  margin-bottom: 6px;
}

.mention-item-snippet {
  font-size: 13px;
  line-height: 1.6;
  color: var(--n-text-color-2, #666);
}

.mention-item-snippet :deep(mark) {
  background: var(--app-accent-20, rgba(24, 160, 88, 0.2));
  color: var(--app-accent-color, #18a058);
  border-radius: 3px;
  padding: 0 2px;
}

.mention-item-footer {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.mention-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mention-pagination {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

.mention-state-fade-enter-active,
.mention-state-fade-leave-active {
  transition: opacity var(--motion-normal) var(--ease-standard);
}

.mention-state-fade-enter-from,
.mention-state-fade-leave-to {
  opacity: 0;
}

.mention-item-motion-enter-active {
  transition:
    opacity var(--motion-normal) var(--ease-standard),
    transform var(--motion-spring-fast) var(--ease-spring-soft);
  transition-delay: calc(var(--mention-index, 0) * 20ms);
}

.mention-item-motion-leave-active {
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-exit);
}

.mention-item-motion-enter-from,
.mention-item-motion-leave-to {
  opacity: 0;
  transform: translateY(var(--motion-distance-sm)) scale(0.985);
}

.mention-item-motion-move {
  transition: transform var(--motion-normal) var(--ease-standard);
}

.mention-modal-card :deep(.n-card) {
  transform-origin: center top;
  animation: mention-modal-in var(--motion-spring-normal) var(--ease-spring-soft);
}

.month-grid-next-enter-active,
.month-grid-next-leave-active,
.month-grid-prev-enter-active,
.month-grid-prev-leave-active,
.month-grid-fade-enter-active,
.month-grid-fade-leave-active {
  transition:
    opacity var(--motion-spring-normal) var(--ease-standard),
    transform var(--motion-spring-normal) var(--ease-spring-soft);
}

.month-grid-next-enter-from {
  opacity: 0;
  transform: translateX(var(--motion-distance-md)) scale(0.985);
}

.month-grid-next-leave-to {
  opacity: 0;
  transform: translateX(calc(var(--motion-distance-md) * -1)) scale(0.985);
}

.month-grid-prev-enter-from {
  opacity: 0;
  transform: translateX(calc(var(--motion-distance-md) * -1)) scale(0.985);
}

.month-grid-prev-leave-to {
  opacity: 0;
  transform: translateX(var(--motion-distance-md)) scale(0.985);
}

.month-grid-fade-enter-from,
.month-grid-fade-leave-to {
  opacity: 0;
  transform: scale(0.99);
}

@keyframes stats-card-in {
  from {
    opacity: 0;
    transform: translateY(var(--motion-distance-md)) scale(0.982);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes dashboard-section-in {
  0% {
    opacity: 0;
    transform: translateY(calc(var(--motion-distance-md) * 1.4))
      scale(var(--motion-scale-pop-start));
  }
  65% {
    opacity: 1;
    transform: translateY(-1px) scale(var(--motion-scale-pop-over));
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes typing-caret-blink {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

@keyframes today-cell-pop {
  0% {
    transform: scale(var(--motion-scale-pop-start));
  }
  68% {
    transform: scale(var(--motion-scale-pop-over));
  }
  100% {
    transform: scale(1);
  }
}

@keyframes month-progress-in {
  from {
    opacity: 0;
    transform: translateY(var(--motion-distance-md)) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes mention-modal-in {
  from {
    opacity: 0;
    transform: translateY(var(--motion-distance-md)) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

:global(:root.reduced-motion) .motion-section,
:global(:root.reduced-motion) .stat-card,
:global(:root.reduced-motion) .month-progress-panel {
  opacity: 1;
  transform: none;
  animation: none !important;
}

:global(:root.reduced-motion) .mention-modal-card :deep(.n-card),
:global(:root.reduced-motion) .day-cell,
:global(:root.reduced-motion) .day-cell.is-today,
:global(:root.reduced-motion) .day-cell.has-diary:not(.is-today),
:global(:root.reduced-motion) .mention-item {
  transform: none;
  animation: none !important;
  box-shadow: none;
}
</style>
