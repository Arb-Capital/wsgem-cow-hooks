import { encodeFunctionData, zeroAddress, type Address } from 'viem'

import {
  APPROVAL_BUFFER_BPS,
  DEFAULT_SLIPPAGE_BPS,
  HOOK_HELPER,
  TGBP,
  UNWRAP_GAS_LIMIT,
  WRAP_GAS_LIMIT,
} from '../config'
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

export interface HookInputs {
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
  isPreHook,
  order,
  account,
  mintcost,
  burncost,
  allowance,
  balance,
}: HookInputs) {
  // Pre-hook = unwrap wstGBP to fund a tGBP sell; post-hook = wrap bought tGBP into wstGBP.
  const wrap =
    !isPreHook && order && mintcost && sameAddress(order.buyTokenAddress, TGBP)
      ? computeWrap(BigInt(order.buyAmount), mintcost, DEFAULT_SLIPPAGE_BPS, APPROVAL_BUFFER_BPS)
      : null

  // Buy-kind orders only bound the sell side (sellAmount is a maximum, not the fill), so sizing
  // the redeem from it would over-convert; the pre-hook needs an exact sell amount.
  const unwrap =
    isPreHook && order && burncost && sameAddress(order.sellTokenAddress, TGBP) && order.kind === 'sell'
      ? computeUnwrap(BigInt(order.sellAmount), burncost, DEFAULT_SLIPPAGE_BPS)
      : null

  // A pre-hook order that sells tGBP but is buy-kind gets its own explanation in the UI (switch the
  // order type) rather than the generic wrong-token notice.
  const buyKindBlocked =
    isPreHook && order !== null && order.kind !== 'sell' && sameAddress(order.sellTokenAddress, TGBP)

  const active = isPreHook ? unwrap : wrap
  const requiredApproval = isPreHook ? unwrap?.amountIn : wrap?.approvalNeeded
  const approved =
    allowance !== null && requiredApproval !== undefined && allowance >= requiredApproval
  const funded = !isPreHook || (balance !== null && unwrap !== null && balance >= unwrap.amountIn)

  // A stale allowance above this order's cap breaks the bounded-per-order approval model on both
  // sides: wrapAll sweeps min(balance, allowance), so the excess would let the sweep pull previously
  // held tGBP; and the helper is publicly callable with a caller-supplied amountIn, so an oversized
  // wstGBP approval lets anyone force-redeem more than this order's unwrap needs. Force it back down
  // before the hook can be added.
  const overApproved =
    allowance !== null && requiredApproval !== undefined && allowance > requiredApproval

  // The post-hook wraps tGBP delivered to the connected wallet; with a custom recipient the proceeds
  // land elsewhere and the sweep would revert (or grab unrelated funds). Zero/empty receiver means
  // "deliver to owner" in CoW's order model.
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
export function buildUnwrapHook(account: Address, unwrap: { amountIn: bigint; needed: bigint }) {
  return {
    target: HOOK_HELPER,
    callData: encodeFunctionData({
      abi: HELPER_ABI,
      functionName: 'unwrap',
      args: [account, unwrap.amountIn, unwrap.needed],
    }),
    gasLimit: UNWRAP_GAS_LIMIT,
  }
}

/** Post-hook payload: sweep min(balance, allowance) into wstGBP with a slippage-guarded minimum. */
export function buildWrapHook(account: Address, wrap: { minOut: bigint }) {
  return {
    target: HOOK_HELPER,
    callData: encodeFunctionData({
      abi: HELPER_ABI,
      functionName: 'wrapAll',
      args: [account, wrap.minOut],
    }),
    gasLimit: WRAP_GAS_LIMIT,
  }
}
