'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { X, GripHorizontal, Radio, MessagesSquare, Fingerprint, CalendarClock, History, Ban, RotateCcw, Info, RefreshCw, Coffee, CalendarOff, PartyPopper, Plane, Bell, Users, CalendarCheck, AlarmClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useDraggable } from '../hooks/useDraggable'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { ChannelsSection } from './calendar-sections/ChannelsSection'
import { CallerQuestionsSection } from './calendar-sections/CallerQuestionsSection'
import { MobilePushSection } from './calendar-sections/MobilePushSection'
import { VisitorIdentitySection } from './calendar-sections/VisitorIdentitySection'
import { BookingWindowSection } from './calendar-sections/BookingWindowSection'
import { HistoryLookupSection } from './calendar-sections/HistoryLookupSection'
import { CancellationPolicySection } from './calendar-sections/CancellationPolicySection'
import { ReschedulePolicySection } from './calendar-sections/ReschedulePolicySection'
import { BreakTimesSection } from './calendar-sections/BreakTimesSection'
import { WeeklyClosedDaysSection } from './calendar-sections/WeeklyClosedDaysSection'
import { HolidaysSection } from './calendar-sections/HolidaysSection'
import { ClosedRangesSection } from './calendar-sections/ClosedRangesSection'
import { CapacitySection } from './calendar-sections/CapacitySection'
import { BookingWidgetSection, BOOKING_WIDGET_DEFAULTS } from './calendar-sections/BookingWidgetSection'
import { LastCallSection } from './calendar-sections/LastCallSection'

export interface CalendarAdvancedSettings {
  enabledChannels?: {
    pstn: boolean
    webVoice: boolean
    chatWidget: boolean
    test: boolean
    bookingWidget?: boolean
  }
  bookingWidget?: {
    title: string
    defaultLang?: '' | 'en' | 'de' | 'fr' | 'ko'
    address?: string
    email?: string
    emailConfirm: boolean
    confirmTtlMin: 15 | 30 | 60
    onlineMaxParty?: number
    hourlyLimit: number
  }
  bookingQuestions?: string
  askBookingMessage?: boolean
  bookingMessagePrompt?: string
  notifyOnBook?: boolean
  notifyOnReschedule?: boolean
  notifyOnCancel?: boolean
  storeVisitorIdentity?: boolean  // Web Voice localStorage UUID
  bookingWindowDays?: number
  historyLookupDays?: number
  reschedulePolicy?: {
    enabled: boolean
    cutoffHours: number           // 1/6/12/24/48/72/96/120
    refuseMessage: string
  }
  cancellationPolicy?: {
    enabled: boolean
    cutoffHours: number           // 1/6/12/24/48/72/96/120
    refuseMessage: string
    offerTransfer: boolean
    transferMessage: string
  }
  breakTimes?: Array<{
    start: string
    end: string
    message: string
  }>
  lastCallMin?: number
  lastCallBreakMin?: number
  weeklyClosedDays?: Partial<Record<
    'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
    {
      closed: boolean
      partialOpenStart?: string
      partialOpenEnd?: string
      message?: string
    }
  >>
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
  capacityMode?: 'single' | 'simple' | 'tables'
  simpleCapacity?: number
  tableInventory?: Array<{
    id: string
    name: string
    capacity: number
    count: number
  }>
  mealDurationMin?: number
  reservationGridMin?: number
  tableMatchPolicy?: 'smallest_fit' | 'exact_only'
  defaultDurationMin?: number
  cleanupMin?: number
}

type SectionKey = 'channels' | 'bookingWidget' | 'callerQuestions' | 'mobilePush' | 'visitorIdentity' | 'bookingWindow' | 'historyLookup' | 'reschedulePolicy' | 'cancellationPolicy' | 'breakTimes' | 'lastCall' | 'weeklyClosedDays' | 'holidays' | 'closedRanges' | 'capacity'

