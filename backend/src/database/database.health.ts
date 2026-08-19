import { Inject, Injectable, Logger } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { DATABASE } from './database.module'
import type { Database } from './client'

/**
 * Answers one question: will the database serve a query right now. Nothing
 * more — a readiness probe that runs real work is a readiness probe that
 * reports load as an outage.
 */
@Injectable()
export class DatabaseHealth {
  private readonly logger = new Logger(DatabaseHealth.name)

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async isReachable(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`)
      return true
    } catch (error) {
      // The driver error can carry the connection string; log it, never return it.
      this.logger.warn(`Database probe failed: ${error instanceof Error ? error.message : error}`)
      return false
    }
  }
}
