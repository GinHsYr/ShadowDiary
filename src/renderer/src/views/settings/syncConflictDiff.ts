import type { SyncConflict } from '../../../../types/api'

export type ConflictDiffLineKind = 'context' | 'removed' | 'added'

export interface ConflictDiffLine {
  kind: ConflictDiffLineKind
  text: string
  localLine?: number
  remoteLine?: number
}

export interface ConflictDiffLabels {
  deleted: string
  localSide: string
  remoteSide: string
  omitted: (count: number) => string
  timestamp: (value: number) => string
  mood: (value: string) => string
  archiveType: (value: string) => string
  fields: {
    title: string
    date: string
    mood: string
    weather: string
    tags: string
    content: string
    images: string
    richText: string
    name: string
    aliases: string
    type: string
    description: string
    mainImage: string
    gallery: string
    createdAt: string
    updatedAt: string
    other: string
  }
}

export interface ConflictDiffResult {
  localLines: string[]
  remoteLines: string[]
  lines: ConflictDiffLine[]
}

const MAXIMUM_PREVIEW_LINES = 220
const LEADING_PREVIEW_LINES = 140
const TRAILING_PREVIEW_LINES = 60

export function buildConflictDiff(
  conflict: SyncConflict,
  labels: ConflictDiffLabels
): ConflictDiffResult {
  const includeRichTextSource =
    conflict.entityType === 'diary' &&
    Boolean(conflict.localPayload) &&
    Boolean(conflict.remotePayload) &&
    conflict.localPayload?.plainContent === conflict.remotePayload?.plainContent &&
    conflict.localPayload?.content !== conflict.remotePayload?.content
  const localSource = payloadDiffLines(
    conflict.entityType,
    conflict.localPayload,
    labels,
    includeRichTextSource
  )
  const remoteSource = payloadDiffLines(
    conflict.entityType,
    conflict.remotePayload,
    labels,
    includeRichTextSource
  )
  ensureVisibleDifference(conflict, localSource, remoteSource, labels)
  const localLines = limitDiffLines(localSource, labels)
  const remoteLines = limitDiffLines(remoteSource, labels)

  return {
    localLines,
    remoteLines,
    lines: buildLineDiff(localLines, remoteLines)
  }
}

function payloadDiffLines(
  entityType: SyncConflict['entityType'],
  payload: Record<string, unknown> | undefined,
  labels: ConflictDiffLabels,
  includeRichTextSource: boolean
): string[] {
  if (!payload) return [labels.deleted]

  const lines: string[] = []
  if (entityType === 'diary') {
    appendDiffField(lines, labels.fields.title, payload.title)
    appendDiffField(lines, labels.fields.date, payload.calendarDate)
    appendDiffField(
      lines,
      labels.fields.mood,
      typeof payload.mood === 'string' ? labels.mood(payload.mood) : undefined
    )
    appendDiffField(lines, labels.fields.weather, payload.weather)
    appendDiffField(lines, labels.fields.tags, payload.tags)
    appendDiffField(lines, labels.fields.content, payload.plainContent, true)
    appendDiffField(
      lines,
      labels.fields.images,
      diaryImageReferences(typeof payload.content === 'string' ? payload.content : undefined)
    )
    if (includeRichTextSource) {
      appendDiffField(
        lines,
        labels.fields.richText,
        formatRichTextSource(typeof payload.content === 'string' ? payload.content : undefined),
        true
      )
    }
    return lines
  }

  appendDiffField(lines, labels.fields.name, payload.name)
  appendDiffField(lines, labels.fields.aliases, payload.aliases)
  appendDiffField(
    lines,
    labels.fields.type,
    typeof payload.type === 'string' ? labels.archiveType(payload.type) : undefined
  )
  appendDiffField(lines, labels.fields.description, payload.description, true)
  appendDiffField(
    lines,
    labels.fields.mainImage,
    compactMediaReference(typeof payload.mainImage === 'string' ? payload.mainImage : undefined)
  )
  const images = Array.isArray(payload.images)
    ? payload.images
        .filter((value): value is string => typeof value === 'string')
        .map(compactMediaReference)
    : []
  appendDiffField(lines, labels.fields.gallery, images)
  return lines
}

