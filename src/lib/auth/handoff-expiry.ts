export function isHandoffExpired(token: Record<string, unknown> | null | undefined): boolean {
  return typeof token?.handoffUntil === 'number' && Date.now() > token.handoffUntil
}
