import { Module } from '@nestjs/common'
import { OrgGuard } from './org.guard'
import { OrgsController } from './orgs.controller'
import { OrgsService } from './orgs.service'
import { WorkspacesController } from './workspaces.controller'

// SessionGuard arrives from the global AuthModule; importing it here would
// create a cycle, since registration needs OrgsService.
@Module({
  controllers: [OrgsController, WorkspacesController],
  providers: [OrgsService, OrgGuard],
  exports: [OrgsService],
})
export class OrgsModule {}
