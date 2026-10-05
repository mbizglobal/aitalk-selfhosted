
import { AIToolClient, ToolDefinition, ToolCallContext } from './types'
import { PrismaClient } from '@prisma/client'
import { GoogleCalendarToolClient } from './google-calendar-tool'
import { MicrosoftCalendarToolClient } from './microsoft-calendar-tool'
import { agentScopedWhere } from '@/lib/connection-scope'
import { createHash } from 'crypto'
import { describeCaughtError, safeLogId } from '@/lib/log-mask'
import { normalizeTableInventory } from '@/lib/calendar/table-inventory'

type CalendarToolType = 'google_calendar' | 'microsoft_calendar'

export interface CalendarNodeInput {
  nodeId: string
  toolType: CalendarToolType
  connectionId: string
  label: string
  nodeData: Record<string, any>
}

interface RosterEntry {
  displayName: string
  ownerEmail: string
  provider: CalendarToolType
}

export interface CalendarRosterEntry {
  key: string
  displayName: string
  ownerEmail: string
  provider: CalendarToolType
}

interface CapacityMeta {
  mode: 'single' | 'simple' | 'tables'
  simpleCapacity?: number
  tableInventory?: Array<{ name: string; capacity: number; count: number }>
  mealDurationMin?: number
}

export class MultiCalendarDispatcher implements AIToolClient {
  private clients = new Map<string, GoogleCalendarToolClient | MicrosoftCalendarToolClient>()
  private roster = new Map<string, RosterEntry>()
  private capacityMeta = new Map<string, CapacityMeta>()
  private okNodeIds = new Set<string>()
  private initialized = false

  async initialize(_prisma: PrismaClient, _connectionId: string): Promise<void> {
    throw new Error('Use MultiCalendarDispatcher.initializeMulti() instead')
  }

  async initializeMulti(
    prisma: PrismaClient,
    scope: { agentId?: string; userId?: string },
    calendarNodes: CalendarNodeInput[],
    staffTransferNumber: string,
    pstnCallbackNumber: string = '',
    channel?: 'pstn' | 'web_voice' | 'chat_widget' | 'test' | 'booking_widget',
    transferToolName: string = 'transfer_to_staff'
  ): Promise<void> {
    if (calendarNodes.length === 0) {
      throw new Error('MultiCalendarDispatcher: no calendar nodes provided')
    }
    if (calendarNodes.length > 15) {
      throw new Error('MultiCalendarDispatcher: max 15 calendars per workflow')
    }

    const failed: string[] = []
    for (const node of calendarNodes) {
      const key = this.makeKey(node.nodeId)
      const client =
        node.toolType === 'google_calendar'
          ? new GoogleCalendarToolClient()
          : new MicrosoftCalendarToolClient()

      const overrides = {
        ...this.extractOverrides(node.nodeData),
        agentId: scope.agentId,
        userId: scope.userId,
        accountId: node.nodeData?.accountId,
        staffTransferNumber,
        transferToolName,
        pstnCallbackNumber,
        channel,
      }
      try {
        await client.initialize(prisma, node.connectionId, overrides)
      } catch (error: any) {
        failed.push(`${safeLogId(node.nodeId)}: ${describeCaughtError(error)}`)
        continue
      }
      this.clients.set(key, client)
      this.okNodeIds.add(node.nodeId)

      const displayName = (node.label || node.nodeData?.label || 'Calendar').trim()
      const ownerEmail = await this.resolveOwnerEmail(prisma, scope, node.nodeData?.accountId)
      this.roster.set(key, {
        displayName,
        ownerEmail,
        provider: node.toolType,
      })

      const mode = ((node.nodeData?.capacityMode as string) === 'simple' || (node.nodeData?.capacityMode as string) === 'tables')
        ? (node.nodeData.capacityMode as 'simple' | 'tables')
        : 'single'
      this.capacityMeta.set(key, {
        mode,
        simpleCapacity: typeof node.nodeData?.simpleCapacity === 'number' ? node.nodeData.simpleCapacity : undefined,
        tableInventory: Array.isArray(node.nodeData?.tableInventory) ? normalizeTableInventory(node.nodeData.tableInventory) : undefined,
        mealDurationMin: typeof node.nodeData?.mealDurationMin === 'number' ? node.nodeData.mealDurationMin : undefined,
      })
    }

    if (failed.length > 0) {
      console.error(`[MultiCalendar] ${failed.length}/${calendarNodes.length} 캘린더 초기화 실패 — 제외하고 진행:`, failed)
    }
    if (this.clients.size === 0) {
      throw new Error(`MultiCalendarDispatcher: all ${calendarNodes.length} calendars failed to initialize`)
    }
    this.initialized = true
  }

