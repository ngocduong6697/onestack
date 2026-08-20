import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { AddressThrottlerGuard, THROTTLER_GUARD } from './common/throttler'
import { AiModule } from './ai/ai.module'
import { AnalyticsModule } from './analytics/analytics.module'
import { AuditModule } from './audit/audit.module'
import { BillingModule } from './billing/billing.module'
import { AutomationModule } from './automation/automation.module'
import { AuthModule } from './auth/auth.module'
import { DomainExceptionFilter } from './common/domain-exception.filter'
import { DatabaseHealth } from './database/database.health'
import { DatabaseModule } from './database/database.module'
import { CustomersModule } from './customers/customers.module'
import { OrgsModule } from './orgs/orgs.module'
import { ProductsModule } from './products/products.module'
import { SubscriptionsModule } from './subscriptions/subscriptions.module'
import { UsersModule } from './users/users.module'
import { HealthController } from './health/health.controller'
import { ReadyController } from './health/ready.controller'

@Module({
  imports: [
    DatabaseModule,
    // A floor for every route; the auth routes tighten it with @Throttle.
    /**
     * A floor for every route; the auth routes tighten it with @Throttle.
     *
     * There is deliberately no way to switch this off by configuration. It
     * was once possible, gated to non-production — which is one
     * misconfiguration away from not being gated at all. Tests that need it
     * out of the way override THROTTLER_GUARD_OVERRIDE in the testing module
     * instead, which cannot be reached from a running deployment.
     */
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    OrgsModule,
    UsersModule,
    CustomersModule,
    ProductsModule,
    BillingModule,
    SubscriptionsModule,
    AiModule,
    AnalyticsModule,
    AuditModule,
    AutomationModule,
    AuthModule,
  ],
  controllers: [HealthController, ReadyController],
  providers: [
    DatabaseHealth,
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    // Named, so a testing module can replace it; APP_GUARD alone cannot be
    // overridden through Nest's testing utilities.
    AddressThrottlerGuard,
    { provide: THROTTLER_GUARD, useExisting: AddressThrottlerGuard },
    { provide: APP_GUARD, useExisting: THROTTLER_GUARD },
  ],
})
export class AppModule {}
