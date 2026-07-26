import { describe, expect, it } from 'vitest'
import {
  compareVectors,
  mergeVectors,
  payloadsEquivalentIgnoringUpdatedAt,
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

    expect(payloadsEquivalentIgnoringUpdatedAt(desktop, phone)).toBe(true)
    expect(payloadsEquivalentIgnoringUpdatedAt(desktop, { ...phone, title: 'Edited' })).toBe(false)
  })
})
