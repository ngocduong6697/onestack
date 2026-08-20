import { Module } from '@nestjs/common'
import { OrgsModule } from '../orgs/orgs.module'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { AI_PROVIDERS_TOKEN, providersFromEnv } from './providers.factory'
import { AiUsageService } from './usage.service'

@Module({
  imports: [OrgsModule],
  controllers: [AiController],
  providers: [
    { provide: AI_PROVIDERS_TOKEN, useFactory: providersFromEnv },
    AiUsageService,
    AiService,
  ],
  exports: [AiService, AiUsageService],
})
export class AiModule {}
