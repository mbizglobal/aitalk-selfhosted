'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { Node } from 'reactflow'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { useSavedTick } from './WorkAppStepPanel'
import { PanelSection } from './PanelSection'
import { ArrowDownToLine } from 'lucide-react'

type Slot = { fromName: string; start: string; end: string; state: 'waiting' | 'delivered' | 'skipped'; submission: number | null; rowRemoved: boolean }
type View = {
  routes: Array<{ fromNodeId: string; fromName: string }>
  periods: Array<{ start: string; end: string; status: string; openedTaskId: string | null; slots: Slot[]; outsideList: number }>
  passes: Array<{ fromName: string; start: string | null; end: string | null; state: string; submission: number; rowRemoved: boolean }>
  stuck: number
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))

export const WorkAppHandoffsIn: React.FC<{ node: Node; t: Record<string, string> }> = ({ node, t }) => {
  const { agent, ui } = useWorkflowContext()
  const saved = useSavedTick(ui.hasChanges)
  const [view, setView] = useState<View | null>(null)
  const [reload, setReload] = useState(0)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reset, setReset] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    setView(null)
    setStart('')
    setEnd('')
    setReset(false)
    setConfirming(false)
    setMsg(null)
    setBusy(false)
    generation.current++
  }, [node.id])

  useEffect(() => {
    if (!agent.workflowId) return
    let alive = true
    fetch(`/api/agent-studio/work-app-handoffs?workflowId=${encodeURIComponent(agent.workflowId)}&nodeId=${encodeURIComponent(node.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: View | null) => {
        if (!alive) return
        if (!d || !Array.isArray(d.routes) || !Array.isArray(d.periods) || !Array.isArray(d.passes)) { setView(null); return }
        setView(d)
        if (d?.periods[0]) { setStart((s) => s || d.periods[0].start); setEnd((x) => x || d.periods[0].end) }
      })
      .catch(() => { if (alive) setView(null) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.workflowId, agent.workflowStatus, node.id, saved, reload])

  if (!view || !view.routes.length) return null

  const stateLabel = (s: string) => t[`handoff_state_${s}`] || s
  const periodLabel = (s: string) => t[`handoff_period_${s}`] || s
  const manualPeriod = view.periods.find((p) => p.start === start && p.end === end)?.status === 'manual'

  const pickStart = (v: string) => { setStart(v); setReset(false); setConfirming(false) }
  const pickEnd = (v: string) => { setEnd(v); setReset(false); setConfirming(false) }

  const queue = async () => {
    const asked = ++generation.current
    const still = () => generation.current === asked
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/agent-studio/work-app-handoffs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: agent.workflowId, nodeId: node.id, periodStart: start, periodEnd: end, resetManual: reset && manualPeriod }),
      })
      const d = await r.json().catch(() => null)
      if (!still()) return
      setMsg(r.ok ? fill(t.handoff_backfill_done || '{n} runs queued — they start within a minute.', { n: d?.queued ?? 0 }) : (d?.detail || d?.error || 'Error'))
    } catch {
      if (!still()) return
      setMsg(t.handoff_backfill_unknown || 'No answer from the server — it may or may not have been queued. Check the status above before running it again.')
    } finally {
      if (still()) {
        setReload((x) => x + 1)
        setBusy(false)
        setConfirming(false)
      }
    }
  }

  const latest = view.periods[0]
  const summary = (
    <>
      <span className="text-sm font-medium">{(t.handoff_in_from || 'From')}: {view.routes.map((r) => r.fromName).join(' · ')}</span>
      {latest && (
        <span className="text-xs text-gray-400">
          {latest.start} – {latest.end} · <span className={latest.status === 'opened' ? 'text-emerald-400' : latest.status === 'manual' ? 'text-amber-400' : 'text-gray-400'}>{periodLabel(latest.status)}</span>
          {' · '}{latest.slots.filter((x) => x.state !== 'waiting').length}/{latest.slots.length}
        </span>
      )}
      {view.stuck > 0 && <span className="text-xs text-red-300">{fill(t.handoff_stuck || '{n} run(s) stuck — waiting to finish. Check that this app is open and has its app template; it retries by itself.', { n: view.stuck })}</span>}
    </>
  )

  return (
    <PanelSection
      title={t.handoff_in_title || 'Handed over to this app'}
      icon={<ArrowDownToLine className="w-5 h-5 text-emerald-400 shrink-0" />}
      editLabel={t.edit || 'Edit'}
      doneLabel={t.app_uses_done || 'Done'}
      summary={summary}
    >
      <p className="text-xs text-gray-400">
        {(t.handoff_in_from || 'From')}: {view.routes.map((r) => r.fromName).join(' · ')}
      </p>

      {view.stuck > 0 && (
        <p className="rounded bg-red-950/60 px-2 py-1 text-[11px] text-red-300">{fill(t.handoff_stuck || '{n} run(s) stuck — waiting to finish. Check that this app is open and has its app template; it retries by itself.', { n: view.stuck })}</p>
      )}
      {view.periods.length === 0 && view.passes.length === 0 && (
        <p className="text-xs text-gray-500">{t.handoff_in_nothing_yet || 'Nothing has arrived yet.'}</p>
      )}

      {view.periods.map((p) => (
        <div key={p.start} className="rounded border border-[#3A3A3A] p-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-200">{p.start} – {p.end}</span>
            <span className={p.status === 'opened' ? 'text-emerald-400' : p.status === 'manual' ? 'text-amber-400' : 'text-gray-400'}>{periodLabel(p.status)}</span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {p.slots.map((s, i) => (
              <li key={i} className="flex justify-between gap-2 text-[11px]">
                <span className="truncate text-gray-400">{s.fromName} · {s.start.slice(0, 7)}–{s.end.slice(5, 7)}</span>
                <span className={s.state === 'delivered' ? 'text-emerald-400' : s.state === 'skipped' ? 'text-gray-400' : 'text-amber-400'}>
                  {stateLabel(s.state)}{s.submission && s.submission > 1 ? ` · v${s.submission}` : ''}{s.rowRemoved ? ` · ${t.handoff_row_removed || 'row removed'}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {p.outsideList > 0 && <p className="mt-1 text-[11px] text-gray-500">{fill(t.handoff_outside || '{n} outside the waiting list (the lines changed after this period started)', { n: p.outsideList })}</p>}
        </div>
      ))}

      {view.passes.length > 0 && (
        <div className="rounded border border-[#3A3A3A] p-2">
          <p className="text-xs text-gray-300">{t.handoff_passes || 'Passed on (no period rule on one side)'}</p>
          <ul className="mt-1 space-y-0.5">
            {view.passes.map((x, i) => (
              <li key={i} className="flex justify-between gap-2 text-[11px]">
                <span className="truncate text-gray-400">{x.fromName}{x.start ? ` · ${x.start} – ${x.end}` : ''}</span>
                <span className="text-emerald-400">{stateLabel(x.state)}{x.submission > 1 ? ` · v${x.submission}` : ''}{x.rowRemoved ? ` · ${t.handoff_row_removed || 'row removed'}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {agent.workflowStatus === 'production' && (
        <div className="space-y-2 border-t border-[#3A3A3A] pt-2">
          <p className="text-xs font-medium text-gray-300">{t.handoff_backfill_title || 'Hand over what is already closed'}</p>
          <p className="text-[11px] text-gray-500">{t.handoff_backfill_help || 'Runs the "when closed" flow again for the closed tasks of this period — only the steps that lead to this app. Emails on that way are sent again.'}</p>
          <div className="flex gap-2">
            <input type="date" value={start} onChange={(e) => pickStart(e.target.value)} autoComplete="off" className="w-full rounded border border-[#3A3A3A] bg-[#1F1F1F] px-2 py-1 text-xs text-gray-200" />
            <input type="date" value={end} onChange={(e) => pickEnd(e.target.value)} autoComplete="off" className="w-full rounded border border-[#3A3A3A] bg-[#1F1F1F] px-2 py-1 text-xs text-gray-200" />
          </div>
          {manualPeriod && (
            <label className="flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer select-none">
              <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
              {t.handoff_backfill_reset || 'A person deleted the task of this period — open it automatically again'}
            </label>
          )}
          {confirming ? (
            <div className="flex gap-2">
              <button type="button" disabled={busy || !start || !end || start > end} onClick={queue} className="flex-1 rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50">
                {t.handoff_backfill_confirm || 'Yes, run it'}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded border border-[#3A3A3A] px-2 py-1 text-xs text-gray-300">{t.cancel || 'Cancel'}</button>
            </div>
          ) : (
            <button type="button" disabled={!start || !end || start > end} onClick={() => setConfirming(true)} className="w-full rounded border border-emerald-800 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50">
              {t.handoff_backfill_go || 'Hand over closed tasks'}
            </button>
          )}
          {msg && <p className="text-[11px] text-gray-400">{msg}</p>}
        </div>
      )}
    </PanelSection>
  )
}
