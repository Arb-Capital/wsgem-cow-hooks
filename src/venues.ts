import type { Address } from 'viem'

// Only type-imports from viem here: vite.config.ts imports this module at build time to derive the
// multi-page inputs and validate venue files, so keep it dependency-light.

export interface TokenInfo {
  address: Address
  symbol: string
}

/**
 * One venue = one wrapped/base token pair plus its owner-bound helper, served as its own CoW hook
 * dapp at `/<slug>/` (own manifest.json, own Hook Store entry).
 *
 * Hard assumptions every venue must satisfy (see docs/configuration.md):
 *  - both tokens are 18-decimals — the sizing math (lib/hookMath) and formatting (lib/format) are
 *    WAD-fixed;
 *  - the wrapped token exposes `mintcost()`/`burncost()` returning WAD base-per-wrapped prices
 *    (lib/abi WRAPPER_PRICE_ABI);
 *  - the helper implements `wrapAll(owner, minAmountOut)` / `unwrap(owner, amountIn, minAmountOut)`
 *    (lib/abi HELPER_ABI) and is owner-bound: callable by anyone, pulls at most the owner's
 *    allowance, pays output only to the owner.
 */
export interface VenueConfig {
  /** URL path segment and VENUES key. Lowercase [a-z0-9-]; changing it breaks deployed URLs. */
  slug: string
  /** Display name — must match `cow_hook_dapp.name` in public/<slug>/manifest.json (build-checked). */
  name: string
  chainId: number
  /** Human chain name for UI notices ("switch network"), e.g. "Ethereum mainnet". */
  chainLabel: string
  /** The unwrapped token the order sells/buys (e.g. tGBP). */
  base: TokenInfo
  /** The wrapped token the hook mints/redeems (e.g. wstGBP). */
  wrapped: TokenInfo
  /** Owner-bound hook helper. Zero address disables the venue (renders a "not deployed" notice). */
  helper: Address
  /** Hook gas limits as decimal strings — measure on fork tests, then add margin. */
  wrapGasLimit: string
  unwrapGasLimit: string
  /** Slippage guard (bps) applied to minAmountOut (wrap) / redeem input (unwrap). */
  slippageBps: bigint
  /** Post-hook approval buffer (bps) over buyAmount so the sweep captures order surplus. */
  approvalBufferBps: bigint
}

export const VENUES: Record<string, VenueConfig> = {
  wstgbp: {
    slug: 'wstgbp',
    name: 'wstGBP Wrap/Unwrap',
    chainId: 1,
    chainLabel: 'Ethereum mainnet',
    base: { address: '0x27f6c8289550fCE67f6B50BeD1F519966aFE5287', symbol: 'tGBP' },
    wrapped: { address: '0x57C3571f10767E49C9d7b60feb6c67804783B7aE', symbol: 'wstGBP' },
    // WsgemHookHelper — deployed 2026-07-03 (block 25453990), Etherscan-verified.
    helper: '0x4F93a2E29B0AA75875Ab922d780B6dc59b415B6A',
    // Fork-test measurements: wrapAll ~177k, unwrap ~250k cold, plus margin.
    wrapGasLimit: '250000',
    unwrapGasLimit: '300000',
    // The wstGBP oracle ratchets slowly (weekly NAV steps, ~25bps mint/burn spread); 50bps absorbs
    // a ratchet between signing and execution.
    slippageBps: 50n,
    approvalBufferBps: 200n,
  },
}

/**
 * Match a venue from the first URL path segment (/wstgbp/…). Null for the root landing page or an
 * unknown path. Strictly first-segment on purpose: the app is only deployable at the domain root
 * (entry HTML, manifests, and Vite's emitted asset links are all root-absolute), so a prefixed
 * path like /hooks/wstgbp/ must not resolve — it would render a venue whose assets and manifest
 * 404. See README "Deploy".
 */
export function resolveVenue(pathname: string): VenueConfig | null {
  const first = pathname.split('/').find(Boolean)
  return (first && VENUES[first]) || null
}
