import { describe, expect, it } from 'vitest'

import { ceilDiv } from './format'
import { BPS, computeUnwrap, computeWrap, WAD } from './hookMath'

// Live values read from wstGBP on mainnet (2026-07-03) — WAD-scaled tGBP-per-wstGBP, mintcost above
// burncost by the ~25bps spread. The suite uses them so the math is exercised at real oracle scale.
const MINTCOST = 1004704843697302403n
const BURNCOST = 1002193081588059147n
const SLIPPAGE = 50n
const BUFFER = 200n

const GBP = WAD // 1 tGBP (18 decimals)
const PENNY = WAD / 100n

describe('computeWrap (post-hook sizing)', () => {
  it('keeps the slippage guard non-zero for every economically real order size', () => {
    // Review regression: floor division only zeroes minOut for orders of a couple of wei — at any
    // real size (down to well below a penny) the wrap always ships a positive minAmountOut.
    for (const proceeds of [3n, 1_000n, PENNY / 10n ** 10n, PENNY, GBP, 12_345n * GBP]) {
      const w = computeWrap(proceeds, MINTCOST, SLIPPAGE, BUFFER)
      expect(w).not.toBeNull()
      expect(w!.minOut).toBeGreaterThan(0n)
      expect(w!.minOut).toBeLessThanOrEqual(w!.expectedOut)
    }
  })

  it('pins the known dust edge: the guard only vanishes at 1-2 wei of tGBP', () => {
    // proceeds*WAD < mintcost  =>  expectedOut floors to 0; this documents (not fixes) that the
    // only unguarded wraps are sub-wei-of-a-penny dust with no economic value.
    expect(computeWrap(1n, MINTCOST, SLIPPAGE, BUFFER)!.minOut).toBe(0n)
    expect(computeWrap(2n, MINTCOST, SLIPPAGE, BUFFER)!.minOut).toBe(0n)
    expect(computeWrap(3n, MINTCOST, SLIPPAGE, BUFFER)!.minOut).toBeGreaterThan(0n)
  })

  it('applies the exact approval buffer', () => {
    const w = computeWrap(GBP, MINTCOST, SLIPPAGE, BUFFER)!
    expect(w.approvalNeeded).toBe((GBP * (BPS + BUFFER)) / BPS)
    expect(w.approvalNeeded).toBeGreaterThan(w.proceeds)
  })

  it('rejects empty or degenerate inputs', () => {
    expect(computeWrap(0n, MINTCOST, SLIPPAGE, BUFFER)).toBeNull()
    expect(computeWrap(GBP, 0n, SLIPPAGE, BUFFER)).toBeNull()
  })
})

describe('computeUnwrap (pre-hook sizing)', () => {
  it('always redeems enough to cover the sell amount (price-orientation regression)', () => {
    // Review regression: mintcost/burncost are tGBP-per-wstGBP, verified on-chain. With that
    // orientation, ceil rounding alone (before the buffer) must cover the claim exactly.
    for (const needed of [1n, 100n, PENNY, GBP, 987_654n * GBP + 1n]) {
      const u = computeUnwrap(needed, BURNCOST, SLIPPAGE)!
      expect((u.exactIn * BURNCOST) / WAD).toBeGreaterThanOrEqual(needed)
      expect(u.expectedOut).toBeGreaterThanOrEqual(needed)
      expect(u.amountIn).toBeGreaterThanOrEqual(u.exactIn)
    }
  })

  it('adds a strictly positive slippage buffer for any redeem of 200 wei or more', () => {
    // Review regression: the 0.5% input buffer only rounds away below exactIn = BPS/SLIPPAGE = 200
    // wei of wstGBP — pure dust at 18 decimals.
    for (const needed of [250n, PENNY, GBP, 10n ** 6n * GBP]) {
      const u = computeUnwrap(needed, BURNCOST, SLIPPAGE)!
      expect(u.amountIn).toBeGreaterThan(u.exactIn)
    }
  })

  it('pins the known dust edge: below 200 wei the buffer rounds to nothing', () => {
    const u = computeUnwrap(100n, BURNCOST, SLIPPAGE)!
    expect(u.amountIn).toBe(u.exactIn)
  })

  it('rejects empty or degenerate inputs', () => {
    expect(computeUnwrap(0n, BURNCOST, SLIPPAGE)).toBeNull()
    expect(computeUnwrap(GBP, 0n, SLIPPAGE)).toBeNull()
  })
})

describe('ceilDiv', () => {
  it('rounds up minimally', () => {
    expect(ceilDiv(10n, 5n)).toBe(2n)
    expect(ceilDiv(11n, 5n)).toBe(3n)
    for (const [a, b] of [
      [1n, 3n],
      [GBP, BURNCOST],
      [7n * GBP + 13n, MINTCOST],
    ] as const) {
      const q = ceilDiv(a, b)
      expect(q * b).toBeGreaterThanOrEqual(a)
      expect((q - 1n) * b).toBeLessThan(a)
    }
  })
})
