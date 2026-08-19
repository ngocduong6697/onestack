/** Slugs are generated, never accepted from input, so one cannot be crafted. */
const MAX_LENGTH = 60

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    // Strip accents, so "Café" and "Cafe" produce the same readable slug.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, '')

  // A name of only punctuation would otherwise produce an empty slug, which
  // would collide with every other such name and read as a missing segment.
  return slug || 'untitled'
}

/**
 * Appends the smallest numeric suffix that is free. Callers pass the set of
 * slugs already taken in the scope the slug has to be unique within.
 */
export function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name)

  if (!taken.has(base)) return base

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, MAX_LENGTH - String(suffix).length - 1)}-${suffix}`

    if (!taken.has(candidate)) return candidate
  }
}
