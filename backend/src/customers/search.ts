/**
 * Escapes a user's search term for LIKE/ILIKE.
 *
 * Without this, a search for `%` matches every record and a search for `_`
 * matches any single character — so the query stops meaning what the person
 * typed. The backslash is escaped first, or it would escape the escapes.
 */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** A contains-match pattern for an already-escaped term. */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`
}
