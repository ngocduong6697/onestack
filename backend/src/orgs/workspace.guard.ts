import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { NotFoundError } from '../common/errors'
import { REQUEST_ORG } from './current-org.decorator'
import { REQUEST_WORKSPACE, type RequestWithWorkspace } from './current-workspace.decorator'
import { OrgsService } from './orgs.service'

/**
 * Runs after OrgGuard and proves the workspace belongs to the organization the
 * caller was already admitted to. Without this, a workspace id would be a
 * capability on its own — which is precisely the bug TASK-004 was written to
 * prevent one level up.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly orgs: OrgsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWorkspace>()
    const org = request[REQUEST_ORG]

    // OrgGuard must have run. Reaching here without it is a wiring mistake.
    if (!org) throw new Error('WorkspaceGuard used on a route without OrgGuard')

    const workspaceId: unknown = request.params?.workspaceId

    if (typeof workspaceId !== 'string' || !isUuid(workspaceId)) {
      throw new NotFoundError('Workspace not found')
    }

    // Filtered by organization as well as id, so an id from another tenant
    // finds nothing rather than finding a row.
    const workspace = await this.orgs.findWorkspace(org.organization.id, workspaceId)

    if (!workspace) throw new NotFoundError('Workspace not found')

    request[REQUEST_WORKSPACE] = workspace

    return true
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID.test(value)
}
