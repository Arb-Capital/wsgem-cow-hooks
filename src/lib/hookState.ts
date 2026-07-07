import { encodeFunctionData, zeroAddress, type Address } from 'viem'

import type { VenueConfig } from '../venues'
import { HELPER_ABI } from './abi'
import { sameAddress } from './format'
import { computeUnwrap, computeWrap } from './hookMath'

/** The slice of CoW's order params the derivation reads — structurally compatible with
 *  `HookDappContext['orderParams']`. */
export interface OrderShape {
  sellTokenAddress: string
  buyTokenAddress: string
  sellAmount: string
  buyAmount: string
  kind: string
  receiver?: string | null
}

/** Decimal string → bigint; null (never throws) for malformed parent-supplied amounts. Strict
 *  base-10 on purpose — `BigInt()` would accept '' (as 0) and '0x…' (as hex). */
function toBigInt(s: string): bigint | null {
  return /^[0-9]+$/.test(s) ? BigInt(s) : null
}

export interface HookInputs {
  venue: VenueConfig
  isPreHook: boolean
  order: OrderShape | null
  account: Address | undefined
  mintcost: bigint | null
  burncost: bigint | null
  allowance: bigint | null
  balance: bigint | null
}

/**
 * Everything the UI decides from chain reads + order params, as a pure function so the gating
 * (approval bounds, funding, order-shape guards) is unit-testable away from React and the iframe.
 */
export function deriveHookState({
  venue,
  isPreHook,
  order,
  account,
  mintcost,
  burncost,
  allowance,
  balance,
}: HookInputs) {
  const base = venue.base.address

  // Order amounts arrive as parent-supplied strings; a malformed one derives "inactive" rather
  // than throwing out of the render.
  const buyAmount = order ? toBigInt(order.buyAmount) : null
  const sellAmount = order ? toBigInt(order.sellAmount) : null

  // Pre-hook = unwrap the wrapped token to fund a base-token sell; post-hook = wrap bought base
  // tokens into the wrapped token.
  const wrap =
    !isPreHook && buyAmount !== null && mintcost && order && sameAddress(order.buyTokenAddress, base)
      ? computeWrap(buyAmount, mintcost, venue.slippageBps, venue.approvalBufferBps)
      : null

  // Buy-kind orders only bound the sell side (sellAmount is a maximum, not the fill), so sizing
  // the redeem from it would over-convert; the pre-hook needs an exact sell amount.
  const unwrap =
    isPreHook && sellAmount !== null && burncost && order && sameAddress(order.sellTokenAddress, base) && order.kind === 'sell'
      ? computeUnwrap(sellAmount, burncost, venue.slippageBps)
      : null

  // A pre-hook order that sells the base token but is buy-kind gets its own explanation in the UI
  // (switch the order type) rather than the generic wrong-token notice.
  const buyKindBlocked =
    isPreHook && order !== null && order.kind !== 'sell' && sameAddress(order.sellTokenAddress, base)

  const active = isPreHook ? unwrap : wrap
  const requiredApproval = isPreHook ? unwrap?.amountIn : wrap?.approvalNeeded
  const approved =
    allowance !== null && requiredApproval !== undefined && allowance >= requiredApproval
  const funded = !isPreHook || (balance !== null && unwrap !== null && balance >= unwrap.amountIn)

  // A stale allowance above this order's cap breaks the bounded-per-order approval model on both
  // sides: wrapAll sweeps min(balance, allowance), so the excess would let the sweep pull
  // previously held base tokens; and the helper is publicly callable with a caller-supplied
  // amountIn, so an oversized wrapped-token approval lets anyone force-redeem more than this
  // order's unwrap needs. Force it back down before the hook can be added.
  const overApproved =
    allowance !== null && requiredApproval !== undefined && allowance > requiredApproval

  // The post-hook wraps base tokens delivered to the connected wallet; with a custom recipient the
  // proceeds land elsewhere and the sweep would revert (or grab unrelated funds). Zero/empty
  // receiver means "deliver to owner" in CoW's order model.
  const receiverMismatch =
    !isPreHook &&
    !!order?.receiver &&
    !sameAddress(order.receiver, account) &&
    !sameAddress(order.receiver, zeroAddress)

  return {
    wrap,
    unwrap,
    active,
    requiredApproval,
    approved,
    funded,
    overApproved,
    receiverMismatch,
    buyKindBlocked,
  }
}

/** Pre-hook payload: redeem an explicit amountIn; minAmountOut is pinned to the order's exact sell
 *  amount — if the redeem can't fund the order, the hook (and so the order) must not proceed. */
export function buildUnwrapHook(
  venue: VenueConfig,
  account: Address,
  unwrap: { amountIn: bigint; needed: bigint },
) {
  return {
    target: venue.helper,
    callData: encodeFunctionData({
      abi: HELPER_ABI,
      functionName: 'unwrap',
      args: [account, unwrap.amountIn, unwrap.needed],
    }),
    gasLimit: venue.unwrapGasLimit,
  }
}

/** Post-hook payload: sweep min(balance, allowance) into the wrapped token with a slippage-guarded
 *  minimum. */
export function buildWrapHook(venue: VenueConfig, account: Address, wrap: { minOut: bigint }) {
  return {
    target: venue.helper,
    callData: encodeFunctionData({
      abi: HELPER_ABI,
      functionName: 'wrapAll',
      args: [account, wrap.minOut],
    }),
    gasLimit: venue.wrapGasLimit,
  }
}
