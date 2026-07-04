# Venue configuration reference

Every venue is a `VenueConfig` entry in `src/venues.ts` — the single source of truth the app,
build, and tests all read. `vite.config.ts` validates the static companions at build/dev-start;
`src/venues.test.ts` validates the values themselves. This document explains what each field
controls and how to choose it.

For the step-by-step process of adding a venue, see [adding-a-venue.md](./adding-a-venue.md).

## Identity

### `slug`

The URL path segment (`https://<domain>/<slug>/`) and the `VENUES` key (build-checked equal).
Lowercase `[a-z0-9-]` only.

**Choosing it:** the wrapped token's symbol, lowercased (`wstgbp`). **Changing it later is a
breaking change**: the deployed URL is what users saved in My Custom Hooks and what the Hook Store
registry points at. Treat it as immutable once deployed.

### `name`

Display name; must byte-match `cow_hook_dapp.name` in `public/<slug>/manifest.json`
(build-checked), and should match the Hook Store registry entry. Used in the UI's "not deployed
yet" notice.

## Chain

### `chainId` / `chainLabel`

`chainId` gates everything: the context's chain must match or the UI shows the switch-network
notice, and no reads happen against the wrong chain. It must have a viem chain in `src/chains.ts`
(add the import there for a new network) and must appear in the manifest's
`conditions.supportedNetworks` (build-checked).

`chainLabel` is only prose — the human name in the switch-network notice ("Ethereum mainnet").

**Constraints:** one venue = one chain. The same pair on two chains is two venues (two slugs, two
manifests, two registry entries). CoW-supported networks as of 2026: Ethereum (1), Gnosis (100),
Polygon (137), Base (8453), Arbitrum (42161), Avalanche (43114), Sepolia (11155111) — check
docs.cow.fi before relying on this list.

## Tokens

### `base` / `wrapped` (`{ address, symbol }`)

`base` is the unwrapped token the CoW order buys/sells (tGBP); `wrapped` is what the helper
mints/redeems (wstGBP). Addresses drive order matching (is the order buying/selling `base`?),
allowance/balance reads, and approvals; symbols appear verbatim in every notice, label, and button.

**Hard constraint — 18 decimals, both tokens.** `lib/hookMath.ts` computes in WAD and
`lib/format.ts` formats with `formatUnits(x, 18)`. A non-18-decimals venue silently missizes
approvals and minimums; that needs code (a decimals field threaded through math + formatting + new
tests), not configuration.

**Interface constraint:** the `wrapped` contract must expose `mintcost()` and `burncost()` (WAD,
base-per-wrapped, mintcost ≥ burncost by the venue's spread) — see `WRAPPER_PRICE_ABI` in
`src/lib/abi.ts`. The dapp reads them live through the host's RPC on a 30s poll.

## Helper

### `helper`

The on-chain hook target. Everything in the trust model hangs on this contract, so a new helper
deployment is the real gate for a new venue:

- **owner-bound**: anyone can call it (CoW's HooksTrampoline is public and untrusted), but it can
  only pull the owner's allowance and only pay the owner. Worst case for a third-party caller is
  forcing a fair-price conversion of the approved amount, delivered to the owner — bounded
  griefing at the venue's round-trip spread, no extraction.
- **ABI**: `wrapAll(address owner, uint256 minAmountOut)` and
  `unwrap(address owner, uint256 amountIn, uint256 minAmountOut)` (`HELPER_ABI`, `src/lib/abi.ts`).

**Kill switch:** set `helper` to the zero address and deploy — the venue renders a "not deployed
yet" notice and makes no account reads. Use it before a helper migration or if an issue is found.

**Migrating helpers:** users' allowances are per-address. After pointing config at a new helper,
existing users must approve the new address (the UI walks them through it: their allowance to the
*new* helper reads as zero); allowances to the old helper linger until revoked — if the old helper
had a flaw worth migrating away from, say so in release notes and tell users to revoke
(revoke.cash or a manual `approve(oldHelper, 0)`).

Record provenance next to the address in a comment: deploy date, block, verification status.

## Gas limits

### `wrapGasLimit` / `unwrapGasLimit` (decimal strings)

Attached to the hook payload; CoW's settlement allots this much gas to the hook call.

**Measuring:** fork-test the helper — `wrapAll` on a wallet that has the base token, `unwrap` with
**cold** storage slots (first-touch of the wrapper's accounting for that owner is the expensive
path). wstGBP measured ~177k / ~250k; config carries 250k / 300k (~30–40% headroom).

**Too low:** the hook reverts at settlement. For a pre-hook the order then can't settle (funds
never move — safe but the order is dead until re-created); for a post-hook the swap settles but the
wrap silently doesn't happen — the user keeps unwrapped base tokens and an open allowance.
**Too high:** hook gas is priced into settlement economics, so gross overestimates make orders less
attractive to solvers. Headroom of tens of percent is right; multiples are not.

## Economic parameters

### `slippageBps`

Guard against the oracle moving between signing and execution. Applied differently per side:

- **Post-hook (wrap):** haircuts `minAmountOut` — user accepts up to `slippageBps` less wstGBP
  than the live `mintcost` quote implies.
- **Pre-hook (unwrap):** inflates the redeem *input* (`amountIn`), while `minAmountOut` stays
  pinned to the order's exact sell amount (if the redeem can't fund the order, the hook must
  revert — that invariant is not configurable). Overshoot beyond the sell amount is still paid to
  the owner in base tokens, so the cost of a generous buffer is just a slightly larger approval and
  a bit of extra conversion at the oracle price.

