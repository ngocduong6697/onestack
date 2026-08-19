import type { ArgumentsHost } from '@nestjs/common'
import { HttpException, Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainExceptionFilter } from './domain-exception.filter'
import { NotFoundError } from './errors'

function makeHost() {
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost

  return { host, status, json }
}

describe('DomainExceptionFilter', () => {
  // The 500 path logs a stack on purpose; silence it so a passing suite is
  // not full of red, and so the call itself can be asserted.
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  it('maps a domain error to its own status and code', () => {
    const { host, status, json } = makeHost()

    new DomainExceptionFilter().catch(new NotFoundError('Customer 42 does not exist'), host)

    expect(status).toHaveBeenCalledWith(404)
    expect(json).toHaveBeenCalledWith({
      error: { code: 'not_found', message: 'Customer 42 does not exist' },
    })
  })

  it('passes an HttpException through with its status', () => {
    const { host, status } = makeHost()

    new DomainExceptionFilter().catch(new HttpException('Teapot', 418), host)

    expect(status).toHaveBeenCalledWith(418)
  })

  it('never leaks the internals of an unknown error', () => {
    const { host, status, json } = makeHost()

    new DomainExceptionFilter().catch(new Error('connection string: postgres://u:pw@db'), host)

    expect(status).toHaveBeenCalledWith(500)
    expect(json).toHaveBeenCalledWith({
      error: { code: 'internal_error', message: 'Internal server error' },
    })
    expect(logged).toHaveBeenCalledOnce()
  })
})
