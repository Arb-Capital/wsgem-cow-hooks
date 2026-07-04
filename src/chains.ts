import type { Chain } from 'viem'
import { arbitrum, avalanche, base, gnosis, mainnet, polygon, sepolia } from 'viem/chains'

// viem chain objects for the networks CoW Protocol supports. A venue's chainId must have an entry
// here (build-checked in vite.config.ts); extend this map when a venue launches on a new network.
export const CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [gnosis.id]: gnosis,
  [polygon.id]: polygon,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [avalanche.id]: avalanche,
  [sepolia.id]: sepolia,
}
