import { Module } from '@nestjs/common'
import { AcceptInviteController } from './accept-invite.controller'
import { InvitationsController } from './invitations.controller'
import { InvitationsService } from './invitations.service'
import { MembersController } from './members.controller'
import { MembersService } from './members.service'
import { OrgGuard } from './org.guard'
import { OrgsController } from './orgs.controller'
import { OrgsService } from './orgs.service'
import { WorkspacesController } from './workspaces.controller'

// SessionGuard arrives from the global AuthModule; importing it here would
// create a cycle, since registration needs OrgsService.
@Module({
  controllers: [
    OrgsController,
    WorkspacesController,
    MembersController,
    InvitationsController,
    AcceptInviteController,
  ],
  providers: [OrgsService, MembersService, InvitationsService, OrgGuard],
  exports: [OrgsService, MembersService, InvitationsService],
})
export class OrgsModule {}
