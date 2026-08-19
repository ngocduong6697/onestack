import { Controller, Get } from '@nestjs/common'
import type { ReadyResponse } from '@onestack/shared'
import { ServiceUnavailableError } from '../common/errors'
import { DatabaseHealth } from '../database/database.health'

/**
 * Readiness, kept separate from /health on purpose. Liveness answers "is this
 * process alive"; readiness answers "should traffic come here". Collapsing
 * them turns a database blip into a restart loop.
 */
@Controller('ready')
export class ReadyController {
  constructor(private readonly database: DatabaseHealth) {}

  @Get()
  async check(): Promise<ReadyResponse> {
    if (!(await this.database.isReachable())) {
      throw new ServiceUnavailableError('Database is not reachable')
    }

    return { status: 'ready', database: 'up' }
  }
}
