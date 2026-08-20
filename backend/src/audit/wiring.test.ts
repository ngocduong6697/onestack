import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTIONS } from './actions'

/**
 * Closes the gap TASK-014 recorded: the catalogue named 21 actions and 11 were
 * wired, and nothing said which. "We wired it" is exactly the claim that stops
 * being true silently — a patch that failed to apply left member removal
 * unaudited while every test still passed.
 *
 * This does not prove an action fires at the right moment; the end-to-end
 * tests do that. It proves the constant is referenced somewhere, so a
 * catalogued action cannot be purely decorative.
 */

const SOURCE_ROOT = join(process.cwd(), 'src')

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)))
      continue
    }

    // The catalogue and this test do not count as call sites.
    if (!entry.name.endsWith('.ts')) continue
    if (entry.name.endsWith('.test.ts')) continue
    if (path.endsWith(join('audit', 'actions.ts'))) continue

    files.push(path)
  }

  return files
}

const files = await sourceFiles(SOURCE_ROOT)
const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')

/** Actions that are catalogued on purpose but not yet reachable. */
const NOT_YET_WIRED = new Set<string>([
  AUDIT_ACTIONS.authLogout,
  AUDIT_ACTIONS.authPasswordChanged,
  AUDIT_ACTIONS.inviteRevoked,
  AUDIT_ACTIONS.productDeleted,
  AUDIT_ACTIONS.productArchived,
  AUDIT_ACTIONS.priceArchived,
  AUDIT_ACTIONS.workspaceDeleted,
  AUDIT_ACTIONS.workflowDeleted,
  AUDIT_ACTIONS.subscriptionCanceled,
  AUDIT_ACTIONS.ledgerEntryDeleted,
])

describe('the audit catalogue and the code that uses it', () => {
  const entries = Object.entries(AUDIT_ACTIONS)

  it.each(entries.filter(([, action]) => !NOT_YET_WIRED.has(action)))(
    'has a call site for %s',
    (name) => {
      expect(source).toContain(`AUDIT_ACTIONS.${name}`)
    },
  )

  /**
   * The list of exceptions has to shrink, not grow quietly. If somebody wires
   * one of these and forgets to remove it from the list, this fails and says so.
   */
  it.each([...NOT_YET_WIRED])('records %s as deliberately unwired', (action) => {
    const name = entries.find(([, value]) => value === action)?.[0]

    expect(source).not.toContain(`AUDIT_ACTIONS.${name}`)
  })

  it('accounts for every catalogued action, wired or explicitly not', () => {
    const wired = entries.filter(([name]) => source.includes(`AUDIT_ACTIONS.${name}`))

    expect(wired.length + NOT_YET_WIRED.size).toBe(entries.length)
  })
})
