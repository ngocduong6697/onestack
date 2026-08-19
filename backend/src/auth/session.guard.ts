import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { UnauthorizedError } from '../common/errors'
import { AuthService } from './auth.service'
import { REQUEST_USER, type RequestWithUser } from './current-user.decorator'
import { SESSION_COOKIE } from './session-cookie'

/**
 * Opt-in, not global. A guard applied to everything would silently require a
 * session on routes that are not ready for one — including the probes, which
 * must answer during an outage.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>()
    const token: unknown = request.cookies?.[SESSION_COOKIE]

    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedError('Authentication required')
    }

    const user = await this.auth.authenticate(token)

    if (!user) {
      // Expired, revoked, forged and disabled all land here on purpose: the
      // caller learns only that it did not work.
      throw new UnauthorizedError('Authentication required')
    }

    request[REQUEST_USER] = user

    return true
  }
}
