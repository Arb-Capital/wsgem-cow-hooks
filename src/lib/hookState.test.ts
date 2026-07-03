import { decodeFunctionData, zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  APPROVAL_BUFFER_BPS,
  DEFAULT_SLIPPAGE_BPS,
  HOOK_HELPER,
  TGBP,
  UNWRAP_GAS_LIMIT,
  WAD,
  WRAP_GAS_LIMIT,
} from '../config'
import { HELPER_ABI } from './abi'
import { computeUnwrap, computeWrap } from './hookMath'
import { buildUnwrapHook, buildWrapHook, deriveHookState, type HookInputs } from './hookState'

// Live values read from wstGBP on mainnet (2026-07-03), same as the hookMath suite.
const MINTCOST = 1004704843697302403n
const BURNCOST = 1002193081588059147n

// Digit-only addresses so checksum casing can't differ between what we pass in and what viem
// returns from decodeFunctionData.
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address

const SELL_AMOUNT = 100n * WAD // pre-hook: order sells 100 tGBP
const BUY_AMOUNT = 100n * WAD // post-hook: order buys 100 tGBP

// The reference sizings the derivation must reproduce (hookMath itself is tested separately).
const WRAP = computeWrap(BUY_AMOUNT, MINTCOST, DEFAULT_SLIPPAGE_BPS, APPROVAL_BUFFER_BPS)!
const UNWRAP = computeUnwrap(SELL_AMOUNT, BURNCOST, DEFAULT_SLIPPAGE_BPS)!

function preHookInputs(over: Partial<HookInputs> = {}, order: Partial<HookInputs['order']> = {}): HookInputs {
  return {
    isPreHook: true,
    account: ACCOUNT,
    mintcost: MINTCOST,
    burncost: BURNCOST,
    allowance: null,
    balance: null,
    ...over,
    order:
      over.order !== undefined
        ? over.order
        : {
            sellTokenAddress: TGBP,
            buyTokenAddress: OTHER,
            sellAmount: SELL_AMOUNT.toString(),
            buyAmount: (99n * WAD).toString(),
            kind: 'sell',
            receiver: '',
            ...order,
          },
  }
}

function postHookInputs(over: Partial<HookInputs> = {}, order: Partial<HookInputs['order']> = {}): HookInputs {
  return {
    isPreHook: false,
    account: ACCOUNT,
    mintcost: MINTCOST,
    burncost: BURNCOST,
    allowance: null,
    balance: null,
    ...over,
    order:
      over.order !== undefined
        ? over.order
        : {
            sellTokenAddress: OTHER,
            buyTokenAddress: TGBP,
            sellAmount: (101n * WAD).toString(),
            buyAmount: BUY_AMOUNT.toString(),
            kind: 'sell',
            receiver: '',
            ...order,
          },
  }
}

