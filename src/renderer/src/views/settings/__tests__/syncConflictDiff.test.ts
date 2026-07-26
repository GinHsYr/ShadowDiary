import { describe, expect, it } from 'vitest'
import type { SyncConflict } from '../../../../../types/api'
import { buildConflictDiff, type ConflictDiffLabels } from '../syncConflictDiff'

const labels: ConflictDiffLabels = {
  deleted: 'Deleted version',
  localSide: 'Computer',
  remoteSide: 'Phone',
  omitted: (count) => 'Omitted ' + count + ' lines',
  timestamp: (value) => new Date(value).toISOString(),
  mood: (value) => value,
  archiveType: (value) => value,
  fields: {
    title: 'Title',
    date: 'Date',
    mood: 'Mood',
    weather: 'Weather',
    tags: 'Tags',
    content: 'Content',
    images: 'Images',
    richText: 'Rich text',
    name: 'Name',
    aliases: 'Aliases',
    type: 'Type',
    description: 'Description',
    mainImage: 'Main image',
    gallery: 'Gallery',
    createdAt: 'Created at',
    updatedAt: 'Updated at',
    other: 'Other raw differences'
  }
}

function diaryConflict(
  localPayload: Record<string, unknown> | undefined,
  remotePayload: Record<string, unknown> | undefined
): SyncConflict {
  return {
    id: 'conflict-1',
    entityType: 'diary',
    entityId: 'diary-1',
    peerDeviceId: 'phone-1',
    localPayload,
    remotePayload,
    localVector: { desktop: 2 },
    remoteVector: { phone: 2 },
    createdAt: Date.now()
  }
}

describe('sync conflict diff', () => {
  it('renders desktop removals, phone additions, and shared context with line numbers', () => {
    const result = buildConflictDiff(
      diaryConflict(
        {
          title: 'Desktop title',
          calendarDate: '2026-07-27',
          mood: 'calm',
          plainContent: 'Shared line\nDesktop-only line',
          content: '<p>Shared line</p><p>Desktop-only line</p>',
          tags: ['desktop']
        },
        {
          title: 'Phone title',
          calendarDate: '2026-07-27',
          mood: 'happy',
          plainContent: 'Shared line\nPhone-only line',
          content: '<p>Shared line</p><p>Phone-only line</p>',
          tags: ['phone']
        }
      ),
      labels
    )

    expect(result.lines).toContainEqual({
      kind: 'removed',
      text: 'Title: Desktop title',
      localLine: 1
    })
    expect(result.lines).toContainEqual({
      kind: 'added',
      text: 'Title: Phone title',
      remoteLine: 1
    })
    expect(result.lines).toContainEqual(
      expect.objectContaining({
        kind: 'context',
        text: 'Date: 2026-07-27'
      })
    )
    expect(
      result.lines.some((line) => line.kind === 'removed' && line.text.includes('Desktop-only'))
    ).toBe(true)
    expect(
      result.lines.some((line) => line.kind === 'added' && line.text.includes('Phone-only'))
    ).toBe(true)
  })

  it('shows deleted versions and exposes formatting-only rich-text changes', () => {
    const deleted = buildConflictDiff(
      diaryConflict(undefined, {
        title: 'Phone copy',
        plainContent: 'Body',
        content: '<p>Body</p>'
      }),
      labels
    )
    expect(deleted.lines[0]).toEqual({
      kind: 'removed',
      text: 'Deleted version',
      localLine: 1
    })

    const formattingOnly = buildConflictDiff(
      diaryConflict(
        {
          title: 'Same',
          plainContent: 'Body',
          content: '<p><strong>Body</strong></p>'
        },
        {
          title: 'Same',
          plainContent: 'Body',
          content: '<p>Body</p>'
        }
      ),
      labels
    )
    expect(formattingOnly.localLines).toContain('Rich text:')
    expect(formattingOnly.lines.some((line) => line.kind === 'removed')).toBe(true)
    expect(formattingOnly.lines.some((line) => line.kind === 'added')).toBe(true)
  })

  it('shows the timestamp that caused an existing metadata-only conflict', () => {
    const shared = {
      title: 'Same entry',
      calendarDate: '2026-07-19',
      mood: 'calm',
      plainContent: 'Same body',
      content: '<p>Same body</p>',
      tags: []
    }
    const result = buildConflictDiff(
      diaryConflict(
        { ...shared, updatedAt: 1784721570267 },
        { ...shared, updatedAt: 1784625068382 }
      ),
      labels
    )

    expect(
      result.lines.some((line) => line.kind === 'removed' && line.text.startsWith('Updated at:'))
    ).toBe(true)
    expect(
      result.lines.some((line) => line.kind === 'added' && line.text.startsWith('Updated at:'))
    ).toBe(true)
  })

  it('caps very long previews while keeping an omission marker', () => {
    const longBody = Array.from({ length: 260 }, (_, index) => 'Line ' + (index + 1)).join('\n')
    const result = buildConflictDiff(
      diaryConflict(
        { title: 'Long diary', plainContent: longBody, content: '<p>' + longBody + '</p>' },
        {
          title: 'Long diary',
          plainContent: longBody + '\nPhone ending',
          content: '<p>' + longBody + '</p>'
        }
      ),
      labels
    )

    expect(result.localLines.length).toBeLessThanOrEqual(201)
    expect(result.localLines.some((line) => line.startsWith('Omitted '))).toBe(true)
  })
})