**Sizing:** cover the venue's worst realistic oracle step between order signing and settlement,
plus rounding. wstGBP: weekly NAV ratchet, ~25bps mint/burn spread → 50bps. A venue with faster or
chunkier oracle updates needs proportionally more; going too high mostly weakens the wrap-side
minimum, so don't pad it "to be safe".

### `approvalBufferBps`

Post-hook only. The helper wraps `min(balance, allowance)`, so approving exactly `buyAmount` would
leave order **surplus** (CoW routinely settles better than the signed minimum) unwrapped. The
approval is `buyAmount × (1 + buffer)` so the sweep captures surplus up to the buffer; anything
beyond stays in the wallet as base tokens.

**Trade-off:** bigger buffer captures more surplus, but the excess allowance is also what a sweep
could take from base tokens the user *already held* if they add the hook while holding some, and
what survives as a stale allowance after settlement (until revoked; the UI forces stale oversized
allowances back down before a new hook can be added). 200bps (2%) comfortably covers typical CoW
surplus; keep it small.

## Assumptions baked into code (not configurable)

If a future venue breaks one of these, it's a code change with tests, not a config entry:

- deployment at the **domain root** — entry HTML, manifests, and built assets use root-absolute
  URLs; hosting under a path prefix needs a matching Vite `base` plus rewritten manifest and
  entry-HTML paths
- 18-decimals tokens; all math WAD-fixed (`lib/hookMath.ts`, `lib/format.ts`)
- `mintcost()`/`burncost()` price interface on the wrapped token (`WRAPPER_PRICE_ABI`)
- `wrapAll`/`unwrap` helper ABI (`HELPER_ABI`)
- EOA-only (`context.isSmartContract` blocked in-app; `walletCompatibility: ['EOA']` in manifests)
  — smart-contract wallets re-run post-hooks per fill on partially fillable orders
- pre-hook requires sell-kind orders (exact sell amount sizes the redeem)
- post-hook requires the order's receiver to be the connected wallet
- unwrap `minAmountOut` pinned to the order's exact sell amount

## Validation map

| Where | When it runs | What it checks |
|---|---|---|
| `vite.config.ts` | `npm run build` and dev-server start | key = slug; `chainId` has a viem chain in `src/chains.ts`; entry HTML, manifest, icon exist; manifest id is 64-hex and unique across venues; manifest name matches config; `supportedNetworks` includes `chainId` |
| `src/venues.test.ts` | `npm test` | address validity/distinctness, chain known to `src/chains.ts`, bps ranges, gas-limit format, symbols, `resolveVenue` routing (first-segment only, root deployment) |
| `src/lib/*.test.ts` | `npm test` | sizing math and gating, run against the real `wstgbp` venue config |
