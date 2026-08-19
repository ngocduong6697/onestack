import { Controller, Get } from '@nestjs/common'
import type { HealthResponse } from '@onestack/shared'

/**
 * Liveness only. It deliberately does not touch Postgres: compose uses this to
 * decide the API is up, and a readiness check that fails when the database
 * blips would take the container down with it. TASK-018 adds /ready.
 */
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now()

  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
    }
  }
}
