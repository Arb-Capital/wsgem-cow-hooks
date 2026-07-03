import { formatUnits, isAddressEqual, type Address } from 'viem'

/** Render a WAD amount with a sane number of decimals for the UI. */
export function fmt(amount: bigint, decimals = 4): string {
  const s = formatUnits(amount, 18)
  const [int, frac = ''] = s.split('.')
  return frac ? `${int}.${frac.slice(0, decimals)}` : int
}

/** Case-insensitive address equality; false (never throws) for missing or malformed inputs. */
export function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  try {
    return isAddressEqual(a as Address, b as Address)
  } catch {
    return false
  }
}

/** ceil(a / b) — the exact-output rounding the helper's unwrap needs to cover a claim. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}
