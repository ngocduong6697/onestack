import { Injectable, type ExecutionContext } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

/**
 * The token a test overrides to take rate limiting out of the way.
 *
 * This exists because the alternative was an environment variable that turned
 * a security control off. That variable was gated to non-production, which is
 * one misconfiguration away from being no gate at all; a DI token cannot be
 * set by a deployment.
 */
export const THROTTLER_GUARD = 'THROTTLER_GUARD'

/**
 * Keys the limit on the client's real address rather than the socket's, which
 * behind a proxy is the proxy — counting every visitor as one client.
 * Express resolves this from `trust proxy`, so with nothing trusted it is
 * still the socket address.
 */
@Injectable()
export class AddressThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = req.ip

    if (typeof ip === 'string' && ip.length > 0) return ip

    const socket = req.socket as { remoteAddress?: string } | undefined

    return socket?.remoteAddress ?? 'unknown'
  }

  /** Exposed so a test can exercise the tracker without an HTTP request. */
  async trackerFor(context: ExecutionContext): Promise<string> {
    return this.getTracker(context.switchToHttp().getRequest())
  }
}
