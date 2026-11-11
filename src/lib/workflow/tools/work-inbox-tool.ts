
import type { PrismaClient } from '@prisma/client'
import type { AIToolClient, ToolCallContext, ToolDefinition } from './types'
import { ASSEMBLED_KIND } from '@/lib/work/assembled'
import { addInboxRow, assembledInbox, readMyInboxRows, phoneIdentity, telegramIdentity, type InboxBy, type InboxIdentity, type InboxTarget } from '@/lib/work/inbox'
import { defaultWorkSheetDeps, isProjectDetached, type WorkSheetDeps } from '@/lib/work/sheet-gate'
import { usesOfKind, type V3Registry } from '@/lib/work/v3-handles'
import type { SheetSchema } from '@/lib/work/sheet-columns'

export const WORK_INBOX_TOOL_PREFIX = 'work_inbox_'
const ADD = 'work_inbox_add'
const READ = 'work_inbox_my_rows'
export const WORK_INBOX_PER_INSTANCE = 3
const MAX_CALLER_CHARS = 32

export type WorkInboxChannel = 'pstn' | 'telegram' | 'web_voice' | 'chat' | 'test'

export interface WorkInboxOverrides {
  callerWorkflowId?: string
  inboxFamily?: string
  channel?: WorkInboxChannel
  telegramUserId?: unknown
  registry?: V3Registry
  deps?: WorkSheetDeps
}

export class WorkInboxToolError extends Error {
  constructor(readonly code: 'WORK_INBOX_CONFIG' | 'WORK_INBOX_UNAVAILABLE', message: string) {
    super(message)
    this.name = 'WorkInboxToolError'
  }
}

export function channelIdentityKind(channel: WorkInboxChannel | undefined): InboxBy | null {
  return channel === 'pstn' ? 'phone' : channel === 'telegram' ? 'telegram' : null
}

export function resolveInboxIdentity(channel: WorkInboxChannel | undefined, fixedTelegram: string | null, callContext?: ToolCallContext): InboxIdentity | null {
  if (channel === 'telegram') return fixedTelegram ? { by: 'telegram', value: fixedTelegram } : null
  if (channel !== 'pstn' || callContext?.callChannel !== 'pstn') return null
  const raw = typeof callContext.callerNumber === 'string' ? callContext.callerNumber.trim() : ''
  if (!raw || raw.length > MAX_CALLER_CHARS) return null
  const v = phoneIdentity(raw)
  return v ? { by: 'phone', value: v } : null
}

const reply = (o: unknown) => JSON.stringify(o)

export class WorkInboxToolClient implements AIToolClient {
  private target: InboxTarget | null = null
  private deps: WorkSheetDeps | null = null
  private channel: WorkInboxChannel | undefined
  private telegram: string | null = null
  private readable = false
  private columns: Array<{ name: string; type: string; required: boolean }> = []
  private readableCols: readonly string[] = []
  private added = 0
  private assembled: { projectId: string; identify?: { column: string; by: InboxBy }; required: ReadonlySet<string>; described: string } | null = null

