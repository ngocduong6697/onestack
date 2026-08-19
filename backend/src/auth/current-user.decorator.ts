import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { PublicUser } from '@onestack/shared'
import type { Request } from 'express'

/** Set by SessionGuard; nothing else may write it. */
export const REQUEST_USER = 'onestackUser'

export interface RequestWithUser extends Request {
  [REQUEST_USER]?: PublicUser
}

/**
 * Reads the user the guard already resolved. It is non-null only because the
 * guard runs first — using it without @UseGuards(SessionGuard) is a mistake
 * the guard's absence makes obvious at runtime rather than silently undefined.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<RequestWithUser>()
  const user = request[REQUEST_USER]

  if (!user) {
    throw new Error('CurrentUser used on a route without SessionGuard')
  }

  return user
})
