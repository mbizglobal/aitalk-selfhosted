'use client'

import React, { useCallback, useEffect, useState } from 'react'
import type { Node } from 'reactflow'
import { AlertCircle, Info, Loader2, RefreshCw } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useWorkflowContext } from '../../contexts/WorkflowContext'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export interface WorkAppOption {
  workflowId: string
  name: string
  agentId: string
  agentTitle: string
  appTemplate: string | null
  opened: boolean
  projectKind?: string | null
  inboxes?: Array<{ family: string; label: string; identify?: { by: 'phone' | 'telegram'; label: string } }>
  tables?: Array<{ family: string; label: string }>
}

export function useWorkApps() {
  const [apps, setApps] = useState<WorkAppOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/agent-studio/work-apps')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        if (!cancelled) setApps(Array.isArray(data.apps) ? data.apps : [])
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  return { apps, loading, loadError }
}

const EVENTS = ['sealed', 'resubmitted', 'unlocked', 'inbox_row'] as const

interface FlowRun {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted'
  code: string | null
  failedNode: string | null
  event: { kind: string; title: string; periodStart: string; periodEnd: string; submissionNumber: number | null } | null
  createdAt: string
  blockedSince: string | null
  canRerun: boolean
}

const selectClass = 'w-full px-3 py-2 text-sm text-gray-100 bg-[#151515] border border-[#222] rounded-lg focus:outline-none focus:border-cyan-500'