describe('deriveHookState — post-hook (wrap) sizing and guards', () => {
  it('sizes the wrap from buyAmount and requires the buffered approval', () => {
    const s = deriveHookState(postHookInputs())
    expect(s.wrap).toEqual(WRAP)
    expect(s.unwrap).toBeNull()
    expect(s.active).toEqual(WRAP)
    expect(s.requiredApproval).toBe(WRAP.approvalNeeded)
  })

  it('sizes buy-kind orders too — only the pre-hook needs an exact sell amount', () => {
    const s = deriveHookState(postHookInputs({}, { kind: 'buy' }))
    expect(s.wrap).toEqual(WRAP)
    expect(s.buyKindBlocked).toBe(false)
  })

  it('is inactive when the order does not buy tGBP', () => {
    const s = deriveHookState(postHookInputs({}, { buyTokenAddress: OTHER }))
    expect(s.active).toBeNull()
    expect(s.requiredApproval).toBeUndefined()
    expect(s.approved).toBe(false)
    expect(s.overApproved).toBe(false)
  })

  it('matches the tGBP buy token case-insensitively', () => {
    const s = deriveHookState(postHookInputs({}, { buyTokenAddress: TGBP.toLowerCase() }))
    expect(s.wrap).toEqual(WRAP)
  })

  it('is inactive without an order, a price, or a positive buyAmount', () => {
    expect(deriveHookState(postHookInputs({ order: null })).active).toBeNull()
    expect(deriveHookState(postHookInputs({ mintcost: null })).active).toBeNull()
    expect(deriveHookState(postHookInputs({ mintcost: 0n })).active).toBeNull()
    expect(deriveHookState(postHookInputs({}, { buyAmount: '0' })).active).toBeNull()
  })

  it('never computes a wrap while in pre-hook position, even for a tGBP buy', () => {
    const s = deriveHookState(preHookInputs({}, { buyTokenAddress: TGBP }))
    expect(s.wrap).toBeNull()
  })

  it('gates approval exactly at the buffered amount', () => {
    const at = (allowance: bigint | null) => deriveHookState(postHookInputs({ allowance }))
    expect(at(null).approved).toBe(false)
    expect(at(null).overApproved).toBe(false)
    expect(at(WRAP.approvalNeeded - 1n).approved).toBe(false)
    expect(at(WRAP.approvalNeeded - 1n).overApproved).toBe(false)
    expect(at(WRAP.approvalNeeded).approved).toBe(true)
    expect(at(WRAP.approvalNeeded).overApproved).toBe(false)
    expect(at(WRAP.approvalNeeded + 1n).approved).toBe(true)
    expect(at(WRAP.approvalNeeded + 1n).overApproved).toBe(true)
  })

  it('is always funded — the wrap sweeps whatever settlement delivers', () => {
    expect(deriveHookState(postHookInputs({ balance: null })).funded).toBe(true)
    expect(deriveHookState(postHookInputs({ balance: 0n })).funded).toBe(true)
  })
})

describe('deriveHookState — pre-hook (unwrap) sizing and guards', () => {
  it('sizes the redeem from the exact sellAmount and requires approval of amountIn', () => {
    const s = deriveHookState(preHookInputs())
    expect(s.unwrap).toEqual(UNWRAP)
    expect(s.wrap).toBeNull()
    expect(s.active).toEqual(UNWRAP)
    expect(s.requiredApproval).toBe(UNWRAP.amountIn)
    // README invariant: minAmountOut is the order's exact sell amount, never less.
    expect(s.unwrap!.needed).toBe(SELL_AMOUNT)
  })

  it('blocks buy-kind orders that sell tGBP with the dedicated notice', () => {
    const s = deriveHookState(preHookInputs({}, { kind: 'buy' }))
    expect(s.unwrap).toBeNull()
    expect(s.active).toBeNull()
    expect(s.buyKindBlocked).toBe(true)
  })

  it('treats a wrong sell token as inactive, not buy-kind-blocked', () => {
    const s = deriveHookState(preHookInputs({}, { sellTokenAddress: OTHER, kind: 'buy' }))
    expect(s.active).toBeNull()
    expect(s.buyKindBlocked).toBe(false)
  })

  it('matches the tGBP sell token case-insensitively', () => {
    const s = deriveHookState(preHookInputs({}, { sellTokenAddress: TGBP.toLowerCase() }))
    expect(s.unwrap).toEqual(UNWRAP)
  })

  it('is inactive without an order, a price, or a positive sellAmount', () => {
    expect(deriveHookState(preHookInputs({ order: null })).active).toBeNull()
    expect(deriveHookState(preHookInputs({ order: null })).buyKindBlocked).toBe(false)
    expect(deriveHookState(preHookInputs({ burncost: null })).active).toBeNull()
    expect(deriveHookState(preHookInputs({ burncost: 0n })).active).toBeNull()
    expect(deriveHookState(preHookInputs({}, { sellAmount: '0' })).active).toBeNull()
  })

  it('gates approval exactly at the buffered redeem input', () => {
    const at = (allowance: bigint | null) => deriveHookState(preHookInputs({ allowance }))
    expect(at(null).approved).toBe(false)
    expect(at(UNWRAP.amountIn - 1n).approved).toBe(false)
    expect(at(UNWRAP.amountIn - 1n).overApproved).toBe(false)
    expect(at(UNWRAP.amountIn).approved).toBe(true)
    expect(at(UNWRAP.amountIn).overApproved).toBe(false)
  })

  it('flags a stale oversized wstGBP approval (public helper — anyone can force-redeem the excess)', () => {
    // Regression: overApproved was post-hook-only, silently accepting stale pre-hook approvals.
    const s = deriveHookState(preHookInputs({ allowance: UNWRAP.amountIn + 1n }))
    expect(s.approved).toBe(true)
    expect(s.overApproved).toBe(true)
  })

  it('gates funding exactly at the redeem input', () => {
    const at = (balance: bigint | null) => deriveHookState(preHookInputs({ balance })).funded
    expect(at(null)).toBe(false)
    expect(at(UNWRAP.amountIn - 1n)).toBe(false)
    expect(at(UNWRAP.amountIn)).toBe(true)
    expect(at(UNWRAP.amountIn + 1n)).toBe(true)
  })

  it('is not funded when inactive, whatever the balance', () => {
    const s = deriveHookState(preHookInputs({ balance: 10n ** 30n }, { sellTokenAddress: OTHER }))
    expect(s.funded).toBe(false)
  })
})