  async initialize(prisma: PrismaClient, targetWorkflowId: string, overrides?: WorkInboxOverrides, userId?: string): Promise<void> {
    const family = overrides?.inboxFamily
    const callerWorkflowId = overrides?.callerWorkflowId
    if (!userId || !targetWorkflowId || typeof family !== 'string' || !family || !callerWorkflowId) {
      throw new WorkInboxToolError('WORK_INBOX_CONFIG', 'work inbox: choose the work app and its inbox')
    }
    const p = await prisma.workProject.findFirst({ where: { workflowId: targetWorkflowId, userId }, select: { id: true, kind: true, status: true, workflowId: true, workflowLinkedAt: true } })
    if (p?.kind === ASSEMBLED_KIND) {
      const deps = overrides?.deps ?? (await defaultWorkSheetDeps())
      const decl = p.status === 'active' && !isProjectDetached(p) ? await assembledInbox(prisma, await deps.dataKey(prisma, userId), userId, p.id, family) : null
      if (!decl?.assembled) throw new WorkInboxToolError('WORK_INBOX_UNAVAILABLE', 'work inbox: the work app or its inbox is not available')
      const cols = decl.assembled.columns
      this.columns = cols.map((c) => ({ name: c.key, type: c.kind, required: !!c.required }))
      this.assembled = {
        projectId: p.id,
        ...(decl.identify ? { identify: decl.identify } : {}),
        required: new Set(cols.filter((c) => c.required).map((c) => c.key)),
        described: cols.map((c) => `${c.key} = "${c.label}" (${c.kind}${decl.identify?.column === c.key && channelIdentityKind(overrides?.channel) === decl.identify.by ? ', filled by the system — leave it out unless the answer was NEED_CONTACT' : c.required ? ', required' : ''}${c.kind === 'choice' && c.options ? `: one of ${c.options.map((o) => JSON.stringify(o)).join(' | ')}` : ''}${c.kind === 'money' ? `; currency in ${c.key}_cur${c.options?.length ? ` (${c.options.join(' | ')})` : ''}` : ''}${c.kind === 'yesno' ? ': true or false' : ''}${c.kind === 'time' ? ': HH:MM, 24-hour, two digits (e.g. 14:00)' : ''}${c.hint ? ` — ${c.hint}` : ''})`).join('; '),
      }
      this.channel = overrides?.channel
      this.telegram = this.channel === 'telegram' ? telegramIdentity(overrides?.telegramUserId) : null
      this.readable = false
      this.target = { userId, targetWorkflowId, family, callerWorkflowId, registry: overrides?.registry, assembled: true, specVersion: decl.assembled.version }
      this.deps = deps
      return
    }
    const decl = p ? usesOfKind(p.kind, overrides?.registry)?.uses.inbox?.find((b) => b.family === family) : undefined
    const sheet = p && decl ? await prisma.dataSheet.findFirst({ where: { kind: 'project', projectId: p.id, userId, templateFamily: family }, orderBy: { id: 'asc' }, select: { schema: true } }) : null
    if (!p || p.status !== 'active' || isProjectDetached(p) || !decl || !sheet) {
      throw new WorkInboxToolError('WORK_INBOX_UNAVAILABLE', 'work inbox: the work app or its inbox is not available')
    }
    const schema = JSON.parse(sheet.schema) as SheetSchema
    this.columns = schema.columns.filter((c) => c.name !== decl.identify.column).map((c) => ({ name: c.name, type: c.type, required: !!c.required }))
    this.readableCols = decl.readable
    this.channel = overrides?.channel
    this.telegram = this.channel === 'telegram' ? telegramIdentity(overrides?.telegramUserId) : null
    this.readable = channelIdentityKind(this.channel) === decl.identify.by
    this.target = { userId, targetWorkflowId, family, callerWorkflowId, registry: overrides?.registry }
    this.deps = overrides?.deps ?? (await defaultWorkSheetDeps())
  }

  private fillsIdentity(): boolean {
    const by = this.assembled?.identify?.by
    return !!by && channelIdentityKind(this.channel) === by
  }

