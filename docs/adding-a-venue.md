# Adding a venue

A **venue** is one wrapped/base token pair (e.g. wstGBP/tGBP) served as its own CoW hook dapp. All
venues live in this repo and deploy together; each gets its own URL path (`/<slug>/`), its own
`manifest.json`, and its own Hook Store listing. CoW Swap resolves each dapp's manifest relative to
the URL it is registered under (`<url>/manifest.json`), which is what makes path-per-venue work.

Field-by-field guidance for every config value lives in [configuration.md](./configuration.md).
This document is the end-to-end checklist.

## 0. Prerequisites (on-chain, before touching this repo)

The dapp is a thin UI over an owner-bound helper contract; nothing here can compensate for a helper
that doesn't hold the invariants. Confirm all of the following:

- [ ] **Helper deployed and verified** for the pair (the wstGBP one is
      `WsgemHookHelper.sol` in the `wstGBP-univ4-hook` repo). It must be:
  - **owner-bound**: callable by anyone (CoW's HooksTrampoline is public and untrusted), pulls at
    most the owner's ERC-20 allowance, and pays output only to the owner;
  - **ABI-compatible** with `src/lib/abi.ts`: `wrapAll(address owner, uint256 minAmountOut)` and
    `unwrap(address owner, uint256 amountIn, uint256 minAmountOut)`.
- [ ] **Wrapper exposes `mintcost()` / `burncost()`** returning WAD-scaled *base-per-wrapped*
      prices (the dapp reads them live for quoting and sizing).
- [ ] **Both tokens are 18-decimals.** The sizing math (`src/lib/hookMath.ts`) and formatting are
      WAD-fixed. A venue with different decimals needs code changes first — don't config around it.
- [ ] **The chain is supported by CoW Protocol** and present in `src/chains.ts` (add the viem chain
      there if it's a new network for us).
- [ ] **Gas measured**: fork-test the helper's `wrapAll` and cold-storage `unwrap`, note the numbers
      (you'll add ~30–40% margin in config).

## 1. Add the config entry — `src/venues.ts`

Add a key to `VENUES` (the key must equal `slug`):

```ts
  wsteur: {
    slug: 'wsteur',
    name: 'wstEUR Wrap/Unwrap',            // must match the manifest's cow_hook_dapp.name
    chainId: 1,
    chainLabel: 'Ethereum mainnet',
    base: { address: '0x…', symbol: 'tEUR' },
    wrapped: { address: '0x…', symbol: 'wstEUR' },
    // <HelperName> — deployed YYYY-MM-DD (block N), Etherscan-verified.
    helper: '0x…',                          // zeroAddress until deployed — venue renders disabled
    // Fork-test measurements: wrapAll ~Xk, unwrap ~Yk cold, plus margin.
    wrapGasLimit: '250000',
    unwrapGasLimit: '300000',
    slippageBps: 50n,                       // size against the venue's oracle cadence + spread
    approvalBufferBps: 200n,
  },
```

Keep the provenance comments (deploy date/block, gas measurements) — they're the audit trail for
the numbers. You can land a venue early with `helper: zeroAddress`; the UI shows a "not deployed
yet" notice until the real address goes in.

## 2. Create the entry page — `<slug>/index.html`

Copy `wstgbp/index.html` and change every `wstgbp` and the title:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/<slug>/icon.svg" />
    <link rel="manifest" href="/<slug>/manifest.json" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title><Wrapped> Wrap/Unwrap — CoW Hook</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

All venues share one bundle; the app picks its config from the URL path at runtime
(`resolveVenue` in `src/venues.ts`). Nothing else to wire — `vite.config.ts` derives the build
inputs from `VENUES`.

## 3. Create the static assets — `public/<slug>/`

- `public/<slug>/icon.svg` — the venue's icon (shown in the CoW Swap hook picker).
- `public/<slug>/manifest.json` — copy `public/wstgbp/manifest.json` and update every field.
  Generate a **fresh** id:

```bash
openssl rand -hex 32
```

Template (the `cow_hook_dapp` object is what CoW Swap validates; the outer PWA fields are
cosmetic):

```json
{
  "name": "<Wrapped> Wrap/Unwrap",
  "short_name": "<Wrapped> Hook",
  "description": "CoW hook dapp: wrap <base> into <wrapped> after a buy, or unwrap <wrapped> to fund a <base> sell.",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [{ "src": "/<slug>/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }],
  "cow_hook_dapp": {
    "id": "<64 hex chars from openssl rand -hex 32 — NEVER reuse another venue's>",
    "name": "<Wrapped> Wrap/Unwrap",
    "descriptionShort": "Wrap <base> into <wrapped> after a buy, or unwrap <wrapped> before a <base> sell.",
    "description": "<long description — adapt the wstgbp one; keep the funds-only-move-owner-to-owner trust summary>",
    "version": "0.1.0",
    "website": "https://github.com/brianmcmichael/wsgem-cow-hooks",
    "image": "/<slug>/icon.svg",
    "conditions": {
      "supportedNetworks": [<chainId>],
      "walletCompatibility": ["EOA"]
    }
  }
}
```

After the first production deploy, change `"image"` to the **absolute** URL
(`https://<domain>/<slug>/icon.svg`) — CoW Swap renders it from its own origin, so a relative path
breaks outside the iframe.

## 4. Validate

```bash
npm test        # config invariants (venues.test.ts) + sizing/gating math
npm run build   # vite.config.ts cross-checks VENUES ↔ entry HTML ↔ manifest ↔ src/chains.ts
                # (id format/uniqueness, name match, supportedNetworks, known chain) and fails
                # with a pointed error
```

The same validation runs when the dev server starts, so drift is caught immediately.

## 5. Test locally inside CoW Swap

The dapp only comes alive embedded in CoW Swap (standalone it shows "Connecting to CoW Swap…" —
that's expected; the order context arrives via postMessage from the parent window).

1. `npm run dev`
2. On [swap.cow.fi](https://swap.cow.fi), enable the **Hooks** trading mode
3. Hook picker → **My Custom Hooks** → add `http://localhost:5180/<slug>/` (trailing slash;
   localhost is whitelisted by CoW's iframe transport for dev)

Walk the state checklist — everything before the approval is free:

- [ ] wrong network → "switch network" notice
- [ ] no wallet → connect notice
- [ ] `helper: zeroAddress` (if pre-deploy) → disabled notice
- [ ] empty swap form → "fill in the swap form" notice
- [ ] pre-hook + buy-kind order selling `<base>` → dedicated buy-kind block
- [ ] wrong token → "set `<base>` as the token you are selling/buying"
- [ ] post-hook + custom recipient → receiver-mismatch block
- [ ] pre-hook with insufficient wrapped balance → funding warning, Add hook disabled
- [ ] approval flow: Approve → exact buffered amount; bump the order size → over-approval warning
      offers "Reduce approval"
- [ ] **Add hook**, then inspect the attached hook in CoW Swap's order summary: decode the calldata
      (`cast calldata-decode 'unwrap(address,uint256,uint256)' <data>` or Etherscan's input
      decoder) and confirm owner = your address, amounts match the UI, target = the helper

## 6. Deploy and re-test

Deploy is repo-wide (all venues ship together): `npm run build`, host `dist/` statically **at the
domain root** — entry pages, manifests, and built assets use root-absolute URLs, so a path-prefixed
deploy (`https://<domain>/prefix/<slug>/`) does not work without Vite `base` changes; use a
dedicated (sub)domain. Then:

- [ ] flip `manifest.json` `"image"` to the absolute URL (step 3 note) and redeploy
- [ ] re-run the step-5 checklist against `https://<domain>/<slug>/` via My Custom Hooks

## 7. End-to-end with real funds

There is no testnet for these tokens, so the last check is a small real order on the venue's chain:

- [ ] pre-hook: small `<base>` sell funded by an unwrap; confirm settlement + hook execution on the
      explorer and [explorer.cow.fi](https://explorer.cow.fi)
- [ ] post-hook: small `<base>` buy wrapped to `<wrapped>`; confirm proceeds (incl. any surplus up
      to the buffer) arrive as `<wrapped>`
- [ ] revoke any leftover allowance, or note it (bounded by design, but tidy is better)

If a solver skips a pre-hook the order simply can't settle — nothing is lost; a skipped post-hook
leaves the bought `<base>` unwrapped in the wallet with the allowance still usable by a later
manual `wrapAll`.

## 8. Hook Store listing (optional but recommended)

PR to [`cowprotocol/cowswap`](https://github.com/cowprotocol/cowswap), adding to
`libs/hook-dapp-lib/src/hookDappsRegistry.ts` (one entry per venue; mirror the existing entries):

```ts
  <WRAPPED>_WRAP_UNWRAP: {
    type: 'IFRAME',
    name: `<Wrapped> Wrap/Unwrap`,
    descriptionShort: `<manifest descriptionShort>`,
    description: `<manifest description>`,
    version: '0.1.0',
    website: 'https://github.com/brianmcmichael/wsgem-cow-hooks',
    image: 'https://<domain>/<slug>/icon.svg',
    url: 'https://<domain>/<slug>/',
    conditions: {
      walletCompatibility: ['EOA'],
      supportedNetworks: [<chainId>],
    },
  },
```

No `conditions.position` — the dapp serves both pre and post and adapts via `context.isPreHook`.
In the PR description: link the verified helper on the block explorer and summarize the trust model
(owner-bound target, publicly callable, funds only flow owner → owner at the oracle price).
Until the PR lands, the venue is fully usable via My Custom Hooks.

## Definition of done

- [ ] `VENUES` entry with provenance comments (helper deploy block, gas measurements)
- [ ] `<slug>/index.html`, `public/<slug>/manifest.json` (fresh id), `public/<slug>/icon.svg`
- [ ] `npm test` and `npm run build` green
- [ ] state checklist passed locally and against the deployed URL
- [ ] one real order settled in each direction
- [ ] manifest image absolute; registry PR opened (or consciously deferred)
