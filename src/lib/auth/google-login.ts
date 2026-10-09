import { isSelfHosted } from '@/lib/edition'

export function isGoogleLoginEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (!isSelfHosted(env)) return true
  return !!(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim())
}

export function gmailMustUseGoogle(email: string, env: Record<string, string | undefined> = process.env): boolean {
  return !isSelfHosted(env) && email.trim().toLowerCase().endsWith('@gmail.com')
}
