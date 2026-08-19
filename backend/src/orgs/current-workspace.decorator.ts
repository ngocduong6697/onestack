import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Workspace } from '@onestack/shared'
import type { RequestWithOrg } from './current-org.decorator'

/** Set by WorkspaceGuard; nothing else may write it. */
export const REQUEST_WORKSPACE = 'onestackWorkspace'

export interface RequestWithWorkspace extends RequestWithOrg {
  [REQUEST_WORKSPACE]?: Workspace
}

export const CurrentWorkspace = createParamDecorator((_d: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<RequestWithWorkspace>()
  const workspace = request[REQUEST_WORKSPACE]

  if (!workspace) {
    throw new Error('CurrentWorkspace used on a route without WorkspaceGuard')
  }

  return workspace
})
