import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadEnvFile } from './env-file'

const KEYS = ['ONESTACK_FROM_FILE', 'ONESTACK_ALREADY_SET', 'ONESTACK_BLANK']

function envFile(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'onestack-env-')), '.env')
  writeFileSync(path, contents)

  return path
}

describe('loadEnvFile', () => {
  afterEach(() => {
    for (const key of KEYS) delete process.env[key]
  })

  it('puts the file into the environment', () => {
    loadEnvFile(envFile('ONESTACK_FROM_FILE=yes\n'))

    expect(process.env.ONESTACK_FROM_FILE).toBe('yes')
  })

  it('leaves a variable the environment already set alone', () => {
    // The deployed case: real configuration must beat a checked-out file.
    process.env.ONESTACK_ALREADY_SET = 'from the environment'

    loadEnvFile(envFile('ONESTACK_ALREADY_SET=from the file\n'))

    expect(process.env.ONESTACK_ALREADY_SET).toBe('from the environment')
  })

  it('treats a blank value in the file as not set at all', () => {
    // `.env.example` writes optional variables as `KEY=`. Left as an empty
    // string that would satisfy a required field and beat a default.
    loadEnvFile(envFile('ONESTACK_BLANK=\n'))

    expect('ONESTACK_BLANK' in process.env).toBe(false)
  })

  it('keeps a blank the environment set itself', () => {
    process.env.ONESTACK_BLANK = ''

    loadEnvFile(envFile('ONESTACK_FROM_FILE=yes\n'))

    expect(process.env.ONESTACK_BLANK).toBe('')
  })

  it('treats a missing file as nothing to load', () => {
    expect(() => loadEnvFile(join(tmpdir(), 'onestack-no-such-dir', '.env'))).not.toThrow()
  })

  it('still reports a file it cannot read', () => {
    // A directory where a file was expected is a mistake worth surfacing,
    // unlike an absent file.
    expect(() => loadEnvFile(mkdtempSync(join(tmpdir(), 'onestack-env-')))).toThrow()
  })
})
