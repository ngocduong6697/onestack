import { describe, expect, it } from 'vitest'
import { satisfies } from './roles'

describe('role ranking', () => {
  it('lets a higher role satisfy a lower requirement', () => {
    expect(satisfies('owner', 'admin')).toBe(true)
    expect(satisfies('owner', 'member')).toBe(true)
    expect(satisfies('admin', 'member')).toBe(true)
  })

  it('refuses a lower role', () => {
    expect(satisfies('member', 'admin')).toBe(false)
    expect(satisfies('member', 'owner')).toBe(false)
    expect(satisfies('admin', 'owner')).toBe(false)
  })

  it('accepts a role as satisfying itself', () => {
    expect(satisfies('member', 'member')).toBe(true)
    expect(satisfies('admin', 'admin')).toBe(true)
    expect(satisfies('owner', 'owner')).toBe(true)
  })
})
