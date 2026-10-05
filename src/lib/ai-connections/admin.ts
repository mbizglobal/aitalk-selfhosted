import { isSelfHosted } from '@/lib/edition'

export function aiConnectionAdmins(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.SELFHOSTED_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
}

export function canManageAiConnections(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!isSelfHosted(env)) return false
  if (typeof email !== 'string' || !email.trim()) return false
  return aiConnectionAdmins(env).has(email.trim().toLowerCase())
}
