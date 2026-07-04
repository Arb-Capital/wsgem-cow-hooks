// Minimal ABIs — only what the dapp calls. ERC-20 calls use viem's exported `erc20Abi`.

export const HELPER_ABI = [
  {
    type: 'function',
    name: 'wrapAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'unwrap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

// Live oracle prices straight off the wrapper (WAD, base-per-wrapped, e.g. tGBP-per-wstGBP).
export const WRAPPER_PRICE_ABI = [
  { type: 'function', name: 'mintcost', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'burncost', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const
