/**
 * Postgres error codes worth naming. Extracted from the three services that
 * had each written this check for themselves.
 *
 * https://www.postgresql.org/docs/16/errcodes-appendix.html
 */
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, UNIQUE_VIOLATION)
}

export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, FOREIGN_KEY_VIOLATION)
}
