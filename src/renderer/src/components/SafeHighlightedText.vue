<script setup lang="ts">
import { computed } from 'vue'

interface HighlightPart {
  text: string
  highlighted: boolean
}

const props = withDefaults(
  defineProps<{
    text: string
    keyword?: string
    extraKeywords?: string[]
  }>(),
  {
    keyword: '',
    extraKeywords: () => []
  }
)

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getAllKeywords(): string[] {
  const all = [
    ...props.keyword.trim().split(/\s+/).filter(Boolean),
    ...props.extraKeywords.map((item) => item.trim()).filter(Boolean)
  ]

  const unique = new Map<string, string>()
  for (const keyword of all) {
    const key = keyword.toLowerCase()
    if (!unique.has(key)) unique.set(key, keyword)
  }

  return [...unique.values()].sort((a, b) => b.length - a.length)
}

const parts = computed<HighlightPart[]>(() => {
  // Security invariant:
  // 1) We only return plain text segments.
  // 2) Highlighting is rendered by <mark> in template, never by v-html.
  const source = props.text ?? ''
  const keywords = getAllKeywords()
  if (!source || keywords.length === 0) {
    return [{ text: source, highlighted: false }]
  }

  const pattern = keywords.map(escapeRegex).join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')

  const result: HighlightPart[] = []
  let cursor = 0

  for (const match of source.matchAll(regex)) {
    const index = match.index ?? 0
    const value = match[0]
    if (!value) continue
    if (index > cursor) {
      result.push({ text: source.slice(cursor, index), highlighted: false })
    }
    result.push({ text: source.slice(index, index + value.length), highlighted: true })
    cursor = index + value.length
  }

  if (cursor < source.length) {
    result.push({ text: source.slice(cursor), highlighted: false })
  }

  return result.length > 0 ? result : [{ text: source, highlighted: false }]
})
</script>

<template>
  <span>
    <template v-for="(part, index) in parts" :key="`${index}-${part.highlighted ? 'h' : 'n'}`">
      <mark v-if="part.highlighted">{{ part.text }}</mark>
      <template v-else>{{ part.text }}</template>
    </template>
  </span>
</template>
