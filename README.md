# wsgem-cow-hooks — Wrap/Unwrap hook dapps for CoW Swap

[CoW Hooks](https://docs.cow.fi/cow-protocol/concepts/order-types/cow-hooks) dapps (iframe apps on
[`@cowprotocol/hook-dapp-lib`](https://www.npmjs.com/package/@cowprotocol/hook-dapp-lib)) that attach
a wsgem wrapper's atomic mint/redeem to CoW Swap orders. The repo is **multi-venue**: each
wrapped/base token pair is a *venue* served as its own hook dapp at `https://<domain>/<slug>/`, with
its own manifest and Hook Store listing, all from one deployment. Venues are defined in
`src/venues.ts`; the first is **wstGBP/tGBP** at `/wstgbp/`.

Per venue:

- **Post-hook — "Wrap base → wrapped":** the order buys the base token; after settlement the hook
  wraps the proceeds at the protocol's `mintcost` and delivers them to your wallet. The wrap sweeps
  `min(balance, allowance)`, so order surplus is captured too — up to the approval buffer over the
  order's `buyAmount` (2% for wstGBP); surplus beyond that stays in your wallet unwrapped. Requires
  the order's recipient to be your own wallet (custom recipients are blocked in the UI).
- **Pre-hook — "Unwrap wrapped → base":** the order sells base tokens you don't hold yet; before
  settlement the hook redeems enough of the wrapped token at `burncost` to fund the sell. Sell-kind
  orders only (an exact sell amount is needed to size the redeem; buy-kind orders are blocked in the
  UI). If the hook is skipped (hook execution is solver social consensus, not enforced), the order
  simply can't settle — nothing is lost.

## Trust model

The on-chain target per venue is an owner-bound helper (for wstGBP: `WsgemHookHelper.sol` in the
`wstGBP-univ4-hook` repo): ownerless, holds no funds, and **owner-bound** — anyone may call it
(CoW's HooksTrampoline is public and untrusted), but it pulls at most what the owner approved and
always pays the output back to the owner at the wrapper's oracle price. Worst case for a
third-party caller: forcing a fair-price conversion of the approved amount, delivered to you
(bounded griefing at the venue's round-trip spread; no extraction). Approvals are bounded per
order — `buyAmount` + buffer for wraps (the buffer lets the sweep capture surplus), redeem amount
+ slippage for unwraps; any allowance left over after settlement stays approved-but-unspent and can
be revoked.

## Venues

| Venue | Path | Chain | Base | Wrapped | Helper |
|---|---|---|---|---|---|
| wstGBP Wrap/Unwrap | `/wstgbp/` | Ethereum mainnet | tGBP `0x27f6c8289550fCE67f6B50BeD1F519966aFE5287` | wstGBP `0x57C3571f10767E49C9d7b60feb6c67804783B7aE` | `0x4F93a2E29B0AA75875Ab922d780B6dc59b415B6A` (deployed 2026-07-03, verified) |

**Adding a venue:** follow [docs/adding-a-venue.md](docs/adding-a-venue.md) (checklist: config
entry + entry HTML + manifest/icon; validation is enforced at build time). Every config field is
documented in [docs/configuration.md](docs/configuration.md).

## Layout

```
src/venues.ts             venue registry — single source of truth (validated at build + in tests)
src/chains.ts             chainId → viem chain for CoW-supported networks
src/App.tsx               the hook UI, parameterized by venue
src/main.tsx              resolves the venue from the URL path; root renders the venue directory
src/lib/                  pure sizing math, gating, payload building (unit-tested)
<slug>/index.html         per-venue entry page (multi-page Vite build)
public/<slug>/            per-venue manifest.json + icon.svg
docs/                     adding-a-venue.md, configuration.md
listing/                  prepared Hook Store registry entries
```

## Develop

```bash
npm install
npm run dev          # http://localhost:5180 — venue directory at /, venues at /<slug>/
npm run build        # type-check + venue validation + production build to dist/
npm test             # venue config invariants + sizing math + approval/funding/order-shape gating
npm run test:coverage  # same, with a coverage report over src/lib (100% enforced by review, not CI)
```

Test against CoW Swap without listing: swap.cow.fi → Hooks trading mode → **My Custom Hooks** →
paste the venue URL (`http://localhost:5180/wstgbp/` works for local dev; note the dapp shows
"Connecting to CoW Swap…" when opened standalone — the order context only arrives inside CoW
Swap's iframe).

## Deploy

Any static host works (the bleu hook dapps use Vercel). The app is fully static (`dist/`); each
venue's `manifest.json` must be served at `/<slug>/manifest.json` (CoW Swap fetches
`<registered URL>/manifest.json`). After the first deploy, replace each venue's relative
`"image"` in `public/<slug>/manifest.json` with the absolute deployed URL of its icon. All venues
deploy together — one build, one host.

**Deploy at the domain root.** Entry pages, manifests, and built assets all use root-absolute URLs
(`/<slug>/…`, `/assets/…`), so `https://<domain>/wstgbp/` works but
`https://<domain>/some-prefix/wstgbp/` does not out of the box — that would need a matching Vite
`base` and rewritten manifest/entry-HTML paths. Use a dedicated (sub)domain instead.

## Hook Store listing

One registry entry per venue: PR to
[`cowprotocol/cowswap`](https://github.com/cowprotocol/cowswap) adding a `type: 'IFRAME'` entry to
`libs/hook-dapp-lib/src/hookDappsRegistry.ts` with `url: https://<domain>/<slug>/`. Prepared
entries live in `listing/`; the template and PR checklist are in
[docs/adding-a-venue.md](docs/adding-a-venue.md) (step 8). No `conditions.position` — each dapp
serves both pre- and post-hook positions.

## Notes / v1 limitations

- EOA wallets only (`walletCompatibility: ['EOA']`), enforced in-app too via `context.isSmartContract`
  (registry metadata alone can be bypassed through "My Custom Hooks"). Smart-contract wallets re-run
  post-hooks per fill on partially fillable orders; revisit before enabling.
- If an older allowance to the helper exceeds the current order's cap, the UI requires reducing it
  to the exact buffered amount before the hook can be added. For the post-hook the sweep would
  otherwise be entitled to previously held base tokens up to that stale allowance; for the pre-hook
  the publicly callable helper would let anyone force-redeem the excess (bounded griefing at the
  oracle price).
- All venues assume 18-decimals tokens and the `mintcost()`/`burncost()` wrapper interface — see
  the "Assumptions baked into code" section of [docs/configuration.md](docs/configuration.md).
- wstGBP is mainnet-only with no testnet deployment, so e2e testing means small real orders.
- Quotes read `mintcost()`/`burncost()` live via the host's RPC; each venue sets a slippage guard
  (`slippageBps`) sized to its oracle cadence: the post-hook puts it on `minAmountOut`, while the
  pre-hook buffers the redeem *input* and pins `minAmountOut` to the order's exact sell amount (if
  the redeem can't fund the order, the hook must revert).
