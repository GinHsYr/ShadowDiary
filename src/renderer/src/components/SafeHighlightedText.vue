<script setup lang="ts">
import { computed } from 'vue'

interface HighlightPart {
  text: string
  highlighted: boolean
}

interface HighlightKeyword {
  keyword: string
  standalone?: boolean
}

const props = withDefaults(
  defineProps<{
    text: string
    keyword?: string
    extraKeywords?: string[]
    highlightKeywords?: HighlightKeyword[]
  }>(),
  {
    keyword: '',
    extraKeywords: () => [],
    highlightKeywords: () => []
  }
)

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getAllKeywords(): HighlightKeyword[] {
  const all: HighlightKeyword[] =
    props.highlightKeywords.length > 0
      ? props.highlightKeywords
      : [
          ...props.keyword
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((keyword) => ({ keyword })),
          ...props.extraKeywords
            .map((item) => item.trim())
            .filter(Boolean)
            .map((keyword) => ({ keyword }))
        ]

  const unique = new Map<string, HighlightKeyword>()
  for (const item of all) {
    const keyword = item.keyword.trim()
    if (!keyword) continue
    const key = keyword.toLowerCase()
    if (!unique.has(key)) unique.set(key, { keyword, standalone: item.standalone })
  }

  return [...unique.values()].sort((a, b) => b.keyword.length - a.keyword.length)
}

function isWordLikeChar(char: string | undefined): boolean {
  if (!char) return false
  return /[\p{L}\p{N}]/u.test(char)
}

function isStandaloneMatch(source: string, index: number, length: number): boolean {
  const end = index + length
  const prevChar = index > 0 ? source[index - 1] : undefined
  const nextChar = end < source.length ? source[end] : undefined

  return !isWordLikeChar(prevChar) && !isWordLikeChar(nextChar)
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

  const keywordByLower = new Map(keywords.map((item) => [item.keyword.toLowerCase(), item]))
  const pattern = keywords.map((item) => escapeRegex(item.keyword)).join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')

  const result: HighlightPart[] = []
  let cursor = 0

  for (const match of source.matchAll(regex)) {
    const index = match.index ?? 0
    const value = match[0]
    if (!value) continue
    const keywordRule = keywordByLower.get(value.toLowerCase())
    if (keywordRule?.standalone && !isStandaloneMatch(source, index, value.length)) continue
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
