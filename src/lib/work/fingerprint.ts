import { createHmac } from 'crypto'

export function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
}

export function fingerprint(key: Buffer, label: string, v: unknown): string {
  return createHmac('sha256', key).update(`work.reference.${label}\0`).update(stable(v)).digest('hex')
}
