import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { AnalyticsModule } from '../analytics/analytics.module'
import { OrgsModule } from '../orgs/orgs.module'
import { Actions } from './actions'
import { AutomationWorker } from './worker'
import { JobQueue } from './queue'
import { WorkflowRunner } from './runner'
import { WorkflowsController } from './workflows.controller'
import { WorkflowsService } from './workflows.service'

@Module({
  imports: [OrgsModule, AiModule, AnalyticsModule],
  controllers: [WorkflowsController],
  providers: [JobQueue, Actions, WorkflowRunner, WorkflowsService, AutomationWorker],
  exports: [WorkflowsService, JobQueue, AutomationWorker],
})
export class AutomationModule {}
