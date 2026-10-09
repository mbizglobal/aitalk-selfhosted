
import { prisma } from '@/lib/prisma'
import { isWorkflowPubliclyAccessible } from '@/lib/chat/public-access'
import { isAppWorkflow, pickNonAppWorkflow } from '@/lib/workflow/start-trigger'
import { isChannelEnabledForCalendarNode, loadAgentAppsTools } from '@/lib/workflow/tools/load-agent-tools'
import { assertServiceEntitlement } from '@/lib/entitlement'
import { isAgentLocked } from '@/lib/agent-lock'
import { MAX_OPEN_SLOTS, utcToIsoWithOffset, wallTimeToUtcMs } from '@/lib/calendar/slot-grid'
import type { AIToolClient } from '@/lib/workflow/tools/types'
import { isRealYmd } from './input'

export interface ResolvedBookingWidget {
  agentId: string
  userId: string
  agentName: string
  workflowId: string
  nodeData: any
  workflowLang: string | null
}

const CALENDAR_TOOL_TYPES = new Set(['google_calendar', 'microsoft_calendar'])

export function widgetCalendarNodesOf(wf: { nodes?: any[]; edges?: any[] }): any[] {
  const nodes = Array.isArray(wf?.nodes) ? wf.nodes : []
  const edges = Array.isArray(wf?.edges) ? wf.edges : []
  const aiNode = nodes.find((n: any) => n?.type === 'ai' || n?.data?.nodeType === 'ai')
  if (!aiNode) return []
  return edges
    .filter((e: any) => e?.source === aiNode.id && e?.sourceHandle === 'tools')
    .map((e: any) => nodes.find((n: any) => n?.id === e.target))
    .filter((n: any) => n?.type === 'tool' && CALENDAR_TOOL_TYPES.has(n?.data?.toolType) && n?.data?.connectionId)
    .filter((n: any) => isChannelEnabledForCalendarNode(n.data, 'booking_widget'))
}

export async function resolveBookingWidget(agentId: string): Promise<ResolvedBookingWidget | null> {
  if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(agentId)) return null
  const agent = await prisma.agent.findUnique({
    where: { agentId },
    select: { userId: true, title: true, accessMode: true },
  })
  if (!agent) return null
  const workflow = pickNonAppWorkflow(
    await prisma.workflow.findMany({
      where: { agentId, status: 'production' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { workflowJson: true, workflowId: true },
    })
  )
  if (!workflow?.workflowJson || isAppWorkflow(workflow.workflowJson)) return null
  let wf: { nodes?: any[]; edges?: any[] }
  try {
    wf = JSON.parse(workflow.workflowJson)
  } catch {
    return null
  }
  if (!isWorkflowPubliclyAccessible(wf?.nodes as any, agent.accessMode)) return null
  const calendars = widgetCalendarNodesOf(wf)
  if (calendars.length !== 1) return null
  const voiceStart = (wf.nodes ?? []).find(
    (n: any) => n?.data?.nodeType === 'start' && typeof n?.data?.language === 'string' && n.data.language.trim()
      && (n.data.triggerType === 'pstn' || n.data.webVoice?.enabled === true),
  )
  return {
    agentId,
    userId: agent.userId,
    agentName: agent.title || '',
    workflowId: workflow.workflowId,
    nodeData: calendars[0].data || {},
    workflowLang: voiceStart ? String(voiceStart.data.language).trim() : null,
  }
}

export async function isServiceAvailable(userId: string, agentId: string): Promise<boolean> {
  try {
    const r = await assertServiceEntitlement(userId)
    if (r.reason) return false
    return !(await isAgentLocked(agentId))
  } catch {
    return false
  }
}

export async function accountLocaleOf(userId: string): Promise<string | null> {
  try {
    const s = await prisma.settings.findUnique({ where: { id: userId }, select: { locale: true } })
    return s?.locale || null
  } catch {
    return null
  }
}

