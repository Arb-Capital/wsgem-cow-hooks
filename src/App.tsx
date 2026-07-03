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
import { mainnet } from 'viem/chains'

import { WRAPPER_PRICE_ABI } from './lib/abi'
import { fmt } from './lib/format'
import { buildUnwrapHook, buildWrapHook, deriveHookState } from './lib/hookState'
import { CHAIN_ID, DEFAULT_SLIPPAGE_BPS, HOOK_HELPER, TGBP, WSTGBP } from './config'

const HELPER_DEPLOYED = HOOK_HELPER !== zeroAddress

interface Chain {
  pub: PublicClient
  wallet: WalletClient
}

export default function App() {
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

  useEffect(() => {
    // initCoWHookDapp registers an iframe message listener with no teardown API; init exactly once
    // so StrictMode's dev double-invoke doesn't leave a second live subscription.
    if (initedRef.current) return
    initedRef.current = true
    const { actions, provider } = initCoWHookDapp({ onContext: setContext })
    actionsRef.current = actions
    const transport = custom(provider as unknown as EIP1193Provider)
    chainRef.current = {
      pub: createPublicClient({ chain: mainnet, transport }),
      wallet: createWalletClient({ chain: mainnet, transport }),
    }
  }, [])

  const isPreHook = context?.isPreHook ?? false
  const account = context?.account as Address | undefined
  const order = context?.orderParams ?? null
  const chainOk = context?.chainId === CHAIN_ID

  // Pre-hook = unwrap wstGBP to fund a tGBP sell; post-hook = wrap bought tGBP into wstGBP.
  const inputToken: Address = isPreHook ? WSTGBP : TGBP

  const refresh = useCallback(async () => {
    const chain = chainRef.current
    if (!chain || !chainOk) return
    try {
      const priceReads = [
        chain.pub.readContract({ address: WSTGBP, abi: WRAPPER_PRICE_ABI, functionName: 'mintcost' }),
        chain.pub.readContract({ address: WSTGBP, abi: WRAPPER_PRICE_ABI, functionName: 'burncost' }),
      ]
      const accountReads =
        account && HELPER_DEPLOYED
          ? [
              chain.pub.readContract({
                address: inputToken,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [account, HOOK_HELPER],
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
  }, [account, inputToken, chainOk])

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
    () => deriveHookState({ isPreHook, order, account, mintcost, burncost, allowance, balance }),
    [isPreHook, order, account, mintcost, burncost, allowance, balance],
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
        args: [HOOK_HELPER, amount],
        account,
        chain: mainnet,
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
    const hook = isPreHook ? buildUnwrapHook(account, unwrap!) : buildWrapHook(account, wrap!)
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
    return <Notice>wstGBP lives on Ethereum mainnet — switch network to use this hook.</Notice>
  }
  if (!HELPER_DEPLOYED) {
    return <Notice>The WsgemHookHelper contract is not deployed yet — check back soon.</Notice>
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
        Fill in the swap form first: {isPreHook ? 'a sell of tGBP (the pre-hook redeems your wstGBP to fund it)' : 'a buy of tGBP (the post-hook wraps the proceeds into wstGBP)'}.
      </Notice>
    )
  }
  if (buyKindBlocked) {
    return (
      <Notice>
        This pre-hook sizes the redeem from an exact sell amount, but this is a buy-type order (it
        sells <em>up to</em> a maximum). Switch the order to sell an exact amount of tGBP.
      </Notice>
    )
  }
  if (!active) {
    return (
      <Notice>
        {isPreHook
          ? 'This pre-hook funds a tGBP sell. Set tGBP as the token you are selling.'
          : 'This post-hook wraps bought tGBP. Set tGBP as the token you are buying.'}
      </Notice>
    )
  }
  if (receiverMismatch) {
    return (
      <Notice>
        This post-hook wraps tGBP delivered to your own wallet, but the order sends the bought tGBP
        to a different recipient. Remove the custom recipient to use this hook.
      </Notice>
    )
  }

  return (
    <main className="card">
      <h1>{isPreHook ? 'Unwrap wstGBP → tGBP (pre-hook)' : 'Wrap tGBP → wstGBP (post-hook)'}</h1>

      {isPreHook && unwrap && (
        <dl>
          <dt>Order sells</dt>
          <dd>{fmt(unwrap.needed)} tGBP</dd>
          <dt>wstGBP to redeem (incl. {Number(DEFAULT_SLIPPAGE_BPS) / 100}% buffer)</dt>
          <dd>{fmt(unwrap.amountIn)} wstGBP</dd>
          <dt>Redeems at burncost</dt>
          <dd>{burncost ? fmt(burncost, 6) : '…'} tGBP / wstGBP</dd>
          {!funded && (
            <>
              <dt className="warn">Balance</dt>
              <dd className="warn">
                {balance !== null ? fmt(balance) : '…'} wstGBP — not enough to fund this order.
              </dd>
            </>
          )}
        </dl>
      )}
      {!isPreHook && wrap && (
        <dl>
          <dt>Order buys (min; surplus is swept up to the approval buffer)</dt>
          <dd>{fmt(wrap.proceeds)} tGBP</dd>
          <dt>Expected wstGBP out</dt>
          <dd>
            ≥ {fmt(wrap.minOut)} (est. {fmt(wrap.expectedOut)})
          </dd>
          <dt>Wraps at mintcost</dt>
          <dd>{mintcost ? fmt(mintcost, 6) : '…'} tGBP / wstGBP</dd>
        </dl>
      )}

      <p className="fine">
        The helper is owner-bound: it can only pull what you approve and always pays the output back to
        your own address, at the wstGBP protocol&apos;s oracle price.
      </p>

      {txError && <p className="error">{txError}</p>}
      {readError && <p className="error">{readError}</p>}

      {!approved ? (
        <button disabled={busy} onClick={() => requiredApproval !== undefined && approveAmount(requiredApproval)}>
          {busy
            ? 'Approving…'
            : `Approve ${fmt(requiredApproval ?? 0n)} ${isPreHook ? 'wstGBP' : 'tGBP'}`}
        </button>
      ) : overApproved ? (
        <>
          <p className="warn">
            {isPreHook ? (
              <>
                An existing approval of {fmt(allowance!)} wstGBP exceeds what this order needs. The
                helper is publicly callable, so anyone could force-redeem the excess to tGBP at the
                oracle price — tighten the approval first.
              </>
            ) : (
              <>
                An existing approval of {fmt(allowance!)} tGBP exceeds this order&apos;s cap. The wrap
                sweeps min(balance, allowance), so the excess could pull tGBP you already hold —
                tighten the approval first.
              </>
            )}
          </p>
          <button disabled={busy} onClick={() => approveAmount(requiredApproval!)}>
            {busy ? 'Approving…' : `Reduce approval to ${fmt(requiredApproval!)} ${isPreHook ? 'wstGBP' : 'tGBP'}`}
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