const SECTION_T_KEYS: Record<SectionKey, string> = {
  channels: 'cal_adv_channels',
  bookingWidget: 'cal_adv_bw_title',
  callerQuestions: 'cal_adv_caller_questions',
  mobilePush: 'cal_adv_push_title',
  visitorIdentity: 'cal_adv_visitor_identity',
  bookingWindow: 'cal_adv_booking_window',
  historyLookup: 'cal_adv_history_lookup',
  reschedulePolicy: 'cal_adv_reschedule_title',
  cancellationPolicy: 'cal_adv_cancel_title',
  breakTimes: 'cal_adv_break_title',
  lastCall: 'cal_adv_lastcall_title',
  weeklyClosedDays: 'cal_adv_weekly_closed_title',
  holidays: 'cal_adv_holidays_title',
  closedRanges: 'cal_adv_closed_ranges_title',
  capacity: 'cal_adv_capacity_title',
}

const SECTION_LIST: Array<{ key: SectionKey; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'channels', icon: Radio },
  { key: 'bookingWidget', icon: CalendarCheck },
  { key: 'callerQuestions', icon: MessagesSquare },
  { key: 'visitorIdentity', icon: Fingerprint },
  { key: 'bookingWindow', icon: CalendarClock },
  { key: 'historyLookup', icon: History },
  { key: 'reschedulePolicy', icon: RefreshCw },
  { key: 'cancellationPolicy', icon: Ban },
  { key: 'capacity', icon: Users },
  { key: 'breakTimes', icon: Coffee },
  { key: 'lastCall', icon: AlarmClock },
  { key: 'weeklyClosedDays', icon: CalendarOff },
  { key: 'holidays', icon: PartyPopper },
  { key: 'closedRanges', icon: Plane },
  { key: 'mobilePush', icon: Bell },
]

function asNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return NaN
}
function positiveOr(v: unknown, fallback: number): number | undefined {
  if (v === undefined) return undefined
  const n = asNumber(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
function nonNegativeOr(v: unknown, fallback: number): number | undefined {
  if (v === undefined) return undefined
  const n = asNumber(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const SECTION_DEFAULTS: Record<SectionKey, Partial<CalendarAdvancedSettings>> = {
  channels: {
    enabledChannels: { pstn: true, webVoice: true, chatWidget: true, test: true, bookingWidget: false },
  },
  bookingWidget: {
    bookingWidget: { ...BOOKING_WIDGET_DEFAULTS },
  },
  callerQuestions: {
    bookingQuestions: '',
    askBookingMessage: false,
    bookingMessagePrompt: '',
  },
  mobilePush: {
    notifyOnBook: false,
    notifyOnReschedule: false,
    notifyOnCancel: false,
  },
  visitorIdentity: {
    storeVisitorIdentity: false,
  },
  bookingWindow: {
    bookingWindowDays: 90,
  },
  historyLookup: {
    historyLookupDays: 90,
  },
  reschedulePolicy: {
    reschedulePolicy: {
      enabled: false,
      cutoffHours: 24,
      refuseMessage: '',
    },
  },
  cancellationPolicy: {
    cancellationPolicy: {
      enabled: false,
      cutoffHours: 24,
      refuseMessage: '',
      offerTransfer: false,
      transferMessage: '',
    },
  },
  breakTimes: {
    breakTimes: [],
  },
  lastCall: {
    lastCallMin: 0,
    lastCallBreakMin: 0,
  },
  weeklyClosedDays: {
    weeklyClosedDays: {
      saturday: { closed: true },
      sunday: { closed: true },
    },
  },
  holidays: {
    holidays: [],
  },
  closedRanges: {
    closedRanges: [],
  },
  capacity: {
    capacityMode: 'single',
    simpleCapacity: 1,
    tableInventory: [],
    mealDurationMin: 90,
    reservationGridMin: 15,
    tableMatchPolicy: 'smallest_fit',
  },
}

const MAX_BREAK_TIMES = 5
const MAX_HOLIDAYS = 80
const MAX_CLOSED_RANGES = 20

export function CalendarAdvancedSettingsModal() {
  const { ui, workflow, nodeHandlers, agent } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const targetNodeId = ui.calendarAdvancedModalNodeId || workflow.selectedNode || ''
  const targetNode = useMemo(
    () => workflow.nodes.find((n) => n.id === targetNodeId),
    [workflow.nodes, targetNodeId]
  )

  const pstnStaffTransferNumber = useMemo(() => {
    const pstnStart = workflow.nodes.find(
      (n) => n.data?.nodeType === 'start' && n.data?.triggerType === 'pstn'
    )
    const v = pstnStart?.data?.staffTransferNumber
    return typeof v === 'string' ? v.trim() : ''
  }, [workflow.nodes])

  const otherCalendarHasWidget = useMemo(
    () =>
      workflow.nodes.some(
        (n) =>
          n.id !== targetNodeId &&
          (n.data?.toolType === 'google_calendar' || n.data?.toolType === 'microsoft_calendar') &&
          n.data?.enabledChannels?.bookingWidget === true
      ),
    [workflow.nodes, targetNodeId]
  )

  const [activeSection, setActiveSection] = useState<SectionKey>('channels')
  const [draft, setDraft] = useState<CalendarAdvancedSettings>({})

  const buildDefaultBreaks = (): NonNullable<CalendarAdvancedSettings['breakTimes']> => [
    {
      start: '12:00',
      end: '13:00',
      message: t.cal_adv_break_default_lunch || 'Closed for lunch — bookings are not accepted.',
    },
  ]

  const buildDefaultWeeklyClosedDays = (): NonNullable<CalendarAdvancedSettings['weeklyClosedDays']> => ({
    saturday: { closed: true },
    sunday: { closed: true },
  })

  useEffect(() => {
    if (!ui.showCalendarAdvancedModal || !targetNode) return
    const data = targetNode.data || {}
    setDraft({
      enabledChannels: data.enabledChannels,
      bookingWidget: data.bookingWidget && typeof data.bookingWidget === 'object' ? data.bookingWidget : undefined,
      bookingQuestions: data.bookingQuestions,
      askBookingMessage: typeof data.askBookingMessage === 'boolean' ? data.askBookingMessage : undefined,
      bookingMessagePrompt: typeof data.bookingMessagePrompt === 'string' ? data.bookingMessagePrompt : undefined,
      notifyOnBook: data.notifyOnBook,
      notifyOnReschedule: data.notifyOnReschedule,
      notifyOnCancel: data.notifyOnCancel,
      storeVisitorIdentity: data.storeVisitorIdentity,
      bookingWindowDays: data.bookingWindowDays,
      historyLookupDays: data.historyLookupDays,
      reschedulePolicy: data.reschedulePolicy,
      cancellationPolicy: data.cancellationPolicy,
      breakTimes: data.breakTimes ?? buildDefaultBreaks(),
      lastCallMin: typeof data.lastCallMin === 'number' ? data.lastCallMin : undefined,
      lastCallBreakMin: typeof data.lastCallBreakMin === 'number' ? data.lastCallBreakMin : undefined,
      weeklyClosedDays: data.weeklyClosedDays ?? buildDefaultWeeklyClosedDays(),
      holidays: Array.isArray(data.holidays)
        ? (() => {
            const t = new Date()
            const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
            return data.holidays.filter(
              (h: any) => h?.origin === 'manual' || (typeof h?.date === 'string' && h.date >= todayStr)
            )
          })()
        : undefined,
      closedRanges: Array.isArray(data.closedRanges)
        ? (() => {
            const t = new Date()
            const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
            return data.closedRanges.filter(
              (r: any) => typeof r?.endDate === 'string' && r.endDate >= todayStr
            )
          })()
        : undefined,
      capacityMode: data.capacityMode,
      simpleCapacity: data.simpleCapacity,
      tableInventory: data.tableInventory,
      mealDurationMin: positiveOr(data.mealDurationMin ?? 0, positiveOr(data.defaultDurationMin, 90) ?? 90),
      reservationGridMin: positiveOr(data.reservationGridMin, 15),
      tableMatchPolicy: data.tableMatchPolicy === 'exact_only' ? 'smallest_fit' : data.tableMatchPolicy,
      defaultDurationMin: positiveOr(data.defaultDurationMin, 30),
      cleanupMin: nonNegativeOr(data.cleanupMin, 0),
    })
    setActiveSection('channels')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.showCalendarAdvancedModal, targetNode])

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showCalendarAdvancedModal })

  useEffect(() => {
    if (ui.showCalendarAdvancedModal && !targetNode) {
      ui.setShowCalendarAdvancedModal(false)
    }
  }, [ui.showCalendarAdvancedModal, targetNode, ui])

  if (!ui.showCalendarAdvancedModal) return null
  if (!targetNode) return null

  const updateDraft = (patch: Partial<CalendarAdvancedSettings>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const handleResetSection = (sectionKey: SectionKey) => {
    const label = t[SECTION_T_KEYS[sectionKey]] || sectionKey
    const confirmMsg = (t.cal_adv_reset_section_confirm || 'Reset "{section}" to default values?\n\nYour changes in this section will be lost (Save is not yet applied to DB).').replace('{section}', label)
    if (!window.confirm(confirmMsg)) return
    if (sectionKey === 'breakTimes') {
      setDraft((prev) => ({ ...prev, breakTimes: buildDefaultBreaks() }))
      return
    }
    setDraft((prev) => ({ ...prev, ...SECTION_DEFAULTS[sectionKey] }))
  }

  const handleResetAll = () => {
    if (!window.confirm(t.cal_adv_reset_all_confirm || 'Reset ALL Calendar Advanced Settings to defaults?\n\nSave is not applied until you click Save.')) return
    setDraft({
      ...SECTION_DEFAULTS.channels,
      ...SECTION_DEFAULTS.bookingWidget,
      ...SECTION_DEFAULTS.callerQuestions,
      ...SECTION_DEFAULTS.mobilePush,
      ...SECTION_DEFAULTS.visitorIdentity,
      ...SECTION_DEFAULTS.bookingWindow,
      ...SECTION_DEFAULTS.historyLookup,
      ...SECTION_DEFAULTS.reschedulePolicy,
      ...SECTION_DEFAULTS.cancellationPolicy,
      breakTimes: buildDefaultBreaks(),
      ...SECTION_DEFAULTS.lastCall,
      ...SECTION_DEFAULTS.weeklyClosedDays,
      ...SECTION_DEFAULTS.holidays,
      ...SECTION_DEFAULTS.closedRanges,
      ...SECTION_DEFAULTS.capacity,
      defaultDurationMin: 30,
      cleanupMin: 0,
    })
  }

  const handleSave = () => {
    const patch: Record<string, any> = {}
    if (draft.enabledChannels !== undefined) patch.enabledChannels = draft.enabledChannels
    if (draft.bookingWidget !== undefined) {
      const bw = draft.bookingWidget
      patch.bookingWidget = {
        title: String(bw.title ?? '').trim().slice(0, 80),
        defaultLang: bw.defaultLang === 'en' || bw.defaultLang === 'de' || bw.defaultLang === 'fr' || bw.defaultLang === 'ko' ? bw.defaultLang : '',
        address: String(bw.address ?? '').trim().slice(0, 160),
        email: String(bw.email ?? '').trim().slice(0, 120),
        emailConfirm: bw.emailConfirm === true,
        confirmTtlMin: bw.confirmTtlMin === 15 || bw.confirmTtlMin === 60 ? bw.confirmTtlMin : 30,
        onlineMaxParty: Number.isInteger(bw.onlineMaxParty) && (bw.onlineMaxParty as number) >= 1 ? Math.min(bw.onlineMaxParty as number, 100) : 0,
        hourlyLimit: Number.isInteger(bw.hourlyLimit) && bw.hourlyLimit >= 1 ? Math.min(bw.hourlyLimit, 200) : 20,
      }
    }
    if (draft.bookingQuestions !== undefined) patch.bookingQuestions = draft.bookingQuestions
    if (draft.askBookingMessage !== undefined) patch.askBookingMessage = draft.askBookingMessage
    const messagePrompt = (draft.bookingMessagePrompt ?? '').trim()
    if (draft.askBookingMessage && !messagePrompt) {
      patch.bookingMessagePrompt = t.cal_adv_msg_prompt_default || "Is there anything you'd like to tell us? If not, we'll skip it."
    } else if (draft.bookingMessagePrompt !== undefined) {
      patch.bookingMessagePrompt = messagePrompt
    }
    if (draft.notifyOnBook !== undefined) patch.notifyOnBook = draft.notifyOnBook
    if (draft.notifyOnReschedule !== undefined) patch.notifyOnReschedule = draft.notifyOnReschedule
    if (draft.notifyOnCancel !== undefined) patch.notifyOnCancel = draft.notifyOnCancel
    if (draft.storeVisitorIdentity !== undefined) patch.storeVisitorIdentity = draft.storeVisitorIdentity
    if (draft.bookingWindowDays !== undefined) patch.bookingWindowDays = draft.bookingWindowDays
    if (draft.historyLookupDays !== undefined) patch.historyLookupDays = draft.historyLookupDays
    if (draft.reschedulePolicy !== undefined) patch.reschedulePolicy = draft.reschedulePolicy
    if (draft.cancellationPolicy !== undefined) patch.cancellationPolicy = draft.cancellationPolicy
    if (draft.breakTimes !== undefined) patch.breakTimes = draft.breakTimes
    if (draft.lastCallMin !== undefined) patch.lastCallMin = [15, 30, 45, 60, 90].includes(draft.lastCallMin) ? draft.lastCallMin : 0
    if (draft.lastCallBreakMin !== undefined) {
      const hasBreak = (draft.breakTimes ?? []).length > 0
      patch.lastCallBreakMin = hasBreak && [15, 30, 45, 60, 90].includes(draft.lastCallBreakMin) ? draft.lastCallBreakMin : 0
    }
    if (draft.weeklyClosedDays !== undefined) patch.weeklyClosedDays = draft.weeklyClosedDays
    if (draft.holidays !== undefined) patch.holidays = draft.holidays
    if (draft.closedRanges !== undefined) patch.closedRanges = draft.closedRanges
    if (draft.capacityMode !== undefined) patch.capacityMode = draft.capacityMode
    if (draft.simpleCapacity !== undefined) patch.simpleCapacity = draft.simpleCapacity
    if (draft.tableInventory !== undefined) {
      const used = new Set(draft.tableInventory.map((tt) => tt.name.trim()).filter(Boolean))
      patch.tableInventory = draft.tableInventory.map((tt) => {
        if (tt.name.trim()) return { ...tt, name: tt.name.trim() }
        const base = (t.cal_adv_cap_table_n || '{n}-seat table').replace('{n}', String(tt.capacity))
        let name = base
        for (let k = 2; used.has(name); k++) name = `${base} ${k}`
        used.add(name)
        return { ...tt, name }
      })
    }
    if (draft.mealDurationMin !== undefined) patch.mealDurationMin = draft.mealDurationMin
    if (draft.reservationGridMin !== undefined) patch.reservationGridMin = draft.reservationGridMin
    if (draft.tableMatchPolicy !== undefined) patch.tableMatchPolicy = draft.tableMatchPolicy
    if (draft.defaultDurationMin !== undefined) patch.defaultDurationMin = draft.defaultDurationMin
    if (draft.cleanupMin !== undefined) patch.cleanupMin = draft.cleanupMin
    nodeHandlers.updateNodeData(targetNode.id, patch)
    ui.setShowCalendarAdvancedModal(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] w-full max-w-4xl max-h-[85vh] flex flex-col"
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="p-6 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-200">
                {t.cal_adv_title || 'Calendar Advanced Settings'}
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                {t.cal_adv_desc || 'Configure which channels can book, what to ask callers, and how to handle returning visitors.'}
              </p>
            </div>
          </div>
          <button
            onClick={() => ui.setShowCalendarAdvancedModal(false)}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          <nav className="w-56 border-r border-[#3A3A3A] bg-[#252525] py-3 flex-shrink-0 overflow-y-auto scrollbar-thin">
            {SECTION_LIST.map((s) => {
              const Icon = s.icon
              const active = activeSection === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left ${
                    active
                      ? 'bg-[#3A3A3A] text-gray-100 border-l-2 border-teal-400'
                      : 'text-gray-400 hover:bg-[#2F2F2F] hover:text-gray-200 border-l-2 border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{t[SECTION_T_KEYS[s.key]] || s.key}</span>
                </button>
              )
            })}
          </nav>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
            {activeSection === 'channels' && (
              <ChannelsSection draft={draft} update={updateDraft} onReset={() => handleResetSection('channels')} />
            )}
            {activeSection === 'bookingWidget' && (
              <BookingWidgetSection
                draft={draft}
                update={updateDraft}
                onReset={() => handleResetSection('bookingWidget')}
                agentId={agent?.agentId || ''}
                otherCalendarHasWidget={otherCalendarHasWidget}
              />
            )}
            {activeSection === 'callerQuestions' && (
              <CallerQuestionsSection draft={draft} update={updateDraft} onReset={() => handleResetSection('callerQuestions')} />
            )}
            {activeSection === 'mobilePush' && (
              <MobilePushSection draft={draft} update={updateDraft} onReset={() => handleResetSection('mobilePush')} />
            )}
            {activeSection === 'visitorIdentity' && (
              <VisitorIdentitySection draft={draft} update={updateDraft} onReset={() => handleResetSection('visitorIdentity')} />
            )}
            {activeSection === 'bookingWindow' && (
              <BookingWindowSection draft={draft} update={updateDraft} onReset={() => handleResetSection('bookingWindow')} />
            )}
            {activeSection === 'historyLookup' && (
              <HistoryLookupSection draft={draft} update={updateDraft} onReset={() => handleResetSection('historyLookup')} />
            )}
            {activeSection === 'reschedulePolicy' && (
              <ReschedulePolicySection
                draft={draft}
                update={updateDraft}
                onReset={() => handleResetSection('reschedulePolicy')}
              />
            )}
            {activeSection === 'cancellationPolicy' && (
              <CancellationPolicySection
                draft={draft}
                update={updateDraft}
                onReset={() => handleResetSection('cancellationPolicy')}
                staffTransferNumber={pstnStaffTransferNumber}
              />
            )}
            {activeSection === 'breakTimes' && (
              <BreakTimesSection
                draft={draft}
                update={updateDraft}
                onReset={() => handleResetSection('breakTimes')}
                max={MAX_BREAK_TIMES}
                defaultMessage={t.cal_adv_break_default_lunch || 'Closed for lunch — bookings are not accepted.'}
              />
            )}
            {activeSection === 'lastCall' && (
              <LastCallSection
                draft={draft}
                update={updateDraft}
                onReset={() => handleResetSection('lastCall')}
                workingHoursEnd={typeof targetNode.data?.workingHoursEnd === 'string' ? targetNode.data.workingHoursEnd : '18:00'}
              />
            )}
            {activeSection === 'weeklyClosedDays' && (
              <WeeklyClosedDaysSection
                draft={draft}
                update={updateDraft}
                onReset={() => handleResetSection('weeklyClosedDays')}
              />
            )}
            {activeSection === 'holidays' && (
              <HolidaysSection
                holidays={draft.holidays ?? []}
                onChange={(holidays) =>
                  updateDraft({ holidays: holidays.map((h) => ({ ...h, origin: h.origin ?? 'manual' })) })
                }
                onReset={() => handleResetSection('holidays')}
                maxHolidays={MAX_HOLIDAYS}
              />
            )}
            {activeSection === 'closedRanges' && (
              <ClosedRangesSection
                draft={draft}
                update={updateDraft}
                onReset={() => handleResetSection('closedRanges')}
                maxClosedRanges={MAX_CLOSED_RANGES}
              />
            )}
            {activeSection === 'capacity' && (
              <CapacitySection
                draft={draft}
                update={updateDraft}
                onReset={() => handleResetSection('capacity')}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#3A3A3A]">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleResetAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-amber-300 transition-colors"
              title="Reset all sections to default values"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.cal_adv_reset_all || 'Reset All'}
            </button>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 hidden md:inline-flex items-center gap-1">
                <Info className="w-3 h-3" />
                {t.cal_adv_save_hint || 'Persists after you save the workflow'}
              </span>
              <Button
                variant="ghost"
                onClick={() => ui.setShowCalendarAdvancedModal(false)}
                className="text-gray-300"
              >
                {t.cancel || 'Cancel'}
              </Button>
              <Button onClick={handleSave} className="bg-teal-600 hover:bg-teal-500 text-white">
                {t.pstn_save || 'Save'}
              </Button>
            </div>
          </div>

          <p className="px-4 pb-3 text-xs text-gray-500 flex items-center justify-end gap-1 md:hidden">
            <Info className="w-3 h-3" />
            {t.cal_adv_save_hint || 'Persists after you save the workflow'}
          </p>
        </div>
      </div>
    </div>
  )
}
