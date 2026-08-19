import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import {
  loginRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type PublicUser,
  type RegisterRequest,
} from '@onestack/shared'
import type { Request, Response } from 'express'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { loadEnv } from '../config/env'
import { AuthService, type AuthenticatedSession } from './auth.service'
import { CurrentUser } from './current-user.decorator'
import { SessionGuard } from './session.guard'
import { SESSION_COOKIE, sessionCookieOptions } from './session-cookie'

@Controller('auth')
export class AuthController {
  private readonly env = loadEnv()

  constructor(private readonly auth: AuthService) {}

  /** Three a minute per IP: enough for a typo, useless for scripted signup. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register')
  @UsePipes(new ZodValidationPipe(registerRequestSchema))
  async register(
    @Body() body: RegisterRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicUser> {
    const session = await this.auth.register(body, request.get('user-agent'))

    return this.withCookie(response, session)
  }

  /** Five a minute per IP. Unlimited login attempts is the cheapest attack. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginRequestSchema))
  async login(
    @Body() body: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicUser> {
    const session = await this.auth.login(body, request.get('user-agent'))

    return this.withCookie(response, session)
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token: unknown = request.cookies?.[SESSION_COOKIE]

    if (typeof token === 'string' && token.length > 0) {
      await this.auth.logout(token)
    }

    // Cleared unconditionally: a caller with a stale cookie should end up
    // without one either way.
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.env))
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user
  }

  private withCookie(response: Response, session: AuthenticatedSession): PublicUser {
    response.cookie(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions(this.env, session.expiresAt),
    )

    // The token goes in the cookie and nowhere else — never in a body a script
    // or a log could read (rule 5).
    return session.user
  }
}
