// Minimal ABIs — only what the dapp calls.

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

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

// Live oracle prices straight off the wrapper (WAD, tGBP-per-wstGBP).
export const WRAPPER_PRICE_ABI = [
  { type: 'function', name: 'mintcost', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'burncost', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const
