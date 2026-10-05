export type PrismaLogLevel = 'error' | 'warn'

export function resolvePrismaLogLevel(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): PrismaLogLevel[] {
  return nodeEnv === 'production' ? [] : ['error', 'warn']
}
