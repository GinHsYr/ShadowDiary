<template>
  <div class="calendar-page">
    <div class="page-header">
      <h1 class="page-title">日历视图</h1>
      <p class="page-subtitle">查看历史日记</p>
    </div>

    <div class="calendar-container">
      <div class="calendar-section">
        <n-calendar v-model:value="selectedDate" @update:value="handleDateSelect" />
      </div>

      <div class="diary-list-section">
        <h3 class="section-title">{{ selectedDateText }}</h3>
        <div v-if="loading" style="text-align: center; padding: 40px 0; color: var(--n-text-color-3)">
          加载中...
        </div>
        <template v-else>
          <n-card
            v-if="diaryForDate"
            :bordered="false"
            class="diary-card"
            @click="goToEdit"
          >
            <div class="diary-header">
              <span class="diary-mood">{{ moodLabels[diaryForDate.mood] || diaryForDate.mood }}</span>
              <span class="diary-time">{{ formatTime(diaryForDate.createdAt) }}</span>
            </div>
            <h4 v-if="diaryForDate.title" class="diary-title">{{ diaryForDate.title }}</h4>
            <p class="diary-content">{{ stripHtml(diaryForDate.content) }}</p>
          </n-card>
          <n-empty v-else description="这一天还没有日记" class="empty-state">
            <template #icon>
              <n-icon size="48">
                <BookOutline />
              </n-icon>
            </template>
            <template #extra>
              <n-button size="small" @click="goToEdit">写一篇</n-button>
            </template>
          </n-empty>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NCalendar, NCard, NEmpty, NIcon, NButton } from 'naive-ui'
import { BookOutline } from '@vicons/ionicons5'
import { useRouter } from 'vue-router'
import type { DiaryEntry } from '../../../../types/model'

const router = useRouter()

const selectedDate = ref<number>(Date.now())
const diaryForDate = ref<DiaryEntry | null>(null)
const loading = ref(false)

const moodLabels: Record<string, string> = {
  happy: '😊 开心',
  calm: '😌 平静',
  sad: '😢 难过',
  excited: '🤩 兴奋',
  tired: '😴 疲惫'
}

const selectedDateText = computed((): string => {
  const date = new Date(selectedDate.value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}年${month}月${day}日`
})

const selectedDateStr = computed((): string => {
  const date = new Date(selectedDate.value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
})

async function loadDiaryForDate(): Promise<void> {
  loading.value = true
  try {
    diaryForDate.value = await window.api.getDiaryByDate(selectedDateStr.value)
  } catch (error) {
    console.error('加载日记失败:', error)
    diaryForDate.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadDiaryForDate)

const handleDateSelect = (_value: number): void => {
  loadDiaryForDate()
}

const goToEdit = (): void => {
  router.push({ path: '/today', query: { date: selectedDateStr.value } })
}

const formatTime = (ts: number): string => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const stripHtml = (html: string): string => {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, '').slice(0, 150)
}
</script>

<style scoped>
.calendar-page {
  padding: 32px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 32px;
}

.page-title {
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--n-text-color);
}

.page-subtitle {
  font-size: 16px;
  color: var(--n-text-color-3);
  margin: 0;
}

.calendar-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.calendar-section,
.diary-list-section {
  background: var(--n-color);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 20px 0;
  color: var(--n-text-color);
}

.diary-card {
  cursor: pointer;
  transition: all 0.3s;
}

.diary-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.diary-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.diary-mood {
  font-size: 16px;
  font-weight: 500;
}

.diary-time {
  font-size: 14px;
  color: var(--n-text-color-3);
}

.diary-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--n-text-color);
}

.diary-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--n-text-color-2);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.empty-state {
  padding: 40px 0;
}

@media (max-width: 968px) {
  .calendar-container {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .calendar-page {
    padding: 16px;
  }

  .page-title {
    font-size: 24px;
  }

  .calendar-section,
  .diary-list-section {
    padding: 16px;
  }
}
</style>
