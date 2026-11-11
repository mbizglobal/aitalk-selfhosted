import { getAppBaseUrl } from '@/lib/app-url'

export const PUBLIC_LINK_PATH = '/d/'

export function publicLinkUrl(token: string, env: Record<string, string | undefined> = process.env): string | null {
  try {
    return `${getAppBaseUrl(env).replace(/\/+$/, '')}${PUBLIC_LINK_PATH}${token}`
  } catch {
    return null
  }
}
