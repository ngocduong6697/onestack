import { readyResponseSchema } from '@onestack/shared'
import { describe, expect, it } from 'vitest'
import { ServiceUnavailableError } from '../common/errors'
import type { DatabaseHealth } from '../database/database.health'
import { ReadyController } from './ready.controller'

function controllerWith(reachable: boolean) {
  return new ReadyController({
    isReachable: async () => reachable,
  } as DatabaseHealth)
}

describe('ReadyController', () => {
  it('reports ready when the database answers', async () => {
    const result = await controllerWith(true).check()

    expect(readyResponseSchema.parse(result)).toEqual({ status: 'ready', database: 'up' })
  })

  it('raises a 503 when the database does not', async () => {
    await expect(controllerWith(false).check()).rejects.toThrow(ServiceUnavailableError)
  })

  it('does not leak why the database is unreachable', async () => {
    await expect(controllerWith(false).check()).rejects.toThrow(/^Database is not reachable$/)
  })
})
