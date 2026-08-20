/**
 * Express's `trust proxy` setting, derived from configuration.
 *
 * A number means "trust this many hops from the socket outward". Zero means
 * trust nothing, which is the only safe default: a forwarded header from a
 * client with no proxy in front of it is simply a claim, and believing it
 * lets anybody present any address.
 */
export function trustProxyHops(configured: number): number {
  if (!Number.isInteger(configured) || configured < 0) return 0

  return configured
}

/**
 * The address rate limiting and audit should attribute a request to.
 *
 * Mirrors what Express does, so the decision can be tested without booting an
 * application: with no trusted hops the socket address wins, whatever the
 * header says.
 */
export function clientAddress(
  socketAddress: string,
  forwardedFor: string | undefined,
  hops: number,
): string {
  if (hops <= 0 || !forwardedFor) return socketAddress

  // Right to left: the rightmost entries were added by proxies nearest to us,
  // and only `hops` of them are trustworthy.
  const chain = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (chain.length === 0) return socketAddress

  const index = chain.length - hops

  return chain[Math.max(0, index)] ?? socketAddress
}
