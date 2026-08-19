import { healthResponseSchema } from '@onestack/shared'
import { describe, expect, it } from 'vitest'
import { HealthController } from './health.controller'

describe('HealthController', () => {
  it('returns a payload matching the shared contract', () => {
    const result = new HealthController().check()

    expect(healthResponseSchema.parse(result)).toEqual(result)
    expect(result.status).toBe('ok')
    expect(result.uptime).toBeGreaterThanOrEqual(0)
  })
})