function ensureVisibleDifference(
  conflict: SyncConflict,
  localLines: string[],
  remoteLines: string[],
  labels: ConflictDiffLabels
): void {
  if (!sameLines(localLines, remoteLines)) return
  const local = conflict.localPayload
  const remote = conflict.remotePayload
  if (!local || !remote) return

  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort()
  const differentKeys = keys.filter((key) => stableValue(local[key]) !== stableValue(remote[key]))
  for (const [key, label] of [
    ['updatedAt', labels.fields.updatedAt],
    ['createdAt', labels.fields.createdAt]
  ] as const) {
    if (!differentKeys.includes(key)) continue
    appendDiffField(localLines, label, timestampValue(local[key], labels))
    appendDiffField(remoteLines, label, timestampValue(remote[key], labels))
  }
  if (!sameLines(localLines, remoteLines)) return

  const reason = differentKeys.length > 0 ? differentKeys.join(', ') : 'versionVector'
  localLines.push(labels.fields.other + ': ' + labels.localSide + ' · ' + reason)
  remoteLines.push(labels.fields.other + ': ' + labels.remoteSide + ' · ' + reason)
}

function sameLines(local: string[], remote: string[]): boolean {
  return local.length === remote.length && local.every((line, index) => line === remote[index])
}

function timestampValue(value: unknown, labels: ConflictDiffLabels): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? labels.timestamp(value)
    : displayValue(value)
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableValue).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return (
      '{' +
      Object.keys(object)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + stableValue(object[key]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value) ?? 'null'
}

function appendDiffField(
  lines: string[],
  label: string,
  rawValue: unknown,
  multiline = false
): void {
  const valueLines = displayValue(rawValue)
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
  if (!multiline && valueLines.length === 1) {
    lines.push(`${label}: ${valueLines[0]}`)
    return
  }
  lines.push(`${label}:`)
  lines.push(...valueLines.map((line) => `  ${line}`))
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
    return items.length > 0 ? items.join(', ') : '—'
  }
  const text = String(value).trim()
  return text || '—'
}

function diaryImageReferences(content: string | undefined): string[] {
  if (!content) return []
  return [
    ...new Set(
      [...content.matchAll(/diary-image:\/\/[a-zA-Z0-9._-]+/g)].map((match) =>
        compactMediaReference(match[0])
      )
    )
  ]
}

function compactMediaReference(value: string | undefined): string {
  if (!value?.trim()) return '—'
  const normalized = value.trim()
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (name.length <= 30) return name
  return `${name.slice(0, 14)}…${name.slice(-11)}`
}

function formatRichTextSource(value: string | undefined): string {
  if (!value?.trim()) return '—'
  return value.trim().replace(/>\s*</g, '>\n<')
}

function limitDiffLines(lines: string[], labels: ConflictDiffLabels): string[] {
  if (lines.length <= MAXIMUM_PREVIEW_LINES) return lines
  const omitted = lines.length - LEADING_PREVIEW_LINES - TRAILING_PREVIEW_LINES
  return [
    ...lines.slice(0, LEADING_PREVIEW_LINES),
    labels.omitted(omitted),
    ...lines.slice(-TRAILING_PREVIEW_LINES)
  ]
}

function buildLineDiff(localLines: string[], remoteLines: string[]): ConflictDiffLine[] {
  const lengths = Array.from({ length: localLines.length + 1 }, () =>
    Array<number>(remoteLines.length + 1).fill(0)
  )
  for (let local = localLines.length - 1; local >= 0; local -= 1) {
    for (let remote = remoteLines.length - 1; remote >= 0; remote -= 1) {
      lengths[local][remote] =
        localLines[local] === remoteLines[remote]
          ? lengths[local + 1][remote + 1] + 1
          : Math.max(lengths[local + 1][remote], lengths[local][remote + 1])
    }
  }

  const diff: ConflictDiffLine[] = []
  let local = 0
  let remote = 0
  let localLine = 1
  let remoteLine = 1
  while (local < localLines.length && remote < remoteLines.length) {
    if (localLines[local] === remoteLines[remote]) {
      diff.push({
        kind: 'context',
        text: localLines[local],
        localLine: localLine++,
        remoteLine: remoteLine++
      })
      local += 1
      remote += 1
    } else if (lengths[local + 1][remote] >= lengths[local][remote + 1]) {
      diff.push({ kind: 'removed', text: localLines[local], localLine: localLine++ })
      local += 1
    } else {
      diff.push({ kind: 'added', text: remoteLines[remote], remoteLine: remoteLine++ })
      remote += 1
    }
  }
  while (local < localLines.length) {
    diff.push({ kind: 'removed', text: localLines[local], localLine: localLine++ })
    local += 1
  }
  while (remote < remoteLines.length) {
    diff.push({ kind: 'added', text: remoteLines[remote], remoteLine: remoteLine++ })
    remote += 1
  }
  return diff
}
