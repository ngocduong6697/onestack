import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { ValidationError } from '../common/errors'

/**
 * A workflow is user input containing a URL, executed by the server. Without a
 * destination check that is server-side request forgery: a workflow author
 * could point the API at the cloud metadata endpoint, at a database bound to
 * localhost, or at anything else on the private network the server sits in.
 *
 * The check is on the **resolved address**, not the hostname, because a
 * hostname an attacker controls can resolve wherever they like.
 */

/** Blocked ranges, as the reasons they are blocked. */
function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)

  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true

  const [a = 0, b = 0] = parts

  if (a === 0) return true // "this network"
  if (a === 10) return true // RFC 1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 168) return true // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a >= 224) return true // multicast and reserved

  return false
}

function isBlockedIpv6(address: string): boolean {
  const normalised = address.toLowerCase().split('%')[0] ?? ''

  if (normalised === '::' || normalised === '::1') return true // unspecified, loopback
  if (normalised.startsWith('fe80')) return true // link-local
  if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true // unique local
  if (normalised.startsWith('ff')) return true // multicast

  // ::ffff:127.0.0.1 and friends — an IPv4 address wearing a hat.
  const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1]) return isBlockedIpv4(mapped[1])

  return false
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address)

  if (version === 4) return isBlockedIpv4(address)
  if (version === 6) return isBlockedIpv6(address)

  // Not an address at all: refuse rather than guess.
  return true
}

export interface SafeUrl {
  url: URL
  address: string
}

/**
 * Parses, restricts the scheme, resolves the host, and refuses anything that
 * lands on a private address. `resolve` is injectable so the check can be
 * tested without depending on what DNS happens to say today.
 */
export async function assertSafeUrl(
  raw: string,
  resolve: (hostname: string) => Promise<string> = async (hostname) =>
    (await lookup(hostname)).address,
): Promise<SafeUrl> {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    throw new ValidationError('The URL is not valid')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Only http and https URLs may be requested')
  }

  // A literal address needs no lookup; a hostname does.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const address = isIP(host) ? host : await resolveOrRefuse(host, resolve)

  if (isBlockedAddress(address)) {
    // Deliberately vague: the caller learns it is refused, not the topology.
    throw new ValidationError('That URL resolves to an address that may not be requested')
  }

  return { url, address }
}

async function resolveOrRefuse(
  hostname: string,
  resolve: (hostname: string) => Promise<string>,
): Promise<string> {
  try {
    return await resolve(hostname)
  } catch {
    throw new ValidationError('That URL could not be resolved')
  }
}
