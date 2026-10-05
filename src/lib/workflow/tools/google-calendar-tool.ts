
import { AIToolClient, ToolDefinition, ToolCallContext } from './types'
import { validateOffsetMatchesCalendar } from './timezone-validation'
import { PrismaClient } from '@prisma/client'
import { getCalendarAccountAccessToken } from '@/lib/google/access-token'
import { agentScopedWhere } from '@/lib/connection-scope'
import { normalizePhoneForStorage } from '@/lib/calendar/phone-match'
import { evaluateEventOwnership, resolveOwnedEventId } from './calendar-ownership'
import { resolveLookupIdentity, matchAppointmentBy } from './calendar-lookup'
import { recordBookingCreated, recordBookingRescheduled, recordBookingCancelled } from '@/lib/calendar/booking-index'
import { sendBookingPush } from '@/lib/calendar/booking-push'
import { isPlaceholderName, isPlaceholderPhone, isNameGroundedInUtterances, isNameGroundingApplicable, isPhoneGroundedInUtterances, phoneNotGroundedMessage } from './booking-name-validation'
import { clampToLastCall, generateOpenSlots, isSlotAligned, isWithinWorkingHours, findBreakOverlap, wallTimeToUtcMs, MAX_OPEN_SLOTS, REQUESTED_SCAN_MAX, REQUESTED_ALTERNATIVES_MAX, REQUESTED_FALLBACK_SCAN_MAX, requestedMsInWindow, requestedScanWindow, shapeRequestedSlots, mergeSlotsByStart } from '@/lib/calendar/slot-grid'
import {
  parsePartySize,
  partySizeFromEvent,
  computeSeatUsage,
  parsePartySizeArg,
  replacePartyLine,
  EVENTS_MAX_PAGES,
  formatPartyLine,
} from '@/lib/calendar/capacity'
import {
  TableType,
  TableMatchPolicy,
  computeTableOccupancy,
  normalizeTableInventory,
  partyFitsInventory,
  capacitySlotFilter,
  type CapacitySlot,
  assignTable,
  formatTableLine,
  summarizeAvailability,
  parseTableAssignment,
  replaceTableLine,
} from '@/lib/calendar/table-inventory'
import {
  replaceContactInDescription,
  contactFromEvent,
  replaceNameInTitle,
  descriptionLineValue,
} from '@/lib/calendar/contact-description'
import {
  notesFromEvent,
  replaceNotesInDescription,
  UPDATE_NOTES_TOOL_DESC,
  UPDATE_NOTES_PARAM,
  ADD_NOTES_PARAM,
  CLEAR_NOTES_PARAM,
  notesChangeOf,
  notesToSave,
  NOTES_ONE_FIELD_REFUSAL,
  type NotesChange,
  removeNotesFromDescription,
  notesAskResult,
  notesUnchangedResult,
  notesUpdatedResult,
  notesAddedResult,
  notesClearedResult,
  bookingMessageNextStep,
} from '@/lib/calendar/booking-message'
import { isWithinEditGrace } from '@/lib/calendar/edit-grace'
import { calendarTodayLine } from '@/lib/calendar/today-line'
import {
  needsBookingConfirm,
  bookingConfirmKey,
  consumeBookingConfirm,
  bookingConfirmRequiredResult,
  bookingConfirmDuplicateResult,
  BOOK_CONFIRMED_PARAM,
  BOOK_CONFIRM_TOOL_DESC,
} from '@/lib/calendar/booking-confirm'
import { describeCaughtError } from '@/lib/log-mask'

const isDev = process.env.NODE_ENV !== 'production'

// ─────────────────────────────────────────────────────────────────────────────
// (a) Google quota(403/429, error.errors[].reason=rateLimitExceeded/userRateLimitExceeded/
function diagGCalFail(label: string, status: number | undefined, errBody: any, t0: number): void {
  const rawReason = errBody?.errors?.[0]?.reason
  const reason = typeof rawReason === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(rawReason) ? rawReason : '-'
  console.error(
    `[GCal/diag] ${label} status=${status ?? 'none'} ms=${Date.now() - t0} reason=${reason}`
  )
}
// ─────────────────────────────────────────────────────────────────────────────

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
const WEEKDAY_KEYS: ReadonlyArray<Weekday> = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function maskPhone(v?: string | null): string | undefined {
  if (!v) return undefined
  const s = String(v)
  if (s.length <= 5) return '***'
  return `${s.slice(0, 3)}****${s.slice(-2)}`
}

interface CalendarOverrides {
  agentId?: string
  userId?: string
  calendarId?: string
  timezone?: string
  workingHoursStart?: string
  workingHoursEnd?: string
  defaultDurationMin?: number
  inviteAttendee?: boolean
  notifyOnBook?: boolean
  bookingMessagePrompt?: string
  notifyOnReschedule?: boolean
  notifyOnCancel?: boolean
  bookingWindowDays?: number
  historyLookupDays?: number
  cancellationPolicy?: {
    enabled: boolean
    cutoffHours: number
    refuseMessage: string
    offerTransfer: boolean
    transferMessage: string
  }
  reschedulePolicy?: {
    enabled: boolean
    cutoffHours: number
    refuseMessage: string
  }
  breakTimes?: Array<{
    start: string
    end: string
    message: string
  }>
  weeklyClosedDays?: Partial<Record<Weekday, {
    closed: boolean
    partialOpenStart?: string
    partialOpenEnd?: string
    message?: string
  }>>
  holidays?: Array<{
    date: string
    name: string
    origin: 'auto' | 'manual'
    message?: string
    subdivisions?: string[]
  }>
  closedRanges?: Array<{
    startDate: string
    endDate: string
    name: string
    message?: string
  }>
  staffTransferNumber?: string
  transferToolName?: string
  pstnCallbackNumber?: string
  accountId?: string
  cleanupMin?: number
  lastCallMin?: number
  lastCallBreakMin?: number
  capacityMode?: 'single' | 'simple' | 'tables'
  simpleCapacity?: number
  tableInventory?: TableType[]
  mealDurationMin?: number
  reservationGridMin?: number
  tableMatchPolicy?: TableMatchPolicy
  channel?: 'pstn' | 'web_voice' | 'chat_widget' | 'test' | 'booking_widget'
}

export class GoogleCalendarToolClient implements AIToolClient {
  private prisma!: PrismaClient
  private connectionId: string = ''
  private accountId: string = ''
  private ownerUserId: string = ''
  private ownerAgentId: string = ''
  private calendarId: string = 'primary'
  private timezone: string = 'Europe/Zurich'
  private workingHoursStart: string = '09:00'
  private workingHoursEnd: string = '18:00'
  private defaultDurationMin: number = 30
  private inviteAttendee: boolean = false
  private notifyOnBook: boolean = false
  private bookingMessagePrompt: string | undefined
  private notifyOnReschedule: boolean = false
  private notifyOnCancel: boolean = false
  private bookingWindowDays: number = 0
  private historyLookupDays: number = 90
  private cancellationPolicy: CalendarOverrides['cancellationPolicy'] | undefined
  private reschedulePolicy: CalendarOverrides['reschedulePolicy'] | undefined
  private breakTimes: NonNullable<CalendarOverrides['breakTimes']> = []
  private weeklyClosedDays: NonNullable<CalendarOverrides['weeklyClosedDays']> | undefined
  private holidays: NonNullable<CalendarOverrides['holidays']> = []
  private closedRanges: NonNullable<CalendarOverrides['closedRanges']> = []
  private staffTransferNumber: string = ''
  private transferToolName: string = 'transfer_to_staff'
  private pstnCallbackNumber: string = ''
  private cleanupMin: number = 0
  private lastCallMin: number = 0
  private lastCallBreakMin: number = 0
  private capacityMode: 'single' | 'simple' | 'tables' = 'single'
  private simpleCapacity: number = 1
  private tableInventory: TableType[] = []
  private mealDurationMin: number = 0 // 0 = use defaultDurationMin
  private reservationGridMin: number = 15
  private tableMatchPolicy: TableMatchPolicy = 'smallest_fit'
  private channel: 'pstn' | 'web_voice' | 'chat_widget' | 'test' | 'booking_widget' | undefined = undefined

