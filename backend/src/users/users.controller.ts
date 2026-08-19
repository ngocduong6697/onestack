import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common'
import {
  changePasswordRequestSchema,
  updateProfileRequestSchema,
  type ChangePasswordRequest,
  type PublicUser,
  type UpdateProfileRequest,
} from '@onestack/shared'
import type { Request } from 'express'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionGuard } from '../auth/session.guard'
import { SESSION_COOKIE } from '../auth/session-cookie'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { UnauthorizedError } from '../common/errors'
import { UsersService } from './users.service'

@Controller('users')
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(updateProfileRequestSchema)) body: UpdateProfileRequest,
  ): Promise<PublicUser> {
    return this.users.updateProfile(user.id, body)
  }

  @Post('me/password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: PublicUser,
    @Req() request: Request,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    const token: unknown = request.cookies?.[SESSION_COOKIE]

    // The guard proved the session; this only re-reads it so the current one
    // can be spared from the revocation.
    if (typeof token !== 'string') throw new UnauthorizedError('Authentication required')

    await this.users.changePassword(user.id, body, token)
  }
}
