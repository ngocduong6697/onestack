import { cronSchema } from '@onestack/shared'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../common/errors'
import { nextOccurrence, nextRunFor } from './schedule'

const at = (iso: string) => new Date(iso)

describe('nextOccurrence', () => {
  it('finds the next daily firing', () => {
    expect(nextOccurrence('0 9 * * *', 'UTC', at('2026-03-10T08:00:00Z')).toISOString()).toBe(
      '2026-03-10T09:00:00.000Z',
    )
  })

  it('rolls to tomorrow once today has passed', () => {
    expect(nextOccurrence('0 9 * * *', 'UTC', at('2026-03-10T10:00:00Z')).toISOString()).toBe(
      '2026-03-11T09:00:00.000Z',
    )
  })

  it('honours a weekly expression', () => {
    // Monday at 09:00; 2026-03-10 is a Tuesday, so the next is the 16th.
    expect(nextOccurrence('0 9 * * 1', 'UTC', at('2026-03-10T10:00:00Z')).toISOString()).toBe(
      '2026-03-16T09:00:00.000Z',
    )
  })

  /**
   * The reason this is a dependency: 09:00 local is a different UTC instant
   * either side of a clock change, and getting it wrong sends the Monday
   * report at 08:00 for half the year.
   */
  it('keeps local time across a daylight-saving change', () => {
    const beforeChange = nextOccurrence('0 9 * * *', 'Europe/London', at('2026-03-28T00:00:00Z'))
    const afterChange = nextOccurrence('0 9 * * *', 'Europe/London', at('2026-03-30T00:00:00Z'))

    // 09:00 GMT before the change; 09:00 BST — 08:00 UTC — after it.
    expect(beforeChange.toISOString()).toBe('2026-03-28T09:00:00.000Z')
    expect(afterChange.toISOString()).toBe('2026-03-30T08:00:00.000Z')
  })

  it('respects a non-UTC timezone', () => {
    // 09:00 in Tokyo is 00:00 UTC.
    expect(
      nextOccurrence('0 9 * * *', 'Asia/Tokyo', at('2026-03-10T00:30:00Z')).toISOString(),
    ).toBe('2026-03-11T00:00:00.000Z')
  })

  it.each([['not a cron'], ['99 * * * *'], ['* * * * bananas']])('refuses %o', (cron) => {
    expect(() => nextOccurrence(cron, 'UTC', at('2026-03-10T00:00:00Z'))).toThrow(ValidationError)
  })

  /**
   * cron-parser accepts a three-field expression; this codebase does not.
   * The field count is enforced by the schema, so that is where it is tested.
   */
  it('leaves the five-field rule to the schema, which enforces it', () => {
    expect(cronSchema.safeParse('* * *').success).toBe(false)
    expect(cronSchema.safeParse('0 9 * * 1').success).toBe(true)
  })

  it('refuses a timezone that does not exist', () => {
    expect(() => nextOccurrence('0 9 * * *', 'Mars/Olympus', at('2026-03-10T00:00:00Z'))).toThrow(
      ValidationError,
    )
  })
})

describe('nextRunFor', () => {
  const scheduled = {
    enabled: true,
    triggerType: 'schedule',
    cron: '0 9 * * *',
    timezone: 'UTC',
  }

  it('schedules an enabled scheduled workflow', () => {
    expect(nextRunFor(scheduled, at('2026-03-10T08:00:00Z'))?.toISOString()).toBe(
      '2026-03-10T09:00:00.000Z',
    )
  })

  /** A disabled workflow has no next run, which is what keeps it unpicked. */
  it('gives a disabled workflow no next run', () => {
    expect(nextRunFor({ ...scheduled, enabled: false }, at('2026-03-10T08:00:00Z'))).toBeNull()
  })

  it('gives a manual workflow no next run', () => {
    expect(
      nextRunFor({ ...scheduled, triggerType: 'manual' }, at('2026-03-10T08:00:00Z')),
    ).toBeNull()
  })

  it('gives a scheduled workflow with no expression no next run', () => {
    expect(nextRunFor({ ...scheduled, cron: null }, at('2026-03-10T08:00:00Z'))).toBeNull()
  })
})
