import { describe, expect, it } from 'vitest'
import { cappedLimit, MAX_PAGE_LIMIT, toPage } from './pagination'

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `id-${i}` }))
const identity = (row: { id: string }) => row

describe('toPage', () => {
  it('returns no cursor when the extra row is absent', () => {
    // Asked for 5, got 5: this is the last page.
    expect(toPage(rows(5), 5, identity)).toEqual({ items: rows(5), nextCursor: null })
  })

  it('drops the extra row and points at the last surviving id', () => {
    const page = toPage(rows(6), 5, identity)

    expect(page.items).toHaveLength(5)
    expect(page.nextCursor).toBe('id-4')
  })

  it('handles an empty result', () => {
    expect(toPage([], 25, identity)).toEqual({ items: [], nextCursor: null })
  })

  it('handles a partial page', () => {
    expect(toPage(rows(2), 25, identity)).toEqual({ items: rows(2), nextCursor: null })
  })

  it('maps rows on the way out', () => {
    const page = toPage(rows(2), 5, (row) => ({ id: row.id, upper: row.id.toUpperCase() }))

    expect(page.items[0]).toEqual({ id: 'id-0', upper: 'ID-0' })
  })

  /** Walking a whole list must produce every item exactly once. */
  it('walks a list with no gaps and no repeats', () => {
    const all = rows(11)
    const seen: string[] = []
    let cursor: string | null = null

    do {
      const start = cursor ? all.findIndex((row) => row.id === cursor) + 1 : 0
      const page = toPage(all.slice(start, start + 6), 5, identity)

      seen.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor
    } while (cursor)

    expect(seen).toHaveLength(11)
    expect(new Set(seen).size).toBe(11)
  })
})

describe('cappedLimit', () => {
  it('passes a reasonable limit through', () => {
    expect(cappedLimit(25)).toBe(25)
  })

  it('caps an unreasonable one', () => {
    expect(cappedLimit(10_000)).toBe(MAX_PAGE_LIMIT)
  })
})
