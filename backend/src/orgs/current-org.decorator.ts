import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common'
import type { Organization } from '@onestack/shared'
import type { RequestWithUser } from '../auth/current-user.decorator'
import type { Role } from './roles'

/** Set by OrgGuard; nothing else may write it. */
export const REQUEST_ORG = 'onestackOrg'

export interface OrgContext {
  organization: Organization
  /** The caller's role in it — already resolved, so handlers never re-query. */
  role: Role
}

export interface RequestWithOrg extends RequestWithUser {
  [REQUEST_ORG]?: OrgContext
}

export const ROLE_METADATA = 'onestackRequiredRole'

/**
 * Declares the minimum role a route needs. Absent, the guard requires
 * membership only — the route fails closed either way, because reaching a
 * scoped route without OrgGuard is what raises.
 */
export const RequireRole = (role: Role) => SetMetadata(ROLE_METADATA, role)

export const CurrentOrg = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<RequestWithOrg>()
  const org = request[REQUEST_ORG]

  if (!org) {
    throw new Error('CurrentOrg used on a route without OrgGuard')
  }

  return org
})
