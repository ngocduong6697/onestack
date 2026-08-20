import { describe, expect, it } from 'vitest'
import { clientAddress, trustProxyHops } from './trust-proxy'

describe('trustProxyHops', () => {
  it('trusts nothing by default', () => {
    expect(trustProxyHops(0)).toBe(0)
  })

  it('trusts the number of hops configured', () => {
    expect(trustProxyHops(1)).toBe(1)
    expect(trustProxyHops(2)).toBe(2)
  })

  it('refuses nonsense rather than guessing', () => {
    expect(trustProxyHops(-1)).toBe(0)
    expect(trustProxyHops(1.5)).toBe(0)
    expect(trustProxyHops(Number.NaN)).toBe(0)
  })
})

describe('clientAddress', () => {
  const socket = '10.0.0.5'

  /**
   * The case that matters. With no proxy in front, a forwarded header is a
   * claim by the client — believing it lets anybody present any address and
   * walk around a rate limit.
   */
  it('ignores the forwarded header when nothing is trusted', () => {
    expect(clientAddress(socket, '203.0.113.9', 0)).toBe(socket)
    expect(clientAddress(socket, '1.2.3.4, 5.6.7.8', 0)).toBe(socket)
  })

  it('uses the client address through one trusted proxy', () => {
    expect(clientAddress(socket, '203.0.113.9', 1)).toBe('203.0.113.9')
  })

  /** Rightmost entries are nearest to us, so only `hops` of them are ours. */
  it('takes the right entry through two trusted proxies', () => {
    expect(clientAddress(socket, '203.0.113.9, 10.1.1.1', 2)).toBe('203.0.113.9')
  })

  it('does not walk past the start of a short chain', () => {
    expect(clientAddress(socket, '203.0.113.9', 5)).toBe('203.0.113.9')
  })

  it('falls back to the socket when the header is empty or absent', () => {
    expect(clientAddress(socket, undefined, 1)).toBe(socket)
    expect(clientAddress(socket, '', 1)).toBe(socket)
    expect(clientAddress(socket, '   ', 1)).toBe(socket)
  })

  it('tolerates the spacing people actually send', () => {
    expect(clientAddress(socket, '203.0.113.9,10.1.1.1', 2)).toBe('203.0.113.9')
  })

  /** Two visitors behind one proxy must not be counted as one client. */
  it('distinguishes two clients behind the same proxy', () => {
    const first = clientAddress(socket, '198.51.100.1', 1)
    const second = clientAddress(socket, '198.51.100.2', 1)

    expect(first).not.toBe(second)
  })
})
