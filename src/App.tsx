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
  encodeFunctionData,
  type Address,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { mainnet } from 'viem/chains'

import { ERC20_ABI, HELPER_ABI, WRAPPER_PRICE_ABI } from './lib/abi'
import { ceilDiv, fmt, sameAddress } from './lib/format'
import {
  APPROVAL_BUFFER_BPS,
  CHAIN_ID,
  DEFAULT_SLIPPAGE_BPS,
  HOOK_HELPER,
  TGBP,
  UNWRAP_GAS_LIMIT,
  WAD,
  WRAP_GAS_LIMIT,
  WSTGBP,
} from './config'

const BPS = 10_000n
const HELPER_DEPLOYED = HOOK_HELPER !== '0x0000000000000000000000000000000000000000'

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
  const [error, setError] = useState<string | null>(null)

  const actionsRef = useRef<CoWHookDappActions | null>(null)
  const chainRef = useRef<Chain | null>(null)

  useEffect(() => {
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

  // Pre-hook = unwrap wstGBP to fund a tGBP sell; post-hook = wrap bought tGBP into wstGBP.
  const inputToken: Address = isPreHook ? WSTGBP : TGBP

  const refresh = useCallback(async () => {
    const chain = chainRef.current
    if (!chain) return
    try {
      const [mc, bc] = await Promise.all([
        chain.pub.readContract({ address: WSTGBP, abi: WRAPPER_PRICE_ABI, functionName: 'mintcost' }),
        chain.pub.readContract({ address: WSTGBP, abi: WRAPPER_PRICE_ABI, functionName: 'burncost' }),
      ])
      setMintcost(mc)
      setBurncost(bc)
      if (account && HELPER_DEPLOYED) {
        const [al, bal] = await Promise.all([
          chain.pub.readContract({
            address: inputToken,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [account, HOOK_HELPER],
          }),
          chain.pub.readContract({
            address: inputToken,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [account],
          }),
        ])
        setAllowance(al)
        setBalance(bal)
      }
      setError(null)
    } catch (e) {
      setError(`RPC read failed: ${(e as Error).message}`)
    }
  }, [account, inputToken])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    document.documentElement.dataset.theme = context?.isDarkMode ? 'dark' : 'light'
  }, [context?.isDarkMode])

  // --- Derived amounts ---------------------------------------------------------------------------

  // Post-hook (wrap): the order buys tGBP; proceeds >= buyAmount (surplus). We approve a buffered
  // amount so the helper's min(balance, allowance) sweep captures surplus too, and set minAmountOut
  // from buyAmount at the live mintcost with a slippage guard.
  const wrap = useMemo(() => {
    if (isPreHook || !order || !mintcost || mintcost === 0n) return null
    if (!sameAddress(order.buyTokenAddress, TGBP)) return null
    const proceeds = BigInt(order.buyAmount)
    if (proceeds === 0n) return null
    const expectedOut = (proceeds * WAD) / mintcost
    const minOut = (expectedOut * (BPS - DEFAULT_SLIPPAGE_BPS)) / BPS
    const approvalNeeded = (proceeds * (BPS + APPROVAL_BUFFER_BPS)) / BPS
    return { proceeds, expectedOut, minOut, approvalNeeded }
  }, [isPreHook, order, mintcost])

  // Pre-hook (unwrap): the order sells tGBP the user does not hold yet; redeem enough wstGBP to cover
  // sellAmount at the live burncost, with a slippage buffer on the input. minAmountOut is the sell
  // amount itself — if the redeem cannot fund the order, the hook (and so the order) must not proceed.
  const unwrap = useMemo(() => {
    if (!isPreHook || !order || !burncost || burncost === 0n) return null
    if (!sameAddress(order.sellTokenAddress, TGBP)) return null
    const needed = BigInt(order.sellAmount)
    if (needed === 0n) return null
    const exactIn = ceilDiv(needed * WAD, burncost)
    const amountIn = (exactIn * (BPS + DEFAULT_SLIPPAGE_BPS)) / BPS
    return { needed, amountIn, expectedOut: (amountIn * burncost) / WAD }
  }, [isPreHook, order, burncost])

  const active = isPreHook ? unwrap : wrap
  const requiredApproval = isPreHook ? unwrap?.amountIn : wrap?.approvalNeeded
  const approved = allowance !== null && requiredApproval !== undefined && allowance >= requiredApproval
  const funded =
    !isPreHook || (balance !== null && unwrap !== undefined && unwrap !== null && balance >= unwrap.amountIn)

  // --- Actions -----------------------------------------------------------------------------------

  async function onApprove() {
    const chain = chainRef.current
    if (!chain || !account || requiredApproval === undefined) return
    setBusy(true)
    setError(null)
    try {
      const hash = await chain.wallet.writeContract({
        address: inputToken,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [HOOK_HELPER, requiredApproval],
        account,
        chain: mainnet,
      })
      await chain.pub.waitForTransactionReceipt({ hash })
      await refresh()
    } catch (e) {
      setError(`Approval failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function onAddHook() {
    const actions = actionsRef.current
    if (!actions || !account) return
    const callData = isPreHook
      ? encodeFunctionData({
          abi: HELPER_ABI,
          functionName: 'unwrap',
          args: [account, unwrap!.amountIn, unwrap!.needed],
        })
      : encodeFunctionData({
          abi: HELPER_ABI,
          functionName: 'wrapAll',
          args: [account, wrap!.minOut],
        })
    const hook = {
      target: HOOK_HELPER,
      callData,
      gasLimit: isPreHook ? UNWRAP_GAS_LIMIT : WRAP_GAS_LIMIT,
    }
    const hookToEdit = context?.hookToEdit
    if (hookToEdit) {
      actions.editHook({ ...hookToEdit, hook: { ...hookToEdit.hook, ...hook } })
    } else {
      actions.addHook({ hook })
    }
  }

  // --- Render ------------------------------------------------------------------------------------

  if (!context) return <main className="card">Connecting to CoW Swap…</main>

  if (context.chainId !== CHAIN_ID) {
    return <Notice>wstGBP lives on Ethereum mainnet — switch network to use this hook.</Notice>
  }
  if (!HELPER_DEPLOYED) {
    return <Notice>The WsgemHookHelper contract is not deployed yet — check back soon.</Notice>
  }
  if (!account) {
    return <Notice>Connect a wallet in CoW Swap to configure this hook.</Notice>
  }
  if (!order) {
    return (
      <Notice>
        Fill in the swap form first: {isPreHook ? 'a sell of tGBP (the pre-hook redeems your wstGBP to fund it)' : 'a buy of tGBP (the post-hook wraps the proceeds into wstGBP)'}.
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

  return (
    <main className="card">
      <h1>{isPreHook ? 'Unwrap wstGBP → tGBP (pre-hook)' : 'Wrap tGBP → wstGBP (post-hook)'}</h1>

      {isPreHook && unwrap ? (
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
      ) : wrap ? (
        <dl>
          <dt>Order buys (min, surplus is swept too)</dt>
          <dd>{fmt(wrap.proceeds)} tGBP</dd>
          <dt>Expected wstGBP out</dt>
          <dd>
            ≥ {fmt(wrap.minOut)} (est. {fmt(wrap.expectedOut)})
          </dd>
          <dt>Wraps at mintcost</dt>
          <dd>{mintcost ? fmt(mintcost, 6) : '…'} tGBP / wstGBP</dd>
        </dl>
      ) : null}

      <p className="fine">
        The helper is owner-bound: it can only pull what you approve and always pays the output back to
        your own address, at the wstGBP protocol&apos;s oracle price.
      </p>

      {error && <p className="error">{error}</p>}

      {!approved ? (
        <button disabled={busy} onClick={onApprove}>
          {busy
            ? 'Approving…'
            : `Approve ${fmt(requiredApproval ?? 0n)} ${isPreHook ? 'wstGBP' : 'tGBP'}`}
        </button>
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