describe('deriveHookState — receiver guard', () => {
  it('accepts missing, empty, own-account, and zero-address receivers on the post-hook', () => {
    for (const receiver of [undefined, null, '', ACCOUNT, ACCOUNT.toLowerCase(), zeroAddress]) {
      const s = deriveHookState(postHookInputs({}, { receiver }))
      expect(s.receiverMismatch).toBe(false)
    }
  })

  it('rejects a custom recipient on the post-hook', () => {
    expect(deriveHookState(postHookInputs({}, { receiver: OTHER })).receiverMismatch).toBe(true)
  })

  it('rejects a custom recipient even when no account is connected', () => {
    const s = deriveHookState(postHookInputs({ account: undefined }, { receiver: OTHER }))
    expect(s.receiverMismatch).toBe(true)
  })

  it('never fires for the pre-hook — proceeds routing does not affect the unwrap', () => {
    expect(deriveHookState(preHookInputs({}, { receiver: OTHER })).receiverMismatch).toBe(false)
  })
})

describe('buildUnwrapHook / buildWrapHook — encoded payloads', () => {
  it('encodes unwrap(owner, amountIn, needed) with the order-exact minAmountOut', () => {
    const hook = buildUnwrapHook(ACCOUNT, UNWRAP)
    expect(hook.target).toBe(HOOK_HELPER)
    expect(hook.gasLimit).toBe(UNWRAP_GAS_LIMIT)
    const { functionName, args } = decodeFunctionData({ abi: HELPER_ABI, data: hook.callData })
    expect(functionName).toBe('unwrap')
    expect(args).toEqual([ACCOUNT, UNWRAP.amountIn, SELL_AMOUNT])
  })

  it('encodes wrapAll(owner, minAmountOut) with the slippage-guarded minimum', () => {
    const hook = buildWrapHook(ACCOUNT, WRAP)
    expect(hook.target).toBe(HOOK_HELPER)
    expect(hook.gasLimit).toBe(WRAP_GAS_LIMIT)
    const { functionName, args } = decodeFunctionData({ abi: HELPER_ABI, data: hook.callData })
    expect(functionName).toBe('wrapAll')
    expect(args).toEqual([ACCOUNT, WRAP.minOut])
  })

  it('round-trips end to end: derived state encodes the same payload the UI would add', () => {
    const s = deriveHookState(preHookInputs({ allowance: UNWRAP.amountIn, balance: UNWRAP.amountIn }))
    expect(s.approved && s.funded && !s.overApproved).toBe(true)
    const { args } = decodeFunctionData({
      abi: HELPER_ABI,
      data: buildUnwrapHook(ACCOUNT, s.unwrap!).callData,
    })
    expect(args).toEqual([ACCOUNT, s.requiredApproval, SELL_AMOUNT])
  })
})