  initializedNodeIds(): ReadonlySet<string> {
    return this.okNodeIds
  }

  setBookingMessagePrompt(prompt: string | undefined): void {
    for (const client of this.clients.values()) client.setBookingMessagePrompt(prompt)
  }

  hasAnyCapacityCalendar(): boolean {
    return Array.from(this.capacityMeta.values()).some(m => m.mode === 'simple' || m.mode === 'tables')
  }

  capacityCalendarKeys(): string[] {
    return Array.from(this.capacityMeta.entries())
      .filter(([_k, m]) => m.mode === 'simple' || m.mode === 'tables')
      .map(([k]) => k)
  }

  calendarKeys(): string[] {
    return Array.from(this.clients.keys())
  }

  async fanoutLookup(
    contact: { phone?: string; email?: string; name?: string },
    callContext: ToolCallContext | undefined,
    timeoutMs = 1500
  ): Promise<Array<{ calendarKey: string; calendarName: string; appointments: any[]; status: 'ok' | 'timeout' | 'error' }>> {
    if (!this.initialized) return []
    const baseArgs: Record<string, any> = {}
    if (contact.phone) baseArgs.patient_phone = contact.phone
    if (contact.email) baseArgs.patient_email = contact.email
    if (contact.name) baseArgs.patient_name = contact.name

    const start = Date.now()
    const tasks = Array.from(this.clients.keys()).map(async (key) => {
      const calendarName = this.roster.get(key)?.displayName || key
      try {
        const remaining = Math.max(0, timeoutMs - (Date.now() - start))
        if (remaining <= 0) {
          return { calendarKey: key, calendarName, appointments: [] as any[], status: 'timeout' as const }
        }
        let timedOut = false
        const raw = await Promise.race([
          this.callTool('lookup_appointments', { ...baseArgs, calendar: key }, callContext),
          new Promise<string>((_, reject) =>
            setTimeout(() => {
              timedOut = true
              reject(new Error('preflight_timeout'))
            }, remaining)
          ),
        ])
        const parsed = JSON.parse(raw)
        if (!parsed?.success || !Array.isArray(parsed.appointments)) {
          return { calendarKey: key, calendarName, appointments: [] as any[], status: 'ok' as const }
        }
        return { calendarKey: key, calendarName, appointments: parsed.appointments, status: 'ok' as const }
      } catch {
        return { calendarKey: key, calendarName, appointments: [] as any[], status: 'timeout' as const }
      }
    })
    return Promise.all(tasks)
  }

  rosterEntries(): CalendarRosterEntry[] {
    return Array.from(this.roster.entries()).map(([key, v]) => ({
      key,
      displayName: v.displayName,
      ownerEmail: v.ownerEmail,
      provider: v.provider,
    }))
  }

  buildRosterPreamble(): string {
    const entries = Array.from(this.roster.entries())
    if (entries.length === 0) return ''
    const lines = entries.map(([key, v]) => `${key}=${v.displayName}`).join(', ')
    const base = `Calendars: ${lines}. Pass the matching key as "calendar" parameter.`

    if (!this.hasAnyCapacityCalendar()) return base

    const capacityLines = entries.map(([key, v]) => {
      const meta = this.capacityMeta.get(key)
      const displayName = v.displayName
      if (!meta || meta.mode === 'single') {
        return `- ${key} (${displayName}): single — DO NOT ask "How many people?", DO NOT pass party_size.`
      }
      if (meta.mode === 'simple') {
        const cap = meta.simpleCapacity ?? 1
        return `- ${key} (${displayName}): simple capacity ${cap} — ask "How many people?" and pass party_size (default 1).`
      }
      // tables
      const summary = (meta.tableInventory || [])
        .map(t => `${t.name}(seats ${t.capacity}, qty ${t.count})`)
        .join(', ')
      return `- ${key} (${displayName}): table inventory (${summary || 'no tables defined'}) — REQUIRED to ask "How many people?" and pass party_size.`
    })

    return `${base}\n\nAUTHORITATIVE per-calendar capacity policy (overrides any "How many people?" guidance in tool descriptions):\n${capacityLines.join('\n')}`
  }

