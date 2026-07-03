import { describe, expect, it } from 'vitest'

import { fmt, sameAddress } from './format'

describe('sameAddress', () => {
  it('matches across checksum and lowercase forms', () => {
    expect(
      sameAddress('0x27f6c8289550fCE67f6B50BeD1F519966aFE5287', '0x27f6c8289550fce67f6b50bed1f519966afe5287'),
    ).toBe(true)
  })

  it('is false, not a throw, for missing or malformed inputs', () => {
    expect(sameAddress(null, '0x27f6c8289550fCE67f6B50BeD1F519966aFE5287')).toBe(false)
    expect(sameAddress('', '')).toBe(false)
    expect(sameAddress('not-an-address', '0x27f6c8289550fCE67f6B50BeD1F519966aFE5287')).toBe(false)
  })
})

describe('fmt', () => {
  it('renders WAD amounts with trimmed decimals', () => {
    expect(fmt(10n ** 18n)).toBe('1')
    expect(fmt(1_234_567_890_000_000_000n)).toBe('1.2345')
    expect(fmt(1_234_567_890_000_000_000n, 6)).toBe('1.234567')
  })
})
