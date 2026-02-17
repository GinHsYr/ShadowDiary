<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
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
  NSpin
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

// 真实数据
const totalEntries = ref(0)
const currentStreak = ref(0)
const recentEntries = ref<DiaryEntry[]>([])
const diaryDates = ref<Set<string>>(new Set())
const personMentionData = ref<{ name: string; count: number }[]>([])
const showMentionModal = ref(false)
const mentionLoading = ref(false)
const selectedPerson = ref('')
const mentionKeywords = ref<string[]>([])
const mentionEntries = ref<PersonMentionDetailItem[]>([])
const mentionTotal = ref(0)

// 加载统计数据
async function loadStats(): Promise<void> {
  try {
    const stats = await window.api.getStats()
    totalEntries.value = stats.totalEntries
    currentStreak.value = stats.currentStreak
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
    chartData.push({ name: '其他', value: restCount })
  }

  return {
    title: {
      text: '人物提及次数',
      left: 'center',
      textStyle: {
        fontSize: 14,
        fontWeight: 600
      }
    },
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}次 ({d}%)'
    },
    legend: {
      orient: 'vertical',
      left: 'left',
      top: 'middle'
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['60%', '55%'],
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

async function loadMentionDetails(personName: string): Promise<void> {
  mentionLoading.value = true
  selectedPerson.value = personName
  showMentionModal.value = true
  mentionEntries.value = []
  mentionTotal.value = 0
  mentionKeywords.value = [personName]

  try {
    const pageSize = 100
    let offset = 0
    let total = 0
    const allEntries: PersonMentionDetailItem[] = []
    let loadedKeywords: string[] = [personName]
    let normalizedName = personName

    do {
      const result = await window.api.getPersonMentionDetails(personName, {
        limit: pageSize,
        offset
      })
      normalizedName = result.personName
      loadedKeywords = result.keywords.length > 0 ? result.keywords : [personName]
      total = result.total
      allEntries.push(...result.entries)
      offset += result.entries.length
      if (result.entries.length === 0) break
    } while (allEntries.length < total)

    selectedPerson.value = normalizedName
    mentionKeywords.value = loadedKeywords
    mentionEntries.value = allEntries
    mentionTotal.value = total
  } catch (error) {
    console.error('加载人物提及明细失败:', error)
  } finally {
    mentionLoading.value = false
  }
}

async function handlePieClick(params: PieClickParams): Promise<void> {
  if (params.componentType !== 'series' || params.seriesType !== 'pie') return
  const personName = params.name?.trim()
  if (!personName || personName === '其他') return
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

const monthLabel = computed(() => {
  const y = currentMonth.value.getFullYear()
  const m = currentMonth.value.getMonth() + 1
  return `${y}年${m}月`
})

const weekDays = ['日', '一', '二', '三', '四', '五', '六']

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
  currentMonth.value = d
  loadDiaryDates()
}

const nextMonth = (): void => {
  const d = new Date(currentMonth.value)
  d.setMonth(d.getMonth() + 1)
  currentMonth.value = d
  loadDiaryDates()
}

const goToToday = (): void => {
  currentMonth.value = new Date()
  loadDiaryDates()
}

// ========== 年月快速跳转 ==========
const showYearMonthPicker = ref(false)
const pickerYear = ref(new Date().getFullYear())

const months = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月'
]

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
  currentMonth.value = new Date(pickerYear.value, monthIdx, 1)
  showYearMonthPicker.value = false
  loadDiaryDates()
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

const jumpToLastMonth = (): void => {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  router.push({ path: '/today', query: { date: dateStr } })
}
</script>