  listTools(): ToolDefinition[] {
    if (!this.initialized) return []

    const enumValues = Array.from(this.clients.keys())
    const rosterText = this.buildRosterPreamble()

    const baseTools = this.unionToolDefinitions()

    return baseTools.map((t, idx) => {
      const params = t.parameters as any
      const augmentedProps = {
        calendar: {
          type: 'string',
          enum: enumValues,
          description: `Which calendar this call targets. ${rosterText.split('\n')[0]}`,
        },
        ...(params?.properties || {}),
      }
      const augmentedRequired = ['calendar']

      const description =
        idx === 0
          ? `${t.description}\n\n${rosterText}`
          : `${t.description} See check_calendar_availability for the calendar roster and capacity policy.`

      return {
        name: t.name,
        description,
        parameters: {
          ...params,
          properties: augmentedProps,
          required: augmentedRequired,
        },
      }
    })
  }

  private unionToolDefinitions(): ToolDefinition[] {
    const byName = new Map<string, { description: string; properties: Record<string, any>; required: string[] }>()

    for (const client of this.clients.values()) {
      for (const tool of client.listToolsForDispatcher()) {
        const params = tool.parameters as any
        const props = params?.properties || {}
        const required: string[] = Array.isArray(params?.required) ? params.required : []

        const existing = byName.get(tool.name)
        if (!existing) {
          byName.set(tool.name, {
            description: tool.description,
            properties: { ...props },
            required: [...required],
          })
          continue
        }
        for (const [propKey, propSchema] of Object.entries(props)) {
          if (!(propKey in existing.properties)) {
            existing.properties[propKey] = propSchema
          }
        }
      }
    }

    //
    for (const [toolName, v] of byName) {
      if (v.properties.duration_min) {
        v.properties.duration_min = {
          ...v.properties.duration_min,
          description:
            'Appointment duration in minutes. For table-inventory calendars the server uses the configured meal duration regardless of this value.',
        }
      }
      if (v.properties.party_size) {
        v.properties.party_size = {
          ...v.properties.party_size,
          description: toolName === 'check_calendar_availability'
            ? 'Number of people, once the caller has said it (concurrent-capacity / table-inventory calendars only). When given, "openSlots" lists only times where this group fits. IGNORED for sequential calendars — do not pass it.'
            : 'Number of people for the booking. Per selected calendar policy (see AUTHORITATIVE list in the tool description): REQUIRED for table-inventory calendars; optional (default 1) for concurrent-capacity calendars; IGNORED for sequential calendars — do not pass it.',
        }
      }
      if (v.properties.start_iso) {
        v.properties.start_iso = {
          ...v.properties.start_iso,
          description: "Datetime in ISO 8601 using the selected calendar's configured timezone (DST-aware).",
        }
      }
      if (v.properties.end_iso) {
        v.properties.end_iso = {
          ...v.properties.end_iso,
          description: "Time window end in ISO 8601 using the selected calendar's configured timezone.",
        }
      }
      if (v.properties.requested_start_iso) {
        v.properties.requested_start_iso = {
          ...v.properties.requested_start_iso,
          description: "Optional — the exact start time the caller asked for, in ISO 8601 using the selected calendar's configured timezone. Must lie inside start_iso–end_iso.",
        }
      }
      if (v.properties.new_start_iso) {
        v.properties.new_start_iso = {
          ...v.properties.new_start_iso,
          description: "New event start in ISO 8601 using the selected calendar's configured timezone (DST-aware).",
        }
      }
    }

    return Array.from(byName.entries()).map(([name, v]) => ({
      name,
      description: v.description,
      parameters: {
        type: 'object',
        properties: v.properties,
        required: v.required,
      },
    }))
  }