  async initialize(
    prisma: PrismaClient,
    connectionId: string,
    overrides?: CalendarOverrides
  ): Promise<void> {
    const connection = await prisma.workflowConnection.findFirst({
      where: {
        id: connectionId,
        ...agentScopedWhere({ agentId: overrides?.agentId, userId: overrides?.userId }, 'Google Calendar Tool'),
        status: 'active',
        provider: 'google_workspace',
      },
      select: { id: true, serviceConfig: true, userId: true, agentId: true },
    })

    if (!connection) {
      throw new Error('Google Calendar connection not found')
    }

    this.prisma = prisma
    this.connectionId = connection.id
    this.ownerUserId = connection.userId
    this.ownerAgentId = connection.agentId

    if (connection.serviceConfig) {
      try {
        const cfg = JSON.parse(connection.serviceConfig)
        if (cfg.calendarId) this.calendarId = cfg.calendarId
        if (cfg.timezone) this.timezone = cfg.timezone
        if (cfg.workingHoursStart) this.workingHoursStart = cfg.workingHoursStart
        if (cfg.workingHoursEnd) this.workingHoursEnd = cfg.workingHoursEnd
        if (typeof cfg.defaultDurationMin === 'number') this.defaultDurationMin = cfg.defaultDurationMin
        if (typeof cfg.inviteAttendee === 'boolean') this.inviteAttendee = cfg.inviteAttendee
      } catch {
        // ignore
      }
    }

    if (overrides?.calendarId) this.calendarId = overrides.calendarId
    if (overrides?.timezone) this.timezone = overrides.timezone
    if (overrides?.workingHoursStart) this.workingHoursStart = overrides.workingHoursStart
    if (overrides?.workingHoursEnd) this.workingHoursEnd = overrides.workingHoursEnd
    if (typeof overrides?.defaultDurationMin === 'number') this.defaultDurationMin = overrides.defaultDurationMin
    if (typeof overrides?.inviteAttendee === 'boolean') this.inviteAttendee = overrides.inviteAttendee
    if (typeof overrides?.notifyOnBook === 'boolean') this.notifyOnBook = overrides.notifyOnBook
    if (typeof overrides?.bookingMessagePrompt === 'string') this.bookingMessagePrompt = overrides.bookingMessagePrompt
    if (typeof overrides?.notifyOnReschedule === 'boolean') this.notifyOnReschedule = overrides.notifyOnReschedule
    if (typeof overrides?.notifyOnCancel === 'boolean') this.notifyOnCancel = overrides.notifyOnCancel
    if (typeof overrides?.bookingWindowDays === 'number' && overrides.bookingWindowDays > 0) {
      this.bookingWindowDays = overrides.bookingWindowDays
    }
    if (typeof overrides?.historyLookupDays === 'number' && overrides.historyLookupDays > 0) {
      this.historyLookupDays = overrides.historyLookupDays
    }
    if (overrides?.cancellationPolicy && typeof overrides.cancellationPolicy === 'object') {
      this.cancellationPolicy = overrides.cancellationPolicy
    }
    if (overrides?.reschedulePolicy && typeof overrides.reschedulePolicy === 'object') {
      this.reschedulePolicy = overrides.reschedulePolicy
    }
    if (Array.isArray(overrides?.breakTimes)) {
      this.breakTimes = overrides.breakTimes.filter(
        (b) =>
          b && typeof b.start === 'string' && typeof b.end === 'string' && typeof b.message === 'string'
      )
    }
    if (overrides?.weeklyClosedDays && typeof overrides.weeklyClosedDays === 'object') {
      this.weeklyClosedDays = overrides.weeklyClosedDays
    }
    if (Array.isArray(overrides?.holidays)) {
      this.holidays = overrides.holidays.filter(
        (h) =>
          h && typeof h.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.date) && typeof h.name === 'string'
      )
    }
    if (Array.isArray(overrides?.closedRanges)) {
      this.closedRanges = overrides.closedRanges.filter(
        (r) =>
          r &&
          typeof r.startDate === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) &&
          typeof r.endDate === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.endDate) &&
          r.startDate <= r.endDate &&
          typeof r.name === 'string'
      )
    }
    if (typeof overrides?.pstnCallbackNumber === 'string') {
      this.pstnCallbackNumber = overrides.pstnCallbackNumber.trim()
    }
    if (typeof overrides?.staffTransferNumber === 'string') {
      this.staffTransferNumber = overrides.staffTransferNumber.trim()
    }
    if (typeof overrides?.transferToolName === 'string' && overrides.transferToolName.trim()) {
      this.transferToolName = overrides.transferToolName.trim()
    }
    if (typeof overrides?.lastCallMin === 'number' && overrides.lastCallMin > 0) {
      this.lastCallMin = Math.min(Math.floor(overrides.lastCallMin), 240)
    }
    if (typeof overrides?.lastCallBreakMin === 'number' && overrides.lastCallBreakMin > 0) {
      this.lastCallBreakMin = Math.min(Math.floor(overrides.lastCallBreakMin), 240)
    }
    if (typeof overrides?.cleanupMin === 'number' && overrides.cleanupMin >= 0) {
      this.cleanupMin = Math.floor(overrides.cleanupMin)
    }
    if (overrides?.channel) {
      this.channel = overrides.channel
    }
    if (overrides?.capacityMode === 'single' || overrides?.capacityMode === 'simple' || overrides?.capacityMode === 'tables') {
      this.capacityMode = overrides.capacityMode
    }
    if (typeof overrides?.simpleCapacity === 'number' && overrides.simpleCapacity >= 1) {
      this.simpleCapacity = Math.floor(overrides.simpleCapacity)
    }
    if (Array.isArray(overrides?.tableInventory)) {
      this.tableInventory = normalizeTableInventory(overrides.tableInventory)
    }
    if (typeof overrides?.mealDurationMin === 'number' && overrides.mealDurationMin > 0) {
      this.mealDurationMin = Math.floor(overrides.mealDurationMin)
    }
    if (typeof overrides?.reservationGridMin === 'number' && overrides.reservationGridMin >= 5) {
      this.reservationGridMin = Math.floor(overrides.reservationGridMin)
    }
    if (overrides?.tableMatchPolicy === 'exact_only' || overrides?.tableMatchPolicy === 'smallest_fit') {
      this.tableMatchPolicy = overrides.tableMatchPolicy
    }

    const requestedAccountId = overrides?.accountId?.trim() || ''
    if (requestedAccountId) {
      const owned = await prisma.workflowCalendarAccount.findFirst({
        where: {
          id: requestedAccountId,
          connectionId: this.connectionId,
          ...agentScopedWhere({ agentId: connection.agentId, userId: connection.userId }, 'Google Calendar Account'),
          status: 'active',
        },
        select: { id: true },
      })
      if (!owned) {
        throw new Error('Google Calendar account not found for this connection')
      }
      this.accountId = owned.id
    } else {
      const firstAccount = await prisma.workflowCalendarAccount.findFirst({
        where: { connectionId: this.connectionId, status: 'active' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })
      this.accountId = firstAccount?.id || ''
    }
    if (!this.accountId) {
      throw new Error('No Gmail account linked to this Calendar connection. Connect a Gmail account first.')
    }
  }

  listTools(): ToolDefinition[] {
    return this.buildToolList(false)
  }

  listToolsForDispatcher(): ToolDefinition[] {
    return this.buildToolList(true)
  }

  private buildToolList(omitCapacityNote: boolean): ToolDefinition[] {
    const hours = `${this.workingHoursStart}-${this.workingHoursEnd} ${this.timezone}`
    const intervalMin = this.getEffectiveSlotIntervalMin()
    const eventDurMin = this.getEffectiveEventDurationMin()
    const capacityNote = omitCapacityNote ? '' : this.getCapacityToolNote()

    return [
      {
        name: 'check_calendar_availability',
        description: `Check available time slots for a NEW or RESCHEDULED booking (caller may speak any language — book/schedule appointment, Termin buchen/vereinbaren, prendre rendez-vous, reservar cita, prenotare appuntamento, 予約, 预约). REQUIRED before any booking. You MUST call this function before telling the caller that any time is available — never assume or fabricate a slot is free. Working hours: ${hours}. Event duration: ${eventDurMin} minutes. Slot start times are aligned to a ${intervalMin}-minute grid (e.g. ${this.workingHoursStart}, +${intervalMin}min, +${intervalMin*2}min, ...). The response includes an "openSlots" array of pre-aligned, available time windows — propose ONLY times from this array. If the caller named a specific time, also pass it as requested_start_iso: the response then includes "requestedTime" — whether exactly that time is free and, if not, the nearest open times. Never invent slot times — the server will reject misaligned bookings.${capacityNote}${
          this.breakTimes.length
            ? ` The response also includes a "breakTimes" array listing daily no-booking windows (e.g. lunch break) — they are already excluded from openSlots.`
            : ''
        }${calendarTodayLine(this.timezone)}`,
        parameters: {
          type: 'object',
          properties: {
            start_iso: {
              type: 'string',
              description: `Search window start in ISO 8601 with offset matching calendar timezone "${this.timezone}". Prefer same-day or next few days.`,
            },
            end_iso: {
              type: 'string',
              description: `Search window end in ISO 8601 with offset matching calendar timezone "${this.timezone}". Usually 24-72 h after start.`,
            },
            duration_min: {
              type: 'number',
              description: `Requested appointment duration in minutes. Default ${this.defaultDurationMin} if the caller did not specify.`,
            },
            requested_start_iso: {
              type: 'string',
              description: `Optional — the exact start time the caller asked for (e.g. "8 PM tonight"), in ISO 8601 with offset matching calendar timezone "${this.timezone}". Must lie inside start_iso–end_iso.`,
            },
            ...(this.capacityMode === 'simple' || this.capacityMode === 'tables'
              ? {
                  party_size: {
                    type: 'number',
                    description: 'Number of people, once the caller has said it. When given, "openSlots" lists only times where this group fits.',
                  },
                }
              : {}),
          },
          required: ['start_iso', 'end_iso'],
        },
      },
      {
        name: 'book_calendar_event',
        description: `Confirm and create a NEW appointment in the owner's Google Calendar (any language — book/make/schedule a new appointment, neuen Termin buchen, prendre rendez-vous, reservar/agendar cita, prenotare un nuovo appuntamento, 新規予約, 新预约). Only call when BOTH (a) the caller expressed intent for a NEW booking, AND (b) the caller agreed to a specific slot that check_calendar_availability returned in "openSlots". NEVER call this in response to a confirmation question about an EXISTING booking (e.g. "Is my appointment confirmed?", "예약된 건가요?", "Ist mein Termin gebucht?", "Mon rendez-vous est confirmé?") — answer from conversation history or call lookup_appointments instead. ${
          this.inviteAttendee
            ? 'If the caller provides an email, they will be sent an invitation.'
            : 'The caller is NOT invited as an attendee — their contact details go into the event description.'
        } The server enforces slot grid alignment — misaligned start times will be rejected with error "booking_misaligned_slot".${omitCapacityNote ? '' : this.getCapacityBookNote()}${
          this.breakTimes.length
            ? ' If the requested slot overlaps with any configured break time (e.g. lunch), the booking will be refused with error "booking_in_break_time" + "refusal_message".'
            : ''
        }${
          (this.weeklyClosedDays && Object.values(this.weeklyClosedDays).some((c) => c?.closed)) || this.holidays.length
            ? ' If the slot falls on a weekly closed day or a holiday, the booking will be refused with error "booking_on_closed_day" or "booking_on_holiday" + "refusal_message".'
            : ''
        }${
          this.closedRanges.length
            ? ' If the date falls within a configured closed range (e.g. vacation, seminar), the booking will be refused with error "booking_in_closed_range" + "refusal_message".'
            : ''
        }${needsBookingConfirm(this.channel) ? ` ${BOOK_CONFIRM_TOOL_DESC}` : ''}`,
        parameters: {
          type: 'object',
          properties: {
            start_iso: {
              type: 'string',
              description: `Event start in ISO 8601 with offset matching calendar timezone "${this.timezone}". Must align to slot grid from check_calendar_availability.`,
            },
            duration_min: {
              type: 'number',
              description: this.capacityMode === 'tables'
                ? `Ignored in table-inventory mode — server uses meal duration ${eventDurMin} min.`
                : `Duration in minutes. Default ${eventDurMin}.`,
            },
            summary: {
              type: 'string',
              description: 'Short event title. Example: "Appointment — Kim Hongil".',
            },
            patient_name: {
              type: 'string',
              description: 'Full name of the caller.',
            },
            ...(this.channel === 'pstn'
              ? {}
              : {
                  patient_phone: {
                    type: 'string',
                    description: 'Phone number of the caller.',
                  },
                }),
            patient_email: {
              type: 'string',
              description: 'Email of the caller (optional).',
            },
            notes: {
              type: 'string',
              description: 'Reason for visit / symptoms / any other notes (optional).',
            },
            ...(needsBookingConfirm(this.channel) ? { confirmed: BOOK_CONFIRMED_PARAM } : {}),
            ...(this.capacityMode === 'simple' || this.capacityMode === 'tables'
              ? {
                  party_size: {
                    type: 'number',
                    description:
                      this.capacityMode === 'tables'
                        ? `Number of people in the party. REQUIRED. Server will auto-assign the smallest fitting table. Returns "no_table_available" if no table fits at that time (propose another time from openSlots), or "party_too_large" if no table can ever seat the group (do NOT propose other times).`
                        : `Number of people for this booking. Default 1. Used for capacity counting (party sizes are summed against the configured capacity of ${this.simpleCapacity}).`,
                  },
                }
              : {}),
          },
          required: this.channel === 'pstn'
            ? (this.capacityMode === 'tables'
                ? ['start_iso', 'summary', 'patient_name', 'party_size']
                : ['start_iso', 'summary', 'patient_name'])
            : (this.capacityMode === 'tables'
                ? ['start_iso', 'summary', 'patient_name', 'patient_phone', 'party_size']
                : ['start_iso', 'summary', 'patient_name', 'patient_phone']),
        },
      },
      {
        name: 'cancel_event',
        description: `Cancel an EXISTING appointment in the owner's Google Calendar (any language — cancel/annul, Termin absagen/stornieren, annuler le rendez-vous, cancelar/anular cita, annullare/cancellare appuntamento, 取消预约, 予約キャンセル). Before cancelling, ask ONE short confirmation question naming the appointment's date and time (if the caller has more than one appointment, name the one they chose — if it is unclear which, ask which one first). Ask it AFTER the caller asks to cancel — the request that prompts the question, or an answer to a greeting that asked whether to change or cancel, is NOT the confirmation. When the caller answers that confirmation question with yes (e.g. "yes", "please cancel it"), call cancel_event IMMEDIATELY in that turn — never ask a second time, and never say you will check or look it up first. No lookup is needed when the appointment is already known — from the existing-appointment context announced at the start, a booking made in this conversation, or a lookup_appointments result from a PREVIOUS turn. Otherwise call lookup_appointments first, and do NOT call cancel_event in the same tool round as lookup_appointments. ${
          this.cancellationPolicy?.enabled
            ? `A cancellation policy is active: requests within ${this.cancellationPolicy.cutoffHours} hours of the appointment start time will be refused (a booking made within the last hour is exempt — the caller can still fix it). The refusal message will be returned in the "refusal_message" field so you can relay it to the caller in their language. Do NOT warn the caller about this policy in advance — call cancel_event and relay the refusal only if one comes back.`
            : 'No time-based cancellation policy is active — any future appointment can be cancelled.'
        }`,
        parameters: {
          type: 'object',
          properties: {
            event_id: {
              type: 'string',
              description: 'The Google Calendar event ID returned by lookup_appointments or known from prior context. Never guess this value.',
            },
          },
          required: ['event_id'],
        },
      },
      {
        name: 'lookup_appointments',
        description: `Look up EXISTING appointments for the current caller in this Google Calendar (any language — my booking/appointment, mein Termin, mon rendez-vous, mi cita/reserva, il mio appuntamento, 我的预约, 私の予約). Use when the caller asks about existing bookings, wants to confirm/check status of a booking, or wants to cancel/reschedule — e.g. "When is my next appointment?", "Is it booked?", "예약된 건가요?", "Ist mein Termin gebucht?", "I want to reschedule", "Cancel my booking". After lookup, read back the appointment to the caller in plain prose and, if the caller wants to cancel or reschedule, ASK FOR CONFIRMATION (cancel) or the NEW TIME (reschedule) in the SAME response, then call cancel_event/reschedule_event ON THE NEXT CALLER TURN once they reply. Do NOT chain cancel_event/reschedule_event in the same tool round as lookup_appointments — wait for the caller to confirm in the next turn. By default searches from today 00:00 (calendar timezone) onwards — today's earlier slots (e.g. morning slot, current time afternoon) are INCLUDED for "is my appointment booked?" or same-day reschedule; yesterday and earlier are NOT searched. Set include_past=true ONLY when the caller explicitly asks about a PAST / previous visit (e.g. "지난번 언제 왔었죠?", "when did I last visit?", "mein letzter Termin?", "ma dernière visite?", "mi última visita?", "上次什么时候来的?", "前回はいつ来ましたか?") — that extends the search back by the configured history window. Do NOT set include_past for booking/confirm/cancel/reschedule (those are future-focused). Match on patient_phone (most reliable) or patient_name. Returns Google Calendar event IDs. Do NOT use this to propose new slots — use check_calendar_availability for that.`,
        parameters: {
          type: 'object',
          properties: {
            patient_phone: {
              type: 'string',
              description: 'Phone number in E.164 format. Pass "auto" for PSTN callers to use the detected caller number. Most reliable match.',
            },
            patient_name: {
              type: 'string',
              description: 'Full name of the caller. Fallback match when phone not available.',
            },
            patient_email: {
              type: 'string',
              description: 'Email of the caller (optional, fallback match).',
            },
            include_past: {
              type: 'boolean',
              description: 'Set true ONLY when the caller explicitly asks about a past/previous visit. Extends the search back by the configured history window. Default false (today onwards / upcoming only).',
            },
          },
        },
      },
      {
        name: 'reschedule_event',
        description: `Move an EXISTING appointment to a new date/time in one step (preferred over cancel + rebook). Use ONLY when the caller uses an explicit CHANGE VERB (not mere availability questions). Triggers (any language): change/move/reschedule/switch time, Termin verschieben/umbuchen/ändern, déplacer/reporter/changer le rendez-vous, cambiar/reprogramar/mover cita, spostare/riprogrammare appuntamento, 改期/改时间, 変更/別の時間に変更, Korean "약속을 X시로 바꿔/옮겨/미뤄", "시간 변경", "다른 시간으로 바꿔/옮겨". Example phrases: "change my appointment", "move it to Friday", "reschedule to next week", "약속을 다섯시로 바꿔주세요", "오후 2시로 옮겨주세요". NOT triggers: availability-only questions like "다른 시간도 가능해요?" / "do you have other times?" → use check_calendar_availability (NEW BOOKING flow), do NOT reschedule. Workflow: (1) IF event_id is known AND caller specified an explicit new time → call reschedule_event DIRECTLY with the new time. SKIP check_calendar_availability (this tool has its own availability/capacity/policy validation; calling check first is an unnecessary extra round). If the call returns an availability_error, then call check_calendar_availability in the NEXT turn to propose alternatives. (2) IF event_id is known but new time NOT specified → ASK the caller for the new time, then on NEXT caller turn call reschedule_event directly. (3) IF event_id is NOT known → first call lookup_appointments, ASK for the new time, then on NEXT caller turn call reschedule_event directly. Do NOT call reschedule_event in the same tool round as lookup_appointments. ${
          this.capacityMode === 'simple' || this.capacityMode === 'tables'
            ? 'ALSO use it when the caller only changes the group size (e.g. "we are 6 now"): pass the appointment\'s CURRENT start time as new_start_iso together with the new party_size. '
            : ''
        }${
          this.reschedulePolicy?.enabled
            ? `A reschedule policy is active: requests within ${this.reschedulePolicy.cutoffHours} hours of the CURRENT appointment start time will be refused (a booking made within the last hour is exempt — the caller can still fix it). The refusal message will be returned in the "refusal_message" field.`
            : 'No time-based reschedule policy is active — any future appointment can be rescheduled, independent of the cancellation policy.'
        } The booking window (${this.bookingWindowDays || 200} days) also applies to the new start time.${
          (this.weeklyClosedDays && Object.values(this.weeklyClosedDays).some((c) => c?.closed)) || this.holidays.length
            ? ' If the new date falls on a weekly closed day or holiday, the reschedule will be refused with error "booking_on_closed_day" or "booking_on_holiday" + "refusal_message".'
            : ''
        }${
          this.closedRanges.length
            ? ' If the new date falls within a configured closed range (vacation/seminar), the reschedule will be refused with error "booking_in_closed_range" — relay the refusal_message and propose a date outside the range.'
            : ''
        }`,
        parameters: {
          type: 'object',
          properties: {
            event_id: {
              type: 'string',
              description: 'The Google Calendar event ID returned by lookup_appointments. Never guess this value.',
            },
            new_start_iso: {
              type: 'string',
              description: `New event start in ISO 8601 with offset matching calendar timezone "${this.timezone}".`,
            },
            new_duration_min: {
              type: 'number',
              description: `New duration in minutes. Omit to keep the same duration as the original event (default fallback: ${this.defaultDurationMin}).`,
            },
            ...(this.capacityMode === 'simple' || this.capacityMode === 'tables'
              ? {
                  party_size: {
                    type: 'number',
                    description: 'New number of people, ONLY if the caller says the group size changed. Omit to keep the current party size. The server re-checks seats/tables for the new size.',
                  },
                }
              : {}),
          },
          required: ['event_id', 'new_start_iso'],
        },
      },
      {
        name: 'update_event_contact',
        description: `Correct the CALLER CONTACT (name or phone) on an EXISTING appointment when the caller indicates the recorded information is wrong. Use ONLY when the caller explicitly asks to correct/change name or phone (not for time changes — use reschedule_event for time, not this tool). Triggers (any language): Korean "이름 다르게 적어주세요/잘못 들었어요/이름 바꿔주세요/전화번호 바꿔주세요", English "correct my name/change the phone number/the name is wrong", German "Name ist falsch/Nummer ändern/Name korrigieren", French "changer le nom/le numéro/corriger le nom", Spanish "cambiar el nombre/el teléfono/corregir nombre", Italian "cambiare il nome/il numero/correggere nome", Chinese "改名/改电话/姓名改一下", Japanese "名前/電話を変更/名前間違い". NOT triggers: time changes ("바꿔주세요 4시로", "move to 4 PM") → use reschedule_event instead. ONE FIELD PER CALL — pass new_name OR new_phone, NEVER both in the same call. If the caller mentions both name and phone in one turn, process the first field, read back the confirmation, then ask about the second field in your next response (the next caller turn handles it). Workflow: (1) IF caller specified an EXPLICIT NEW VALUE for name or phone (e.g. "이름 임철수으로 바꿔주세요", "전화 010-1234-5678로 변경"): IF event_id is known → call update_event_contact DIRECTLY with new_name/new_phone. (2) IF caller mentioned the name or phone field but did NOT yet provide a new value — this includes BOTH explicit correction intent ("이름 바꿔주세요", "전화 바꿔주세요", "name is wrong") AND simple inquiries / field mentions without explicit change verb ("예약자 이름", "이름이 뭐죠?", "전화번호 확인", "what is the name?", "der Name?"): call update_event_contact with the event_id and ONLY pending_field='name' (or 'phone') — DO NOT pass new_name/new_phone. The current value on file is then read back to the caller with an invitation to change it (e.g. "지금 예약 이름은 X 입니다. 변경 원하시면 새 이름을 말씀해 주세요"); follow the "instruction" field in the tool result for what to say. The caller then either confirms / asks to change in the next turn (you call update_event_contact again with new_name/new_phone), or stays silent (no further action needed). This pattern keeps response text deterministic and faster than generating prose — always prefer pending_field over LLM-generated ASK sentences when the field is mentioned without a new value. (3) IF event_id is NOT known → first call lookup_appointments, then on NEXT caller turn call update_event_contact. (4) NEVER pass the same value as the existing one. Do NOT call book_calendar_event for contact corrections (creates duplicate). Do NOT call cancel_event (loses booking). PSTN calls: phone is auto-injected from the call source — only name correction is meaningful. The server will reject new_phone on PSTN calls. ${UPDATE_NOTES_TOOL_DESC}`,
        parameters: {
          type: 'object',
          properties: {
            event_id: {
              type: 'string',
              description: 'The Google Calendar event ID returned by lookup_appointments or known from prior context. Never guess this value.',
            },
            pending_field: {
              type: 'string',
              enum: ['name', 'phone', 'notes'],
              description: 'OPTIONAL — pass this WHEN caller has expressed clear intent to correct name, phone, or their message (notes) but has NOT yet given the new value. Server returns a deterministic ASK prompt that the bridge speaks; do NOT pass new_name/new_phone together with pending_field. On the NEXT caller turn (after the caller provides the value), call update_event_contact again with new_name, new_phone, or — for the message — add_notes if they are adding to it or new_notes if they are replacing it.',
            },
            new_notes: UPDATE_NOTES_PARAM,
            add_notes: ADD_NOTES_PARAM,
            clear_notes: CLEAR_NOTES_PARAM,
            new_name: {
              type: 'string',
              description: 'Optional. New caller name to replace the existing Name line in the event description. ONLY pass this when the caller has provided an EXPLICIT new name in the current turn. Mutually exclusive with pending_field.',
            },
            new_phone: {
              type: 'string',
              description: 'Optional. New phone number (E.164 or local format) — ONLY pass when caller provided an EXPLICIT new value. Mutually exclusive with pending_field. NOT applicable to PSTN calls — server rejects with phone_update_blocked_on_pstn. TWO-STEP CONFIRM: the FIRST call with new_phone (and confirm_phone omitted/false) does NOT save — it returns the number for you to read back and ask the caller to confirm; the phone is saved ONLY on a SECOND call passing the SAME new_phone together with confirm_phone=true after the caller agrees.',
            },
            confirm_phone: {
              type: 'boolean',
              description: 'OPTIONAL — pass true ONLY on the confirmation call, together with the SAME new_phone you previously read back, AFTER the caller has explicitly confirmed that number is correct. Never pass confirm_phone=true on the first attempt or with a number the caller has not yet confirmed.',
            },
          },
          required: ['event_id'],
        },
      },
    ]
  }

  setBookingMessagePrompt(prompt: string | undefined): void {
    this.bookingMessagePrompt = prompt
  }

  async callTool(name: string, args: Record<string, any>, callContext?: ToolCallContext): Promise<string> {
    try {
      const accessToken = await getCalendarAccountAccessToken(this.prisma, this.accountId)

      if (name === 'check_calendar_availability') {
        return await this.checkAvailability(accessToken, args)
      }
      if (name === 'book_calendar_event') {
        return await this.bookEvent(accessToken, args, callContext)
      }
      if (name === 'lookup_appointments') {
        return await this.lookupAppointments(accessToken, args, callContext)
      }
      if (name === 'cancel_event' || name === 'reschedule_event' || name === 'update_event_contact') {
        const resolved = resolveOwnedEventId(typeof args.event_id === 'string' ? args.event_id : undefined, callContext)
        if (resolved.overridden) {
          if (isDev) {
            const modelEventIdLen = String(args.event_id ?? '').length
            console.log(`[Calendar/${name}] event_id override: model=${modelEventIdLen} chars → owned="${String(resolved.eventId).slice(0, 12)}..." (single verified upcoming appointment)`)
          }
          args = { ...args, event_id: resolved.eventId }
        }
      }
      if (name === 'cancel_event') {
        return await this.cancelEvent(accessToken, args, callContext)
      }
      if (name === 'reschedule_event') {
        return await this.rescheduleEvent(accessToken, args, callContext)
      }
      if (name === 'update_event_contact') {
        return await this.updateEventContact(accessToken, args, callContext)
      }
      return JSON.stringify({ success: false, error: `Unknown tool: ${name}` })
    } catch (err: any) {
      console.error(`[GCal/diag] ${name} THREW`, describeCaughtError(err))
      console.error('[GCal] tool call threw:', describeCaughtError(err))
      const needsReconnect =
        err !== null && typeof err === 'object' &&
        Object.prototype.hasOwnProperty.call(err, 'code') &&
        (err as { code?: unknown }).code === 'reconnect_required'
      return JSON.stringify({
        success: false,
        error: needsReconnect
          ? 'Calendar connection expired — the account owner must reconnect it in settings.'
          : 'Calendar call failed',
      })
    }
  }

  private async checkAvailability(accessToken: string, args: Record<string, any>): Promise<string> {
    const { start_iso, end_iso } = args
    if (!start_iso || !end_iso) {
      return JSON.stringify({ success: false, error: 'start_iso and end_iso are required' })
    }
    const requestedIso: string | null =
      typeof args.requested_start_iso === 'string' && args.requested_start_iso.trim() ? args.requested_start_iso.trim() : null

    for (const [key, value] of [['start_iso', start_iso], ['end_iso', end_iso], ...(requestedIso ? [['requested_start_iso', requestedIso]] : [])] as const) {
      const v = validateOffsetMatchesCalendar(value, this.timezone)
      if (!v.ok) {
        return JSON.stringify({
          success: false,
          error: 'wrong_timezone_offset',
          parameter: key,
          expected_offset: v.expectedOffset,
          got_offset: v.gotOffset,
          calendar_timezone: this.timezone,
          message: v.refusalMessage,
        })
      }
    }

    const partyArg = this.capacityMode === 'single' ? null : parsePartySizeArg(args.party_size)
    if (partyArg === 'invalid') return this.invalidPartySizeResponse()
    if (partyArg !== null) {
      const tooLarge = this.partyTooLargeResponse(partyArg)
      if (tooLarge) return tooLarge
    }

    let busy: Array<{ start: string; end: string }> = []
    let listEvents: any[] = []
    const useEventsList = this.capacityMode === 'simple' || this.capacityMode === 'tables'

    if (useEventsList) {
      const all = await this.listEventsAll(accessToken, start_iso, end_iso, 'checkAvailability/events.list')
      if (!all) {
        return JSON.stringify({
          success: false,
          error: 'calendar_unavailable',
          message: 'The calendar could not be read right now. Apologize briefly and ask the caller to try again in a moment. Do NOT say any time is free.',
        })
      }
      listEvents = all
      busy = []
    } else {
      const __t0 = Date.now()
      const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin: start_iso,
          timeMax: end_iso,
          timeZone: this.timezone,
          items: [{ id: this.calendarId }],
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        diagGCalFail('checkAvailability/freebusy', response.status, data.error, __t0)
        return JSON.stringify({
          success: false,
          error: data.error?.message || `freebusy query failed (status ${response.status})`,
        })
      }
      busy = data.calendars?.[this.calendarId]?.busy ?? []
    }

    const startDate = this.getLocalDate(start_iso)
    const endDate = this.getLocalDate(end_iso)
    const holidaysInWindow = this.holidays.filter(
      (h) => h.date >= startDate && h.date <= endDate
    )

    const weeklyClosed = this.weeklyClosedDays
      ? Object.fromEntries(
          Object.entries(this.weeklyClosedDays)
            .filter(([_, cfg]) => cfg && cfg.closed)
            .map(([key, cfg]) => [
              key,
              {
                closed: true,
                ...(cfg!.partialOpenStart && cfg!.partialOpenEnd
                  ? {
                      partialOpenStart: cfg!.partialOpenStart,
                      partialOpenEnd: cfg!.partialOpenEnd,
                    }
                  : {}),
              },
            ])
        )
      : undefined

    const eventDurMin = this.getEffectiveEventDurationMin()
    const intervalMin = this.getEffectiveSlotIntervalMin()

    const requestedMs = requestedMsInWindow(requestedIso, start_iso, end_iso)

    const scan = requestedMs === null ? { start: start_iso, end: end_iso } : requestedScanWindow(requestedMs, start_iso, end_iso)
    const slotsIn = (searchStart: string, searchEnd: string, maxSlots: number): CapacitySlot[] => generateOpenSlots<CapacitySlot>({
      searchStart,
      searchEnd,
      timezone: this.timezone,
      workingHoursStart: this.workingHoursStart,
      workingHoursEnd: this.workingHoursEnd,
      durationMin: eventDurMin,
      intervalMin,
      busy,
      breakTimes: this.breakTimes,
      weeklyClosedDays: this.weeklyClosedDays,
      holidays: this.holidays,
      closedRanges: this.closedRanges,
      maxSlots,
      lastCallMin: this.lastCallMin,
      lastCallBreakMin: this.lastCallBreakMin,
      ...(this.capacityMode === 'simple' || this.capacityMode === 'tables'
        ? {
            accept: capacitySlotFilter({
              mode: this.capacityMode,
              events: listEvents as any,
              inventory: this.tableInventory,
              policy: this.tableMatchPolicy,
              simpleCapacity: this.simpleCapacity,
              partySize: partyArg,
              timezone: this.timezone,
            }),
          }
        : {}),
    })
    const allSlots = slotsIn(scan.start, scan.end, requestedMs === null ? MAX_OPEN_SLOTS : REQUESTED_SCAN_MAX)
    const fallbackSlots =
      requestedMs !== null && allSlots.length < REQUESTED_ALTERNATIVES_MAX
        ? mergeSlotsByStart(
            new Date(scan.start).getTime() > new Date(start_iso).getTime() ? slotsIn(start_iso, scan.end, REQUESTED_FALLBACK_SCAN_MAX) : [],
            allSlots,
            new Date(scan.end).getTime() < new Date(end_iso).getTime() ? slotsIn(scan.start, end_iso, MAX_OPEN_SLOTS) : [],
          )
        : []
    const { openSlots, fields: requestedFields } = shapeRequestedSlots(allSlots, requestedIso, requestedMs, fallbackSlots)

    return JSON.stringify({
      success: true,
      timezone: this.timezone,
      workingHours: { start: this.workingHoursStart, end: this.workingHoursEnd },
      defaultDurationMin: eventDurMin,
      slotGrid: { intervalMin, durationMin: eventDurMin, alignment: 'workingHoursStart' },
      ...(this.lastCallMin > 0 || this.lastCallBreakMin > 0
        ? { lastBookingNote: `Late slots are shorter: their "end" is the closing time${this.lastCallBreakMin > 0 ? ' or the start of the break' : ''}. If the caller picks one, tell them they can stay only until that "end".` }
        : {}),
      capacityMode: this.capacityMode,
      ...(this.capacityMode !== 'single' && partyArg === null
        ? { partySizeNote: 'openSlots are NOT filtered by group size. Ask how many people and call again with party_size before offering a time.' }
        : {}),
      ...(this.capacityMode === 'simple' ? { capacityTotal: this.simpleCapacity } : {}),
      ...(this.capacityMode === 'tables'
        ? {
            tableInventory: this.tableInventory.map((t) => ({
              name: t.name, capacity: t.capacity, count: t.count,
            })),
          }
        : {}),
      ...requestedFields,
      openSlots,
      ...(this.breakTimes.length
        ? {
            breakTimes: this.breakTimes.map((b) => ({ start: b.start, end: b.end })),
            breakTimesNote:
              'Already excluded from openSlots. Listed for context only.',
          }
        : {}),
      ...(weeklyClosed && Object.keys(weeklyClosed).length
        ? {
            weeklyClosedDays: weeklyClosed,
            weeklyClosedDaysNote:
              'Already excluded from openSlots. partialOpenStart/End ranges are honored.',
          }
        : {}),
      ...(holidaysInWindow.length
        ? {
            closedDates: holidaysInWindow.map((h) => ({ date: h.date, name: h.name })),
            closedDatesNote: 'Already excluded from openSlots.',
          }
        : {}),
      ...(this.closedRanges.length
        ? (() => {
            const overlapping = this.closedRanges.filter(
              (r) => r.startDate <= endDate && r.endDate >= startDate
            )
            return overlapping.length
              ? {
                  closedRanges: overlapping.map((r) => ({
                    startDate: r.startDate, endDate: r.endDate, name: r.name,
                  })),
                  closedRangesNote: 'Already excluded from openSlots. Mention end date if caller insists.',
                }
              : {}
          })()
        : {}),
      busy,
    })
  }

  // ───────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────

  private getEffectiveSlotIntervalMin(): number {
    if (this.capacityMode === 'tables') {
      return Math.max(5, this.reservationGridMin || 15)
    }
    const base = (this.defaultDurationMin || 30) + (this.cleanupMin || 0)
    return Math.max(5, base)
  }

  private clampLastCall(startIso: string, durationMin: number): { ok: true; durationMin: number } | { ok: false } {
    return clampToLastCall({
      startIso,
      durationMin,
      workingHoursStart: this.workingHoursStart,
      workingHoursEnd: this.workingHoursEnd,
      breakTimes: this.breakTimes,
      weeklyClosedDays: this.weeklyClosedDays as any,
      timezone: this.timezone,
      lastCallMin: this.lastCallMin,
      lastCallBreakMin: this.lastCallBreakMin,
    })
  }

  private getEffectiveEventDurationMin(aiSpecified?: number): number {
    if (this.capacityMode === 'tables') {
      return this.mealDurationMin > 0 ? this.mealDurationMin : (this.defaultDurationMin || 90)
    }
    if (typeof aiSpecified === 'number' && aiSpecified > 0) return aiSpecified
    return this.defaultDurationMin || 30
  }

  private getCapacityToolNote(): string {
    if (this.capacityMode === 'simple') {
      return ` This calendar accepts up to ${this.simpleCapacity} concurrent bookings (party sizes summed). The response includes "seatsAvailable" per slot — propose only slots with seatsAvailable >= party_size. ALWAYS ask the caller "How many people?" before proposing slots.`
    }
    if (this.capacityMode === 'tables') {
      const summary = this.tableInventory
        .map((t) => `${t.name}(seats ${t.capacity}, qty ${t.count})`)
        .join(', ')
      return ` This calendar uses a TABLE INVENTORY (${summary || 'no tables defined'}). Each booking occupies one table for ${this.getEffectiveEventDurationMin()} minutes. The response includes "availableTables" per slot. ALWAYS ask the caller "How many people?" first and pass it as party_size, so openSlots lists only times that fit the group — the server auto-assigns the smallest fitting table. Error "party_too_large" means no table can ever seat the group — do NOT propose other times.`
    }
    return ''
  }

  private invalidPartySizeResponse(): string {
    return JSON.stringify({
      success: false,
      error: 'invalid_party_size',
      message: 'party_size must be a whole number of people (1 or more). Ask the caller how many people and call again.',
    })
  }

  private partyTooLargeResponse(partySize: number): string | null {
    const contact = 'Do NOT propose another time — no time will work. Tell the caller that a group this size cannot be booked this way and they should contact the business directly.'
    if (this.capacityMode === 'simple') {
      if (partySize <= this.simpleCapacity) return null
      return JSON.stringify({
        success: false,
        error: 'party_too_large',
        requested_party_size: partySize,
        capacity_total: this.simpleCapacity,
        message: `A group of ${partySize} exceeds the total capacity of ${this.simpleCapacity}. ${contact}`,
      })
    }
    if (this.capacityMode !== 'tables' || partyFitsInventory(this.tableInventory, partySize, this.tableMatchPolicy)) return null
    const largest = this.tableInventory.reduce((m, t) => Math.max(m, t.capacity), 0)
    const exactMiss = this.tableMatchPolicy === 'exact_only' && largest >= partySize
    return JSON.stringify({
      success: false,
      error: 'party_too_large',
      requested_party_size: partySize,
      largest_table_seats: largest,
      ...(exactMiss ? { exact_size_only: true } : {}),
      message: exactMiss
        ? `No table seats exactly ${partySize} people and this restaurant only seats exact sizes. ${contact}`
        : `The largest table seats ${largest}. ${contact}`,
    })
  }

  private timeUnavailableResponse(): string {
    return JSON.stringify({
      success: false,
      error: 'time_unavailable',
      message: 'That time is blocked in the calendar (for example a private event or a closure). Call check_calendar_availability and propose ONLY times from "openSlots".',
    })
  }

  private outsideWorkingHoursResponse(durationMin: number): string {
    return JSON.stringify({
      success: false,
      error: 'booking_outside_working_hours',
      working_hours: `${this.workingHoursStart}-${this.workingHoursEnd}`,
      duration_min: durationMin,
      timezone: this.timezone,
      ...(this.lastCallMin > 0 ? { last_booking_min_before_close: this.lastCallMin } : {}),
      ...(this.lastCallBreakMin > 0 ? { last_booking_min_before_break: this.lastCallBreakMin } : {}),
      message: this.lastCallMin > 0 || this.lastCallBreakMin > 0
        ? `Late bookings are accepted only up to ${this.lastCallMin > 0 ? `${this.lastCallMin} minutes before closing` : 'the point where the whole booking still ends by closing'}${this.lastCallBreakMin > 0 ? ` and ${this.lastCallBreakMin} minutes before each break` : ''} (working hours ${this.workingHoursStart}-${this.workingHoursEnd}, ${this.timezone}). Call check_calendar_availability and propose ONLY times from "openSlots".`
        : `The booking must start and end within working hours ${this.workingHoursStart}-${this.workingHoursEnd} (${this.timezone}); it lasts ${durationMin} minutes. Call check_calendar_availability and propose ONLY times from "openSlots".`,
    })
  }

  private getCapacityBookNote(): string {
    if (this.capacityMode === 'simple') {
      return ` Capacity ${this.simpleCapacity} — if the requested slot is full, error "capacity_exceeded" with "seats_remaining" is returned. Propose another time. Error "party_too_large" means the group exceeds the total capacity: do NOT propose another time.`
    }
    if (this.capacityMode === 'tables') {
      return ` Server auto-assigns a table to the booking based on party_size — if no table fits at the requested time, error "no_table_available" (with "available_tables") is returned: propose another time from openSlots. Error "party_too_large" means no table can ever seat the group: do NOT propose another time.`
    }
    return ''
  }

  private getLocalHHMM(iso: string): string {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return '00:00'
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d)
    const h = parts.find((p) => p.type === 'hour')?.value || '00'
    const m = parts.find((p) => p.type === 'minute')?.value || '00'
    return `${h}:${m}`
  }

  private hhmmToMin(s: string): number {
    if (typeof s !== 'string' || !/^\d{1,2}:\d{2}$/.test(s)) return NaN
    const [h, m] = s.split(':').map(Number)
    return h * 60 + m
  }

  private findOverlappingBreak(
    startIso: string,
    endIso: string
  ): { start: string; end: string; message: string } | null {
    if (!this.breakTimes.length) return null
    const durationMin = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000
    return findBreakOverlap(startIso, durationMin, this.breakTimes, this.timezone)
  }


  private getLocalDate(iso: string): string {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return ''
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d)
    const y = parts.find((p) => p.type === 'year')?.value || '0000'
    const mo = parts.find((p) => p.type === 'month')?.value || '01'
    const da = parts.find((p) => p.type === 'day')?.value || '01'
    return `${y}-${mo}-${da}`
  }

  private getLocalWeekday(iso: string): number {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return -1
    const w = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timezone,
      weekday: 'short',
    }).format(d)
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w)
  }

  private isBeforeToday(startIso?: string): boolean {
    if (!startIso) return false
    try {
      return this.getLocalDate(startIso) < this.getLocalDate(new Date().toISOString())
    } catch {
      return false
    }
  }

  private findClosedDayHit(
    startIso: string,
    endIso: string
  ):
    | { kind: 'holiday'; date: string; name: string; message?: string }
    | { kind: 'range'; startDate: string; endDate: string; name: string; message?: string }
    | { kind: 'weekly'; weekday: Weekday; message?: string }
    | null {
    const date = this.getLocalDate(startIso)

    // 1) Holiday match (exact local date)
    if (date) {
      const h = this.holidays.find((x) => x.date === date)
      if (h) return { kind: 'holiday', date: h.date, name: h.name, message: h.message }
    }

    if (date) {
      const r = this.closedRanges.find((x) => date >= x.startDate && date <= x.endDate)
      if (r) {
        return {
          kind: 'range',
          startDate: r.startDate,
          endDate: r.endDate,
          name: r.name,
          message: r.message,
        }
      }
    }

    const wdIdx = this.getLocalWeekday(startIso)
    if (wdIdx < 0) return null
    const dayKey = WEEKDAY_KEYS[wdIdx]
    const cfg = this.weeklyClosedDays?.[dayKey]
    if (!cfg?.closed) return null

    if (cfg.partialOpenStart && cfg.partialOpenEnd) {
      const es = this.hhmmToMin(this.getLocalHHMM(startIso))
      const ee = this.hhmmToMin(this.getLocalHHMM(endIso))
      const ps = this.hhmmToMin(cfg.partialOpenStart)
      const pe = this.hhmmToMin(cfg.partialOpenEnd)
      if (
        Number.isFinite(es) &&
        Number.isFinite(ee) &&
        Number.isFinite(ps) &&
        Number.isFinite(pe) &&
        ps < pe &&
        es >= ps &&
        ee <= pe
      ) {
        return null
      }
    }
    return { kind: 'weekly', weekday: dayKey, message: cfg.message }
  }

  private weekdayDisplay(wd: Weekday): string {
    return wd.charAt(0).toUpperCase() + wd.slice(1)
  }

  private async bookEvent(
    accessToken: string,
    args: Record<string, any>,
    callContext?: ToolCallContext
  ): Promise<string> {
    const {
      start_iso,
      duration_min,
      summary,
      patient_email,
      notes,
    } = args
    let { patient_name, patient_phone } = args

    if (callContext?.callChannel === 'pstn' && callContext.callerNumber) {
      patient_phone = callContext.callerNumber
    }
    if (callContext?.callChannel === 'web_voice' || callContext?.callChannel === 'chat_widget') {
      patient_phone = patient_phone || callContext.restrictedContact?.phone || undefined
      patient_name = patient_name || callContext.restrictedContact?.name || undefined
    }

    if (callContext?.callChannel === 'pstn' && !patient_phone) {
      return JSON.stringify({
        success: false,
        error: 'phone_capture_failed',
        message: 'The caller phone number could not be captured from the call. Apologize briefly in the caller\'s language and ask them to try booking again in a moment.',
      })
    }

    if (!start_iso || !summary || !patient_name || !patient_phone) {
      return JSON.stringify({
        success: false,
        error: 'start_iso, summary, patient_name, patient_phone are required',
      })
    }

    if (isPlaceholderName(patient_name)) {
      return JSON.stringify({
        success: false,
        error: 'name_required',
        message: 'A real caller name is required before booking. Ask the caller for their full name — do NOT use placeholders like "Unknown" or generic labels.',
      })
    }
    if ((callContext?.callChannel === 'web_voice' || callContext?.callChannel === 'chat_widget' || callContext?.callChannel === 'booking_widget') && isPlaceholderPhone(patient_phone)) {
      return JSON.stringify({
        success: false,
        error: 'phone_required',
        message: 'A valid phone number is required before booking. Ask the caller for their contact phone number.',
      })
    }
    if (isNameGroundingApplicable(callContext?.callerUtterances, callContext?.transcriptSource)
        && !isNameGroundedInUtterances(patient_name, callContext?.callerUtterances)) {
      return JSON.stringify({
        success: false,
        error: 'name_required',
        message: 'Ask the caller for their full name and use exactly what they say. Do NOT fill the name from a placeholder, a known/previous contact, or your own guess.',
      })
    }
    if ((callContext?.callChannel === 'web_voice' || callContext?.callChannel === 'chat_widget')
        && callContext?.callerUtterances
        && !isPhoneGroundedInUtterances(patient_phone, callContext.callerUtterances)) {
      return JSON.stringify({
        success: false,
        error: 'phone_required',
        message: phoneNotGroundedMessage(callContext.callChannel),
      })
    }

    const tzCheck = validateOffsetMatchesCalendar(start_iso, this.timezone)
    if (!tzCheck.ok) {
      return JSON.stringify({
        success: false,
        error: 'wrong_timezone_offset',
        parameter: 'start_iso',
        expected_offset: tzCheck.expectedOffset,
        got_offset: tzCheck.gotOffset,
        calendar_timezone: this.timezone,
        message: tzCheck.refusalMessage,
      })
    }

    if (this.bookingWindowDays > 0) {
      const startMs = new Date(start_iso).getTime()
      if (Number.isFinite(startMs)) {
        const daysAhead = Math.round((startMs - Date.now()) / 86400000)
        if (daysAhead > this.bookingWindowDays) {
          return JSON.stringify({
            success: false,
            error: 'booking_window_exceeded',
            max_days_ahead: this.bookingWindowDays,
            requested_days_ahead: daysAhead,
            message: `The requested date is ${daysAhead} days ahead, but this practice only accepts bookings up to ${this.bookingWindowDays} days in advance. Ask the caller to suggest a closer date within the next ${this.bookingWindowDays} days.`,
          })
        }
      }
    }

    {
      const existing = await this.findExistingFutureAppointment(accessToken, callContext)
      if (existing) {
        return JSON.stringify({
          success: false,
          error: 'active_booking_exists',
          existing_appointment: existing,
          message: 'This caller already has one upcoming appointment, and only one upcoming appointment is allowed at a time. Tell the caller the existing appointment date and time, then offer to reschedule it (reschedule_event with its event_id) or cancel it (cancel_event) first. Do NOT book a second appointment.',
        })
      }
    }

    const fullDurationMin = this.getEffectiveEventDurationMin(typeof duration_min === 'number' ? duration_min : undefined)
    const lastCall = this.clampLastCall(start_iso, fullDurationMin)
    if (!lastCall.ok) return this.outsideWorkingHoursResponse(fullDurationMin)
    const durationMin = lastCall.durationMin
    const endDate = new Date(new Date(start_iso).getTime() + durationMin * 60 * 1000)

    {
      const intervalMin = this.getEffectiveSlotIntervalMin()
      if (!isSlotAligned(start_iso, intervalMin, this.workingHoursStart, this.timezone)) {
        return JSON.stringify({
          success: false,
          error: 'booking_misaligned_slot',
          expected_interval_min: intervalMin,
          working_hours_start: this.workingHoursStart,
          timezone: this.timezone,
          message: `The requested time does not align to the ${intervalMin}-minute slot grid (starting from ${this.workingHoursStart}). Call check_calendar_availability and propose ONLY times from "openSlots". For caller's off-grid time requests, suggest the nearest earlier openSlots entry.`,
        })
      }
    }

    if (!isWithinWorkingHours(start_iso, durationMin, this.workingHoursStart, this.workingHoursEnd, this.timezone)) {
      return this.outsideWorkingHoursResponse(durationMin)
    }

    {
      const closed = this.findClosedDayHit(start_iso, endDate.toISOString())
      if (closed) {
        if (closed.kind === 'holiday') {
          return JSON.stringify({
            success: false,
            error: 'booking_on_holiday',
            date: closed.date,
            holiday_name: closed.name,
            timezone: this.timezone,
            refusal_message:
              closed.message?.trim() ||
              `We are closed on ${closed.name} (${closed.date}). Bookings cannot be accepted on this day.`,
            instructions:
              "Speak the refusal_message naturally in the caller's language. Then propose a different date that is not a holiday and not a weekly closed day.",
          })
        }
        if (closed.kind === 'range') {
          return JSON.stringify({
            success: false,
            error: 'booking_in_closed_range',
            range_start: closed.startDate,
            range_end: closed.endDate,
            range_name: closed.name,
            timezone: this.timezone,
            refusal_message:
              closed.message?.trim()
                ?.replace(/\{start\}/g, closed.startDate)
                ?.replace(/\{end\}/g, closed.endDate)
                ?.replace(/\{name\}/g, closed.name) ||
              `We are closed from ${closed.startDate} to ${closed.endDate} (${closed.name}). Bookings cannot be accepted in this range.`,
            instructions:
              "Speak the refusal_message naturally. Then propose a date outside this closed range. If the caller insists, mention the end date so they know when bookings resume.",
          })
        }
        const wdLabel = this.weekdayDisplay(closed.weekday)
        return JSON.stringify({
          success: false,
          error: 'booking_on_closed_day',
          weekday: closed.weekday,
          timezone: this.timezone,
          refusal_message:
            closed.message?.trim()?.replace(/\{weekday\}/g, wdLabel) ||
            `We are closed on ${wdLabel}s. Bookings cannot be accepted on this day.`,
          instructions:
            'Speak the refusal_message naturally. Propose another weekday that is not closed.',
        })
      }
    }

    {
      const hit = this.findOverlappingBreak(start_iso, endDate.toISOString())
      if (hit) {
        return JSON.stringify({
          success: false,
          error: 'booking_in_break_time',
          break_window: `${hit.start}-${hit.end}`,
          timezone: this.timezone,
          refusal_message:
            hit.message?.trim() ||
            `Bookings are not accepted during our daily break window ${hit.start}-${hit.end}.`,
          instructions:
            "Speak the refusal_message to the caller in their language. Then propose another slot that does NOT overlap this break window. Do not attempt to force the booking — the server will reject it again.",
        })
      }
    }

    let assignedTable: { tableId: string; tableName: string; instanceIdx: number } | null = null
    let resolvedPartySize = 1
    if (this.capacityMode === 'simple' || this.capacityMode === 'tables') {
      const partyArg = parsePartySizeArg((args as any).party_size)
      if (partyArg === 'invalid') return this.invalidPartySizeResponse()
      if (partyArg === null && this.capacityMode === 'tables') {
        return JSON.stringify({
          success: false,
          error: 'party_size_required',
          message: 'party_size is required in table-inventory mode. Ask the caller "How many people?" and call again with the number.',
        })
      }
      const partySize = partyArg ?? 1
      const tooLarge = this.partyTooLargeResponse(partySize)
      if (tooLarge) return tooLarge
      resolvedPartySize = partySize

      const sMs = new Date(start_iso).getTime()
      const eMs = new Date(endDate).getTime()
      const overlapEvents = await this.fetchEventsInWindow(accessToken, sMs, eMs)
      if (!overlapEvents) {
        return JSON.stringify({
          success: false,
          error: 'calendar_unavailable',
          message: 'The calendar could not be read to check free seats/tables, so the booking was NOT made. Apologize briefly and ask the caller to try again in a moment. Do NOT say the booking is confirmed.',
        })
      }

      if (this.capacityMode === 'simple') {
        const { used, blocked } = computeSeatUsage(overlapEvents as any, sMs, eMs, this.timezone)
        if (blocked) return this.timeUnavailableResponse()
        if (used + partySize > this.simpleCapacity) {
          return JSON.stringify({
            success: false,
            error: 'capacity_exceeded',
            requested_party_size: partySize,
            seats_in_use: used,
            capacity_total: this.simpleCapacity,
            seats_remaining: Math.max(0, this.simpleCapacity - used),
            message: `That time has only ${Math.max(0, this.simpleCapacity - used)} seats remaining (capacity ${this.simpleCapacity}, ${used} already booked). Propose another time with enough seats or smaller party size.`,
          })
        }
      } else {
        const { occupied, blocked } = computeTableOccupancy(overlapEvents as any, this.tableInventory, sMs, eMs, this.timezone)
        if (blocked) return this.timeUnavailableResponse()
        const assigned = assignTable(this.tableInventory, occupied, partySize, this.tableMatchPolicy)
        if (!assigned) {
          const summary = summarizeAvailability(this.tableInventory, occupied)
          return JSON.stringify({
            success: false,
            error: 'no_table_available',
            requested_party_size: partySize,
            available_tables: summary
              .filter((t) => t.available > 0)
              .map((t) => ({ name: t.tableName, capacity: t.capacity, available: t.available })),
            message: `No table fits ${partySize} people at that time. Available: ${summary
              .filter((t) => t.available > 0)
              .map((t) => `${t.tableName} (seats ${t.capacity}, ${t.available} free)`)
              .join(', ') || 'none'}. Propose another time.`,
          })
        }
        assignedTable = assigned
      }
    }

    if (callContext && needsBookingConfirm(callContext.callChannel)) {
      const partyForConfirm = this.capacityMode === 'simple' || this.capacityMode === 'tables' ? resolvedPartySize : null
      const confirmKey = bookingConfirmKey({
        calendarId: this.calendarId, startIso: start_iso, name: patient_name, phone: patient_phone, partySize: partyForConfirm,
        fullPhone: callContext.callChannel === 'web_voice',
      })
      const confirmOutcome = consumeBookingConfirm(callContext, confirmKey, args?.confirmed)
      if (confirmOutcome === 'duplicate') return bookingConfirmDuplicateResult()
      if (confirmOutcome === 'ask') {
        return bookingConfirmRequiredResult({
          startIso: start_iso, timezone: this.timezone, name: patient_name, partySize: partyForConfirm,
          readPhone: callContext.callChannel === 'web_voice',
          notes: notes ? descriptionLineValue(notes) : null,
        })
      }
    }

    const sourceLine =
      callContext?.callChannel === 'pstn'
        ? `Source: PSTN call${callContext.callerNumber ? ` from ${callContext.callerNumber}` : ''}`
        : callContext?.callChannel === 'web_voice'
          ? 'Source: Web voice call'
          : callContext?.callChannel === 'booking_widget'
            ? 'Source: Booking widget'
            : null

    const descriptionLines = [
      `Name: ${descriptionLineValue(patient_name)}`,
      `Phone: ${normalizePhoneForStorage(patient_phone)}`,
    ]
    if (patient_email) descriptionLines.push(`Email: ${descriptionLineValue(patient_email)}`)
    if (this.capacityMode === 'simple' || this.capacityMode === 'tables') {
      descriptionLines.push(formatPartyLine(resolvedPartySize))
    }
    if (assignedTable) {
      descriptionLines.push(formatTableLine(assignedTable))
    }
    if (notes) descriptionLines.push('', `Notes: ${descriptionLineValue(notes)}`)
    if (sourceLine) descriptionLines.push('', sourceLine)

    const body: Record<string, any> = {
      summary,
      description: descriptionLines.join('\n'),
      status: 'confirmed',
      start: { dateTime: start_iso, timeZone: this.timezone },
      end: { dateTime: endDate.toISOString(), timeZone: this.timezone },
    }

    if (this.inviteAttendee && patient_email) {
      body.attendees = [{ email: patient_email, displayName: patient_name }]
    }

    const sendUpdates = this.inviteAttendee && patient_email ? 'all' : 'none'
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events?sendUpdates=${sendUpdates}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()
    if (!response.ok) {
      return JSON.stringify({
        success: false,
        error: data.error?.message || `events.insert failed (status ${response.status})`,
      })
    }

    const fastPathContact: { name?: string; phone?: string } = {}
    if (patient_name) fastPathContact.name = patient_name
    if (patient_phone && callContext?.callChannel !== 'pstn') fastPathContact.phone = patient_phone

    await recordBookingCreated(this.prisma, {
      userId: this.ownerUserId,
      agentId: this.ownerAgentId,
      accountId: this.accountId,
      provider: 'google',
      calendarId: this.calendarId,
      externalEventId: data.id,
      startIso: data.start?.dateTime || start_iso,
      endIso: data.end?.dateTime || endDate.toISOString(),
    })

    if (this.notifyOnBook) {
      void sendBookingPush(this.prisma, this.ownerUserId, 'book', {
        name: patient_name,
        startIso: data.start?.dateTime || start_iso,
        timezone: this.timezone,
      }).catch(() => {})
    }

    return JSON.stringify({
      success: true,
      eventId: data.id,
      htmlLink: data.htmlLink,
      start: data.start?.dateTime,
      end: data.end?.dateTime,
      voice_fastpath: {
        start_iso: data.start?.dateTime || start_iso,
        calendar_timezone: this.timezone,
        ...(Object.keys(fastPathContact).length > 0 ? { contact: fastPathContact } : {}),
        ...(assignedTable
          ? { table_name: assignedTable.tableName, party_size: resolvedPartySize }
          : this.capacityMode === 'simple'
            ? { party_size: resolvedPartySize }
            : {}),
      },
      ...(assignedTable
        ? {
            assigned_table: {
              name: assignedTable.tableName,
              instance: assignedTable.instanceIdx,
              capacity: this.tableInventory.find((t) => t.id === assignedTable!.tableId)?.capacity,
            },
            party_size: resolvedPartySize,
            message: `Booked. Confirm to caller: their party of ${resolvedPartySize} is seated at ${assignedTable.tableName} (seats ${this.tableInventory.find((t) => t.id === assignedTable!.tableId)?.capacity}). Do NOT mention the instance number "#${assignedTable.instanceIdx}" — that is internal.`,
          }
        : (this.capacityMode === 'simple'
          ? { party_size: resolvedPartySize }
          : {})),
      ...(this.bookingMessagePrompt ? { next_step: bookingMessageNextStep(this.bookingMessagePrompt) } : {}),
    })
  }

  private async fetchEventsInWindow(
    accessToken: string,
    startMs: number,
    endMs: number
  ): Promise<any[] | null> {
    const padMs = 3 * 3600 * 1000
    return this.listEventsAll(
      accessToken,
      new Date(startMs - padMs).toISOString(),
      new Date(endMs + padMs).toISOString(),
      'fetchEventsInWindow'
    )
  }

  private async listEventsAll(
    accessToken: string,
    timeMinIso: string,
    timeMaxIso: string,
    diagLabel: string
  ): Promise<any[] | null> {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`
      + `?timeMin=${encodeURIComponent(timeMinIso)}`
      + `&timeMax=${encodeURIComponent(timeMaxIso)}`
      + `&singleEvents=true&orderBy=startTime&maxResults=250`
    const items: any[] = []
    let pageToken: string | undefined
    for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
      const __t0 = Date.now()
      const url = pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base
      const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        diagGCalFail(diagLabel, r.status, d?.error, __t0)
        return null
      }
      if (!d || !Array.isArray(d.items)) return null
      items.push(...d.items)
      if (d.nextPageToken === undefined || d.nextPageToken === null) return items.filter((ev: any) => ev?.status !== 'cancelled')
      if (typeof d.nextPageToken !== 'string' || !d.nextPageToken) return null
      pageToken = d.nextPageToken
    }
    return null
  }

  private async findExistingFutureAppointment(
    accessToken: string,
    callContext?: ToolCallContext
  ): Promise<{ event_id: string; start_iso: string; summary?: string } | null> {
    try {
      const raw = await this.lookupAppointments(accessToken, {}, callContext)
      const parsed = JSON.parse(raw)
      if (!parsed?.success || !Array.isArray(parsed.appointments)) return null
      const now = Date.now()
      for (const ap of parsed.appointments) {
        const t = new Date(ap?.start).getTime()
        if (Number.isFinite(t) && t > now) {
          return { event_id: ap.event_id, start_iso: ap.start, summary: ap.summary }
        }
      }
      return null
    } catch {
      return null
    }
  }

  private async lookupAppointments(
    accessToken: string,
    args: Record<string, any>,
    callContext?: ToolCallContext
  ): Promise<string> {
    let { patient_name, patient_email, patient_phone } = args

    if (isDev) {
      console.log('[Calendar/lookup] entry:', {
        raw_args: {
          patient_name: !!patient_name,
          patient_phone: maskPhone(patient_phone),
          patient_email: patient_email ? '(set)' : undefined,
        },
        callChannel: callContext?.callChannel,
        callerNumber: maskPhone(callContext?.callerNumber ?? null),
        restrictedContact: callContext?.restrictedContact
          ? {
              phone: maskPhone(callContext.restrictedContact.phone),
              hasEmail: !!callContext.restrictedContact.email,
            }
          : null,
      })
    }

    {
      const ident = resolveLookupIdentity(callContext, { patient_name, patient_phone, patient_email })
      patient_name = ident.name
      patient_phone = ident.phone
      patient_email = ident.email
    }

    const ownedIds = callContext?.sameCallOwnedEventIds
    const hasOwned = !!ownedIds && ownedIds.size > 0

    if (isDev) {
      console.log('[Calendar/lookup] after override:', {
        patient_name: !!patient_name,
        patient_phone: maskPhone(patient_phone),
        patient_email: patient_email ? '(set)' : undefined,
        ownedEventCount: ownedIds?.size ?? 0,
      })
    }

    if (!patient_phone && !patient_name && !patient_email && !hasOwned) {
      return JSON.stringify({
        success: false,
        error: 'no_match_criteria',
        message: 'No verified identity for this visitor, so a lookup is not possible. On web, the visitor is recognized automatically across visits; on PSTN, the caller number is used. Do not ask for a phone number to look up — only their own appointments from this session or a recognized return visit can be retrieved.',
      })
    }

    const now = Date.now()
    const tzWallFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timezone,
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
    const wallParts = tzWallFmt.formatToParts(new Date(now))
    const wallH = Number(wallParts.find((p) => p.type === 'hour')?.value || '0') % 24
    const wallM = Number(wallParts.find((p) => p.type === 'minute')?.value || '0')
    const wallS = Number(wallParts.find((p) => p.type === 'second')?.value || '0')
    const sinceMidnightMs = ((wallH * 3600) + (wallM * 60) + wallS) * 1000 + (now % 1000)
    const todayMidnightMs = now - sinceMidnightMs
    const includePast = (args as any)?.include_past === true
    const lookbackMs = includePast && this.historyLookupDays > 0 ? this.historyLookupDays * 86400000 : 0
    const timeMin = new Date(todayMidnightMs - lookbackMs).toISOString()
    const futureDays = this.bookingWindowDays > 0 ? this.bookingWindowDays : 200
    const timeMax = new Date(now + futureDays * 86400000).toISOString()

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`
      + `?timeMin=${encodeURIComponent(timeMin)}`
      + `&timeMax=${encodeURIComponent(timeMax)}`
      + `&singleEvents=true&orderBy=startTime&maxResults=250`

    const __t0 = Date.now()
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await response.json()
    if (!response.ok) {
      diagGCalFail('lookupAppointments/events.list', response.status, data.error, __t0)
      return JSON.stringify({
        success: false,
        error: data.error?.message || `events.list failed (status ${response.status})`,
      })
    }

    const items: any[] = Array.isArray(data.items) ? data.items : []
    const nameNeedle = patient_name ? String(patient_name).toLowerCase() : ''
    const emailNeedle = patient_email ? String(patient_email).toLowerCase() : ''

    const matches: Array<Record<string, any>> = []
    for (const ev of items) {
      const haystack = `${ev.summary || ''}\n${ev.description || ''}`
      const start = ev.start?.dateTime || ev.start?.date
      const end = ev.end?.dateTime || ev.end?.date || start
      const matchedBy = matchAppointmentBy({
        haystack, eventId: ev.id, phone: patient_phone, nameNeedle, emailNeedle, ownedIds,
      })
      if (matchedBy) {
        const notes = notesFromEvent(ev)
        matches.push({
          event_id: ev.id,
          summary: ev.summary,
          start,
          end,
          status: ev.status,
          description_excerpt: (ev.description || '').slice(0, 300),
          ...(notes ? { notes } : {}),
          matched_by: matchedBy,
          _parsedContact: contactFromEvent(ev),
        })
        if (matches.length >= 10) break
      }
    }

    const voiceFastpath = matches.length === 0
      ? { count: 0 as const }
      : matches.length === 1
        ? (() => {
            const parsed = matches[0]._parsedContact || {}
            const lookupContact: { name?: string; phone?: string } = {}
            if (parsed.name) lookupContact.name = parsed.name
            if (parsed.phone && callContext?.callChannel !== 'pstn') lookupContact.phone = parsed.phone
            return {
              count: 1 as const,
              start_iso: matches[0].start,
              calendar_timezone: this.timezone,
              ...(Object.keys(lookupContact).length > 0 ? { contact: lookupContact } : {}),
            }
          })()
        : null
    for (const m of matches) {
      delete m._parsedContact
    }

    return JSON.stringify({
      success: true,
      lookup_window: {
        current_time: new Date(now).toISOString(),
        from: timeMin,
        to: timeMax,
        history_days: 0,
        future_days: futureDays,
      },
      count: matches.length,
      appointments: matches,
      message: matches.length === 0
        ? `No matching appointments found from today onwards.`
        : undefined,
      ...(voiceFastpath ? { voice_fastpath: voiceFastpath } : {}),
    })
  }

  private buildVerificationRequiredResponse(intent: 'cancel' | 'reschedule'): string {
    const hasPstn = !!this.pstnCallbackNumber
    const action = intent === 'cancel' ? 'cancel' : 'reschedule'
    return JSON.stringify({
      success: false,
      error: 'verification_required',
      pstn_callback_number: this.pstnCallbackNumber || null,
      refusal_message: hasPstn
        ? `For your security, ${action}ing an appointment requires identity verification. Please call ${this.pstnCallbackNumber} directly — your phone number will be verified automatically and we can ${action} your booking right away.`
        : `For your security, ${action}ing an appointment requires identity verification. Please use the confirmation link from your booking email or visit us in person. We cannot ${action} appointments through the web chat without verifying you.`,
      instructions: hasPstn
        ? `MANDATORY: Speak the refusal_message to the visitor in their language, replacing the English with a natural translation. Read the phone number ${this.pstnCallbackNumber} digit by digit clearly. Do NOT proceed with any further calendar actions for this booking. Do NOT reveal any details about the appointment itself.`
        : `MANDATORY: Speak the refusal_message to the visitor in their language. Do NOT proceed with any further calendar actions for this booking. Do NOT reveal any details about the appointment itself.`,
    })
  }

  private assertEventOwnership(eventData: any, callContext?: ToolCallContext): string | null {
    const eventId = typeof eventData?.id === 'string' ? eventData.id : undefined
    const haystack = `${eventData?.summary || ''}\n${eventData?.description || ''}`
    return evaluateEventOwnership(eventId, haystack, callContext)
  }

  private async cancelEvent(
    accessToken: string,
    args: Record<string, any>,
    callContext?: ToolCallContext
  ): Promise<string> {
    const { event_id } = args
    if (!event_id || typeof event_id !== 'string') {
      return JSON.stringify({
        success: false,
        error: 'event_id is required. Use lookup_appointments first to get the event_id.',
      })
    }

    const getUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(event_id)}`
    const getRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const eventData = await getRes.json()
    if (!getRes.ok) {
      return JSON.stringify({
        success: false,
        error: eventData.error?.message || `Event not found (status ${getRes.status})`,
      })
    }
    if (eventData.status === 'cancelled') {
      return JSON.stringify({
        success: false,
        error: 'already_cancelled',
        message: 'This appointment has already been cancelled.',
      })
    }

    const ownershipCheck = this.assertEventOwnership(eventData, callContext)
    if (ownershipCheck === 'ownership_mismatch') {
      return JSON.stringify({
        success: false,
        error: 'ownership_mismatch',
        message: 'This appointment is not linked to the current caller. Refuse to cancel and politely explain that only the appointment owner can cancel their own booking. Do not reveal any details about this appointment.',
      })
    }
    if (ownershipCheck === 'verification_required') {
      return this.buildVerificationRequiredResponse('cancel')
    }

    const startIso = eventData.start?.dateTime || eventData.start?.date
    if (this.isBeforeToday(startIso)) {
      return JSON.stringify({
        success: false,
        error: 'appointment_in_past',
        message: 'That appointment is in the past and cannot be cancelled.',
      })
    }
    const startMs = startIso ? new Date(startIso).getTime() : NaN

    if (this.cancellationPolicy?.enabled
        && this.cancellationPolicy.cutoffHours > 0
        && Number.isFinite(startMs)
        && !isWithinEditGrace(eventData)) {
      const hoursUntil = (startMs - Date.now()) / 3600000
      if (hoursUntil < this.cancellationPolicy.cutoffHours && hoursUntil > 0) {
        const refusal = this.cancellationPolicy.refuseMessage?.trim()
          || `Appointments cannot be cancelled within ${this.cancellationPolicy.cutoffHours} hours of the scheduled time.`

        const isPstn = callContext?.callChannel === 'pstn'
        const canOfferTransfer =
          isPstn
          && this.cancellationPolicy.offerTransfer === true
          && !!this.staffTransferNumber

        return JSON.stringify({
          success: false,
          error: 'cancellation_too_late',
          cutoff_hours: this.cancellationPolicy.cutoffHours,
          hours_until_appointment: Math.round(hoursUntil * 10) / 10,
          appointment_start: startIso,
          refusal_message: refusal,
          ...(canOfferTransfer
            ? {
                transfer_offer: this.cancellationPolicy.transferMessage?.trim()
                  || 'Would you like me to transfer you to a staff member?',
                staff_transfer_number: this.staffTransferNumber,
                instructions: `Speak the refusal_message first, then the transfer_offer. If the caller explicitly agrees (e.g. "yes", "please do", "connect me"), say a short handoff line like "Connecting you to a staff member now." and then call the ${this.transferToolName} function to actually forward the call. If they decline, confirm and continue the conversation normally.`,
              }
            : {
                instructions: 'Speak the refusal_message to the caller in their language. Do not attempt any alternative — the policy is firm.',
              }),
        })
      }
    }

    const delUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(event_id)}?sendUpdates=none`
    const delRes = await fetch(delUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!delRes.ok && delRes.status !== 204 && delRes.status !== 410) {
      let errMsg = `delete failed (status ${delRes.status})`
      try {
        const errData = await delRes.json()
        errMsg = errData.error?.message || errMsg
      } catch {
        /* ignore */
      }
      return JSON.stringify({ success: false, error: errMsg })
    }

    callContext?.sameCallOwnedEventIds?.delete(event_id)

    await recordBookingCancelled(this.prisma, { accountId: this.accountId, calendarId: this.calendarId, externalEventId: event_id })

    if (this.notifyOnCancel) {
      void sendBookingPush(this.prisma, this.ownerUserId, 'cancel', {
        startIso: startIso,
        timezone: this.timezone,
      }).catch(() => {})
    }

    return JSON.stringify({
      success: true,
      event_id,
      appointment_start: startIso,
      summary: eventData.summary,
      message: 'The appointment has been cancelled. Confirm the cancellation briefly with the caller.',
      ...(startIso
        ? {
            voice_fastpath: {
              cancelled_start_iso: startIso,
              calendar_timezone: this.timezone,
            },
          }
        : {}),
    })
  }

  private async rescheduleEvent(
    accessToken: string,
    args: Record<string, any>,
    callContext?: ToolCallContext
  ): Promise<string> {
    const { event_id, new_start_iso, new_duration_min } = args
    if (!event_id || typeof event_id !== 'string') {
      return JSON.stringify({
        success: false,
        error: 'event_id is required. Use lookup_appointments first to get the event_id.',
      })
    }
    if (!new_start_iso || typeof new_start_iso !== 'string') {
      return JSON.stringify({
        success: false,
        error: 'new_start_iso is required (ISO 8601 with timezone).',
      })
    }

    const newStartMs = new Date(new_start_iso).getTime()
    if (!Number.isFinite(newStartMs)) {
      return JSON.stringify({
        success: false,
        error: 'new_start_iso could not be parsed as a valid ISO 8601 datetime.',
      })
    }

    const tzCheck = validateOffsetMatchesCalendar(new_start_iso, this.timezone)
    if (!tzCheck.ok) {
      return JSON.stringify({
        success: false,
        error: 'wrong_timezone_offset',
        parameter: 'new_start_iso',
        expected_offset: tzCheck.expectedOffset,
        got_offset: tzCheck.gotOffset,
        calendar_timezone: this.timezone,
        message: tzCheck.refusalMessage,
      })
    }

    const getUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(event_id)}`
    const getRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const eventData = await getRes.json()
    if (!getRes.ok) {
      return JSON.stringify({
        success: false,
        error: eventData.error?.message || `Event not found (status ${getRes.status})`,
      })
    }
    if (eventData.status === 'cancelled') {
      return JSON.stringify({
        success: false,
        error: 'already_cancelled',
        message: 'This appointment has already been cancelled and cannot be rescheduled. Offer to book a new one via check_calendar_availability + book_calendar_event.',
      })
    }

    const rescheduleOwnershipCheck = this.assertEventOwnership(eventData, callContext)
    if (rescheduleOwnershipCheck === 'ownership_mismatch') {
      return JSON.stringify({
        success: false,
        error: 'ownership_mismatch',
        message: 'This appointment is not linked to the current caller. Refuse to reschedule and politely explain that only the appointment owner can change their own booking. Do not reveal any details about this appointment.',
      })
    }
    if (rescheduleOwnershipCheck === 'verification_required') {
      return this.buildVerificationRequiredResponse('reschedule')
    }

    const currentStartIso: string | undefined = eventData.start?.dateTime || eventData.start?.date
    if (this.isBeforeToday(currentStartIso)) {
      return JSON.stringify({
        success: false,
        error: 'appointment_in_past',
        message: 'That appointment is in the past and cannot be rescheduled.',
      })
    }
    const currentEndIso: string | undefined = eventData.end?.dateTime || eventData.end?.date
    const currentStartMs = currentStartIso ? new Date(currentStartIso).getTime() : NaN
    const currentEndMs = currentEndIso ? new Date(currentEndIso).getTime() : NaN
    const currentDurationMin =
      Number.isFinite(currentStartMs) && Number.isFinite(currentEndMs)
        ? Math.round((currentEndMs - currentStartMs) / 60000)
        : this.defaultDurationMin
    const requestedDurationMin = this.capacityMode === 'tables'
      ? this.getEffectiveEventDurationMin()
      : (typeof new_duration_min === 'number' && new_duration_min > 0 ? new_duration_min : currentDurationMin)
    const lastCallCheck = this.clampLastCall(new_start_iso, requestedDurationMin)
    if (!lastCallCheck.ok) return this.outsideWorkingHoursResponse(requestedDurationMin)
    const effectiveDurationMin = lastCallCheck.durationMin

    if (this.bookingWindowDays > 0) {
      const daysAhead = Math.round((newStartMs - Date.now()) / 86400000)
      if (daysAhead > this.bookingWindowDays) {
        return JSON.stringify({
          success: false,
          error: 'booking_window_exceeded',
          max_days_ahead: this.bookingWindowDays,
          requested_days_ahead: daysAhead,
          message: `The requested new date is ${daysAhead} days ahead, but this practice only accepts bookings up to ${this.bookingWindowDays} days in advance. Ask the caller to pick a closer date.`,
        })
      }
    }

    {
      const proposedEndIsoForClosed = new Date(newStartMs + effectiveDurationMin * 60000).toISOString()
      const closed = this.findClosedDayHit(new_start_iso, proposedEndIsoForClosed)
      if (closed) {
        if (closed.kind === 'holiday') {
          return JSON.stringify({
            success: false,
            error: 'booking_on_holiday',
            date: closed.date,
            holiday_name: closed.name,
            timezone: this.timezone,
            refusal_message:
              closed.message?.trim() ||
              `We are closed on ${closed.name} (${closed.date}). The reschedule cannot be accepted to that day.`,
            instructions:
              "Speak the refusal_message naturally in the caller's language. Then propose a different date that is not a holiday and not a weekly closed day.",
          })
        }
        if (closed.kind === 'range') {
          return JSON.stringify({
            success: false,
            error: 'booking_in_closed_range',
            range_start: closed.startDate,
            range_end: closed.endDate,
            range_name: closed.name,
            timezone: this.timezone,
            refusal_message:
              closed.message?.trim()
                ?.replace(/\{start\}/g, closed.startDate)
                ?.replace(/\{end\}/g, closed.endDate)
                ?.replace(/\{name\}/g, closed.name) ||
              `We are closed from ${closed.startDate} to ${closed.endDate} (${closed.name}). The reschedule cannot be accepted to that range.`,
            instructions:
              "Speak the refusal_message naturally. Then propose a date outside this closed range. Mention the end date so the caller knows when bookings resume.",
          })
        }
        const wdLabel = this.weekdayDisplay(closed.weekday)
        return JSON.stringify({
          success: false,
          error: 'booking_on_closed_day',
          weekday: closed.weekday,
          timezone: this.timezone,
          refusal_message:
            closed.message?.trim()?.replace(/\{weekday\}/g, wdLabel) ||
            `We are closed on ${wdLabel}s. The reschedule cannot be accepted to that day.`,
          instructions:
            'Speak the refusal_message naturally. Propose another weekday that is not closed.',
        })
      }
    }

    {
      const proposedEndIso = new Date(newStartMs + effectiveDurationMin * 60000).toISOString()
      const hit = this.findOverlappingBreak(new_start_iso, proposedEndIso)
      if (hit) {
        return JSON.stringify({
          success: false,
          error: 'booking_in_break_time',
          break_window: `${hit.start}-${hit.end}`,
          timezone: this.timezone,
          refusal_message:
            hit.message?.trim() ||
            `Bookings are not accepted during our daily break window ${hit.start}-${hit.end}.`,
          instructions:
            "Speak the refusal_message to the caller in their language. Then propose another time that does NOT overlap this break window. Do not retry with the same start time.",
        })
      }
    }

    if (this.reschedulePolicy?.enabled
        && this.reschedulePolicy.cutoffHours > 0
        && Number.isFinite(currentStartMs)
        && !isWithinEditGrace(eventData)) {
      const hoursUntil = (currentStartMs - Date.now()) / 3600000
      if (hoursUntil < this.reschedulePolicy.cutoffHours && hoursUntil > 0) {
        const refusal = this.reschedulePolicy.refuseMessage?.trim()
          || `Appointments cannot be rescheduled within ${this.reschedulePolicy.cutoffHours} hours of the scheduled time.`

        return JSON.stringify({
          success: false,
          error: 'reschedule_too_late',
          cutoff_hours: this.reschedulePolicy.cutoffHours,
          hours_until_appointment: Math.round(hoursUntil * 10) / 10,
          appointment_start: currentStartIso,
          refusal_message: refusal,
          instructions: 'Speak the refusal_message to the caller in their language. Do not attempt to reschedule — the policy is firm. You MAY offer to cancel the appointment instead if that still fits the cancellation policy.',
        })
      }
    }

    {
      const intervalMin = this.getEffectiveSlotIntervalMin()
      if (!isSlotAligned(new_start_iso, intervalMin, this.workingHoursStart, this.timezone)) {
        return JSON.stringify({
          success: false,
          error: 'booking_misaligned_slot',
          expected_interval_min: intervalMin,
          working_hours_start: this.workingHoursStart,
          timezone: this.timezone,
          message: `The new start time does not align to the ${intervalMin}-minute slot grid. Call check_calendar_availability for the new date and propose ONLY times from "openSlots".`,
        })
      }
    }

    if (!isWithinWorkingHours(new_start_iso, effectiveDurationMin, this.workingHoursStart, this.workingHoursEnd, this.timezone)) {
      return this.outsideWorkingHoursResponse(effectiveDurationMin)
    }

    const durationMin = effectiveDurationMin
    const newEndIso = new Date(newStartMs + durationMin * 60000).toISOString()

    let rescheduleAssignedTable: { tableId: string; tableName: string; instanceIdx: number } | null = null
    let reschedulePartySize = 1
    let partyChanged = false
    if (this.capacityMode === 'simple' || this.capacityMode === 'tables') {
      const existingDesc = String(eventData.description || '')
      const existingPartySize = parsePartySize(existingDesc)
      const newPartyArg = parsePartySizeArg((args as any).party_size)
      if (newPartyArg === 'invalid') return this.invalidPartySizeResponse()
      const movePartySize = newPartyArg ?? existingPartySize
      partyChanged = movePartySize !== existingPartySize
      reschedulePartySize = movePartySize
      const tooLarge = this.partyTooLargeResponse(movePartySize)
      if (tooLarge) return tooLarge

      const sMs = newStartMs
      const eMs = new Date(newEndIso).getTime()
      const windowEvents = await this.fetchEventsInWindow(accessToken, sMs, eMs)
      if (!windowEvents) {
        return JSON.stringify({
          success: false,
          error: 'calendar_unavailable',
          message: 'The calendar could not be read to check free seats/tables, so the appointment was NOT changed. Apologize briefly and ask the caller to try again in a moment. Do NOT say it was rescheduled.',
        })
      }
      const overlapEvents = windowEvents.filter((ev: any) => ev?.id !== event_id)

      if (this.capacityMode === 'simple') {
        const { used, blocked } = computeSeatUsage(overlapEvents as any, sMs, eMs, this.timezone)
        if (blocked) return this.timeUnavailableResponse()
        if (used + movePartySize > this.simpleCapacity) {
          return JSON.stringify({
            success: false,
            error: 'capacity_exceeded',
            requested_party_size: movePartySize,
            seats_in_use: used,
            capacity_total: this.simpleCapacity,
            seats_remaining: Math.max(0, this.simpleCapacity - used),
            message: `That new time has only ${Math.max(0, this.simpleCapacity - used)} seats remaining (capacity ${this.simpleCapacity}, ${used} already booked). Propose another time with enough seats.`,
          })
        }
      } else {
        const { occupied, blocked } = computeTableOccupancy(overlapEvents as any, this.tableInventory, sMs, eMs, this.timezone)
        if (blocked) return this.timeUnavailableResponse()
        const assigned = assignTable(this.tableInventory, occupied, movePartySize, this.tableMatchPolicy)
        if (!assigned) {
          const summary = summarizeAvailability(this.tableInventory, occupied)
          return JSON.stringify({
            success: false,
            error: 'no_table_available',
            requested_party_size: movePartySize,
            available_tables: summary
              .filter((t) => t.available > 0)
              .map((t) => ({ name: t.tableName, capacity: t.capacity, available: t.available })),
            message: `No table fits the party of ${movePartySize} at the new time. Propose another time.`,
          })
        }
        rescheduleAssignedTable = assigned
      }
    }

    let patchBody: Record<string, any> = {
      start: { dateTime: new_start_iso, timeZone: this.timezone },
      end: { dateTime: newEndIso, timeZone: this.timezone },
    }
    if (partyChanged || rescheduleAssignedTable) {
      let finalDesc = String(eventData.description || '')
      if (partyChanged) finalDesc = replacePartyLine(finalDesc, reschedulePartySize)
      if (rescheduleAssignedTable) finalDesc = replaceTableLine(finalDesc, formatTableLine(rescheduleAssignedTable))
      patchBody.description = finalDesc
    }

    const patchUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(event_id)}?sendUpdates=${this.inviteAttendee ? 'all' : 'none'}`
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchBody),
    })
    const patchData = await patchRes.json()
    if (!patchRes.ok) {
      return JSON.stringify({
        success: false,
        error: patchData.error?.message || `events.patch failed (status ${patchRes.status})`,
      })
    }

    await recordBookingRescheduled(this.prisma, {
      accountId: this.accountId,
      calendarId: this.calendarId,
      externalEventId: event_id,
      startIso: patchData.start?.dateTime,
      endIso: patchData.end?.dateTime,
    })

    if (this.notifyOnReschedule) {
      void sendBookingPush(this.prisma, this.ownerUserId, 'reschedule', {
        startIso: patchData.start?.dateTime || new_start_iso,
        timezone: this.timezone,
      }).catch(() => {})
    }

    return JSON.stringify({
      success: true,
      event_id,
      previous_start: currentStartIso,
      new_start: patchData.start?.dateTime,
      new_end: patchData.end?.dateTime,
      summary: patchData.summary,
      ...(rescheduleAssignedTable
        ? {
            assigned_table: {
              name: rescheduleAssignedTable.tableName,
              instance: rescheduleAssignedTable.instanceIdx,
              capacity: this.tableInventory.find((t) => t.id === rescheduleAssignedTable!.tableId)?.capacity,
            },
            party_size: reschedulePartySize,
          }
        : {}),
      message: 'The appointment has been rescheduled. Read back the new date/time to the caller to confirm.',
      ...(patchData.start?.dateTime
        ? {
            voice_fastpath: {
              previous_start_iso: currentStartIso,
              new_start_iso: patchData.start.dateTime,
              calendar_timezone: this.timezone,
            },
          }
        : {}),
    })
  }

  private async updateEventContact(
    accessToken: string,
    args: Record<string, any>,
    callContext?: ToolCallContext,
  ): Promise<string> {
    const { event_id, new_name, new_phone, pending_field, confirm_phone } = args || {}
    if (!event_id || typeof event_id !== 'string') {
      return JSON.stringify({ success: false, error: 'event_id is required' })
    }
    const hasName = typeof new_name === 'string' && new_name.trim().length > 0
    const hasPhone = typeof new_phone === 'string' && new_phone.trim().length > 0
    const notesChange = notesChangeOf(args)
    if (notesChange === 'mixed') return JSON.stringify(NOTES_ONE_FIELD_REFUSAL)
    if (notesChange) return await this.updateEventNotes(accessToken, event_id, notesChange, callContext)
    const askField: 'name' | 'phone' | null =
      pending_field === 'name' || pending_field === 'phone' ? pending_field : null
    if (askField && !hasName && !hasPhone) {
      if (askField === 'phone' && callContext?.callChannel === 'pstn') {
        return JSON.stringify({
          success: false,
          error: 'phone_update_blocked_on_pstn',
          refusal_message: 'The caller phone is auto-recorded from the call source on PSTN — no manual update is possible.',
        })
      }
      let currentValue: string | undefined
      try {
        const getUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(event_id)}`
        const getResp = await fetch(getUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
        if (getResp.ok) {
          const evData = await getResp.json()
          const ownership = this.assertEventOwnership(evData, callContext)
          if (ownership === 'ownership_mismatch') {
            return JSON.stringify({ success: false, error: 'ownership_mismatch' })
          }
          if (ownership === 'verification_required') {
            return this.buildVerificationRequiredResponse('reschedule')
          }
          const parsed = contactFromEvent(evData)
          currentValue = askField === 'name' ? parsed.name : parsed.phone
        }
      } catch {
      }
      return JSON.stringify({
        success: true,
        event_id,
        ask_for_value: true,
        instruction: currentValue
          ? `Tell the caller their current ${askField} on file is "${currentValue}", then ask them to say the new ${askField}. Speak this now.`
          : `Ask the caller to say the new ${askField}. Speak this now.`,
        voice_fastpath: {
          ask_for_value: true,
          field: askField,
          ...(currentValue ? { current_value: currentValue } : {}),
          calendar_timezone: this.timezone,
        },
      })
    }
    if (!hasName && !hasPhone) {
      return JSON.stringify({ success: false, error: 'no_fields_to_update' })
    }
    if (hasName && hasPhone) {
      return JSON.stringify({
        success: false,
        error: 'one_field_at_a_time',
        refusal_message: 'Update name and phone in separate caller turns — process the first field, confirm, then ask about the second.',
      })
    }
    if (hasPhone && callContext?.callChannel === 'pstn') {
      return JSON.stringify({
        success: false,
        error: 'phone_update_blocked_on_pstn',
        refusal_message: 'The caller phone is auto-recorded from the call source on PSTN — no manual update is possible. Only the name can be updated on PSTN calls.',
      })
    }

    // 1) Fetch current event
    const getUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(event_id)}`
    const getResp = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!getResp.ok) {
      const data = await getResp.json().catch(() => ({}))
      return JSON.stringify({
        success: false,
        error: data.error?.message || `events.get failed (status ${getResp.status})`,
      })
    }
    const eventData = await getResp.json()

    const ownership = this.assertEventOwnership(eventData, callContext)
    if (ownership === 'ownership_mismatch') {
      return JSON.stringify({ success: false, error: 'ownership_mismatch' })
    }
    if (ownership === 'verification_required') {
      return this.buildVerificationRequiredResponse('reschedule')
    }
    callContext?.sameCallOwnedEventIds?.add(event_id)

    const field: 'name' | 'phone' = hasName ? 'name' : 'phone'
    const newValue = (hasName ? new_name : new_phone).trim()

    if (hasPhone) {
      const digits = newValue.replace(/\D/g, '')
      if (digits.length < 7) {
        return JSON.stringify({
          success: false,
          error: 'phone_incomplete',
          refusal_message: 'That phone number looks incomplete. Ask the caller to say their FULL phone number again — all digits in one turn — then read it back to confirm before saving.',
        })
      }
      const normalizedPhone = normalizePhoneForStorage(newValue)
      const confirmed =
        confirm_phone === true &&
        callContext?.pendingPhoneUpdate?.eventId === event_id &&
        callContext?.pendingPhoneUpdate?.phone === normalizedPhone
      if (!confirmed) {
        if (callContext) callContext.pendingPhoneUpdate = { eventId: event_id, phone: normalizedPhone }
        return JSON.stringify({
          success: true,
          event_id,
          confirm_required: true,
          instruction: `Read the phone number "${normalizedPhone}" back to the caller digit by digit and ask them to confirm it is correct. Do NOT say it has been saved. ONLY after the caller confirms, call update_event_contact again with new_phone="${normalizedPhone}" and confirm_phone=true. Speak the read-back now.`,
          voice_fastpath: {
            confirm_phone: normalizedPhone,
            calendar_timezone: this.timezone,
          },
        })
      }
      if (callContext) callContext.pendingPhoneUpdate = undefined
    }

    // 4) Patch description
    const currentDescription: string = eventData?.description || ''
    const newDescription = replaceContactInDescription(currentDescription, field, newValue)
    const newSummary =
      field === 'name'
        ? replaceNameInTitle(eventData?.summary, contactFromEvent(eventData).name, newValue)
        : null
    if (newDescription === currentDescription && !newSummary) {
      return JSON.stringify({
        success: true,
        event_id,
        unchanged: true,
        voice_fastpath: {
          unchanged: true,
          updated_field: field,
          current_value: newValue,
          calendar_timezone: this.timezone,
        },
      })
    }

    // 4) PATCH
    const patchUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(event_id)}`
    const patchResp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: newDescription,
        ...(newSummary ? { summary: newSummary } : {}),
      }),
    })
    if (!patchResp.ok) {
      const data = await patchResp.json().catch(() => ({}))
      return JSON.stringify({
        success: false,
        error: data.error?.message || `events.patch failed (status ${patchResp.status})`,
      })
    }

    return JSON.stringify({
      success: true,
      event_id,
      voice_fastpath: {
        updated_field: field,
        ...(field === 'name' ? { name: newValue } : { phone: newValue }),
        calendar_timezone: this.timezone,
      },
    })
  }

  private async updateEventNotes(
    accessToken: string,
    eventId: string,
    change: NotesChange,
    callContext?: ToolCallContext,
  ): Promise<string> {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(eventId)}`
    const getResp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!getResp.ok) {
      return JSON.stringify({ success: false, error: `events.get failed (status ${getResp.status})` })
    }
    const eventData = await getResp.json()
    const ownership = this.assertEventOwnership(eventData, callContext)
    if (ownership === 'ownership_mismatch') {
      return JSON.stringify({ success: false, error: 'ownership_mismatch' })
    }
    if (ownership === 'verification_required') {
      return this.buildVerificationRequiredResponse('reschedule')
    }
    const current = notesFromEvent(eventData)
    if (change.kind === 'ask') return JSON.stringify(notesAskResult(eventId, current))

    callContext?.sameCallOwnedEventIds?.add(eventId)
    if (change.kind === 'clear' && !current) return JSON.stringify(notesClearedResult(eventId, false))
    const next = change.kind === 'clear' ? '' : notesToSave(change, current)
    if (next === null) return JSON.stringify(notesUnchangedResult(eventId, current ?? '', change.kind === 'add' ? change.value : undefined))

    const description = change.kind === 'clear'
      ? removeNotesFromDescription(eventData?.description)
      : replaceNotesInDescription(eventData?.description, next)
    const patchResp = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    })
    if (!patchResp.ok) {
      return JSON.stringify({ success: false, error: `events.patch failed (status ${patchResp.status})` })
    }
    if (change.kind === 'clear') return JSON.stringify(notesClearedResult(eventId, true))
    return JSON.stringify(change.kind === 'add' ? notesAddedResult(eventId, current, next) : notesUpdatedResult(eventId, change.value))
  }
}
