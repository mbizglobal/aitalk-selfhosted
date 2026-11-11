'use client'

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Edge, Node } from 'reactflow'
import { AlertTriangle, ExternalLink, Info, Link2, Loader2, Plus } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { WorkAppLines, useSavedTick } from './WorkAppStepPanel'
import { PanelSection } from './PanelSection'
import { COMPANY_BOOK_KINDS } from '@/lib/work/app-template-kinds'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export type SharedAppPick = { appWorkflowId: string; appName: string; canvasWorkflowId: string; canvasName: string; agentId: string; agentName: string; alone: boolean }
type Unpickable = { why: 'draft' | 'deleted_canvas' | 'removed_node'; canvasName: string | null; appName: string }
export type SharedAppList = {
  pickable: SharedAppPick[]; unpickable: Unpickable[]; exists: boolean
  bookBound?: boolean; byBook?: { same: string[]; none: string[]; mixed: string[]; other: string[] }; bookUnusable?: boolean
}

export function useSharedApps(appTemplate: string | null, canvasWorkflowId: string | null | undefined, refresh: unknown, book?: string | null): { list: SharedAppList | null; failed: boolean; reload: () => void } {
  const [list, setList] = useState<SharedAppList | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!appTemplate) return
    let alive = true
    setFailed(false)
    setList(null)
    fetch(`/api/agent-studio/shared-apps?appTemplate=${encodeURIComponent(appTemplate)}${canvasWorkflowId ? `&workflowId=${encodeURIComponent(canvasWorkflowId)}` : ''}${book ? `&bookAppWorkflowId=${encodeURIComponent(book)}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setList({ pickable: d.pickable ?? [], unpickable: d.unpickable ?? [], exists: d.exists === true, bookBound: d.bookBound === true, ...(d.byBook ? { byBook: d.byBook } : {}), bookUnusable: d.bookUnusable === true }) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [appTemplate, canvasWorkflowId, refresh, tick, book])
  return { list, failed, reload: useCallback(() => setTick((x) => x + 1), []) }
}

