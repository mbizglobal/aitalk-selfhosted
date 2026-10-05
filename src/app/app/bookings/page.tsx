'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, Loader2, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { Button } from '@/components/ui/button'
import { computeDayStatus, type ClosedDaySettings, type DayStatus } from '@/lib/holidays/closed-day-status'
import { MonthGrid } from '../agent-studio/modals/calendar-preview/MonthGrid'
import { MonthNav } from '../agent-studio/modals/calendar-preview/MonthNav'
import { LegendBar } from '../agent-studio/modals/calendar-preview/LegendBar'
import { todayInTimezone } from '../agent-studio/modals/calendar-preview/MonthGridUtil'

interface CalendarNode {
  nodeId: string
  nodeName: string
  type: 'google' | 'microsoft'
  connectionId: string
  calendarId: string
  timezone: string
  weeklyClosedDays?: any
  holidays?: any[]
  closedRanges?: any[]
}

interface CalendarWorkflow {
  workflowId: string
  workflowName: string
  agentId: string
  agentTitle: string
  calendarNodes: CalendarNode[]
}

interface EventOut {
  id: string
  time: string
  duration: number
  name: string
  phone: string
  notes?: string
  htmlLink: string
}

interface EventsMonthResponse {
  success: boolean
  timezone?: string
  year?: number
  month?: number
  settings?: ClosedDaySettings
  eventsByDate?: Record<string, EventOut[]>
  truncated?: boolean
  cached?: boolean
  error?: string
}

