import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { ArchiveType, Mood } from '../../types/model'
import { stripHtmlToPlain } from '../database/migrations'

type SeedArchive = {
  name: string
  aliases: string[]
  description: string
  type: ArchiveType
}

const DAY_MS = 24 * 60 * 60 * 1000
const NOON_MS = 12 * 60 * 60 * 1000

const moods: Mood[] = ['happy', 'calm', 'sad', 'excited', 'tired']
const weathers = ['晴', '多云', '小雨', '大风', '阴']

const personArchives: SeedArchive[] = [
  {
    name: '陈舟',
    aliases: ['阿舟', 'CZ'],
    description: '项目搭档，擅长把复杂流程拆成可执行清单。',
    type: 'person'
  },
  {
    name: '林遥',
    aliases: ['Yao', '小林'],
    description: '老朋友，常约周末徒步与夜跑。',
    type: 'person'
  },
  {
    name: '许桉',
    aliases: ['An', '小许'],
    description: '产品同学，节奏快，需求沟通直接。',
    type: 'person'
  },
  {
    name: '赵宁',
    aliases: ['Ning', '老赵'],
    description: '同事，负责上线发布和质量把控。',
    type: 'person'
  },
  {
    name: '周沐',
    aliases: ['Mumu', '小周'],
    description: '设计师，审美稳定，反馈高效。',
    type: 'person'
  },
  {
    name: '高岚',
    aliases: ['Lan', '阿岚'],
    description: '大学同学，最近在练咖啡拉花。',
    type: 'person'
  }
]

const otherArchives: SeedArchive[] = [
  {
    name: '晨跑路线 A',
    aliases: ['河岸线', 'A 线'],
    description: '从北门到河堤折返，单程约 2.8 公里。',
    type: 'object'
  },
  {
    name: '木纹笔记本',
    aliases: ['棕色本'],
    description: '线下记录灵感的纸质笔记本。',
    type: 'object'
  },
  {
    name: '读书会',
    aliases: ['周三夜读'],
    description: '每周三晚上线上分享一本书的章节。',
    type: 'other'
  },
  {
    name: '小厨房计划',
    aliases: ['Meal Prep'],
    description: '每周日提前准备三天的便当。',
    type: 'other'
  }
]

const tagPool = [
  '工作',
  '学习',
  '复盘',
  '生活',
  '运动',
  '阅读',
  '旅行',
  '计划',
  '灵感',
  '健康',
  '家庭',
  '朋友',
  '效率',
  '项目'
]

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildDiaryHtml(paragraphs: string[]): string {
  return paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}

function buildDiaryParagraphs(index: number, personA: SeedArchive, personB: SeedArchive): string[] {
  const focus = [
    '今天把需求拆分成了三个可落地里程碑',
    '下午的评审把卡住的边界条件都补齐了',
    '晚上回看提交记录，发现节奏比上周稳定',
    '临睡前把明天最关键的两件事写在了便签上'
  ]

  return [
    `${personA.name} 提醒我先确认输入边界，避免返工。`,
    `和 ${personB.aliases[0]} 讨论后，决定先做最小可用版本。`,
    focus[index % focus.length],
    `今天的关键词：专注、清晰、稳步推进。`
  ]
}

export function seedDisguiseData(db: Database.Database): void {
  const now = Date.now()
  const allArchives = [...personArchives, ...otherArchives]

  const seed = db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'user.name',
      '林遥'
    )
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('user.avatar', '')

    const insertArchive = db.prepare(
      `INSERT INTO archives (id, name, alias, description, type, main_image, images, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (let i = 0; i < allArchives.length; i++) {
      const archive = allArchives[i]
      const ts = now - (allArchives.length - i) * DAY_MS
      insertArchive.run(
        randomUUID(),
        archive.name,
        archive.aliases.join(', '),
        archive.description,
        archive.type,
        null,
        '[]',
        ts,
        ts
      )
    }

    const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)')
    const tagIdMap = new Map<string, number>()
    for (const tag of tagPool) {
      insertTag.run(tag)
      const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag) as { id: number }
      tagIdMap.set(tag, row.id)
    }

    const insertDiary = db.prepare(
      `INSERT INTO diary_entries (id, title, content, plain_content, mood, weather, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertDiaryTag = db.prepare(
      'INSERT OR IGNORE INTO diary_tags (diary_id, tag_id) VALUES (?, ?)'
    )

    for (let i = 0; i < 60; i++) {
      const personA = personArchives[i % personArchives.length]
      const personB = personArchives[(i + 2) % personArchives.length]
      const date = new Date(now - i * DAY_MS)
      const createdAt =
        new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime() +
        NOON_MS
      const updatedAt = createdAt + (i % 4) * 15 * 60 * 1000
      const paragraphs = buildDiaryParagraphs(i, personA, personB)
      const content = buildDiaryHtml(paragraphs)
      const plainContent = stripHtmlToPlain(content)
      const entryId = randomUUID()

      const title = `${personA.name} · 第 ${i + 1} 天进度记录`
      const mood = moods[i % moods.length]
      const weather = weathers[i % weathers.length]

      insertDiary.run(entryId, title, content, plainContent, mood, weather, createdAt, updatedAt)

      const diaryTags = [
        tagPool[i % tagPool.length],
        tagPool[(i + 3) % tagPool.length],
        tagPool[(i + 7) % tagPool.length]
      ]
      for (const tag of diaryTags) {
        const tagId = tagIdMap.get(tag)
        if (tagId) {
          insertDiaryTag.run(entryId, tagId)
        }
      }
    }
  })

  seed()
}
