'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { Node } from 'reactflow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import {
  Clock,
  Calendar,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Info
} from 'lucide-react'
import { describeCronExpression } from '@/lib/schedule/cron-utils'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

type SchedulePreset = 'daily' | 'weekly' | 'monthly' | 'custom'

const isDev = process.env.NODE_ENV === 'development'
const MINUTE_OPTIONS = isDev
  ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59]
  : [0, 10, 20, 30, 40, 50]

const TIMEZONES = [
  // UTC
  { value: 'UTC', label: 'UTC (±0)' },
  // Europe
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Zurich', label: 'Zurich / Berlin / Paris (CET)' },
  { value: 'Europe/Athens', label: 'Athens (EET)' },
  // Americas
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'America/Chicago', label: 'Chicago (CST/CDT)' },
  { value: 'America/Denver', label: 'Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)' },
  // Asia
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Seoul / Tokyo (KST/JST)' },
  // Oceania
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' }
]

export const SchedulePanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent, workflow, ui, confirmLiveSave } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const DAYS_OF_WEEK = useMemo(() => [
    { value: 0, label: t.day_sun },
    { value: 1, label: t.day_mon },
    { value: 2, label: t.day_tue },
    { value: 3, label: t.day_wed },
    { value: 4, label: t.day_thu },
    { value: 5, label: t.day_fri },
    { value: 6, label: t.day_sat }
  ], [t])

  const currentWorkflowId = agent.workflowId

  const normalizeMinute = (m: number) => {
    return MINUTE_OPTIONS.reduce((prev, curr) =>
      Math.abs(curr - m) < Math.abs(prev - m) ? curr : prev
    )
  }

  const [preset, setPreset] = useState<SchedulePreset>(node.data.schedulePreset || 'daily')
  const [times, setTimes] = useState<{ hour: number; minute: number }[]>(
    node.data.scheduleTimes ?? [{ hour: node.data.scheduleHour ?? 9, minute: normalizeMinute(node.data.scheduleMinute ?? 0) }]
  )
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    node.data.scheduleDaysOfWeek ?? (node.data.scheduleDayOfWeek != null ? [node.data.scheduleDayOfWeek] : [1])
  )
  const [dayOfMonth, setDayOfMonth] = useState(node.data.scheduleDayOfMonth ?? 1)

  const [hourInputs, setHourInputs] = useState<string[]>(
    (node.data.scheduleTimes ?? [{ hour: node.data.scheduleHour ?? 9 }]).map((t: any) => String(t.hour))
  )
  const [dayOfMonthInput, setDayOfMonthInput] = useState(String(node.data.scheduleDayOfMonth ?? 1))
  const [timezone, setTimezone] = useState(node.data.scheduleTimezone || 'UTC')
  const [cronExpression, setCronExpression] = useState(node.data.cronExpression || '')
  const [enabled, setEnabled] = useState(node.data.scheduleEnabled ?? false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedSchedule, setSavedSchedule] = useState<any>(null)
  const [nextRunTimes, setNextRunTimes] = useState<string[]>([])

  const generateCronExpression = useCallback(() => {
    const sortedTimes = [...times].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))

    switch (preset) {
      case 'daily':
        return sortedTimes.map(t => `${t.minute} ${t.hour} * * *`).join(';')
      case 'weekly':
        const sortedDays = [...daysOfWeek].sort((a, b) => a - b)
        return sortedTimes.map(t => `${t.minute} ${t.hour} * * ${sortedDays.join(',')}`).join(';')
      case 'monthly':
        return sortedTimes.map(t => `${t.minute} ${t.hour} ${dayOfMonth} * *`).join(';')
      case 'custom':
        return cronExpression
      default:
        return `0 9 * * *`
    }
  }, [preset, times, daysOfWeek, dayOfMonth, cronExpression])

  useEffect(() => {
    const cron = generateCronExpression()
    updateNodeData({
      schedulePreset: preset,
      scheduleTimes: times,
      scheduleDaysOfWeek: daysOfWeek,
      scheduleDayOfMonth: dayOfMonth,
      scheduleTimezone: timezone,
      cronExpression: cron,
      scheduleEnabled: enabled
    })
  }, [preset, times, daysOfWeek, dayOfMonth, timezone, cronExpression, enabled])

  useEffect(() => {
    if (!currentWorkflowId || !agent.agentId) return

    const loadSchedule = async () => {
      try {
        const response = await fetch(
          `/api/agents/${agent.agentId}/schedules?workflowId=${currentWorkflowId}`
        )
        if (response.ok) {
          const data = await response.json()
          if (data.schedule) {
            setSavedSchedule(data.schedule)
            setNextRunTimes(data.schedule.nextRunTimes?.map((d: string) =>
              new Date(d).toLocaleString()
            ) || [])
            setEnabled(data.schedule.enabled)
          }
        }
      } catch (err) {
        console.error('Failed to load schedule:', err)
      }
    }

    loadSchedule()
  }, [currentWorkflowId, agent.agentId])

  const handleSaveSchedule = async () => {
    if (!currentWorkflowId || !agent.agentId) {
      setError(t.please_save_workflow)
      return
    }

    if (!(await confirmLiveSave())) return

    setLoading(true)
    setError(null)

    try {
      const cron = generateCronExpression()

      const currentNodeData = {
        ...node.data,
        schedulePreset: preset,
        scheduleTimes: times,
        scheduleDaysOfWeek: daysOfWeek,
        scheduleDayOfMonth: dayOfMonth,
        scheduleTimezone: timezone,
        cronExpression: cron,
        scheduleEnabled: enabled
      }

      const workflowJson = {
        nodes: workflow.nodes.map(n =>
          n.id === node.id
            ? { ...n, data: { ...currentNodeData, icon: null } }
            : { ...n, data: { ...n.data, icon: null } }
        ),
        edges: workflow.edges
      }

      const workflowResponse = await fetch(`/api/workflows/${currentWorkflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agent.workflowName,
          workflowJson: JSON.stringify(workflowJson),
          expectedVersion: agent.workflowVersionRef.current, // optimistic concurrency (G1)
          expectedStatus: agent.workflowStatus,
        })
      })

      if (!workflowResponse.ok) {
        const errBody = await workflowResponse.json().catch(() => null)
        if (errBody?.code === 'STALE_CONFLICT') throw new Error(t.workflow_version_conflict)
        if (errBody?.code === 'STATUS_CHANGED') {
          if (typeof errBody?.currentStatus === 'string') agent.setWorkflowStatus(errBody.currentStatus)
          throw new Error(t.workflow_status_changed)
        }
        throw new Error(t.failed_save_workflow)
      }
      const savedData = await workflowResponse.json().catch(() => null)
      if (typeof savedData?.workflow?.version === 'number') {
        agent.workflowVersionRef.current = savedData.workflow.version
      }

      const updatedNodes = workflow.nodes.map(n =>
        n.id === node.id
          ? { ...n, data: currentNodeData }
          : n
      )
      ui.setHasChanges(false)
      ui.setSavedSnapshot({ nodes: updatedNodes, edges: workflow.edges })

      const response = await fetch(`/api/agents/${agent.agentId}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: currentWorkflowId,
          cronExpression: cron,
          timezone,
          enabled
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || t.failed_save_schedule)
      }

      const data = await response.json()
      setSavedSchedule(data.schedule)
      setNextRunTimes(data.schedule.nextRunTimes?.map((d: string) =>
        new Date(d).toLocaleString()
      ) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed_save_schedule)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSchedule = async () => {
    if (!savedSchedule || !agent.agentId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/agents/${agent.agentId}/schedules?scheduleId=${savedSchedule.id}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        throw new Error(t.failed_delete_schedule)
      }

      setSavedSchedule(null)
      setNextRunTimes([])
      setEnabled(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed_delete_schedule)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleEnabled = async () => {
    if (!savedSchedule) {
      setEnabled(!enabled)
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`/api/agents/${agent.agentId}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: currentWorkflowId,
          cronExpression: savedSchedule.cronExpression,
          timezone: savedSchedule.timezone,
          enabled: !enabled
        })
      })

      if (response.ok) {
        setEnabled(!enabled)
        const data = await response.json()
        setSavedSchedule(data.schedule)
      }
    } catch (err) {
      console.error('Failed to toggle schedule:', err)
    } finally {
      setLoading(false)
    }
  }

  const presetLabels: Record<SchedulePreset, string> = useMemo(() => ({
    daily: t.daily,
    weekly: t.weekly,
    monthly: t.monthly,
    custom: t.custom
  }), [t])

  return (
    <div className="space-y-4">
      {/* Schedule Preset */}
      <div>
        <label className="text-sm font-medium text-gray-200 mb-2 block">
          {t.schedule_type}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(['daily', 'weekly', 'monthly', 'custom'] as SchedulePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-3 py-2 text-sm rounded-md border transition-colors ${preset === p
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-[#3A3A3A] text-gray-300 hover:border-gray-500'
                }`}
            >
              {presetLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Time Settings */}
      {preset !== 'custom' && (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-200 mb-2 block">
              <Clock className="w-4 h-4 inline mr-1" />
              {times.length > 1 ? t.times : t.time}
            </label>
            <div className="space-y-2">
              {times.map((time, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={hourInputs[index] ?? String(time.hour)}
                    onChange={(e) => {
                      const val = e.target.value
                      if (val === '' || /^\d{0,2}$/.test(val)) {
                        const newInputs = [...hourInputs]
                        newInputs[index] = val
                        setHourInputs(newInputs)
                      }
                    }}
                    onBlur={() => {
                      const num = parseInt(hourInputs[index]) || 0
                      const clamped = Math.min(23, Math.max(0, num))
                      const newTimes = [...times]
                      newTimes[index] = { ...newTimes[index], hour: clamped }
                      setTimes(newTimes)
                      const newInputs = [...hourInputs]
                      newInputs[index] = String(clamped)
                      setHourInputs(newInputs)
                    }}
                    placeholder="0-23"
                    className="w-16 bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-center"
                  />
                  <span className="text-gray-400">:</span>
                  <select
                    value={time.minute}
                    onChange={(e) => {
                      const newTimes = [...times]
                      newTimes[index] = { ...newTimes[index], minute: parseInt(e.target.value) }
                      setTimes(newTimes)
                    }}
                    className="w-16 bg-[#2A2A2A] border border-[#3A3A3A] text-gray-200 rounded-md px-1 py-2 text-sm text-center"
                  >
                    {MINUTE_OPTIONS.map((min) => (
                      <option key={min} value={min}>
                        {min.toString().padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                  {times.length > 1 && (
                    <button
                      onClick={() => {
                        const newTimes = times.filter((_, i) => i !== index)
                        setTimes(newTimes)
                        const newInputs = hourInputs.filter((_, i) => i !== index)
                        setHourInputs(newInputs)
                      }}
                      className="text-gray-500 hover:text-red-400 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              {times.length < 5 && (
                <button
                  onClick={() => {
                    setTimes([...times, { hour: 9, minute: 0 }])
                    setHourInputs([...hourInputs, '9'])
                  }}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  {t.add_time}
                </button>
              )}
            </div>
          </div>

          {preset === 'weekly' && (
            <div>
              <label className="text-sm font-medium text-gray-200 mb-2 block">
                <Calendar className="w-4 h-4 inline mr-1" />
                {t.days_of_week}
              </label>
              <div className="flex flex-wrap gap-1">
                {DAYS_OF_WEEK.map((day) => {
                  const isSelected = daysOfWeek.includes(day.value)
                  return (
                    <button
                      key={day.value}
                      onClick={() => {
                        if (isSelected) {
                          if (daysOfWeek.length > 1) {
                            setDaysOfWeek(daysOfWeek.filter(d => d !== day.value))
                          }
                        } else {
                          setDaysOfWeek([...daysOfWeek, day.value])
                        }
                      }}
                      className={`px-2 py-1 text-xs rounded font-medium transition-colors ${isSelected
                          ? 'bg-primary/20 text-primary border border-primary'
                          : 'bg-[#3A3A3A] text-gray-400 hover:bg-[#4A4A4A] hover:text-gray-200 border border-transparent'
                        }`}
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {t.click_multiple_days}
              </p>
            </div>
          )}

          {/* Day of Month (for monthly) */}
          {preset === 'monthly' && (
            <div>
              <label className="text-sm font-medium text-gray-200 mb-2 block">
                <Calendar className="w-4 h-4 inline mr-1" />
                {t.day_of_month}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                value={dayOfMonthInput}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === '' || /^\d{0,2}$/.test(val)) {
                    setDayOfMonthInput(val)
                  }
                }}
                onBlur={() => {
                  const num = parseInt(dayOfMonthInput) || 1
                  const clamped = Math.min(31, Math.max(1, num))
                  setDayOfMonth(clamped)
                  setDayOfMonthInput(String(clamped))
                }}
                placeholder="1-31"
                className="w-20 bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-center"
              />
            </div>
          )}
        </div>
      )}

      {/* Custom Cron Expression */}
      {preset === 'custom' && (
        <div>
          <label className="text-sm font-medium text-gray-200 mb-2 block">
            {t.cron_expression}
          </label>
          <Input
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            placeholder="0 9 * * *"
            className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">
            {t.cron_format}
          </p>
        </div>
      )}

      {/* Timezone */}
      <div>
        <label className="text-sm font-medium text-gray-200 mb-2 block">
          {t.timezone}
        </label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full bg-[#2A2A2A] border border-[#3A3A3A] text-gray-200 rounded-md px-3 py-2 text-sm"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </div>

      {/* Current Cron Expression Display */}
      <div className="bg-[#2A2A2A] rounded-md p-3">
        <div className="flex items-center gap-2 mb-2">
          <Info className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-400">{t.schedule_expression}</span>
        </div>
        <div className="flex items-center justify-between">
          <code className="text-sm text-primary font-mono">
            {generateCronExpression()}
          </code>
          <span className="text-xs text-gray-400">
            {describeCronExpression(generateCronExpression())}
          </span>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {savedSchedule ? (
        savedSchedule.enabled ? (
          <div className="bg-[#1E3A1E] rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400">{t.schedule_active}</span>
            </div>
            {nextRunTimes.length > 0 && (
              <div className="text-xs text-gray-400">
                <p className="font-medium mb-1">{t.next_runs}</p>
                <ul className="space-y-0.5">
                  {nextRunTimes.slice(0, 3).map((time, i) => (
                    <li key={i}>• {time}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-[#2A2A2A] rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Pause className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400">{t.schedule_paused}</span>
            </div>
            <p className="text-xs text-gray-500">{t.schedule_paused_desc}</p>
          </div>
        )
      ) : currentWorkflowId && (
        <div className="bg-[#3A2A1E] rounded-md p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-orange-400" />
            <span className="text-sm text-orange-400">{t.schedule_not_saved}</span>
          </div>
          <p className="text-xs text-gray-400">{t.schedule_not_saved_desc}</p>
        </div>
      )}

      {/* Actions */}
      <div className="pt-4 border-t border-[#3A3A3A] space-y-2">
        {/* Enable/Disable Toggle */}
        <Button
          variant="outline"
          size="sm"
          className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9"
          onClick={handleToggleEnabled}
          disabled={loading}
        >
          {enabled ? (
            <>
              <Pause className="w-4 h-4 mr-2" />
              {t.disable_schedule}
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              {t.enable_schedule}
            </>
          )}
        </Button>

        {/* Save Schedule */}
        <Button
          variant={savedSchedule ? "outline" : "default"}
          size="sm"
          className={`w-full justify-start h-9 ${
            savedSchedule
              ? 'border-primary text-primary hover:bg-primary/10'
              : 'bg-orange-500 hover:bg-orange-600 text-white border-orange-500'
          }`}
          onClick={handleSaveSchedule}
          disabled={loading || !currentWorkflowId}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {savedSchedule ? t.update_schedule : t.save_schedule}
        </Button>

        {/* Delete Schedule */}
        {savedSchedule && (
          <Button
            variant="outline"
            size="sm"
            className="w-full border-red-500 text-red-500 hover:bg-red-500/10 justify-start h-9"
            onClick={handleDeleteSchedule}
            disabled={loading}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {t.delete_schedule}
          </Button>
        )}
      </div>

      {/* Info Notice */}
      {!currentWorkflowId && (
        <div className="bg-[#2A2A2A] rounded-md p-3 text-xs text-gray-400">
          <Info className="w-4 h-4 inline mr-1" />
          {t.save_workflow_first}
        </div>
      )}
    </div>
  )
}
