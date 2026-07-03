import type { Address } from 'viem'

// Mainnet addresses for the tGBP/wstGBP system. See the Solidity repo (wstGBP-univ4-hook) for the
// contracts; the helper is the only hook target — it is owner-bound (funds flow only owner -> owner).
export const CHAIN_ID = 1

export const TGBP: Address = '0x27f6c8289550fCE67f6B50BeD1F519966aFE5287'
export const WSTGBP: Address = '0x57C3571f10767E49C9d7b60feb6c67804783B7aE'

// WsgemHookHelper — deployed 2026-07-03 (block 25453990), Etherscan-verified.
// Set to the zero address to disable the dapp (e.g. ahead of a redeploy).
export const HOOK_HELPER: Address = '0x4F93a2E29B0AA75875Ab922d780B6dc59b415B6A'

// Gas limits measured on fork tests (wrapAll ~177k, unwrap ~250k cold) plus margin.
export const WRAP_GAS_LIMIT = '250000'
export const UNWRAP_GAS_LIMIT = '300000'

// Default slippage guard on minAmountOut, in basis points. The wstGBP oracle ratchets slowly (weekly
// NAV steps, ~25bps mint/burn spread), so 50bps absorbs a ratchet between signing and execution.
export const DEFAULT_SLIPPAGE_BPS = 50n

// Post-hook approvals: proceeds can exceed `buyAmount` (order surplus). Approve a little extra so the
// sweep (min(balance, allowance)) captures surplus too — up to this buffer; anything beyond it stays
// unwrapped, and unused allowance stays approved-but-unspent and can be revoked.
export const APPROVAL_BUFFER_BPS = 200n

export const WAD = 10n ** 18n
