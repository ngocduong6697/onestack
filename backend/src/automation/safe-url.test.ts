import { describe, expect, it } from 'vitest'
import { ValidationError } from '../common/errors'
import { assertSafeUrl, isBlockedAddress } from './safe-url'

/** The addresses somebody would actually try. */
describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'the rest of loopback'],
    ['10.0.0.1', 'RFC 1918'],
    ['172.16.0.1', 'RFC 1918'],
    ['172.31.255.255', 'the top of RFC 1918'],
    ['192.168.1.1', 'RFC 1918'],
    ['169.254.169.254', 'cloud metadata'],
    ['0.0.0.0', 'this network'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'IPv6 link-local'],
    ['fd00::1', 'IPv6 unique local'],
    ['::ffff:127.0.0.1', 'IPv4 loopback wearing an IPv6 hat'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each([['8.8.8.8'], ['1.1.1.1'], ['93.184.216.34'], ['172.32.0.1'], ['2606:4700:4700::1111']])(
    'allows the public address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false)
    },
  )

  it('refuses anything that is not an address at all', () => {
    expect(isBlockedAddress('not-an-address')).toBe(true)
    expect(isBlockedAddress('')).toBe(true)
  })
})

describe('assertSafeUrl', () => {
  const resolvesTo = (address: string) => async () => address

  it('allows a public https URL', async () => {
    const safe = await assertSafeUrl('https://example.test/hook', resolvesTo('93.184.216.34'))

    expect(safe.url.hostname).toBe('example.test')
    expect(safe.address).toBe('93.184.216.34')
  })

  it.each([['ftp://example.test'], ['file:///etc/passwd'], ['gopher://example.test']])(
    'refuses the scheme in %s',
    async (raw) => {
      await expect(assertSafeUrl(raw, resolvesTo('93.184.216.34'))).rejects.toThrow(ValidationError)
    },
  )

  it('refuses a malformed URL', async () => {
    await expect(assertSafeUrl('not a url', resolvesTo('8.8.8.8'))).rejects.toThrow(ValidationError)
  })

  it('refuses a literal private address without a lookup', async () => {
    await expect(
      assertSafeUrl('http://169.254.169.254/latest/meta-data/', async () => {
        throw new Error('DNS should not have been consulted')
      }),
    ).rejects.toThrow(/may not be requested/)
  })

  /** The reason the check is on the resolved address, not the hostname. */
  it('refuses a public hostname that resolves somewhere private', async () => {
    await expect(
      assertSafeUrl('https://totally-innocent.test/', resolvesTo('127.0.0.1')),
    ).rejects.toThrow(/may not be requested/)
  })

  it('refuses a hostname that will not resolve', async () => {
    await expect(
      assertSafeUrl('https://nowhere.test/', async () => {
        throw new Error('ENOTFOUND')
      }),
    ).rejects.toThrow(/could not be resolved/)
  })

  it('says nothing about the topology it is protecting', async () => {
    await expect(assertSafeUrl('http://10.0.0.5/', resolvesTo('10.0.0.5'))).rejects.toThrow(
      /^That URL resolves to an address that may not be requested$/,
    )
  })

  it('handles a bracketed IPv6 literal', async () => {
    await expect(assertSafeUrl('http://[::1]:8080/', resolvesTo('::1'))).rejects.toThrow(
      ValidationError,
    )
  })
})
