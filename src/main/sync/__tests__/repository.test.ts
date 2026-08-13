import { describe, expect, it } from 'vitest'
import {
  canonicalizeMediaSources,
  compareVectors,
  mergeVectors,
  payloadsEquivalentForSync,
  stableStringify
} from '../repository'

describe('sync record semantics', () => {
  it('detects causal and concurrent version vectors', () => {
    expect(compareVectors({ phone: 1 }, { phone: 1 })).toBe('equal')
    expect(compareVectors({ phone: 2, desktop: 1 }, { phone: 1 })).toBe('localDescends')
    expect(compareVectors({ phone: 1 }, { phone: 2, desktop: 1 })).toBe('remoteDescends')
    expect(compareVectors({ phone: 2 }, { desktop: 2 })).toBe('concurrent')
  })

  it('merges vector counters by device', () => {
    expect(mergeVectors({ phone: 3, desktop: 1 }, { phone: 2, tablet: 4 })).toEqual({
      phone: 3,
      desktop: 1,
      tablet: 4
    })
  })

  it('serializes canonical payloads independently of insertion order', () => {
    const first = { title: 'Day', nested: { z: 2, a: 1 }, tags: ['one', 'two'] }
    const second = { tags: ['one', 'two'], nested: { a: 1, z: 2 }, title: 'Day' }
    expect(stableStringify(first)).toBe(stableStringify(second))
    expect(stableStringify(first)).toBe(
      '{"nested":{"a":1,"z":2},"tags":["one","two"],"title":"Day"}'
    )
  })

  it('treats updatedAt-only divergence as equivalent content', () => {
    const desktop = {
      id: 'diary-1',
      title: 'Same entry',
      plainContent: 'Same body',
      updatedAt: 1784721570267
    }
    const phone = {
      ...desktop,
      updatedAt: 1784625068382
    }

    expect(payloadsEquivalentForSync('diary', desktop, phone)).toBe(true)
    expect(payloadsEquivalentForSync('diary', desktop, { ...phone, title: 'Edited' })).toBe(false)
  })

  it('keeps diary image URIs stable while canonicalizing legacy paths', () => {
    const imageId = '123e4567-e89b-42d3-a456-426614174000.webp'
    const source = 'diary-image://' + imageId
    const image = (value: string): string => '<img src="' + value + '">'

    expect(canonicalizeMediaSources(image(source))).toBe(image(source))
    expect(canonicalizeMediaSources(image('diary-imag' + source))).toBe(image(source))
    expect(canonicalizeMediaSources(image('C:\\ShadowDiary\\images\\' + imageId))).toBe(
      image(source)
    )
    expect(canonicalizeMediaSources(image('file:///C:/ShadowDiary/images/' + imageId))).toBe(
      image(source)
    )
  })

  it('treats missing and empty archive media fields as equivalent', () => {
    const shared = {
      id: 'archive-1',
      name: 'Camera',
      type: 'object',
      createdAt: 1,
      updatedAt: 1
    }

    expect(
      payloadsEquivalentForSync('archive', { ...shared, mainImage: null, images: [] }, shared)
    ).toBe(true)
  })

  it('normalizes equivalent archive image locations before comparing', () => {
    const mainImageId = '123e4567-e89b-12d3-a456-426614174000.webp'
    const galleryImageId = '223e4567-e89b-42d3-a456-426614174001.jpg'
    const shared = {
      id: 'archive-1',
      name: 'Camera',
      type: 'object',
      createdAt: 1
    }
    const desktop = {
      ...shared,
      mainImage: `diary-image://${mainImageId}`,
      images: [`C:\\ShadowDiary\\images\\${galleryImageId}`],
      updatedAt: 200
    }
    const phone = {
      ...shared,
      mainImage: `/data/user/0/app/media/${mainImageId}`,
      images: [`file:///data/user/0/app/media/${galleryImageId}`],
      updatedAt: 100
    }

    expect(payloadsEquivalentForSync('archive', desktop, phone)).toBe(true)
  })

  it('keeps genuinely different archive images non-equivalent', () => {
    const shared = {
      id: 'archive-1',
      name: 'Camera',
      type: 'object',
      images: [],
      createdAt: 1,
      updatedAt: 1
    }

    expect(
      payloadsEquivalentForSync(
        'archive',
        {
          ...shared,
          mainImage: 'diary-image://123e4567-e89b-12d3-a456-426614174000.webp'
        },
        {
          ...shared,
          mainImage: 'diary-image://323e4567-e89b-42d3-b456-426614174002.webp'
        }
      )
    ).toBe(false)
  })
})
