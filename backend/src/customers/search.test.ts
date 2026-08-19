import { describe, expect, it } from 'vitest'
import { containsPattern, escapeLike } from './search'

describe('escapeLike', () => {
  /**
   * The bug this prevents: a search for '%' returning every record, because
   * the term was pasted into a LIKE pattern as a wildcard.
   */
  it('escapes the wildcards', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
  })

  it('escapes the escape character first', () => {
    // Otherwise the backslash added for '%' would itself be escaped again.
    expect(escapeLike('a\\b')).toBe('a\\\\b')
    expect(escapeLike('\\%')).toBe('\\\\\\%')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeLike('Acme Corp')).toBe('Acme Corp')
    expect(escapeLike("O'Brien & Sons")).toBe("O'Brien & Sons")
  })

  it('handles an empty term', () => {
    expect(escapeLike('')).toBe('')
  })
})

describe('containsPattern', () => {
  it('wraps an escaped term in unescaped wildcards', () => {
    expect(containsPattern('acme')).toBe('%acme%')
    expect(containsPattern('100%')).toBe('%100\\%%')
  })
})