export const WorkEventStartPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { agent, workflow } = useWorkflowContext()
  const nodeName = (id: string) => (workflow.nodes.find((n) => n.id === id)?.data?.label as string | undefined) || id
  const { apps, loading, loadError } = useWorkApps()

  const sourceId: string = typeof node.data?.workEventWorkflowId === 'string' ? node.data.workEventWorkflowId : ''
  const events: string[] = Array.isArray(node.data?.workEvents) ? node.data.workEvents : []
  const picked = apps.find((a) => a.workflowId === sourceId)
  const selectedMissing = !!sourceId && !loading && !loadError && !picked

  const toggleEvent = (k: string) => {
    const next = events.includes(k) ? events.filter((e) => e !== k) : EVENTS.filter((e) => e === k || events.includes(e))
    updateNodeData({ workEvents: next })
  }

  const workflowId = agent.workflowId
  const [runs, setRuns] = useState<FlowRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [rerunBusy, setRerunBusy] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)

  const loadRuns = useCallback(async () => {
    if (!workflowId) return
    setRunsLoading(true)
    setRunsError(false)
    try {
      const res = await fetch(`/api/agent-studio/flow-runs?workflowId=${encodeURIComponent(workflowId)}`)
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setRuns(Array.isArray(data.runs) ? data.runs : [])
    } catch {
      setRunsError(true)
    } finally {
      setRunsLoading(false)
    }
  }, [workflowId])

  useEffect(() => { void loadRuns() }, [loadRuns])

  const rerun = async (runId: string) => {
    setRerunBusy(true)
    setRerunError(null)
    try {
      const res = await fetch(`/api/agent-studio/flow-runs/${encodeURIComponent(runId)}/rerun`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRerunError(data?.error === 'STALE'
          ? (t.work_event_rerun_stale || 'This run can no longer be run again — refresh the list.')
          : (t.work_event_rerun_failed || 'Could not run it again.'))
        return
      }
      setConfirmId(null)
      await loadRuns()
    } catch {
      setRerunError(t.work_event_rerun_failed || 'Could not run it again.')
    } finally {
      setRerunBusy(false)
    }
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang) : '')
  const statusLabel = (s: string) => t[`work_event_status_${s}`] || s
  const statusColor = (s: string) => (s === 'done' ? 'text-emerald-400' : s === 'failed' || s === 'interrupted' ? 'text-red-400' : 'text-amber-400')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-200">{t.work_event_source_label || 'Work app'}</p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />{t.loading || 'Loading…'}</div>
        ) : loadError ? (
          <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t.work_apps_load_failed || 'Could not load the work apps'}</p>
        ) : (
          <select
            value={sourceId}
            aria-label={t.work_event_source_label || 'Work app'}
            onChange={(e) => updateNodeData({ workEventWorkflowId: e.target.value || undefined })}
            className={selectClass}
          >
            <option value="">{t.work_app_select_placeholder || '— choose a work app —'}</option>
            {apps.map((a) => (
              <option key={a.workflowId} value={a.workflowId}>
                {a.name}{a.agentTitle ? ` · ${a.agentTitle}` : ''}{a.opened ? '' : ` (${t.work_app_not_opened || 'not opened yet'})`}
              </option>
            ))}
            {selectedMissing && <option value={sourceId}>{sourceId} ({t.work_app_missing || 'not found'})</option>}
          </select>
        )}
        {!loading && !loadError && apps.length === 0 && (
          <p className="text-xs text-amber-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t.work_apps_none || 'No deployed work app in this account yet — deploy a Start / App workflow first.'}</p>
        )}
        {picked && !picked.opened && (
          <p className="text-xs text-amber-400">{t.work_app_open_once || 'This work app has not been opened yet — open it once first, so its project exists.'}</p>
        )}
        {selectedMissing && (
          <p className="text-xs text-red-400">{t.work_app_missing_hint || 'The chosen work app is missing or no longer deployed.'}</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-200">{t.work_event_events_label || 'Run when'}</p>
        {EVENTS.map((k) => (
          <label key={k} className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={events.includes(k)} onChange={() => toggleEvent(k)} />
            <span>{t[`work_event_kind_${k}`] || k}</span>
          </label>
        ))}
        {events.length === 0 && <p className="text-xs text-amber-400">{t.work_event_events_none || 'Choose at least one.'}</p>}
      </div>

      <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>{t.work_event_context_help || 'The run sees what happened:'}</p>
          <ul className="font-mono text-[11px] text-gray-300 space-y-0.5">
            <li>{'{{context.workEvent.kind}}'}</li>
            <li>{'{{context.workEvent.title}}'}</li>
            <li>{'{{context.workEvent.periodStart}}'}</li>
            <li>{'{{context.workEvent.periodEnd}}'}</li>
            <li>{'{{context.workEvent.submissionNumber}}'}</li>
          </ul>
          <p>{t.work_event_note || 'Keep this as the only Start node. A Wait node cannot be used — no person replies to this run.'}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-200">{t.work_event_runs_title || 'Recent runs'}</p>
          <button
            type="button"
            onClick={() => void loadRuns()}
            disabled={!workflowId || runsLoading}
            className="p-1 text-gray-400 hover:text-gray-200 disabled:opacity-40"
            title={t.work_event_runs_refresh || 'Refresh'}
            aria-label={t.work_event_runs_refresh || 'Refresh'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {runsError ? (
          <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t.work_event_runs_failed || 'Could not load the runs'}</p>
        ) : runs.length === 0 ? (
          <p className="text-xs text-gray-500">{runsLoading ? (t.loading || 'Loading…') : (t.work_event_runs_none || 'No runs yet.')}</p>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id} className="rounded-md border border-[#3A3A3A] p-2 text-xs space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-gray-200 min-w-0 truncate">
                    {r.event ? r.event.title : '—'}
                  </span>
                  <span className={`shrink-0 ${statusColor(r.status)}`}>{statusLabel(r.status)}</span>
                </div>
                {r.event && (
                  <p className="text-gray-500">
                    {r.event.periodStart ? `${r.event.periodStart} – ${r.event.periodEnd} · ` : ''}{t[`work_event_kind_short_${r.event.kind}`] || r.event.kind}
                  </p>
                )}
                <p className="text-gray-500">{fmt(r.createdAt)}</p>
                {(r.failedNode || r.code) && (
                  <p className="text-red-400 break-all">
                    {r.failedNode ? `${t.work_event_failed_node || 'Stopped at'}: ${nodeName(r.failedNode)}` : ''}
                    {r.failedNode && r.code ? ' · ' : ''}
                    {r.code || ''}
                  </p>
                )}
                {r.blockedSince && (
                  <p className="text-amber-400">{t.work_event_blocked_since || 'Waiting since'} {fmt(r.blockedSince)}</p>
                )}
                {r.canRerun && (
                  confirmId === r.id ? (
                    <div className="space-y-1 pt-1">
                      <p className="text-amber-300">{t.work_event_rerun_confirm || 'Alerts are sent again.'}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={rerunBusy}
                          onClick={() => void rerun(r.id)}
                          className="px-2 py-1 rounded bg-cyan-700 text-white hover:bg-cyan-600 disabled:opacity-50"
                        >
                          {rerunBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : (t.work_event_rerun_yes || 'Run again')}
                        </button>
                        <button
                          type="button"
                          disabled={rerunBusy}
                          onClick={() => { setConfirmId(null); setRerunError(null) }}
                          className="px-2 py-1 rounded border border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A]"
                        >
                          {t.cancel || 'Cancel'}
                        </button>
                      </div>
                      {rerunError && <p className="text-red-400">{rerunError}</p>}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setConfirmId(r.id); setRerunError(null) }}
                      className="mt-1 px-2 py-1 rounded border border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A]"
                    >
                      {t.work_event_rerun || 'Run again'}
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
