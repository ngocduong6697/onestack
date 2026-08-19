import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug } from './slug'

describe('slugify', () => {
  it.each([
    ['Acme Corp', 'acme-corp'],
    ['  Leading and trailing  ', 'leading-and-trailing'],
    ['Multiple   spaces', 'multiple-spaces'],
    ['Punctuation!? Everywhere...', 'punctuation-everywhere'],
    ['Café Ünicode', 'cafe-unicode'],
    ['ALL CAPS', 'all-caps'],
    ['already-a-slug', 'already-a-slug'],
    ['Numbers 123 kept', 'numbers-123-kept'],
  ])('turns %o into %o', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('never returns an empty slug, which would read as a missing path segment', () => {
    expect(slugify('!!!')).toBe('untitled')
    expect(slugify('   ')).toBe('untitled')
  })

  it('truncates without leaving a trailing separator', () => {
    const slug = slugify('a'.repeat(200))

    expect(slug).toHaveLength(60)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('uniqueSlug', () => {
  it('uses the plain slug when it is free', () => {
    expect(uniqueSlug('Acme Corp', new Set())).toBe('acme-corp')
  })

  it('suffixes rather than failing on a collision', () => {
    expect(uniqueSlug('Acme Corp', new Set(['acme-corp']))).toBe('acme-corp-2')
  })

  it('finds the first free suffix', () => {
    const taken = new Set(['acme-corp', 'acme-corp-2', 'acme-corp-3'])

    expect(uniqueSlug('Acme Corp', taken)).toBe('acme-corp-4')
  })

  it('keeps a suffixed slug within the length limit', () => {
    const base = slugify('b'.repeat(200))

    expect(uniqueSlug('b'.repeat(200), new Set([base])).length).toBeLessThanOrEqual(60)
  })
})
