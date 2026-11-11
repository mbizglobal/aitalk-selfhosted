'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { Edge, Node } from 'reactflow'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { useWorkApps, type WorkAppOption } from './WorkEventStartPanel'
import { inboxesOf } from './WorkInboxToolPanel'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const selectClass = 'w-full px-3 py-2 text-sm text-gray-100 bg-[#151515] border border-[#222] rounded-lg focus:outline-none focus:border-amber-500'

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function useSavedTick(hasChanges: boolean): number {
  const prev = useRef(hasChanges)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (prev.current && !hasChanges) setTick((x) => x + 1)
    prev.current = hasChanges
  }, [hasChanges])
  return tick
}

export function useCanvasApps(canvasWorkflowId: string | null | undefined, status: string | null | undefined, savedTick?: unknown): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!canvasWorkflowId) return
    let alive = true
    fetch(`/api/agent-studio/work-app-nodes?workflowId=${encodeURIComponent(canvasWorkflowId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        const rows = (d?.apps ?? []) as Array<{ nodeId: string; workflowId: string; status: string }>
        setMap(new Map(rows.filter((a) => a.status !== 'archived').map((a) => [a.nodeId, a.workflowId])))
      })
      .catch(() => { if (alive) setMap(new Map()) })
    return () => { alive = false }
  }, [canvasWorkflowId, status, savedTick])
  return map
}

export const WorkAppStepPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { workflow } = useWorkflowContext()
  const canvasApps = workflow.nodes.filter((n) => n.data?.nodeType === 'workApp')

  return (
    <div className="space-y-4">
      {canvasApps.length > 0
        ? <CanvasTarget node={node} updateNodeData={updateNodeData} canvasApps={canvasApps} t={t} />
        : <AccountTarget node={node} updateNodeData={updateNodeData} t={t} />}
      <StepFields node={node} updateNodeData={updateNodeData} t={t} />
      {canvasApps.length === 0 && <WorkAppLines node={node} t={t} />}
      {canvasApps.length > 0 && workflow.edges.some((e) => (e.source === node.id || e.target === node.id) && (e.sourceHandle === 'ref' || e.sourceHandle === 'send')) && (
        <p className="text-xs text-amber-400">{t.work_app_step_old_lines || 'This step still has reference / send lines from before — they are not used in a workflow with Work app nodes. Delete them and draw the lines between Work app nodes.'}</p>
      )}
    </div>
  )
}

function CanvasTarget({ node, updateNodeData, canvasApps, t }: Props & { canvasApps: Node[]; t: Record<string, string> }) {
  const targetNodeId: string = typeof node.data?.targetNodeId === 'string' ? node.data.targetNodeId : ''
  const missing = !!targetNodeId && !canvasApps.some((n) => n.id === targetNodeId)
  const oldTarget = !targetNodeId && typeof node.data?.targetWorkflowId === 'string' && node.data.targetWorkflowId
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-200">{t.work_app_step_target || 'Work app'}</p>
      <select
        value={targetNodeId}
        aria-label={t.work_app_step_target || 'Work app'}
        onChange={(e) => {
          const id = e.target.value
          const n = canvasApps.find((x) => x.id === id)
          updateNodeData({ targetNodeId: id || undefined, targetWorkflowId: undefined, label: n ? `${t.work_app_step_open || 'Open task'} · ${String(n.data?.label ?? '')}` : (t.work_app_step || 'Open work app task') })
        }}
        className={selectClass}
      >
        <option value="">{t.work_app_select_placeholder || '— choose a work app —'}</option>
        {canvasApps.map((n) => <option key={n.id} value={n.id}>{String(n.data?.label ?? n.id)}</option>)}
        {missing && <option value={targetNodeId}>{targetNodeId} ({t.work_app_missing || 'not found'})</option>}
      </select>
      {missing && <p className="text-xs text-red-400">{t.work_app_missing_hint || 'The chosen work app is missing or no longer deployed.'}</p>}
      {oldTarget && <p className="text-xs text-amber-400">{t.work_app_step_old_target || 'This step still opens a work app chosen before by its id — choose a Work app node of this workflow instead.'}</p>}
    </div>
  )
}

function AccountTarget({ node, updateNodeData, t }: Props & { t: Record<string, string> }) {
  const { apps, loading, loadError } = useWorkApps()
  const targetId: string = typeof node.data?.targetWorkflowId === 'string' ? node.data.targetWorkflowId : ''
  const picked = apps.find((a) => a.workflowId === targetId)
  const selectedMissing = !!targetId && !loading && !loadError && !picked
  const staleNode = typeof node.data?.targetNodeId === 'string' && node.data.targetNodeId
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-200">{t.work_app_step_target || 'Work app'}</p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />{t.loading || 'Loading…'}</div>
      ) : loadError ? (
        <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t.work_apps_load_failed || 'Could not load the work apps'}</p>
      ) : (
        <select
          value={targetId}
          aria-label={t.work_app_step_target || 'Work app'}
          onChange={(e) => {
            const id = e.target.value
            const a = apps.find((x) => x.workflowId === id)
            updateNodeData({ targetWorkflowId: id || undefined, targetNodeId: undefined, label: a ? a.name : (t.work_app_step || 'Work app') })
          }}
          className={selectClass}
        >
          <option value="">{t.work_app_select_placeholder || '— choose a work app —'}</option>
          {apps.map((a) => (
            <option key={a.workflowId} value={a.workflowId}>
              {a.name}{a.agentTitle ? ` · ${a.agentTitle}` : ''}{a.opened ? '' : ` (${t.work_app_not_opened || 'not opened yet'})`}
            </option>
          ))}
          {selectedMissing && <option value={targetId}>{targetId} ({t.work_app_missing || 'not found'})</option>}
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
      {staleNode && (
        <button type="button" className="text-left text-xs text-amber-400 underline" onClick={() => updateNodeData({ targetNodeId: undefined })}>
          {t.work_app_step_stale_node || 'This step was set to a Work app node that is no longer on this workflow — click to clear it, then choose a work app.'}
        </button>
      )}
    </div>
  )
}

function StepFields({ node, updateNodeData, t }: Props & { t: Record<string, string> }) {
  const action: string = node.data?.action === 'read_status' ? 'read_status' : 'open_task'
  const periodDate: string = typeof node.data?.periodDate === 'string' && node.data.periodDate ? node.data.periodDate : 'event_end'
  const periodMode = DATE_RE.test(periodDate) ? 'fixed' : periodDate
  const saveAs: string = typeof node.data?.saveAs === 'string' ? node.data.saveAs : ''
  return (
    <>
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-200">{t.work_app_step_action || 'What to do'}</p>
        <select value={action} aria-label={t.work_app_step_action || 'What to do'} onChange={(e) => updateNodeData({ action: e.target.value })} className={selectClass}>
          <option value="open_task">{t.work_app_step_action_open_task || 'Open the task of that period (create it if missing)'}</option>
          <option value="read_status">{t.work_app_step_action_read_status || 'Read the status only'}</option>
        </select>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-200">{t.work_app_step_period || 'Which period'}</p>
        <select
          value={periodMode}
          aria-label={t.work_app_step_period || 'Which period'}
          onChange={(e) => updateNodeData({ periodDate: e.target.value === 'fixed' ? todayIso() : e.target.value })}
          className={selectClass}
        >
          <option value="event_end">{t.work_app_step_period_event_end || 'The period that contains the event’s end date'}</option>
          <option value="event_start">{t.work_app_step_period_event_start || 'The period that contains the event’s start date'}</option>
          <option value="today">{t.work_app_step_period_today || 'The period that contains today'}</option>
          <option value="fixed">{t.work_app_step_period_fixed || 'The period that contains a fixed date'}</option>
        </select>
        {periodMode === 'fixed' && (
          <input
            type="date"
            value={periodDate}
            onChange={(e) => { if (DATE_RE.test(e.target.value)) updateNodeData({ periodDate: e.target.value }) }}
            className={selectClass}
          />
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-200">{t.work_app_step_save_as || 'Save the result as'}</p>
        <Input
          value={saveAs}
          placeholder="workApp"
          autoComplete="off"
          onChange={(e) => updateNodeData({ saveAs: e.target.value.trim() || undefined })}
        />
        <p className="text-xs text-gray-500">
          {(t.work_app_step_result_help || 'Next nodes read {{context.NAME.title}}, periodStart, periodEnd, status, submissionNumber, taskId and created.').replace('NAME', saveAs || 'workApp')}
        </p>
      </div>
    </>
  )
}

type LineEnd = { workflowId: string; nodeId: string | null; fixedTemplate: string | null }

export function WorkAppLines({ node, t }: { node: Node; t: Record<string, string> }) {
  const { workflow, agent, ui } = useWorkflowContext()
  const { apps, loading } = useWorkApps()
  const saved = useSavedTick(ui.hasChanges)
  const hidden = useCanvasApps(node.data?.nodeType === 'workApp' || node.data?.nodeType === 'workAppLink' ? agent.workflowId : null, agent.workflowStatus, saved)
  const end = (n: Node | undefined): LineEnd => {
    if (n?.data?.nodeType === 'workApp') {
      return { workflowId: hidden.get(n.id) ?? '', nodeId: n.id, fixedTemplate: typeof n.data?.appTemplate === 'string' && n.data.appTemplate ? n.data.appTemplate : null }
    }
    if (n?.data?.nodeType === 'workAppLink') {
      return { workflowId: typeof n.data?.linkedAppWorkflowId === 'string' ? n.data.linkedAppWorkflowId : '', nodeId: null, fixedTemplate: typeof n.data?.appTemplate === 'string' && n.data.appTemplate ? n.data.appTemplate : null }
    }
    return { workflowId: typeof n?.data?.targetWorkflowId === 'string' ? n.data.targetWorkflowId : '', nodeId: null, fixedTemplate: null }
  }

  const incoming = workflow.edges.filter((e) => e.target === node.id && e.sourceHandle === 'ref')
  const outgoingSends = workflow.edges.filter((e) => e.source === node.id && e.sourceHandle === 'send')

  const updateEdgeData = (edgeId: string, patch: Record<string, unknown>) => {
    const next = workflow.edges.map((e) => (e.id === edgeId ? { ...e, data: { ...(e.data ?? {}), ...patch } } : e))
    workflow.setEdges(next)
    workflow.saveToHistory(workflow.nodes, next)
  }

  return (
    <>
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-200">{t.work_app_ref_title || 'Reference lines'}</p>
        <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{t.work_app_ref_help || 'Drag from the «ref» handle under a Work app node to another Work app node — that work app may then read this one. It is connected when you deploy.'}</p>
        </div>
        {incoming.length === 0 ? (
          <p className="text-xs text-gray-500">{t.work_app_ref_none || 'No work app is read by this one yet.'}</p>
        ) : (
          incoming.map((e) => {
            const src = workflow.nodes.find((n) => n.id === e.source)
            return <RefLine key={e.id} edge={e} source={src} end={end(src)} canvasWorkflowId={agent.workflowId ?? ''} apps={apps} refresh={saved} t={t} onChange={(patch) => updateEdgeData(e.id, patch)} />
          })
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-200">{t.work_app_send_title || 'Send lines'}</p>
        <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{t.work_app_send_help || "Drag from the «send» handle under a Work app node to another Work app node — this work app may then send rows it picks to that work app's inbox. Every send is a card a person approves, and the other work app receives the rows unconfirmed. It is connected when you deploy."}</p>
        </div>
        {outgoingSends.length === 0 ? (
          <p className="text-xs text-gray-500">{t.work_app_send_none || 'This work app does not send to another work app yet.'}</p>
        ) : (
          outgoingSends.map((e) => {
            const target = workflow.nodes.find((n) => n.id === e.target)
            return <SendLine key={e.id} edge={e} target={target} end={end(target)} apps={apps} appsLoading={loading} t={t} onChange={(patch) => updateEdgeData(e.id, patch)} />
          })
        )}
      </div>
    </>
  )
}

function SendLine({ edge, target, end, apps, appsLoading, t, onChange }: {
  edge: Edge
  target: Node | undefined
  end: LineEnd
  apps: WorkAppOption[]
  appsLoading: boolean
  t: Record<string, string>
  onChange: (patch: Record<string, unknown>) => void
}) {
  const app = end.workflowId ? apps.find((a) => a.workflowId === end.workflowId) : undefined
  const inboxes: ReadonlyArray<{ family: string; label: string }> = app?.tables ?? inboxesOf(app?.projectKind ?? app?.appTemplate ?? end.fixedTemplate ?? undefined).map((b) => ({ family: b.family, label: b.family }))
  const family: string = typeof edge.data?.inboxFamily === 'string' ? edge.data.inboxFamily : ''
  useEffect(() => {
    if (app && !family && inboxes.length === 1) onChange({ inboxFamily: inboxes[0].family })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, inboxes.length, inboxes[0]?.family, app?.workflowId])
  const known = !!end.workflowId || !!end.fixedTemplate

  return (
    <div className="rounded-md border border-dashed border-emerald-600/60 p-3 text-xs space-y-2">
      <p className="text-gray-200">
        {t.work_app_send_to || 'Sends to'}: <span className="font-medium">{app?.name || target?.data?.label || '—'}</span>
      </p>
      {!known ? (
        <p className="text-amber-400">{end.nodeId ? (t.work_app_line_deploy_first || 'Deploy once (or fix the app template on that node) to choose its inbox.') : (t.work_app_send_pick_target || 'Choose a work app on the other node first.')}</p>
      ) : appsLoading ? (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-3 h-3 animate-spin" />{t.loading || 'Loading…'}</div>
      ) : end.workflowId && !app && !end.nodeId ? (
        <p className="text-red-400">{t.work_app_missing_hint || 'The chosen work app is missing or no longer deployed.'}</p>
      ) : inboxes.length === 0 ? (
        <p className="text-amber-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t.work_inbox_none || 'This work app has no inbox — its app template does not declare one.'}</p>
      ) : (
        <>
          <select value={family} aria-label={t.work_inbox_family || 'Inbox'} onChange={(e) => onChange({ inboxFamily: e.target.value })} className={selectClass}>
            <option value="">{t.work_inbox_family_placeholder || '— choose an inbox —'}</option>
            {inboxes.map((b) => <option key={b.family} value={b.family}>{b.label}</option>)}
          </select>
          {!family && <p className="text-amber-400">{t.work_app_send_choose_inbox || 'Choose the inbox — needed to deploy.'}</p>}
        </>
      )}
    </div>
  )
}

function RefLine({ edge, source, end, canvasWorkflowId, apps, refresh, t, onChange }: {
  edge: Edge
  source: Node | undefined
  end: LineEnd
  canvasWorkflowId: string
  apps: WorkAppOption[]
  refresh: unknown
  t: Record<string, string>
  onChange: (patch: Record<string, unknown>) => void
}) {
  const app = end.workflowId ? apps.find((a) => a.workflowId === end.workflowId) : undefined
  const chosen: string[] = Array.isArray(edge.data?.sheets) ? edge.data.sheets.filter((x: unknown): x is string => typeof x === 'string') : []
  const includeUnconfirmed = edge.data?.includeUnconfirmed === true
  const query = end.nodeId
    ? (canvasWorkflowId ? `canvasWorkflowId=${encodeURIComponent(canvasWorkflowId)}&nodeId=${encodeURIComponent(end.nodeId)}` : '')
    : (end.workflowId ? `workflowId=${encodeURIComponent(end.workflowId)}` : '')

  const [sheets, setSheets] = useState<Array<{ family: string; label: string }>>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  useEffect(() => { setSheets([]) }, [query])

  useEffect(() => {
    setLoadError(false)
    if (!query) { setSheets([]); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/agent-studio/work-app-sheets?${query}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        if (!cancelled) setSheets(Array.isArray(data.sheets) ? data.sheets : [])
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query, refresh])

  const toggle = (family: string) =>
    onChange({ sheets: chosen.includes(family) ? chosen.filter((f) => f !== family) : [...chosen, family] })

  return (
    <div className="rounded-md border border-dashed border-amber-600/60 p-3 text-xs space-y-2">
      <p className="text-gray-200">
        {t.work_app_ref_reads || 'Reads'}: <span className="font-medium">{app?.name || source?.data?.label || '—'}</span>
      </p>
      {!query ? (
        <p className="text-amber-400">{t.work_app_ref_pick_source || 'Choose a work app on the other node first.'}</p>
      ) : loading && sheets.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-3 h-3 animate-spin" />{t.loading || 'Loading…'}</div>
      ) : loadError && sheets.length === 0 ? (
        <p className="text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t.work_app_ref_sheets_failed || 'Could not load its sheets'}</p>
      ) : sheets.length === 0 ? (
        <p className="text-amber-400">{t.work_app_ref_no_sheets || 'That work app has no sheets to read yet — open it once and choose its app template.'}</p>
      ) : (
        <div className="space-y-1">
          <p className="text-gray-400">{t.work_app_ref_sheets || 'Sheets it may read'}</p>
          {sheets.map((s) => (
            <label key={s.family} className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input type="checkbox" checked={chosen.includes(s.family)} onChange={() => toggle(s.family)} />
              <span>{s.label}</span>
            </label>
          ))}
          {chosen.length === 0 && <p className="text-amber-400">{t.work_app_ref_choose_one || 'Choose at least one sheet — needed to deploy.'}</p>}
        </div>
      )}
      <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
        <input type="checkbox" checked={includeUnconfirmed} onChange={() => onChange({ includeUnconfirmed: !includeUnconfirmed })} />
        <span>{t.work_app_ref_include_unconfirmed || 'Include rows not confirmed yet'}</span>
      </label>
    </div>
  )
}
