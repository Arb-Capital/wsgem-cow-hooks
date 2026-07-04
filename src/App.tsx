import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  initCoWHookDapp,
  type CoWHookDappActions,
  type HookDappContext,
} from '@cowprotocol/hook-dapp-lib'
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  zeroAddress,
  type Address,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from 'viem'

import { CHAINS } from './chains'
import { WRAPPER_PRICE_ABI } from './lib/abi'
import { fmt } from './lib/format'
import { buildUnwrapHook, buildWrapHook, deriveHookState } from './lib/hookState'
import type { VenueConfig } from './venues'

interface Chain {
  pub: PublicClient
  wallet: WalletClient
}

export default function App({ venue }: { venue: VenueConfig }) {
  const [context, setContext] = useState<HookDappContext | null>(null)
  const [mintcost, setMintcost] = useState<bigint | null>(null)
  const [burncost, setBurncost] = useState<bigint | null>(null)
  const [allowance, setAllowance] = useState<bigint | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [busy, setBusy] = useState(false)
  // Background reads and user-initiated transactions fail independently; keep their surfaces apart
  // so a successful 30s poll can't wipe an approval error the user still needs to see.
  const [readError, setReadError] = useState<string | null>(null)
  const [txError, setTxError] = useState<string | null>(null)

  const actionsRef = useRef<CoWHookDappActions | null>(null)
  const chainRef = useRef<Chain | null>(null)
  const initedRef = useRef(false)

  const { base, wrapped } = venue
  const helperDeployed = venue.helper !== zeroAddress
  const viemChain = CHAINS[venue.chainId]

  useEffect(() => {
    // initCoWHookDapp registers an iframe message listener with no teardown API; init exactly once
    // so StrictMode's dev double-invoke doesn't leave a second live subscription.
    if (initedRef.current) return
    initedRef.current = true
    const { actions, provider } = initCoWHookDapp({ onContext: setContext })
    actionsRef.current = actions
    const transport = custom(provider as unknown as EIP1193Provider)
    chainRef.current = {
      pub: createPublicClient({ chain: viemChain, transport }),
      wallet: createWalletClient({ chain: viemChain, transport }),
    }
  }, [viemChain])

  const isPreHook = context?.isPreHook ?? false
  const account = context?.account as Address | undefined
  const order = context?.orderParams ?? null
  const chainOk = context?.chainId === venue.chainId

  // Pre-hook = unwrap the wrapped token to fund a base sell; post-hook = wrap bought base tokens.
  const inputToken: Address = isPreHook ? wrapped.address : base.address
  const inputSymbol = isPreHook ? wrapped.symbol : base.symbol

  const refresh = useCallback(async () => {
    const chain = chainRef.current
    if (!chain || !chainOk) return
    try {
      const priceReads = [
        chain.pub.readContract({ address: wrapped.address, abi: WRAPPER_PRICE_ABI, functionName: 'mintcost' }),
        chain.pub.readContract({ address: wrapped.address, abi: WRAPPER_PRICE_ABI, functionName: 'burncost' }),
      ]
      const accountReads =
        account && helperDeployed
          ? [
              chain.pub.readContract({
                address: inputToken,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [account, venue.helper],
              }),
              chain.pub.readContract({
                address: inputToken,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [account],
              }),
            ]
          : []
      const [mc, bc, al, bal] = await Promise.all([...priceReads, ...accountReads])
      setMintcost(mc)
      setBurncost(bc)
      if (accountReads.length) {
        setAllowance(al)
        setBalance(bal)
      }
      setReadError(null)
    } catch (e) {
      setReadError(`RPC read failed: ${(e as Error).message}`)
    }
  }, [account, inputToken, chainOk, wrapped.address, venue.helper, helperDeployed])

  useEffect(() => {
    // The refresh key (account, inputToken, chain) changed: the cached allowance/balance belong to
    // the previous key, so drop them before the async re-read — otherwise `approved`/`funded` are
    // judged against the wrong token or wallet until it lands.
    setAllowance(null)
    setBalance(null)
    refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    document.documentElement.dataset.theme = context?.isDarkMode ? 'dark' : 'light'
  }, [context?.isDarkMode])

  // --- Derived amounts (pure — see lib/hookState for the gating rules and their rationale) --------

  const {
    wrap,
    unwrap,
    active,
    requiredApproval,
    approved,
    funded,
    overApproved,
    receiverMismatch,
    buyKindBlocked,
  } = useMemo(
    () => deriveHookState({ venue, isPreHook, order, account, mintcost, burncost, allowance, balance }),
    [venue, isPreHook, order, account, mintcost, burncost, allowance, balance],
  )

  // --- Actions -----------------------------------------------------------------------------------

  async function approveAmount(amount: bigint) {
    const chain = chainRef.current
    if (!chain || !account) return
    setBusy(true)
    setTxError(null)
    try {
      const hash = await chain.wallet.writeContract({
        address: inputToken,
        abi: erc20Abi,
        functionName: 'approve',
        args: [venue.helper, amount],
        account,
        chain: viemChain,
      })
      await chain.pub.waitForTransactionReceipt({ hash })
      await refresh()
    } catch (e) {
      setTxError(`Approval failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function onAddHook() {
    const actions = actionsRef.current
    if (!actions || !account) return
    const hook = isPreHook ? buildUnwrapHook(venue, account, unwrap!) : buildWrapHook(venue, account, wrap!)
    const hookToEdit = context?.hookToEdit
    if (hookToEdit) {
      actions.editHook({ ...hookToEdit, hook: { ...hookToEdit.hook, ...hook } })
    } else {
      actions.addHook({ hook })
    }
  }

  // --- Render ------------------------------------------------------------------------------------

  if (!context) return <main className="card">Connecting to CoW Swap…</main>

  if (!chainOk) {
    return (
      <Notice>
        {wrapped.symbol} lives on {venue.chainLabel} — switch network to use this hook.
      </Notice>
    )
  }
  if (!helperDeployed) {
    return <Notice>The {venue.name} helper contract is not deployed yet — check back soon.</Notice>
  }
  if (!account) {
    return <Notice>Connect a wallet in CoW Swap to configure this hook.</Notice>
  }
  if (context.isSmartContract) {
    return (
      <Notice>
        This hook supports EOA wallets only for now — smart-contract wallets re-run post-hooks per
        fill on partially fillable orders.
      </Notice>
    )
  }
  if (!order) {
    return (
      <Notice>
        Fill in the swap form first:{' '}
        {isPreHook
          ? `a sell of ${base.symbol} (the pre-hook redeems your ${wrapped.symbol} to fund it)`
          : `a buy of ${base.symbol} (the post-hook wraps the proceeds into ${wrapped.symbol})`}
        .
      </Notice>
    )
  }
  if (buyKindBlocked) {
    return (
      <Notice>
        This pre-hook sizes the redeem from an exact sell amount, but this is a buy-type order (it
        sells <em>up to</em> a maximum). Switch the order to sell an exact amount of {base.symbol}.
      </Notice>
    )
  }
  if (!active) {
    return (
      <Notice>
        {isPreHook
          ? `This pre-hook funds a ${base.symbol} sell. Set ${base.symbol} as the token you are selling.`
          : `This post-hook wraps bought ${base.symbol}. Set ${base.symbol} as the token you are buying.`}
      </Notice>
    )
  }
  if (receiverMismatch) {
    return (
      <Notice>
        This post-hook wraps {base.symbol} delivered to your own wallet, but the order sends the
        bought {base.symbol} to a different recipient. Remove the custom recipient to use this hook.
      </Notice>
    )
  }

  return (
    <main className="card">
      <h1>
        {isPreHook
          ? `Unwrap ${wrapped.symbol} → ${base.symbol} (pre-hook)`
          : `Wrap ${base.symbol} → ${wrapped.symbol} (post-hook)`}
      </h1>

      {isPreHook && unwrap && (
        <dl>
          <dt>Order sells</dt>
          <dd>
            {fmt(unwrap.needed)} {base.symbol}
          </dd>
          <dt>
            {wrapped.symbol} to redeem (incl. {Number(venue.slippageBps) / 100}% buffer)
          </dt>
          <dd>
            {fmt(unwrap.amountIn)} {wrapped.symbol}
          </dd>
          <dt>Redeems at burncost</dt>
          <dd>
            {burncost ? fmt(burncost, 6) : '…'} {base.symbol} / {wrapped.symbol}
          </dd>
          {!funded && (
            <>
              <dt className="warn">Balance</dt>
              <dd className="warn">
                {balance !== null ? fmt(balance) : '…'} {wrapped.symbol} — not enough to fund this
                order.
              </dd>
            </>
          )}
        </dl>
      )}
      {!isPreHook && wrap && (
        <dl>
          <dt>Order buys (min; surplus is swept up to the approval buffer)</dt>
          <dd>
            {fmt(wrap.proceeds)} {base.symbol}
          </dd>
          <dt>Expected {wrapped.symbol} out</dt>
          <dd>
            ≥ {fmt(wrap.minOut)} (est. {fmt(wrap.expectedOut)})
          </dd>
          <dt>Wraps at mintcost</dt>
          <dd>
            {mintcost ? fmt(mintcost, 6) : '…'} {base.symbol} / {wrapped.symbol}
          </dd>
        </dl>
      )}

      <p className="fine">
        The helper is owner-bound: it can only pull what you approve and always pays the output back to
        your own address, at the {wrapped.symbol} protocol&apos;s oracle price.
      </p>

      {txError && <p className="error">{txError}</p>}
      {readError && <p className="error">{readError}</p>}

      {!approved ? (
        <button disabled={busy} onClick={() => requiredApproval !== undefined && approveAmount(requiredApproval)}>
          {busy ? 'Approving…' : `Approve ${fmt(requiredApproval ?? 0n)} ${inputSymbol}`}
        </button>
      ) : overApproved ? (
        <>
          <p className="warn">
            {isPreHook ? (
              <>
                An existing approval of {fmt(allowance!)} {wrapped.symbol} exceeds what this order
                needs. The helper is publicly callable, so anyone could force-redeem the excess to{' '}
                {base.symbol} at the oracle price — tighten the approval first.
              </>
            ) : (
              <>
                An existing approval of {fmt(allowance!)} {base.symbol} exceeds this order&apos;s
                cap. The wrap sweeps min(balance, allowance), so the excess could pull {base.symbol}{' '}
                you already hold — tighten the approval first.
              </>
            )}
          </p>
          <button disabled={busy} onClick={() => approveAmount(requiredApproval!)}>
            {busy ? 'Approving…' : `Reduce approval to ${fmt(requiredApproval!)} ${inputSymbol}`}
          </button>
        </>
      ) : (
        <button disabled={busy || !funded} onClick={onAddHook}>
          {context.hookToEdit ? 'Update hook' : 'Add hook'}
        </button>
      )}
    </main>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <main className="card">
      <p>{children}</p>
    </main>
  )
}
