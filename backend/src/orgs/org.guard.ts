import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../common/errors'
import { REQUEST_USER } from '../auth/current-user.decorator'
import { REQUEST_ORG, ROLE_METADATA, type RequestWithOrg } from './current-org.decorator'
import { OrgsService } from './orgs.service'
import { satisfies, type Role } from './roles'

/**
 * Resolves the organization named in the path and the caller's role in it.
 *
 * A non-member gets 404, not 403. A 403 would confirm the organization exists,
 * which is exactly what someone walking through ids wants to learn.
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly orgs: OrgsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithOrg>()
    const user = request[REQUEST_USER]

    // SessionGuard runs first. Without it there is nobody to check.
    if (!user) throw new UnauthorizedError('Authentication required')

    // Express types this as string | string[]; a repeated parameter would
    // arrive as an array, and only a single well-formed id may proceed.
    const organizationId: unknown = request.params?.orgId

    if (typeof organizationId !== 'string' || !isUuid(organizationId)) {
      // An unparseable id cannot name a real organization, and saying so would
      // distinguish "malformed" from "not yours".
      throw new NotFoundError('Organization not found')
    }

    const membership = await this.orgs.membershipOf(organizationId, user.id)

    if (!membership) throw new NotFoundError('Organization not found')

    const required = this.reflector.getAllAndOverride<Role | undefined>(ROLE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ])

    // Membership is established by this point, so 403 leaks nothing new.
    if (required && !satisfies(membership.role, required)) {
      throw new ForbiddenError(`This action requires the ${required} role`)
    }

    request[REQUEST_ORG] = membership

    return true
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID.test(value)
}
