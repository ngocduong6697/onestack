import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { DomainExceptionFilter } from './common/domain-exception.filter'
import { DatabaseHealth } from './database/database.health'
import { DatabaseModule } from './database/database.module'
import { HealthController } from './health/health.controller'
import { ReadyController } from './health/ready.controller'

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, ReadyController],
  providers: [DatabaseHealth, { provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
