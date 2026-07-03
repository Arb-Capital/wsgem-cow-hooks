# wsgem-cow-hooks — wstGBP Wrap/Unwrap hook dapp for CoW Swap

A [CoW Hooks](https://docs.cow.fi/cow-protocol/concepts/order-types/cow-hooks) dapp (iframe app on
[`@cowprotocol/hook-dapp-lib`](https://www.npmjs.com/package/@cowprotocol/hook-dapp-lib)) that attaches
the wstGBP wrapper's atomic mint/redeem to any CoW Swap order on Ethereum mainnet:

- **Post-hook — "Wrap tGBP → wstGBP":** the order buys tGBP; after settlement the hook wraps the
  proceeds into wstGBP at the protocol's `mintcost` and delivers them to your wallet. The wrap sweeps
  `min(balance, allowance)`, so order surplus is captured too — up to the approval's 2% buffer over
  the order's `buyAmount`; surplus beyond that stays in your wallet as tGBP. Requires the order's
  recipient to be your own wallet (custom recipients are blocked in the UI).
- **Pre-hook — "Unwrap wstGBP → tGBP":** the order sells tGBP you don't hold yet; before settlement the
  hook redeems enough of your wstGBP at `burncost` to fund the sell. Sell-kind orders only (an exact
  sell amount is needed to size the redeem; buy-kind orders are blocked in the UI). If the hook is
  skipped (hook execution is solver social consensus, not enforced), the order simply can't settle —
  nothing is lost.

## Trust model

The on-chain target is **`WsgemHookHelper`** (see the Solidity repo, `wstGBP-univ4-hook`,
`src/adapter/WsgemHookHelper.sol`): ownerless, holds no funds, and **owner-bound** — anyone may call it
(CoW's HooksTrampoline is public and untrusted), but it pulls at most what the owner approved and always
pays the output back to the owner at the wrapper's oracle price. Worst case for a third-party caller:
forcing a fair-price conversion of the approved amount, delivered to you (bounded griefing, ~25bps
round-trip spread; no extraction). Approvals are bounded per order — `buyAmount` +2% for wraps
(the buffer lets the sweep capture surplus), redeem amount +0.5% for unwraps; any allowance left
over after settlement stays approved-but-unspent and can be revoked.

## Addresses (Ethereum mainnet)

| Contract | Address |
|---|---|
| tGBP | `0x27f6c8289550fCE67f6B50BeD1F519966aFE5287` |
| wstGBP | `0x57C3571f10767E49C9d7b60feb6c67804783B7aE` |
| WsgemHookHelper | `0x4F93a2E29B0AA75875Ab922d780B6dc59b415B6A` (deployed 2026-07-03, verified) |

## Develop

```bash
npm install
npm run dev          # http://localhost:5180
npm run build        # type-check + production build to dist/
npm test             # unit tests for the hook sizing math (vitest)
```

Test against CoW Swap without listing: swap.cow.fi → Hooks tab → **My Custom Hooks** → paste the dapp
URL (the local dev URL works if CoW Swap can reach it; otherwise deploy a preview first).

## Deploy

Any static host works (the bleu hook dapps use Vercel). The app is fully static (`dist/`); the only
requirement is that `manifest.json` is served at the site root. After the first deploy, replace the
relative `"image"` in `public/manifest.json` with the absolute URL of `icon.svg` at the deployed domain.

## Hook Store listing

Once the helper is deployed, `src/config.ts` is updated, and the dapp is live at a stable URL, open a PR
to [`cowprotocol/cowswap`](https://github.com/cowprotocol/cowswap) adding a `type: 'IFRAME'` entry to
`libs/hook-dapp-lib/src/hookDappsRegistry.ts` (mirror the existing `bleu` entries: `name`,
`descriptionShort`, `description`, `version`, `website`, `image`, `url`, `conditions.supportedNetworks:
[1]`, `conditions.walletCompatibility: ['EOA']`, no `position` — the dapp serves both).

## Notes / v1 limitations

- EOA wallets only (`walletCompatibility: ['EOA']`), enforced in-app too via `context.isSmartContract`
  (registry metadata alone can be bypassed through "My Custom Hooks"). Smart-contract wallets re-run
  post-hooks per fill on partially fillable orders; revisit before enabling.
- If an older allowance to the helper exceeds the current order's cap, the post-hook UI requires
  reducing it to the exact buffered amount before the hook can be added — the sweep would otherwise
  be entitled to previously held tGBP up to that stale allowance.
- Mainnet only — tGBP/wstGBP have no testnet deployment, so e2e testing means small real orders.
- Quotes read `wstGBP.mintcost()`/`burncost()` live via the host's RPC; the oracle ratchets slowly, and
  a 0.5% guard (`DEFAULT_SLIPPAGE_BPS` in `src/config.ts`) is applied on each side: the post-hook puts
  it on `minAmountOut`, while the pre-hook buffers the redeem *input* by 0.5% and pins `minAmountOut`
  to the order's exact sell amount (if the redeem can't fund the order, the hook must revert).
