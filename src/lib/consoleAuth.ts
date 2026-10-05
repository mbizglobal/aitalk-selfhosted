import type { NextRequest } from 'next/server'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export function getConsoleAdminCookieOptions(): { name: string; httpOnly: boolean; sameSite: 'lax'; path: string; secure: boolean; maxAge: number } {
  return { name: 'console_admin', httpOnly: true, sameSite: 'lax', path: '/', secure: true, maxAge: 0 }
}
export async function issueConsoleAdminToken(_email: string): Promise<string> {
  return unavailable('Operator sign-in')
}
export async function getConsoleAdminOrSession(_req: NextRequest): Promise<{ email: string; via: 'console-token' | 'session' } | null> {
  return null
}
