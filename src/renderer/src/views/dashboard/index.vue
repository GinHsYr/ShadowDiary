<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import {
  NGrid,
  NGi,
  NCard,
  NStatistic,
  NList,
  NListItem,
  NThing,
  NTag,
  NSpace,
  NButton,
  NNumberAnimation,
  NIcon,
  NPopover
} from 'naive-ui'
import { ChevronBackOutline, ChevronForwardOutline, TodayOutline } from '@vicons/ionicons5'
import { useRouter } from 'vue-router'
import type { DiaryEntry } from '../../../../types/model'

const router = useRouter()

// 真实数据
const totalEntries = ref(0)
const currentStreak = ref(0)
const recentEntries = ref<DiaryEntry[]>([])
const diaryDates = ref<Set<string>>(new Set())

const moodLabels: Record<string, string> = {
  happy: '😊 开心',
  calm: '😌 平静',
  sad: '😢 难过',
  excited: '🤩 兴奋',
  tired: '😴 疲惫'
}

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

onMounted(() => {
  loadStats()
  loadRecentEntries()
  loadDiaryDates()
})

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
    days.push({ date: d, fullDate, isCurrentMonth: false, isToday: fullDate === todayStr, hasDiary: diaryDates.value.has(fullDate) })
  }

  // 当月
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const fullDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({ date: d, fullDate, isCurrentMonth: true, isToday: fullDate === todayStr, hasDiary: diaryDates.value.has(fullDate) })
  }

  // 下月填充（补满6行 = 42格）
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const m = month + 2 > 12 ? 1 : month + 2
    const y = month + 2 > 12 ? year + 1 : year
    const fullDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({ date: d, fullDate, isCurrentMonth: false, isToday: fullDate === todayStr, hasDiary: diaryDates.value.has(fullDate) })
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

const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

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

const formatDate = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onBeforeUnmount(() => {
  // 清理操作
})
</script>

<template>
  <div class="home-view">
    <!-- 欢迎 -->
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
              <span class="month-label clickable" @click="openYearMonthPicker">{{ monthLabel }}</span>
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

    <!-- 最近列表 -->
    <div class="list-header">
      <h3>最近回忆</h3>
      <n-button text type="primary" size="small" @click="router.push('/calendar')">查看全部</n-button>
    </div>

    <n-list hoverable clickable>
      <n-list-item
        v-for="item in recentEntries"
        :key="item.id"
        @click="router.push({ path: '/today', query: { date: formatDate(item.createdAt) } })"
      >
        <n-thing :title="item.title || '无标题'">
          <template #description>
            <n-space size="small">
              <n-tag size="small" :bordered="false">{{ formatDate(item.createdAt) }}</n-tag>
              <n-tag size="small" type="success" :bordered="false">{{ moodLabels[item.mood] || item.mood }}</n-tag>
            </n-space>
          </template>
        </n-thing>
      </n-list-item>
    </n-list>
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
  transition: background 0.15s, color 0.15s;
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
  transition: background 0.2s, color 0.2s;
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

/* ===== 列表 ===== */
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
</style>