<template>
  <div class="home-view">
    <div class="welcome-box">
      <h2>👋 你好，准备写点什么？</h2>
    </div>

    <!-- 日历卡片 -->
    <n-card :bordered="false" class="calendar-card">
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
                <span class="ym-year-label">{{ pickerYear }}年</span>
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
            回到今天
          </n-button>
        </div>
        <n-space :size="8" class="quick-jump">
          <n-button size="tiny" secondary @click="jumpToToday">今天</n-button>
          <n-button size="tiny" secondary @click="jumpToYesterday">昨天</n-button>
          <n-button size="tiny" secondary @click="jumpToLastWeek">上周今日</n-button>
          <n-button size="tiny" secondary @click="jumpToLastMonth">上月今日</n-button>
        </n-space>
      </div>

      <!-- 星期头 -->
      <div class="weekday-row">
        <div v-for="w in weekDays" :key="w" class="weekday-cell">{{ w }}</div>
      </div>

      <!-- 日期格子 -->
      <div class="days-grid">
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

      <!-- 图例 -->
      <div class="calendar-legend">
        <div class="legend-item">
          <span class="legend-dot"></span>
          <span>有日记</span>
        </div>
        <div class="legend-item">
          <span class="legend-today-box"></span>
          <span>今天</span>
        </div>
      </div>
    </n-card>

    <!-- 统计 -->
    <n-grid :x-gap="24" :cols="2" class="stats-grid">
      <n-gi>
        <n-card embedded :bordered="false" class="stat-card">
          <n-statistic label="你一共写了" tabular-nums>
            <n-number-animation :from="0" :to="totalEntries" />
            <template #suffix> 篇日记 </template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card embedded :bordered="false" class="stat-card">
          <n-statistic label="连续记录" tabular-nums>
            <n-number-animation :from="0" :to="currentStreak" />
            <template #suffix>天</template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 人物提及饼图 -->
    <n-card v-if="personMentionData.length > 0" :bordered="false" class="chart-card">
      <v-chart :option="pieChartOption" autoresize class="pie-chart" @click="handlePieClick" />
    </n-card>

    <n-modal
      v-model:show="showMentionModal"
      preset="card"
      :title="`${selectedPerson} · 提及明细`"
      style="width: min(860px, 92vw); border-radius: 14px"
      class="mention-modal-card"
      :bordered="false"
      :segmented="{ content: 'soft' }"
    >
      <div class="mention-meta">共 {{ mentionTotal }} 篇日记提及</div>

      <div v-if="mentionLoading" class="mention-loading">
        <n-spin size="small" />
      </div>

      <div v-else-if="mentionEntries.length === 0" class="mention-empty">暂无提及记录</div>

      <div v-else class="mention-list">
        <div v-for="entry in mentionEntries" :key="entry.id" class="mention-item">
          <div class="mention-item-head">
            <span class="mention-item-date">{{ formatDate(entry.createdAt) }}</span>
            <span class="mention-item-count">提及 {{ entry.mentionCount }} 次</span>
          </div>
          <div class="mention-item-title">{{ entry.title || '无标题' }}</div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="mention-item-snippet" v-html="getHighlightedSnippet(entry)" />
          <div class="mention-item-footer">
            <div class="mention-tags">
              <n-tag
                v-for="kw in entry.matchedKeywords"
                :key="`${entry.id}-${kw}`"
                size="small"
                round
                type="success"
                :bordered="false"
              >
                {{ kw }}
              </n-tag>
            </div>
            <n-button size="tiny" tertiary type="primary" @click="openMentionDiary(entry)">
              打开日记
            </n-button>
          </div>
        </div>
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

.welcome-box {
  margin-bottom: 20px;
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
  transition: background 0.2s;
}

.month-label.clickable:hover {
  background: var(--n-color-hover, rgba(0, 0, 0, 0.04));
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
    background 0.15s,
    color 0.15s;
  user-select: none;
}

.ym-month-cell:hover {
  background: var(--n-color-hover, rgba(0, 0, 0, 0.04));
}

.ym-month-cell.is-active {
  background: var(--n-color-target, #18a058);
  color: #fff;
  font-weight: 600;
}

.ym-month-cell.is-now:not(.is-active) {
  color: var(--n-color-target, #18a058);
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
  transition:
    background 0.2s,
    color 0.2s;
  gap: 2px;
}

.day-cell:hover {
  background: var(--n-color-hover, rgba(0, 0, 0, 0.04));
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
}

.diary-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--n-color-target, #18a058);
  flex-shrink: 0;
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
}

/* ===== 饼图 ===== */
.chart-card {
  margin-bottom: 24px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.pie-chart {
  height: 300px;
  width: 100%;
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
  background: rgba(16, 185, 129, 0.2);
  color: inherit;
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
</style>
