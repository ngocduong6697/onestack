/**
 * Keys whose values must never reach the audit log.
 *
 * Matched as substrings and case-insensitively, so `passwordHash`,
 * `tokenHash` and `ANTHROPIC_API_KEY` are all caught. The audit log records
 * that something changed, not the secret it changed to.
 */
const SENSITIVE = [
  'password',
  'hash',
  'token',
  'secret',
  'apikey',
  'api_key',
  'credential',
  'prompt',
  'completion',
]

const REDACTED = '[redacted]'
const MAX_STRING = 500
const MAX_KEYS = 50

function isSensitive(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z]/g, '')

  return SENSITIVE.some((needle) => normalised.includes(needle.replace(/[^a-z]/g, '')))
}

/**
 * Redacts sensitive keys and bounds what is stored. Values are truncated
 * rather than dropped, because "the name changed to something 4KB long" is
 * still useful, and a workflow should not be able to fill this table.
 */
export function redact(changes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(changes).slice(0, MAX_KEYS)) {
    if (isSensitive(key)) {
      out[key] = REDACTED
      continue
    }

    if (typeof value === 'string') {
      out[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
      continue
    }

    if (value === null || ['number', 'boolean'].includes(typeof value)) {
      out[key] = value
      continue
    }

    // Nested objects are summarised rather than walked: an audit entry is a
    // note, not a copy of the record.
    out[key] = Array.isArray(value) ? `[${value.length} items]` : '[object]'
  }

  return out
}
