/** Money as text "12.50" → cents (bigint) and back. Pure — no core import needed */
const MONEY = /^(-)?(\d+)(?:\.(\d{1,2}))?$/
const ZERO = BigInt(0)
const HUNDRED = BigInt(100)

export function toCents(v: unknown): bigint | null {
  const m = typeof v === 'string' ? MONEY.exec(v.trim()) : null
  if (!m) return null
  const cents = BigInt(m[2]) * HUNDRED + BigInt((m[3] ?? '').padEnd(2, '0') || '0')
  return m[1] ? -cents : cents
}

export function fromCents(c: bigint): string {
  const neg = c < ZERO
  const a = neg ? -c : c
  return `${neg ? '-' : ''}${a / HUNDRED}.${String(a % HUNDRED).padStart(2, '0')}`
}
