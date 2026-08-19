import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { DomainExceptionFilter } from './common/domain-exception.filter'
import { HealthController } from './health/health.controller'

@Module({
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
