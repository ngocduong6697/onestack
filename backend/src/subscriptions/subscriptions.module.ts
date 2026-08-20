import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { OrgsModule } from '../orgs/orgs.module'
import { SubscriptionsController } from './subscriptions.controller'
import { SubscriptionsService } from './subscriptions.service'

@Module({
  imports: [OrgsModule, BillingModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