export async function createSharedApp(appTemplate: string, canvasWorkflowId: string, book?: string): Promise<{ ok: true; appWorkflowId: string; book: string | null } | { ok: false; code: string }> {
  try {
    const r = await fetch('/api/agent-studio/shared-apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appTemplate, workflowId: canvasWorkflowId, ...(book ? { bookAppWorkflowId: book } : {}) }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, code: typeof d?.detail === 'string' && d.detail ? d.detail : String(d?.error ?? r.status) }
    return { ok: true, appWorkflowId: String(d.appWorkflowId), book: typeof d.book === 'string' ? d.book : null }
  } catch {
    return { ok: false, code: 'NETWORK' }
  }
}

async function attachBook(appWorkflowId: string, book: string): Promise<{ ok: true; book: string } | { ok: false; code: string }> {
  try {
    const r = await fetch('/api/agent-studio/shared-apps/attach-book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appWorkflowId, bookAppWorkflowId: book }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, code: String(d?.error ?? r.status) }
    return { ok: true, book: String(d.book) }
  } catch {
    return { ok: false, code: 'NETWORK' }
  }
}

let bookWrites = 0
const bookWriteListeners = new Set<() => void>()
function markBookWrite(d: 1 | -1) { bookWrites += d; bookWriteListeners.forEach((f) => f()) }
function useBookWritePending(): boolean {
  return useSyncExternalStore((f) => { bookWriteListeners.add(f); return () => { bookWriteListeners.delete(f) } }, () => bookWrites > 0, () => false)
}

export function toLinkNode(nodes: Node[], edges: Edge[], nodeId: string, target: { appWorkflowId: string; appName: string }, appTemplate: string): { nodes: Node[]; edges: Edge[] } {
  const nextNodes = nodes.map((n) => (n.id === nodeId
    ? { ...n, data: { label: target.appName || 'Bank ledger', icon: null, color: 'bg-sky-700', nodeType: 'workAppLink', appTemplate, linkedAppWorkflowId: target.appWorkflowId } }
    : n))
  const isApp = (id: string) => id !== nodeId && nodes.find((n) => n.id === id)?.data?.nodeType === 'workApp'
  const nextEdges = edges.filter((e) => {
    if (e.source !== nodeId && e.target !== nodeId) return true
    return e.sourceHandle === 'ref' && isApp(e.source === nodeId ? e.target : e.source)
  })
  return { nodes: nextNodes, edges: nextEdges }
}

export const WorkAppLinkPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { agent, ui, workflow } = useWorkflowContext()
  const saved = useSavedTick(ui.hasChanges)
  const appTemplate = typeof node.data?.appTemplate === 'string' ? node.data.appTemplate : null
  const target = typeof node.data?.linkedAppWorkflowId === 'string' ? node.data.linkedAppWorkflowId : ''
  const isBookKind = !!appTemplate && COMPANY_BOOK_KINDS.includes(appTemplate)
  const bookLinks = isBookKind ? [] : workflow.nodes.filter((n) => n.data?.nodeType === 'workAppLink' && COMPANY_BOOK_KINDS.includes(String(n.data?.appTemplate)))
  const bookValue = bookLinks.length === 1 && typeof bookLinks[0].data?.linkedAppWorkflowId === 'string' ? bookLinks[0].data.linkedAppWorkflowId : ''
  const bookState: 'none' | 'empty' | 'set' = !bookLinks.length ? 'none' : bookValue ? 'set' : 'empty'
  const bookName = bookLinks.length === 1 && typeof bookLinks[0].data?.label === 'string' ? bookLinks[0].data.label : ''
  const { list, failed, reload } = useSharedApps(appTemplate, agent.workflowId, saved, bookState === 'set' ? bookValue : null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [moved, setMoved] = useState(false)
  const pending = useBookWritePending()
  const latest = useRef(workflow)
  latest.current = workflow
  const bookNow = () => {
    const ls = latest.current.nodes.filter((n) => n.data?.nodeType === 'workAppLink' && COMPANY_BOOK_KINDS.includes(String(n.data?.appTemplate)))
    return ls.length === 1 && typeof ls[0].data?.linkedAppWorkflowId === 'string' ? ls[0].data.linkedAppWorkflowId : ''
  }
  const bound = !!list?.bookBound && bookState !== 'none'
  const boundNoBook = !!list?.bookBound && bookState === 'none'
  const chosen = list?.pickable.find((p) => p.appWorkflowId === target && (!bound || list.byBook?.same.includes(p.appWorkflowId))) ?? null
  const appLabel = typeof node.data?.label === 'string' && node.data.label ? node.data.label : String(appTemplate ?? '')

  const choose = (appWorkflowId: string) => {
    const p = list?.pickable.find((x) => x.appWorkflowId === appWorkflowId)
    updateNodeData({ linkedAppWorkflowId: appWorkflowId, ...(p ? { label: p.appName } : {}) })
  }
  const createNew = async () => {
    if (!appTemplate || !agent.workflowId) return
    setCreating(true)
    setCreateError(null)
    setMoved(false)
    if (bound) markBookWrite(1)
    const r = await createSharedApp(appTemplate, agent.workflowId, bound ? bookValue : undefined)
    if (bound) markBookWrite(-1)
    setCreating(false)
    if (!r.ok) { setCreateError(r.code); return }
    if (bound && r.book !== bookNow()) { setMoved(true); reload(); return }
    updateNodeData({ linkedAppWorkflowId: r.appWorkflowId })
    reload()
  }
  const attach = async (appWorkflowId: string) => {
    if (!bookValue) return
    setAttaching(appWorkflowId)
    setCreateError(null)
    setMoved(false)
    markBookWrite(1)
    const r = await attachBook(appWorkflowId, bookValue)
    markBookWrite(-1)
    setAttaching(null)
    if (!r.ok) { setCreateError(`ATTACH:${r.code}`); reload(); return }
    if (r.book !== bookNow()) { setMoved(true); reload(); return }
    const p = list?.pickable.find((x) => x.appWorkflowId === appWorkflowId)
    updateNodeData({ linkedAppWorkflowId: appWorkflowId, ...(p ? { label: p.appName } : {}) })
    reload()
  }

  const why = !target ? (list?.pickable.length ? 'choose' : list?.unpickable.find((u) => u.why === 'draft') ? 'draft' : list?.unpickable.find((u) => u.why === 'removed_node') ? 'removed_node' : list?.unpickable.length ? 'deleted_canvas' : 'none') : !chosen && list ? 'gone' : null
  const sameApps = bound ? (list?.pickable ?? []).filter((p) => list?.byBook?.same.includes(p.appWorkflowId)) : []
  const noBookApps = bound ? (list?.pickable ?? []).filter((p) => list?.byBook?.none.includes(p.appWorkflowId)) : []
  const fill = (x: string) => x.replace('{app}', appLabel)
  const boundWhy = !bound ? null
    : bookState === 'empty' ? fill(t.work_app_link_book_first || 'Choose the bank ledger of this workflow first — then the {app} of the same company can be chosen here.')
    : list?.bookUnusable ? (t.work_app_link_book_unusable || 'The bank ledger node of this workflow points at a ledger that is not deployed or no longer exists — choose another ledger there first.')
    : moved ? (t.work_app_link_moved || 'It was linked to another ledger meanwhile — check the bank ledger node of this workflow.')
    : target && !chosen && list ? fill(t.work_app_link_wrong_book || 'The linked app reads another company\'s bank ledger — choose the {app} of this company.')
    : !target && sameApps.length ? fill(t.work_app_link_choose_bound || 'Choose the {app} of this company (it reads the same bank ledger). Until then deploying is refused.')
    : !target && !sameApps.length && !noBookApps.length && list ? fill(t.work_app_link_none_bound || 'This company has no {app} on its bank ledger yet — create one below.')
    : null
  const removed = list?.unpickable.find((u) => u.why === 'removed_node')
  const notice: Record<string, string> = {
    choose: t.work_app_link_choose || 'Choose the bank ledger this workflow reads. Until then deploying is refused.',
    draft: t.work_app_link_draft_only || 'Your ledger workflow is not deployed yet — deploy it, then choose it here. Or create a new ledger workflow.',
    removed_node: (t.work_app_link_removed_node || 'The ledger node was removed from "{name}". Restore it there from the version history and deploy — then it can be chosen here again.').replace('{name}', removed?.canvasName ?? ''),
    deleted_canvas: t.work_app_link_deleted_canvas || 'Your ledger lost its workflow. Restore it in Work apps (Manage) and deploy it — then it can be chosen here.',
    none: t.work_app_link_none || 'There is no bank ledger yet — create a ledger workflow below.',
    gone: t.work_app_link_gone || 'The linked ledger was deleted or is not deployed. Restore it from the trash and deploy it, or choose another ledger.',
  }
  const createErrorText = (code: string) => code === 'COMPANY_LIMIT'
    ? (t.work_app_link_err_company || "The ledger could not be created — your plan's company (bank ledger) limit is reached. Choose an existing ledger, or upgrade your plan.")
    : code.startsWith('ATTACH:')
    ? (t.work_app_link_attach_err || 'Could not link it to the ledger. Reload and try again.')
    : code === 'workflow_limit_reached'
    ? (t.work_app_link_err_limit || 'The ledger could not be created — your plan has no free workflow. Choose an existing ledger or delete a workflow.')
    : ['TRIAL_EXPIRED', 'SERVICE_INACTIVE', 'PENDING_ACCESS', 'production_limit_reached'].includes(code)
      ? (t.work_app_link_err_gate || 'The ledger could not be created — this account cannot deploy a workflow right now.')
      : (t.work_app_link_err || 'The ledger could not be created. Try again.')

  const label = (p: SharedAppPick) => `${p.alone ? p.canvasName : `${p.appName} — ${p.canvasName}`}${p.agentName ? ` (${p.agentName})` : ''}`
  return (
    <div className="space-y-4">
      {bound ? (boundWhy && (
        <div className="flex gap-2 rounded-md border border-amber-700/60 bg-amber-950/40 p-3 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{boundWhy}</p>
        </div>
      )) : why && list && (
        <div className="flex gap-2 rounded-md border border-amber-700/60 bg-amber-950/40 p-3 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{notice[why]}</p>
        </div>
      )}
      <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>{bound
          ? (t.work_app_link_note_bound || 'This node points at an app of the same company — it reads the bank ledger chosen on this canvas. Its own settings live in its workflow.')
          : (t.work_app_link_note || 'One bank ledger per company — it lives in its own workflow. This node points at it so the apps on this canvas can read it. Bank files, its AI and month closing are set up in the ledger workflow.')}</p>
      </div>

      {bound ? (bookState === 'set' && !list?.bookUnusable && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-200">{t.work_app_link_target_app || 'Linked app'}</p>
          {!list && !failed ? (
            <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin" />{t.loading || 'Loading…'}</div>
          ) : failed ? (
            <p className="text-xs text-red-400">{t.work_app_link_load_failed || 'Could not load the ledgers.'}</p>
          ) : (
            <select
              value={chosen ? target : ''}
              onChange={(e) => choose(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border border-[#3A3A3A] bg-[#1F1F1F] px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
            >
              <option value="" disabled>{fill(t.work_app_link_pick_app || 'Choose the {app}…')}</option>
              {list!.pickable.filter((p) => !list!.byBook?.none.includes(p.appWorkflowId)).map((p) => {
                const same = list!.byBook?.same.includes(p.appWorkflowId)
                const tag = same ? '' : list!.byBook?.mixed.includes(p.appWorkflowId) ? ` — ${t.work_app_link_mixed || 'reads several ledgers'}` : ` — ${t.work_app_link_other_company || 'another company'}`
                return <option key={p.appWorkflowId} value={p.appWorkflowId} disabled={!same}>{label(p)}{tag}</option>
              })}
            </select>
          )}
          {noBookApps.length > 0 && (
            <div className="space-y-2 rounded-md border border-sky-700/60 bg-sky-950/30 p-3 text-xs text-sky-100">
              <p className="font-medium">{t.work_app_link_attach_title || 'Not linked to a bank ledger yet'}</p>
              {noBookApps.map((p) => (
                <div key={p.appWorkflowId} className="space-y-1">
                  <button type="button" onClick={() => attach(p.appWorkflowId)} disabled={pending || !!attaching} className="flex w-full items-center gap-2 rounded-md border border-[#3A3A3A] px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-[#3A3A3A] disabled:opacity-50">
                    {attaching === p.appWorkflowId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                    {label(p)} — {(t.work_app_link_attach || "Link to this company's ledger ({ledger})").replace('{ledger}', bookName)}
                  </button>
                  <p className="text-gray-400">{(t.work_app_link_attach_changes || 'Adds the ledger to the workflow "{name}" and saves it.').replace('{name}', p.canvasName)}</p>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={createNew}
            disabled={creating || pending || !agent.workflowId || !appTemplate}
            className="flex w-full items-center gap-2 rounded-md border border-[#3A3A3A] px-3 py-2 text-sm text-gray-200 hover:bg-[#3A3A3A] disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {fill(t.work_app_link_create_bound || 'Create a new {app} workflow on this ledger and link it').replace('{ledger}', bookName)}
          </button>
          {createError && <p className="text-xs text-red-400">{createErrorText(createError)}</p>}
        </div>
      )) : (
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-200">{t.work_app_link_target || 'Linked ledger'}</p>
        {!list && !failed ? (
          <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin" />{t.loading || 'Loading…'}</div>
        ) : failed ? (
          <p className="text-xs text-red-400">{t.work_app_link_load_failed || 'Could not load the ledgers.'}</p>
        ) : (
          <select
            value={chosen ? target : ''}
            onChange={(e) => choose(e.target.value)}
            disabled={isBookKind && pending}
            className="w-full rounded-md border border-[#3A3A3A] bg-[#1F1F1F] px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
          >
            <option value="" disabled>{t.work_app_link_pick || 'Choose a ledger…'}</option>
            {list!.pickable.map((p) => (
              <option key={p.appWorkflowId} value={p.appWorkflowId}>
                {label(p)}
              </option>
            ))}
          </select>
        )}
        {boundNoBook ? (
          <p className="text-xs text-amber-300">{fill(t.work_app_link_book_missing || 'To create a new {app} here, add a Bank ledger link node to this workflow first — the new app is made on that ledger.')}</p>
        ) : (
        <button
          type="button"
          onClick={createNew}
          disabled={creating || (isBookKind && pending) || !agent.workflowId || !appTemplate}
          className="flex w-full items-center gap-2 rounded-md border border-[#3A3A3A] px-3 py-2 text-sm text-gray-200 hover:bg-[#3A3A3A] disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {t.work_app_link_create || 'Create a new ledger workflow and link it'}
        </button>
        )}
        {list?.exists && !boundNoBook && (
          <p className="text-xs text-amber-300">{t.work_app_link_exists_warn || 'This account already has a bank ledger — a new one splits your bank files into two places. Create one only for another company.'}</p>
        )}
        {createError && <p className="text-xs text-red-400">{createErrorText(createError)}</p>}
      </div>
      )}

      <PanelSection
        title={t.work_app_lines_title || 'Lines to other work apps'}
        icon={<Link2 className="w-5 h-5 text-teal-400 shrink-0" />}
        editLabel={t.edit || 'Edit'}
        doneLabel={t.app_uses_done || 'Done'}
        summary={<span className="text-sm text-gray-400">{t.work_app_link_lines_help || 'Reference lines only — drag from ref to a Work app node of this canvas, or from that node to here.'}</span>}
      >
        <WorkAppLines node={node} t={t} />
      </PanelSection>

      {chosen ? (
        <a
          href={`/chat/${encodeURIComponent(chosen.agentId)}/app?workflowId=${encodeURIComponent(chosen.appWorkflowId)}${['de', 'fr', 'ko'].includes(lang) ? `&lang=${lang}` : ''}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-[#3A3A3A] px-3 py-2 text-sm text-gray-200 hover:bg-[#3A3A3A]"
        >
          {t.app_open_link || 'Open app'}
          <ExternalLink className="w-3 h-3 ml-auto" />
        </a>
      ) : null}
    </div>
  )
}

export function SharedAppChoice({ node, hasHiddenApp, t }: { node: Node; hasHiddenApp: boolean; t: Record<string, string> }) {
  const { agent, workflow, ui } = useWorkflowContext()
  const saved = useSavedTick(ui.hasChanges)
  const appTemplate = typeof node.data?.appTemplate === 'string' ? node.data.appTemplate : null
  const otherApps = workflow.nodes.some((n) => n.id !== node.id && n.data?.nodeType === 'workApp')
  const ask = !!appTemplate && otherApps && !hasHiddenApp && node.data?.keepHere !== true
  const { list } = useSharedApps(ask ? appTemplate : null, agent.workflowId, saved)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(workflow)
  latest.current = workflow
  const askNow = useRef(ask)
  askNow.current = ask
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  if (!ask || !list) return null

  const convert = (target: { appWorkflowId: string; appName: string }) => {
    if (!mounted.current || !askNow.current) return
    const { nodes, edges, setNodes, setEdges, saveToHistory } = latest.current
    const d = nodes.find((n) => n.id === node.id)?.data
    if (d?.nodeType !== 'workApp' || d?.appTemplate !== appTemplate || d?.keepHere === true) return
    const next = toLinkNode(nodes, edges, node.id, target, appTemplate!)
    setNodes(next.nodes)
    setEdges(next.edges)
    saveToHistory(next.nodes, next.edges)
  }
  const keepHere = () => {
    const next = workflow.nodes.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, keepHere: true } } : n))
    workflow.setNodes(next)
    workflow.saveToHistory(next, workflow.edges)
  }
  const createAndLink = async () => {
    if (!agent.workflowId) return
    setBusy(true)
    setError(null)
    const r = await createSharedApp(appTemplate!, agent.workflowId)
    setBusy(false)
    if (!r.ok) { setError(r.code); return }
    convert({ appWorkflowId: r.appWorkflowId, appName: typeof node.data?.label === 'string' ? node.data.label : 'Bank ledger' })
  }

  return (
    <div className="space-y-2 rounded-md border border-sky-700/60 bg-sky-950/30 p-3 text-xs text-sky-100">
      <p className="font-medium">{t.work_app_shared_ask || 'A company keeps one bank ledger. Where should this one live?'}</p>
      {list.pickable.length > 0 && (
        <div className="flex gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-md border border-[#3A3A3A] bg-[#1F1F1F] px-2 py-1.5 text-xs text-gray-200">
            <option value="" disabled>{t.work_app_link_pick || 'Choose a ledger…'}</option>
            {list.pickable.map((p) => <option key={p.appWorkflowId} value={p.appWorkflowId}>{p.alone ? p.canvasName : `${p.appName} — ${p.canvasName}`}</option>)}
          </select>
          <button
            type="button"
            disabled={!pick}
            onClick={() => { const p = list.pickable.find((x) => x.appWorkflowId === pick); if (p) convert(p) }}
            className="rounded-md border border-[#3A3A3A] px-2 py-1.5 text-xs text-gray-200 hover:bg-[#3A3A3A] disabled:opacity-50"
          >
            {t.work_app_shared_link || 'Link this ledger'}
          </button>
        </div>
      )}
      <button type="button" onClick={createAndLink} disabled={busy} className="flex w-full items-center gap-2 rounded-md border border-[#3A3A3A] px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-[#3A3A3A] disabled:opacity-50">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
        {t.work_app_link_create || 'Create a new ledger workflow and link it'}
      </button>
      {list.exists && <p className="text-amber-300">{t.work_app_link_exists_warn || 'This account already has a bank ledger — a new one splits your bank files into two places. Create one only for another company.'}</p>}
      {error && <p className="text-red-400">{error === 'COMPANY_LIMIT'
        ? (t.work_app_link_err_company || "The ledger could not be created — your plan's company (bank ledger) limit is reached. Choose an existing ledger, or upgrade your plan.")
        : (t.work_app_link_err || 'The ledger could not be created. Try again.')}</p>}
      <button type="button" onClick={keepHere} disabled={busy} className="w-full rounded-md px-2 py-1 text-left text-xs text-gray-400 hover:text-gray-200">
        {t.work_app_shared_keep || 'Keep the ledger inside this workflow'}
      </button>
    </div>
  )
}
