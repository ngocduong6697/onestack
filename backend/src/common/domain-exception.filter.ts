import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common'
import type { Response } from 'express'
import { DomainError } from './errors'

interface ErrorBody {
  error: { code: string; message: string }
}

/**
 * The one place an exception becomes a response.
 *
 * Domain errors carry their own status and code. Anything unrecognised is a
 * bug: it is logged with its stack and returned as an opaque 500, because the
 * client has no business seeing internals (CLAUDE.md rule 5).
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const { status, body } = this.translate(exception)

    response.status(status).json(body)
  }

  private translate(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        body: { error: { code: exception.code, message: exception.message } },
      }
    }

    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        body: { error: { code: 'http_error', message: exception.message } },
      }
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    )

    return {
      status: 500,
      body: { error: { code: 'internal_error', message: 'Internal server error' } },
    }
  }
}