export async function contactPhoneOf(agentId: string): Promise<string | null> {
  try {
    const cpn = await prisma.callPhoneNumber.findFirst({
      where: { agentId, isActive: true },
      select: { phoneNumber: true },
      orderBy: { createdAt: 'asc' },
    })
    return cpn?.phoneNumber || null
  } catch {
    return null
  }
}

export async function loadWidgetCalendarClient(r: ResolvedBookingWidget): Promise<AIToolClient | null> {
  const loaded = await loadAgentAppsTools(prisma, r.agentId, r.userId, r.workflowId, 'booking_widget')
  if (loaded.multiCalendar) return null
  return loaded.clients.get('book_calendar_event') ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export function todayYmdIn(timezone: string, nowMs: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function dayBoundsIso(ymd: string, timezone: string): { start: string; end: string } {
  return {
    start: utcToIsoWithOffset(wallTimeToUtcMs(`${ymd}T00:00`, timezone), timezone),
    end: utcToIsoWithOffset(wallTimeToUtcMs(`${addDaysYmd(ymd, 1)}T00:00`, timezone), timezone),
  }
}

export function isBookableDate(ymd: string, timezone: string, bookingWindowDays: number, nowMs: number = Date.now()): boolean {
  if (!isRealYmd(ymd)) return false
  const today = todayYmdIn(timezone, nowMs)
  if (ymd < today) return false
  if (bookingWindowDays > 0 && ymd > addDaysYmd(today, bookingWindowDays)) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export type DaySlots = { ok: true; starts: string[] } | { ok: false; reason: 'party_too_large' | 'unavailable' }

export async function fetchDaySlots(client: AIToolClient, ymd: string, timezone: string, party: number | null): Promise<DaySlots> {
  const { start, end } = dayBoundsIso(ymd, timezone)
  const seen = new Set<string>()
  const starts: string[] = []
  let from = start
  for (let round = 0; round < 6; round++) {
    const raw = await client.callTool('check_calendar_availability', {
      start_iso: from,
      end_iso: end,
      ...(party ? { party_size: party } : {}),
    }, { callChannel: 'booking_widget' })
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
    if (!parsed?.success) return { ok: false, reason: parsed?.error === 'party_too_large' ? 'party_too_large' : 'unavailable' }
    const slots: Array<{ start?: unknown }> = Array.isArray(parsed.openSlots) ? parsed.openSlots : []
    for (const s of slots) {
      if (typeof s?.start === 'string' && !seen.has(s.start)) {
        seen.add(s.start)
        starts.push(s.start)
      }
    }
    if (slots.length < MAX_OPEN_SLOTS || starts.length === 0) break
    const lastMs = new Date(starts[starts.length - 1]).getTime()
    if (!Number.isFinite(lastMs)) break
    from = utcToIsoWithOffset(lastMs + 60_000, timezone)
  }
  starts.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  return { ok: true, starts }
}

const SLOT_CACHE_MS = 60_000
const gSlots = globalThis as unknown as { __aitalkSlotCache?: Map<string, { at: number; value: DaySlots }> }
const slotCache = (gSlots.__aitalkSlotCache ??= new Map<string, { at: number; value: DaySlots }>())

export async function cachedDaySlots(
  agentId: string,
  client: () => Promise<AIToolClient | null>,
  ymd: string,
  timezone: string,
  party: number | null,
): Promise<DaySlots> {
  const key = `${agentId}|${ymd}|${party ?? 0}`
  const hit = slotCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < SLOT_CACHE_MS) return hit.value
  const c = await client()
  if (!c) return { ok: false, reason: 'unavailable' }
  const value = await fetchDaySlots(c, ymd, timezone, party)
  if (value.ok) {
    slotCache.set(key, { at: now, value })
    if (slotCache.size > 5000) {
      for (const [k, v] of slotCache) if (now - v.at >= SLOT_CACHE_MS) slotCache.delete(k)
    }
  }
  return value
}

export function invalidateDaySlots(agentId: string, ymd: string): void {
  const prefix = `${agentId}|${ymd}|`
  for (const k of slotCache.keys()) if (k.startsWith(prefix)) slotCache.delete(k)
}
