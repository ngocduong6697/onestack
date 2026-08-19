import { describe, expect, it } from 'vitest'
import { newId } from './ids'

describe('newId', () => {
  it('produces a version 7 uuid', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('is unique across a burst', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId))

    expect(ids.size).toBe(1000)
  })

  it('sorts by creation time, which is the whole reason for v7', async () => {
    const first = newId()
    await new Promise((resolve) => setTimeout(resolve, 2))
    const second = newId()

    expect([second, first].sort()).toEqual([first, second])
  })
})
