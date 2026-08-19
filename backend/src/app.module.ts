import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from './auth/auth.module'
import { DomainExceptionFilter } from './common/domain-exception.filter'
import { DatabaseHealth } from './database/database.health'
import { DatabaseModule } from './database/database.module'
import { OrgsModule } from './orgs/orgs.module'
import { HealthController } from './health/health.controller'
import { ReadyController } from './health/ready.controller'

@Module({
  imports: [
    DatabaseModule,
    // A floor for every route; the auth routes tighten it with @Throttle.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      /**
       * Tests that are not about rate limiting need it out of the way, and
       * evaluating this per request avoids reading the environment at import
       * time. Production can never turn it off, whatever the variable says.
       */
      skipIf: () =>
        process.env.NODE_ENV !== 'production' && process.env.THROTTLE_DISABLED === 'true',
    }),
    OrgsModule,
    AuthModule,
  ],
  controllers: [HealthController, ReadyController],
  providers: [
    DatabaseHealth,
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