  async callTool(
    name: string,
    args: Record<string, any>,
    callContext?: ToolCallContext
  ): Promise<string> {
    const calendarKey = String(args?.calendar || '')
    if (!calendarKey) {
      return JSON.stringify({
        success: false,
        error: 'calendar_parameter_missing',
        available: Array.from(this.clients.keys()),
        message:
          'You must include the "calendar" parameter (one of the available keys) when calling a multi-calendar tool. Ask the caller which calendar they want.',
      })
    }

    const client = this.clients.get(calendarKey)
    if (!client) {
      return JSON.stringify({
        success: false,
        error: 'unknown_calendar',
        available: Array.from(this.clients.keys()),
        message: `Calendar key "${calendarKey}" not found. Available: ${Array.from(this.clients.keys()).join(', ')}`,
      })
    }

    const { calendar: _omit, ...rest } = args
    return client.callTool(name, rest, callContext)
  }

  // ========================================
  // ========================================

  private makeKey(nodeId: string): string {
    const hash = createHash('sha256').update(nodeId).digest('hex').slice(0, 6)
    return `cal_${hash}`
  }

  private extractOverrides(d: Record<string, any> | undefined): Record<string, any> {
    if (!d) return {}
    return {
      calendarId: d.calendarId || d.googleCalendarId || d.microsoftCalendarId,
      timezone: d.timezone || d.googleCalendarTimezone || d.microsoftCalendarTimezone,
      workingHoursStart:
        d.workingHoursStart || d.googleCalendarWorkingStart || d.microsoftCalendarWorkingStart,
      workingHoursEnd:
        d.workingHoursEnd || d.googleCalendarWorkingEnd || d.microsoftCalendarWorkingEnd,
      defaultDurationMin:
        d.defaultDurationMin ||
        d.googleCalendarDefaultDuration ||
        d.microsoftCalendarDefaultDuration,
      inviteAttendee:
        typeof d.inviteAttendee === 'boolean'
          ? d.inviteAttendee
          : typeof d.googleCalendarInviteAttendee === 'boolean'
            ? d.googleCalendarInviteAttendee
            : d.microsoftCalendarInviteAttendee,
      notifyOnBook:
        typeof d.notifyOnBook === 'boolean'
          ? d.notifyOnBook
          : typeof d.googleCalendarNotifyOnBook === 'boolean'
            ? d.googleCalendarNotifyOnBook
            : d.microsoftCalendarNotifyOnBook,
      notifyOnReschedule:
        typeof d.notifyOnReschedule === 'boolean'
          ? d.notifyOnReschedule
          : typeof d.googleCalendarNotifyOnReschedule === 'boolean'
            ? d.googleCalendarNotifyOnReschedule
            : d.microsoftCalendarNotifyOnReschedule,
      notifyOnCancel:
        typeof d.notifyOnCancel === 'boolean'
          ? d.notifyOnCancel
          : typeof d.googleCalendarNotifyOnCancel === 'boolean'
            ? d.googleCalendarNotifyOnCancel
            : d.microsoftCalendarNotifyOnCancel,
      bookingWindowDays: d.bookingWindowDays,
      historyLookupDays: d.historyLookupDays,
      cancellationPolicy: d.cancellationPolicy,
      reschedulePolicy: d.reschedulePolicy,
      breakTimes: d.breakTimes,
      weeklyClosedDays: d.weeklyClosedDays,
      holidays: d.holidays,
      closedRanges: d.closedRanges,
      cleanupMin: d.cleanupMin,
      capacityMode: d.capacityMode,
      simpleCapacity: d.simpleCapacity,
      tableInventory: d.tableInventory,
      mealDurationMin: d.mealDurationMin,
      reservationGridMin: d.reservationGridMin,
      tableMatchPolicy: d.tableMatchPolicy,
      lastCallMin: d.lastCallMin,
      lastCallBreakMin: d.lastCallBreakMin,
    }
  }

  private async resolveOwnerEmail(
    prisma: PrismaClient,
    scope: { agentId?: string; userId?: string },
    accountId?: string
  ): Promise<string> {
    if (!accountId) return ''
    try {
      const acc = await prisma.workflowCalendarAccount.findFirst({
        where: { id: accountId, ...agentScopedWhere(scope, 'Multi-Calendar Roster') },
        select: { ownerEmail: true },
      })
      return acc?.ownerEmail || ''
    } catch {
      return ''
    }
  }
}
