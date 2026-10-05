import { isSelfHosted } from '@/lib/edition'

const CLOUD_FALLBACK = 'https://www.aitalk.ch'

export function getAppBaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (!isSelfHosted(env)) return env.NEXTAUTH_URL || CLOUD_FALLBACK
  const url = env.NEXTAUTH_URL?.trim()
  if (!url) throw new Error('NEXTAUTH_URL is required for a self-hosted installation (the address users open, e.g. https://ai.example.com)')
  let parsed: URL | null = null
  try { parsed = new URL(url) } catch { }
  if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('NEXTAUTH_URL must be an absolute http(s) address for a self-hosted installation (e.g. https://ai.example.com)')
  }
  return (parsed.origin + parsed.pathname).replace(/\/+$/, '')
}
