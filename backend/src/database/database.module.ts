import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common'
import { loadEnv } from '../config/env'
import { createDatabase, type Database, type DatabaseHandle } from './client'

export const DATABASE = Symbol('DATABASE')
const DATABASE_HANDLE = Symbol('DATABASE_HANDLE')

/**
 * Global because every feature module needs the same single pool; making each
 * one import DatabaseModule would only invite a second pool by accident.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_HANDLE,
      useFactory: (): DatabaseHandle => createDatabase(loadEnv()),
    },
    {
      provide: DATABASE,
      useFactory: (handle: DatabaseHandle): Database => handle.db,
      inject: [DATABASE_HANDLE],
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close()
  }
}
