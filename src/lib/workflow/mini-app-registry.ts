
export type MiniAppChannel = 'schedule' | 'pstn'
export type MiniAppRuntime = 'engine' | 'speech-session'

export const MINI_APP_REGISTRY = {
  quiz: { channels: ['schedule'] as const, runtime: 'engine' as const, handle: 'miniapps', label: 'Quiz' },
  voice_quiz: { channels: ['pstn'] as const, runtime: 'speech-session' as const, handle: 'miniapps', label: 'Voice Quiz' },
} as const

export type MiniAppType = keyof typeof MINI_APP_REGISTRY

export const MINI_APP_TYPES = Object.keys(MINI_APP_REGISTRY) as MiniAppType[]

export function runtimeForChannel(channel: string): MiniAppRuntime | null {
  if (channel === 'schedule') return 'engine'
  if (channel === 'pstn') return 'speech-session'
  return null
}

export function isMiniAppType(t: unknown): t is MiniAppType {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(MINI_APP_REGISTRY, t)
}

export function miniAppsForChannel(channel: string): MiniAppType[] {
  return MINI_APP_TYPES.filter((t) => (MINI_APP_REGISTRY[t].channels as readonly string[]).includes(channel))
}

export function isMiniAppAllowedOn(type: unknown, channel: string): boolean {
  if (!isMiniAppType(type)) return false
  const spec = MINI_APP_REGISTRY[type]
  if (!(spec.channels as readonly string[]).includes(channel)) return false
  return runtimeForChannel(channel) === spec.runtime
}

export function miniAppsRunBy(runtime: MiniAppRuntime): MiniAppType[] {
  return MINI_APP_TYPES.filter((t) => MINI_APP_REGISTRY[t].runtime === runtime)
}

export function isMiniAppNode(n: any): boolean {
  return n?.type === 'tool' && n?.data?.nodeType === 'miniapp' && isMiniAppType(n?.data?.miniAppType)
}

export function isMiniAppNodeOfType(n: any, type: MiniAppType): boolean {
  return isMiniAppNode(n) && n.data.miniAppType === type
}

export function miniAppChannelOf(nodes: any[]): string | null {
  const start = (nodes || []).find((n: any) => n?.data?.nodeType === 'start' && typeof n?.data?.triggerType === 'string')
  return start ? start.data.triggerType : null
}
