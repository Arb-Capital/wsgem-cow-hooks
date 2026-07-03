# Hook Store listing PR — prepared entry

Once the dapp is live at a stable URL (and `src/config.ts` has the deployed `WsgemHookHelper`), open a
PR to [`cowprotocol/cowswap`](https://github.com/cowprotocol/cowswap) adding this entry to
`libs/hook-dapp-lib/src/hookDappsRegistry.ts` (replace `<DAPP_URL>` with the deployed origin):

```ts
  WSTGBP_WRAP_UNWRAP: {
    type: 'IFRAME',
    name: `wstGBP Wrap/Unwrap`,
    descriptionShort: `Wrap tGBP into wstGBP after a buy, or unwrap wstGBP before a tGBP sell`,
    description: `Attach the wstGBP wrapper's atomic mint/redeem to any CoW Swap order. As a post-hook, the tGBP you buy is wrapped into wstGBP at the protocol's own oracle price (mintcost) and delivered straight to your wallet. As a pre-hook, your wstGBP is redeemed to tGBP (at burncost) to fund a tGBP sell. Funds only ever move from you back to you: the on-chain helper is owner-bound, pulls at most what you approved, and always pays the proceeds to your own address.`,
    version: '0.1.0',
    website: 'https://github.com/brianmcmichael/wsgem-cow-hooks',
    image: '<DAPP_URL>/icon.svg',
    url: '<DAPP_URL>/',
    conditions: {
      walletCompatibility: ['EOA'],
      supportedNetworks: [1],
    },
  },
```

Notes:

- No `conditions.position` — the dapp serves both pre- (unwrap) and post- (wrap) positions and adapts
  via `context.isPreHook`.
- The PR description should link the deployed `WsgemHookHelper` on Etherscan and summarize the trust
  model (owner-bound target, callable by anyone, funds flow only owner → owner at oracle price).
- Before the PR lands, the dapp is fully usable via CoW Swap → Hooks → "My Custom Hooks" → paste
  `<DAPP_URL>`.
