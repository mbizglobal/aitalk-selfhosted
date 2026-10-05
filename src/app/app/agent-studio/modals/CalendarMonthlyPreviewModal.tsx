'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Calendar, X, GripHorizontal, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useDraggable } from '../hooks/useDraggable'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import {
  computeDayStatus,
  type ClosedDaySettings,
  type DayStatus,
} from '@/lib/holidays/closed-day-status'
import { MonthGrid } from './calendar-preview/MonthGrid'
import { MonthNav } from './calendar-preview/MonthNav'
import { LegendBar } from './calendar-preview/LegendBar'
import { todayInTimezone } from './calendar-preview/MonthGridUtil'

const DEFAULT_TIMEZONE = 'Europe/Zurich'

interface PreviewEvent {
  id: string
  time: string
  duration: number
  name: string
  phone: string
  notes?: string
  htmlLink: string
}

export function CalendarMonthlyPreviewModal() {
  const { ui, workflow, agent } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const targetNodeId = ui.calendarMonthlyPreviewNodeId || workflow.selectedNode || ''
  const targetNode = useMemo(
    () => workflow.nodes.find((n) => n.id === targetNodeId),
    [workflow.nodes, targetNodeId]
  )

  const timezone: string = targetNode?.data?.googleCalendarTimezone || DEFAULT_TIMEZONE
  const todayYmd = useMemo(() => todayInTimezone(timezone), [timezone])

  const [year, setYear] = useState<number>(() => Number(todayYmd.slice(0, 4)))
  const [month, setMonth] = useState<number>(() => Number(todayYmd.slice(5, 7)))
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null)

  useEffect(() => {
    if (!ui.showCalendarMonthlyPreviewModal) return
    setYear(Number(todayYmd.slice(0, 4)))
    setMonth(Number(todayYmd.slice(5, 7)))
    setSelectedYmd(todayYmd)
  }, [ui.showCalendarMonthlyPreviewModal, todayYmd])

  const settings: ClosedDaySettings = useMemo(
    () => ({
      weeklyClosedDays: targetNode?.data?.weeklyClosedDays,
      holidays: targetNode?.data?.holidays,
      closedRanges: targetNode?.data?.closedRanges,
    }),
    [targetNode?.data]
  )

  const getDayStatus = (ymd: string): DayStatus => computeDayStatus(ymd, settings)

  const workflowId = agent?.workflowId || ''
  const [eventsByDate, setEventsByDate] = useState<Record<string, PreviewEvent[]> | null>(null)
  const [eventsState, setEventsState] = useState<'idle' | 'loading' | 'error'>('idle')
  useEffect(() => {
    if (!ui.showCalendarMonthlyPreviewModal || !targetNodeId) return
    if (!workflowId) {
      setEventsByDate(null)
      setEventsState('error')
      return
    }
    let cancelled = false
    setEventsState('loading')
    const url = new URL('/api/dashboard/calendar/events-month', window.location.origin)
    url.searchParams.set('workflowId', workflowId)
    url.searchParams.set('nodeId', targetNodeId)
    url.searchParams.set('year', String(year))
    url.searchParams.set('month', String(month))
    fetch(url.toString())
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data?.success && data.eventsByDate && typeof data.eventsByDate === 'object') {
          setEventsByDate(data.eventsByDate)
          setEventsState('idle')
        } else {
          setEventsByDate(null)
          setEventsState('error')
        }
      })
      .catch(() => {
        if (cancelled) return
        setEventsByDate(null)
        setEventsState('error')
      })
    return () => { cancelled = true }
  }, [ui.showCalendarMonthlyPreviewModal, workflowId, targetNodeId, year, month])

  const eventsCountMap = useMemo(() => {
    const out: Record<string, { count: number }> = {}
    for (const [date, list] of Object.entries(eventsByDate || {})) {
      if (Array.isArray(list) && list.length > 0) out[date] = { count: list.length }
    }
    return out
  }, [eventsByDate])

  const { handleDragStart, dragStyle } = useDraggable({
    isOpen: ui.showCalendarMonthlyPreviewModal,
  })

  if (!ui.showCalendarMonthlyPreviewModal) return null
  if (!targetNode) return null

  const close = () => {
    ui.setShowCalendarMonthlyPreviewModal(false)
    ui.setCalendarMonthlyPreviewNodeId(null)
  }

  const calendarLabel = String(targetNode.data?.label || 'Calendar')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="w-[900px] max-w-[95vw] max-h-[90vh] bg-[#1F1F1F] rounded-lg shadow-xl overflow-hidden flex flex-col"
        style={dragStyle}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-[#3A3A3A] bg-[#252525] cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-400" />
            <Calendar className="w-5 h-5 text-teal-400" />
            <div>
              <h2 className="text-sm font-semibold text-gray-100">
                {t.cal_preview_modal_title || 'Configuration Preview'} — {calendarLabel}
              </h2>
              <p className="text-[11px] text-gray-500">
                {t.cal_preview_modal_subtitle ||
                  'Visualizes weekly closed days, holidays, and vacation ranges. No live event data.'}
              </p>
            </div>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded hover:bg-[#3A3A3A] text-gray-300"
            aria-label={t.cal_preview_close_modal || 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left — Calendar grid */}
          <div className="flex-1 p-4 overflow-y-auto scrollbar-thin">
            <MonthNav
              year={year}
              month={month}
              onChange={(y, m) => {
                setYear(y)
                setMonth(m)
              }}
              onToday={() => {
                setYear(Number(todayYmd.slice(0, 4)))
                setMonth(Number(todayYmd.slice(5, 7)))
                setSelectedYmd(todayYmd)
              }}
              todayLabel={t.cal_preview_today || 'Today'}
            />
            <MonthGrid
              year={year}
              month={month}
              todayYmd={todayYmd}
              selectedYmd={selectedYmd}
              getDayStatus={getDayStatus}
              onDayClick={setSelectedYmd}
              eventsByDate={eventsCountMap}
              weekdayHeaders={[
                t.cal_preview_wd_sun || 'Sun',
                t.cal_preview_wd_mon || 'Mon',
                t.cal_preview_wd_tue || 'Tue',
                t.cal_preview_wd_wed || 'Wed',
                t.cal_preview_wd_thu || 'Thu',
                t.cal_preview_wd_fri || 'Fri',
                t.cal_preview_wd_sat || 'Sat',
              ]}
            />
            <LegendBar
              showBookedBadge
              labels={{
                booked: t.cal_preview_legend_booked || 'Booked',
                closed: t.cal_preview_legend_closed || 'Closed (AI declines politely)',
                holiday: t.cal_preview_legend_holiday || 'Holiday (AI declines)',
                range: t.cal_preview_legend_range || 'Vacation (AI declines)',
                partial: t.cal_preview_legend_partial || 'Partial open',
              }}
            />
            <div className="mt-3 px-1 text-[11px] text-gray-500">
              <span>
                {(t.cal_preview_timezone_note || 'Timezone: {tz}').replace('{tz}', timezone)}
              </span>
            </div>
          </div>

          {/* Right — Day detail drawer */}
          <div className="w-[300px] border-l border-[#3A3A3A] bg-[#1a1a1a] p-4 overflow-y-auto scrollbar-thin">
            {selectedYmd ? (
              <div className="space-y-4">
                <DayConfigDetail
                  ymd={selectedYmd}
                  status={getDayStatus(selectedYmd)}
                  t={t}
                />
                <DayBookings
                  events={eventsByDate?.[selectedYmd] || []}
                  state={eventsState}
                  calendarType={targetNode.data?.toolType === 'microsoft_calendar' ? 'microsoft' : 'google'}
                  t={t}
                />
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                {t.cal_preview_select_day_hint || 'Click a day to see how the AI will respond.'}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 py-3 border-t border-[#3A3A3A] bg-[#252525]">
          <Button variant="outline" onClick={close} className="border-[#3A3A3A] bg-[#1F1F1F] text-gray-200 hover:bg-[#2A2A2A]">
            {t.cal_adv_close || 'Close'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function DayBookings({
  events,
  state,
  calendarType,
  t,
}: {
  events: PreviewEvent[]
  state: 'idle' | 'loading' | 'error'
  calendarType: 'google' | 'microsoft'
  t: any
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-gray-300 mb-1.5">
        🔵 {t.cal_preview_bookings_title || 'Bookings'}
      </div>
      {state === 'loading' ? (
        <p className="text-[11px] text-gray-500">{t.cal_preview_bookings_loading || 'Loading bookings…'}</p>
      ) : state === 'error' ? (
        <p className="text-[11px] text-gray-500">
          {t.cal_preview_bookings_unavailable || 'Bookings could not be loaded. Save the workflow and check the calendar connection.'}
        </p>
      ) : events.length === 0 ? (
        <p className="text-[11px] text-gray-500">{t.cal_preview_no_bookings || 'No bookings on this day.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((ev) => (
            <li
              key={ev.id || `${ev.time}-${ev.name}`}
              className="flex items-start justify-between gap-2 p-2 rounded border border-[#3A3A3A] bg-[#1F1F1F] text-[11px]"
            >
              <div className="min-w-0">
                <div className="font-medium text-gray-100">{ev.time}</div>
                <div className="text-gray-400 truncate">
                  {ev.name || '—'}
                  {ev.phone ? ` · ${ev.phone}` : ''}
                  {ev.duration ? ` · ${ev.duration}m` : ''}
                </div>
                {ev.notes && (
                  <div className="text-gray-400 line-clamp-2 break-words" title={ev.notes}>
                    💬 {ev.notes}
                  </div>
                )}
              </div>
              {ev.htmlLink && (
                <a
                  href={ev.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-teal-400 hover:underline whitespace-nowrap"
                >
                  <ExternalLink className="w-3 h-3" />
                  {calendarType === 'microsoft' ? 'Outlook' : 'Google Cal'}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface DayConfigDetailProps {
  ymd: string
  status: DayStatus
  t: any
}

function DayConfigDetail({ ymd, status, t }: DayConfigDetailProps) {
  const dateLabel = formatDateLabel(ymd)
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-100">{dateLabel}</div>
        <div className="text-[11px] text-gray-500">{ymd}</div>
      </div>

      <StatusBlock status={status} t={t} />

      {status.kind !== 'open' && status.kind !== 'partial' && (
        <RefusalPreview status={status} t={t} />
      )}
    </div>
  )
}

function StatusBlock({ status, t }: { status: DayStatus; t: any }) {
  switch (status.kind) {
    case 'open':
      return (
        <div className="p-3 rounded border border-[#3A3A3A] bg-[#1F1F1F]">
          <div className="text-xs font-medium text-gray-200 mb-1">🟢 {t.cal_preview_legend_open || 'Open'}</div>
          <p className="text-[11px] text-gray-400">
            {t.cal_preview_day_status_open ||
              'Open all day. Bookings accepted within working hours.'}
          </p>
        </div>
      )
    case 'partial':
      return (
        <div className="p-3 rounded border border-yellow-500/40 bg-yellow-500/10">
          <div className="text-xs font-medium text-yellow-200 mb-1">🟡 {t.cal_preview_legend_partial || 'Partial open'}</div>
          <p className="text-[11px] text-yellow-100/90">
            {(t.cal_preview_day_status_partial || 'Partial open: {start} – {end}.')
              .replace('{start}', status.openStart)
              .replace('{end}', status.openEnd)}
          </p>
        </div>
      )
    case 'holiday':
      return (
        <div className="p-3 rounded border border-red-500/40 bg-red-500/10">
          <div className="text-xs font-medium text-red-200 mb-1">🎉 {status.name}</div>
          <p className="text-[11px] text-red-100/90">
            {(t.cal_preview_day_status_holiday || 'Holiday: {name}. AI will refuse bookings.').replace('{name}', status.name)}
          </p>
        </div>
      )
    case 'range':
      return (
        <div className="p-3 rounded border border-purple-500/40 bg-purple-500/10">
          <div className="text-xs font-medium text-purple-200 mb-1">✈️ {status.name}</div>
          <p className="text-[11px] text-purple-100/90">
            {(t.cal_preview_day_status_range ||
              'Vacation: {name} ({start} – {end}). AI will refuse bookings.')
              .replace('{name}', status.name)
              .replace('{start}', status.startDate)
              .replace('{end}', status.endDate)}
          </p>
        </div>
      )
    case 'weekly':
      return (
        <div className="p-3 rounded border border-gray-500/40 bg-gray-500/10">
          <div className="text-xs font-medium text-gray-300 mb-1">🚫 {capitalize(status.weekday)}</div>
          <p className="text-[11px] text-gray-400">
            {(t.cal_preview_day_status_weekly ||
              'Closed on {weekday}. AI will refuse bookings.')
              .replace('{weekday}', capitalize(status.weekday))}
          </p>
        </div>
      )
  }
}

function RefusalPreview({ status, t }: { status: Exclude<DayStatus, { kind: 'open' } | { kind: 'partial' }>; t: any }) {
  const message = customMessage(status) || defaultRefusal(status, t)
  return (
    <div className="p-3 rounded border border-[#3A3A3A] bg-[#252525]">
      <div className="text-[11px] font-medium text-gray-300 mb-1.5">
        {t.cal_preview_refusal_preview_label || 'AI refusal message preview:'}
      </div>
      <p className="text-[11px] text-gray-400 whitespace-pre-wrap leading-relaxed">{message}</p>
    </div>
  )
}

function customMessage(
  status: Exclude<DayStatus, { kind: 'open' } | { kind: 'partial' }>,
): string | null {
  if ('message' in status && status.message && status.message.trim()) return status.message.trim()
  return null
}

function defaultRefusal(
  status: Exclude<DayStatus, { kind: 'open' } | { kind: 'partial' }>,
  t: any,
): string {
  const fmt = (template: string, vars: Record<string, string>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template)
  switch (status.kind) {
    case 'holiday':
      return fmt(
        t.cal_preview_default_refusal_holiday ||
          'We are closed on {name} ({date}). Bookings cannot be accepted.',
        { name: status.name, date: status.date },
      )
    case 'range':
      return fmt(
        t.cal_preview_default_refusal_range ||
          'We are on vacation: {name} (until {endDate}). Bookings cannot be accepted during this period.',
        { name: status.name, endDate: status.endDate },
      )
    case 'weekly':
      return fmt(
        t.cal_preview_default_refusal_weekly ||
          'We are closed on {weekday}s. Bookings cannot be accepted on this day.',
        { weekday: capitalize(status.weekday) },
      )
  }
}

function formatDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const d = new Date(`${ymd}T12:00:00Z`)
  if (!Number.isFinite(d.getTime())) return ymd
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const monthName = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${wd}, ${monthName} ${Number(m[3])}, ${m[1]}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
