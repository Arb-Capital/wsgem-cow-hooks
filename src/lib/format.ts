import { formatUnits } from 'viem'

/** Render a WAD amount with a sane number of decimals for the UI. */
export function fmt(amount: bigint, decimals = 4): string {
  const s = formatUnits(amount, 18)
  const [int, frac = ''] = s.split('.')
  return frac ? `${int}.${frac.slice(0, decimals)}` : int
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

/** ceil(a * WAD / p) — the exact-output rounding the helper's unwrap needs to cover a claim. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}
