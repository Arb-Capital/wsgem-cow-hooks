import { ceilDiv } from './format'

export const BPS = 10_000n
export const WAD = 10n ** 18n

/**
 * Post-hook (wrap) sizing: the order buys the base token; proceeds >= buyAmount (surplus). The
 * approval is a buffered amount so the helper's min(balance, allowance) sweep captures surplus too,
 * and minAmountOut comes from buyAmount at the live mintcost (WAD base-per-wrapped) with a slippage
 * guard.
 */
export function computeWrap(proceeds: bigint, mintcost: bigint, slippageBps: bigint, bufferBps: bigint) {
  if (proceeds <= 0n || mintcost <= 0n) return null
  const expectedOut = (proceeds * WAD) / mintcost
  const minOut = (expectedOut * (BPS - slippageBps)) / BPS
  const approvalNeeded = (proceeds * (BPS + bufferBps)) / BPS
  return { proceeds, expectedOut, minOut, approvalNeeded }
}

/**
 * Pre-hook (unwrap) sizing: redeem enough of the wrapped token to cover the order's exact
 * sellAmount at the live burncost (WAD base-per-wrapped), with a slippage buffer on the input.
 * minAmountOut is the sell amount itself — if the redeem cannot fund the order, the hook (and so
 * the order) must not proceed.
 */
export function computeUnwrap(needed: bigint, burncost: bigint, slippageBps: bigint) {
  if (needed <= 0n || burncost <= 0n) return null
  const exactIn = ceilDiv(needed * WAD, burncost)
  const amountIn = (exactIn * (BPS + slippageBps)) / BPS
  return { needed, exactIn, amountIn, expectedOut: (amountIn * burncost) / WAD }
}