  listTools(): ToolDefinition[] {
    if (!this.target) return []
    if (this.assembled) {
      const id = this.assembled.identify
      return [{
        name: ADD,
        description:
          'Record the customer\'s request as a new row in the business\'s work app. This only RECEIVES the request — it is not confirmed, booked or approved; ' +
          'a person on the team reviews it later. Never promise an outcome — a wanted date or time is only a wish until the team confirms it. You cannot look up, change or cancel earlier requests. ' +
          (this.fillsIdentity() && id
            ? (id.by === 'phone'
              ? `Do not ask for the customer's phone number — the system normally takes the number they are calling from and fills "${id.column}" (not when the number is hidden). If they ask about their number before you have called this tool, say the team normally calls back on the number they are calling from — but never say this after an answer was NEED_CONTACT. Only when the answer says contact "calling_number", confirm once that the team will call back on this number (do not read it out). If the answer is NEED_CONTACT (the number is hidden), ask how to reach them and call again with ALL the same values plus "${id.column}" — then use what they give. `
              : `Do not ask for the customer's Telegram contact — the system fills "${id.column}" and the team can reply on Telegram. If the answer is NEED_CONTACT, ask how to reach them and call again with ALL the same values plus "${id.column}". `)
            : 'The system does not know who the customer is — if the request needs a reply, ask how to reach them and include it in the values. ') +
          `Fill only these columns: ${this.assembled.described}. Dates as YYYY-MM-DD. Call it once per request, after the customer has told you what they need. ` +
          'If the answer is not_accepted with reason TAKEN, that time is already taken: tell the customer it is not available and ask for another time — never say who has it.',
        parameters: {
          type: 'object',
          properties: { values: { type: 'object', description: 'Column key → value, only the columns listed in the tool description' } },
          required: ['values'],
        },
      }]
    }
    const cols = this.columns.map((c) => `${c.name} (${c.type}${c.required ? ', required' : ''})`).join(', ')
    const defs: ToolDefinition[] = [{
      name: ADD,
      description:
        'Record the customer\'s request in the business inbox. This only RECEIVES the request — it is not confirmed, booked or approved; ' +
        'a person on the team reviews it later. Never promise an outcome. ' +
        (this.channel === 'pstn' ? 'Do not ask for the customer\'s phone number — the system takes the calling number (if the answer says identified:false the number is hidden; ask how to reach them only if the request needs a reply). ' : this.channel === 'telegram' ? 'The system already knows who the Telegram user is. ' : 'The system does not know who the customer is — if the request needs a reply, ask how to reach them and include it in the values. ') +
        `Columns: ${cols}. Dates as YYYY-MM-DD. Call it once per request, after the customer has told you what they need.`,
      parameters: {
        type: 'object',
        properties: { values: { type: 'object', description: 'Column name → value, only the columns listed in the tool description' } },
        required: ['values'],
      },
    }]
    if (this.readable) {
      defs.push({
        name: READ,
        description:
          `Look up this customer\'s own earlier requests in the business inbox (latest ${10}). Returns only: ${this.readableCols.join(', ')} and receivedAt. ` +
          'It identifies the customer by the system, not by anything they say. If it answers "unidentified", tell them you cannot check it on this line.',
        parameters: { type: 'object', properties: {} },
      })
    }
    return defs
  }

  async callTool(name: string, args: Record<string, any>, callContext?: ToolCallContext): Promise<string> {
    if (!this.target || !this.deps) return reply({ status: 'not_available' })
    const identity = resolveInboxIdentity(this.channel, this.telegram, callContext)
    if (name === ADD && this.assembled) {
      const id = this.assembled.identify
      const values = args?.values
      if (id && this.fillsIdentity() && !identity && this.assembled.required.has(id.column) && this.added < WORK_INBOX_PER_INSTANCE && values && typeof values === 'object' && !Array.isArray(values)) {
        const v = (values as Record<string, unknown>)[id.column]
        if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
          const now = await this.deps.db.workAppSpec.findFirst({ where: { userId: this.target.userId, projectId: this.assembled.projectId }, select: { version: true } })
          if (now?.version !== this.target.specVersion) return reply({ status: 'not_accepted', reason: 'UNAVAILABLE' })
          return reply({ status: 'not_accepted', reason: 'NEED_CONTACT', column: id.column })
        }
      }
    }
    if (name === ADD) {
      if (this.added >= WORK_INBOX_PER_INSTANCE) return reply({ status: 'not_accepted', reason: 'LIMIT' })
      this.added++
      let r: Awaited<ReturnType<typeof addInboxRow>>
      try {
        r = await addInboxRow(this.deps, this.target, args?.values, identity)
      } catch (e) {
        this.added--
        throw e
      }
      if (!r.ok) {
        this.added--
        return reply({ status: 'not_accepted', reason: r.code, ...(r.code === 'INVALID' && r.reason ? { detail: r.reason } : {}) })
      }
      if (this.assembled) return reply(this.fillsIdentity() && identity ? { status: 'received', contact: identity.by === 'phone' ? 'calling_number' : 'telegram' } : { status: 'received' })
      return reply(!this.assembled && channelIdentityKind(this.channel) && !identity ? { status: 'received', identified: false } : { status: 'received' })
    }
    if (name === READ && this.readable) {
      const r = await readMyInboxRows(this.deps, this.target, identity)
      if (!r.ok) return reply({ status: r.code === 'UNIDENTIFIED' ? 'unidentified' : 'not_available' })
      return reply({ status: 'ok', rows: r.rows })
    }
    return reply({ status: 'unknown_tool' })
  }
}