export default function BookingsPage() {
  const { t } = useLanguage()

  const [workflows, setWorkflows] = useState<CalendarWorkflow[]>([])
  const [loadingWorkflows, setLoadingWorkflows] = useState(true)
  const [selected, setSelected] = useState<{ workflowId: string; nodeId: string } | null>(null)

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.workflowId === selected?.workflowId),
    [workflows, selected?.workflowId]
  )
  const selectedNode = useMemo(
    () => selectedWorkflow?.calendarNodes.find((n) => n.nodeId === selected?.nodeId),
    [selectedWorkflow, selected?.nodeId]
  )

  const timezone = selectedNode?.timezone || 'Europe/Zurich'
  const todayYmd = useMemo(() => todayInTimezone(timezone), [timezone])
  const [year, setYear] = useState<number>(() => Number(todayYmd.slice(0, 4)))
  const [month, setMonth] = useState<number>(() => Number(todayYmd.slice(5, 7)))
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null)

  const [eventsData, setEventsData] = useState<EventsMonthResponse | null>(null)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/dashboard/calendar-workflows')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data?.success && Array.isArray(data.workflows)) {
          setWorkflows(data.workflows)
          const first = data.workflows[0]
          if (first?.calendarNodes?.[0]) {
            setSelected({ workflowId: first.workflowId, nodeId: first.calendarNodes[0].nodeId })
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingWorkflows(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedNode) return
    const t = todayInTimezone(selectedNode.timezone || 'Europe/Zurich')
    setYear(Number(t.slice(0, 4)))
    setMonth(Number(t.slice(5, 7)))
    setSelectedYmd(t)
  }, [selectedNode])

  // events fetch
  const loadEvents = useCallback(
    async (refresh = false) => {
      if (!selected) return
      setLoadingEvents(true)
      setEventsError(null)
      try {
        const url = new URL('/api/dashboard/calendar/events-month', window.location.origin)
        url.searchParams.set('workflowId', selected.workflowId)
        url.searchParams.set('nodeId', selected.nodeId)
        url.searchParams.set('year', String(year))
        url.searchParams.set('month', String(month))
        if (refresh) url.searchParams.set('refresh', '1')
        const r = await fetch(url.toString())
        const data: EventsMonthResponse = await r.json()
        if (!data.success) {
          setEventsError(data.error || 'Failed to load events')
          setEventsData(null)
        } else {
          setEventsData(data)
        }
      } catch (e: any) {
        setEventsError(e?.message || 'Network error')
        setEventsData(null)
      } finally {
        setLoadingEvents(false)
      }
    },
    [selected, year, month]
  )

  useEffect(() => {
    loadEvents(false)
  }, [loadEvents])

  const settings: ClosedDaySettings = useMemo(
    () =>
      eventsData?.settings || {
        weeklyClosedDays: selectedNode?.weeklyClosedDays,
        holidays: selectedNode?.holidays,
        closedRanges: selectedNode?.closedRanges,
      },
    [eventsData, selectedNode]
  )

  const eventsByDate = eventsData?.eventsByDate || {}
  const eventsCountMap = useMemo(() => {
    const out: Record<string, { count: number }> = {}
    for (const [date, list] of Object.entries(eventsByDate)) {
      if (Array.isArray(list) && list.length > 0) out[date] = { count: list.length }
    }
    return out
  }, [eventsByDate])

  const getDayStatus = (ymd: string): DayStatus => computeDayStatus(ymd, settings)

  if (loadingWorkflows) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    )
  }

  if (workflows.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-lg border bg-card p-6 text-center">
          <Calendar className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-2">{t('bookings_page_title') || 'Bookings'}</h2>
          <p className="text-sm text-muted-foreground">
            {t('bookings_no_calendar_yet') ||
              'No Calendar workflow configured yet. Set up a Calendar tool in Agent Studio first.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5 text-teal-500" />
          {t('bookings_page_title') || 'Bookings'}
        </h1>
        <div className="flex items-center gap-2">
          <CalendarSelector
            workflows={workflows}
            selected={selected}
            onChange={(s) => setSelected(s)}
            workflowLabel={t('bookings_workflow_label') || 'Workflow'}
            calendarLabel={t('bookings_calendar_select') || 'Calendar'}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadEvents(true)}
            disabled={loadingEvents}
            className="h-9"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingEvents ? 'animate-spin' : ''}`} />
            {t('bookings_refresh') || 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Left — month grid */}
        <div className="rounded-lg border bg-card p-4">
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
            todayLabel={t('bookings_today') || 'Today'}
          />
          {loadingEvents && !eventsData ? (
            <div className="py-12 text-center">
              <Loader2 className="w-5 h-5 animate-spin text-gray-500 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                {t('bookings_loading') || 'Loading bookings…'}
              </p>
            </div>
          ) : eventsError ? (
            <div className="py-6 px-4 rounded border border-red-500/40 bg-red-500/10">
              <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                <AlertCircle className="w-4 h-4" />
                {(t('bookings_fetch_failed') || 'Failed to load bookings: {error}').replace(
                  '{error}',
                  eventsError
                )}
              </div>
            </div>
          ) : (
            <>
              <MonthGrid
                year={year}
                month={month}
                todayYmd={todayYmd}
                selectedYmd={selectedYmd}
                getDayStatus={getDayStatus}
                eventsByDate={eventsCountMap}
                onDayClick={setSelectedYmd}
              />
              <LegendBar
                showBookedBadge
                labels={{
                  closed: t('bookings_legend_closed') || 'Closed (AI declines politely)',
                  holiday: t('bookings_legend_holiday') || 'Holiday',
                  range: t('bookings_legend_range') || 'Vacation',
                  partial: t('bookings_legend_partial') || 'Partial open',
                  booked: t('bookings_legend_booked') || 'N booked',
                }}
              />
              <div className="mt-2 px-1 text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
                <span>
                  {(t('bookings_timezone_note') || 'Timezone: {tz}').replace('{tz}', timezone)}
                </span>
                {eventsData?.cached && (
                  <span className="text-[10px] px-1.5 rounded bg-muted text-muted-foreground">
                    cached
                  </span>
                )}
                {eventsData?.truncated && (
                  <span className="text-[10px] px-1.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    {t('bookings_truncated_note') || 'Some events not shown (>250)'}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right — day detail drawer */}
        <DayDetailDrawer
          ymd={selectedYmd}
          status={selectedYmd ? getDayStatus(selectedYmd) : null}
          events={selectedYmd ? eventsByDate[selectedYmd] || [] : []}
          calendarType={selectedNode?.type}
          t={t}
        />
      </div>
    </div>
  )
}

interface SelectorProps {
  workflows: CalendarWorkflow[]
  selected: { workflowId: string; nodeId: string } | null
  onChange: (sel: { workflowId: string; nodeId: string }) => void
  workflowLabel: string
  calendarLabel: string
}

function CalendarSelector({ workflows, selected, onChange, calendarLabel }: SelectorProps) {
  const value = selected ? `${selected.workflowId}::${selected.nodeId}` : ''
  const handleChange = (v: string) => {
    const [workflowId, nodeId] = v.split('::')
    if (workflowId && nodeId) onChange({ workflowId, nodeId })
  }

  const totalCalendars = workflows.reduce((acc, w) => acc + w.calendarNodes.length, 0)
  if (totalCalendars <= 1) return null

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      className="h-9 px-2 text-sm rounded-md border border-input bg-background"
    >
      {workflows.map((w) =>
        w.calendarNodes.map((n) => (
          <option key={`${w.workflowId}::${n.nodeId}`} value={`${w.workflowId}::${n.nodeId}`}>
            {w.workflowName} — {n.nodeName}
          </option>
        ))
      )}
    </select>
  )
}

interface DayDetailDrawerProps {
  ymd: string | null
  status: DayStatus | null
  events: EventOut[]
  calendarType?: 'google' | 'microsoft'
  t: (key: string) => string
}

function DayDetailDrawer({ ymd, status, events, calendarType, t }: DayDetailDrawerProps) {
  if (!ymd || !status) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t('bookings_select_day_hint') || 'Click a day to see bookings.'}
      </div>
    )
  }

  const isClosed = status.kind !== 'open' && status.kind !== 'partial'
  const adminWarning = isClosed && events.length > 0

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold">{formatDateLabel(ymd)}</div>
        <div className="text-[11px] text-muted-foreground">{ymd}</div>
      </div>

      <ClosureBlock status={status} t={t} />

      {adminWarning && (
        <div className="p-2 rounded border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {t('bookings_admin_warning_booked_on_closed') ||
              'Warning: bookings exist on a configured closed day. Review your AI agent.'}
          </span>
        </div>
      )}

      {events.length === 0 ? (
        !isClosed && (
          <p className="text-xs text-muted-foreground">
            {t('bookings_no_events_today') || 'No bookings on this day.'}
          </p>
        )
      ) : (
        <ul className="space-y-1.5">
          {events.map((ev) => (
            <li
              key={ev.id || `${ev.time}-${ev.name}`}
              className="flex items-center justify-between gap-2 p-2 rounded border bg-muted/30 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium">{ev.time}</div>
                <div className="text-muted-foreground truncate">
                  {ev.name || '—'}
                  {ev.phone ? ` · ${ev.phone}` : ''}
                  {ev.duration ? ` · ${ev.duration}m` : ''}
                </div>
                {ev.notes && (
                  <div className="text-muted-foreground line-clamp-2 break-words" title={ev.notes}>
                    💬 {ev.notes}
                  </div>
                )}
              </div>
              {ev.htmlLink && (
                <a
                  href={ev.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] inline-flex items-center gap-0.5 text-teal-600 hover:underline whitespace-nowrap"
                  title={
                    calendarType === 'microsoft'
                      ? t('bookings_open_in_outlook') || 'Open in Outlook'
                      : t('bookings_open_in_google') || 'Open in Google Calendar'
                  }
                >
                  <ExternalLink className="w-3 h-3" />
                  {calendarType === 'microsoft'
                    ? t('bookings_open_in_outlook_short') || 'Outlook'
                    : t('bookings_open_in_google_short') || 'Google Cal'}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ClosureBlock({ status, t }: { status: DayStatus; t: (key: string) => string }) {
  switch (status.kind) {
    case 'open':
      return null
    case 'partial':
      return (
        <div className="p-2 rounded border border-yellow-500/40 bg-yellow-500/10 text-[11px] text-yellow-800 dark:text-yellow-200">
          🟡{' '}
          {(t('bookings_day_status_partial') || 'Partial open: {start} – {end}.')
            .replace('{start}', status.openStart)
            .replace('{end}', status.openEnd)}
        </div>
      )
    case 'holiday':
      return (
        <div className="p-2 rounded border border-red-500/40 bg-red-500/10 text-[11px] text-red-700 dark:text-red-300">
          🎉 {status.name}
        </div>
      )
    case 'range':
      return (
        <div className="p-2 rounded border border-purple-500/40 bg-purple-500/10 text-[11px] text-purple-700 dark:text-purple-300">
          ✈️ {status.name} (until {status.endDate})
        </div>
      )
    case 'weekly':
      return (
        <div className="p-2 rounded border border-gray-500/40 bg-gray-500/10 text-[11px] text-muted-foreground">
          🚫 {(t('bookings_day_status_weekly') || 'Closed on {weekday}').replace(
            '{weekday}',
            status.weekday.charAt(0).toUpperCase() + status.weekday.slice(1)
          )}
        </div>
      )
  }
}

function formatDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const d = new Date(`${ymd}T12:00:00Z`)
  if (!Number.isFinite(d.getTime())) return ymd
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const mo = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${wd}, ${mo} ${Number(m[3])}, ${m[1]}`
}
