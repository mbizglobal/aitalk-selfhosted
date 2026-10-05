
export const SAFE_LINK_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:', 'https:', 'mailto:', 'tel:',
])

export const SAFE_IMAGE_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:', 'https:',
])

export function toSafeUrl(raw: string, allowed: ReadonlySet<string>): string | null {
  try {
    const parsed = new URL(raw.trim())
    return allowed.has(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}
