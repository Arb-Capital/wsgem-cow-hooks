import { isAddress, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { CHAINS } from './chains'
import { BPS } from './lib/hookMath'
import { resolveVenue, VENUES } from './venues'

// Static-file/manifest sync (entry HTML, manifest id uniqueness, name/chain match) is enforced at
// build time in vite.config.ts; this suite covers the invariants of the config values themselves.
describe('VENUES config invariants', () => {
  const entries = Object.entries(VENUES)

  it('has at least one venue', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('%s: slug matches its key and is URL-safe', (key, venue) => {
    expect(venue.slug).toBe(key)
    expect(venue.slug).toMatch(/^[a-z0-9-]+$/)
  })

  it.each(entries)('%s: addresses are valid and distinct', (_key, venue) => {
    for (const addr of [venue.base.address, venue.wrapped.address]) {
      expect(isAddress(addr)).toBe(true)
      expect(addr).not.toBe(zeroAddress)
    }
    // helper may be zeroAddress (venue disabled) but must still be well-formed
    expect(isAddress(venue.helper)).toBe(true)
    expect(venue.base.address.toLowerCase()).not.toBe(venue.wrapped.address.toLowerCase())
    if (venue.helper !== zeroAddress) {
      expect(venue.helper.toLowerCase()).not.toBe(venue.base.address.toLowerCase())
      expect(venue.helper.toLowerCase()).not.toBe(venue.wrapped.address.toLowerCase())
    }
  })

  it.each(entries)('%s: chainId has a viem chain (CoW-supported network)', (_key, venue) => {
    expect(CHAINS[venue.chainId]).toBeDefined()
    expect(venue.chainLabel.length).toBeGreaterThan(0)
  })

  it.each(entries)('%s: bps parameters are sane', (_key, venue) => {
    expect(venue.slippageBps).toBeGreaterThan(0n)
    expect(venue.slippageBps).toBeLessThan(BPS)
    expect(venue.approvalBufferBps).toBeGreaterThan(0n)
    expect(venue.approvalBufferBps).toBeLessThan(BPS)
  })

  it.each(entries)('%s: gas limits are positive decimal strings', (_key, venue) => {
    for (const limit of [venue.wrapGasLimit, venue.unwrapGasLimit]) {
      expect(limit).toMatch(/^[1-9][0-9]*$/)
      expect(BigInt(limit)).toBeGreaterThanOrEqual(100_000n)
    }
  })

  it.each(entries)('%s: token symbols are set', (_key, venue) => {
    expect(venue.base.symbol.length).toBeGreaterThan(0)
    expect(venue.wrapped.symbol.length).toBeGreaterThan(0)
    expect(venue.base.symbol).not.toBe(venue.wrapped.symbol)
  })
})

describe('resolveVenue', () => {
  it('matches a venue at the domain root', () => {
    expect(resolveVenue('/wstgbp/')?.slug).toBe('wstgbp')
    expect(resolveVenue('/wstgbp')?.slug).toBe('wstgbp')
    expect(resolveVenue('/wstgbp/index.html')?.slug).toBe('wstgbp')
  })

  it('does not match under a path prefix — the app deploys at the domain root only', () => {
    expect(resolveVenue('/hooks/wstgbp/')).toBeNull()
  })

  it('returns null for the root landing and unknown paths', () => {
    expect(resolveVenue('/')).toBeNull()
    expect(resolveVenue('')).toBeNull()
    expect(resolveVenue('/nope/')).toBeNull()
  })
})
