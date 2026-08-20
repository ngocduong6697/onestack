import { Global, Module } from '@nestjs/common'
import { OrgsModule } from '../orgs/orgs.module'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'

/**
 * Global for the same reason the database is: rule 7 applies across every
 * feature, and making each module import this would be one more thing to
 * forget on the day somebody adds an important action.
 */
@Global()
@Module({
  imports: [OrgsModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
