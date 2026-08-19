/**
 * Errors the domain is allowed to throw. Services throw these; the exception
 * filter is the single place that turns them into HTTP. Nothing below the
 * controller layer should import from @nestjs/common to raise an error.
 */
export abstract class DomainError extends Error {
  abstract readonly status: number
  abstract readonly code: string

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ValidationError extends DomainError {
  readonly status = 422
  readonly code = 'validation_failed'
}

export class UnauthorizedError extends DomainError {
  readonly status = 401
  readonly code = 'unauthorized'
}

export class ForbiddenError extends DomainError {
  readonly status = 403
  readonly code = 'forbidden'
}

export class NotFoundError extends DomainError {
  readonly status = 404
  readonly code = 'not_found'
}

export class ConflictError extends DomainError {
  readonly status = 409
  readonly code = 'conflict'
}

export class ServiceUnavailableError extends DomainError {
  readonly status = 503
  readonly code = 'service_unavailable'
}
