'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCheck, CheckCircle2, Circle, Loader2, Lock, LockOpen, Send, Eye, ShieldCheck, Stamp, Undo2, XCircle } from 'lucide-react'
import { workStopText, workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type AppTemplateScreen, type ChecklistItem, type WorkFiles, type PreviewResult, type SubmissionItem, type SubmissionView, type TaskApproval, type TaskReferenceStatus, type TaskSummary, type WorkApi } from '../lib/api'
import { AppTemplateFields, fieldsComplete, fieldsToValues, fieldInputCls, type FieldValues } from './AppTemplateFields'
import { ConfirmDialog } from './ConfirmDialog'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

interface Props {
  api: WorkApi
  files: WorkFiles
  lang: WorkLang
  projectId: string
  task: TaskSummary
  appTemplate: AppTemplateScreen | null
  modules: string[]
  readOnly: boolean
  onChanged: () => void
  refresh?: number
  onOpenSheet?: (sheetId: string) => void
  choices?: TaskSummary[]
  onChoose?: (taskId: string) => void
  onGoto?: (goto: NonNullable<ChecklistItem['goto']>) => void
}

function boxOrder(keys: string[]): string[] {
  const subs = keys.filter((k) => k.endsWith('_tax'))
  const out: string[] = []
  for (const k of keys.filter((x) => !x.endsWith('_tax'))) { out.push(k); if (subs.includes(`${k}_tax`)) out.push(`${k}_tax`) }
  return [...out, ...subs.filter((k) => !out.includes(k))]
}
const boxCode = (k: string) => (k.endsWith('_tax') ? '' : k)
const CHECK_OF: Record<string, string> = { balance: 'bank.balance-check' }

const getPath = (v: unknown, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), v)

function valueText(lang: WorkLang, v: unknown, pkg: string | null): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return workT(lang, v ? 'yes' : 'no', undefined, pkg)
  if (typeof v === 'string') return workT(lang, `res_${v}`, workT(lang, `opt_${v}`, v, pkg), pkg)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const isAmount = (v: unknown) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)

export function ResultView({ lang, value, table, labelPrefix, listPath }: { lang: WorkLang; value: unknown; table?: string; labelPrefix?: string; listPath?: string }) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  if (!value || typeof value !== 'object') return <p className="text-sm text-gray-300">{valueText(lang, value, pkg)}</p>
  const o = value as Record<string, unknown>
  const boxes = table ? getPath(o, table) : undefined
  const list = listPath ? getPath(o, listPath) : undefined
  const rest = Object.entries(o).filter(([k, v]) => k !== table && k !== listPath && (v === null || typeof v !== 'object'))
  return (
    <div className="space-y-3">
      {rest.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rest.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-gray-400">{t(`res_${k}`, k)}</dt>
              <dd className={`text-gray-100 ${isAmount(v) ? 'tabular-nums' : ''}`}>{valueText(lang, v, pkg)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {boxes && typeof boxes === 'object' && !Array.isArray(boxes) && (
        <table className="w-full max-w-md text-sm">
          <tbody>
            {boxOrder(Object.keys(boxes as Record<string, unknown>)).map((k) => [k, (boxes as Record<string, unknown>)[k]] as const).map(([k, v]) => (
              <tr key={k} className="border-t border-[#2A2A2A]">
                <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap tabular-nums">{boxCode(k)}</td>
                <td className="py-1.5 pr-3 text-gray-300">{t(`${labelPrefix ?? ''}${k}`, '')}</td>
                <td className="py-1.5 text-right text-white tabular-nums">{valueText(lang, v, pkg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Array.isArray(list) && (
        list.length === 0 ? <p className="text-sm text-gray-500">{t('no_rows')}</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400">
                  {Object.keys(list[0] as Record<string, unknown>).map((k) => <th key={k} className="px-2 py-1 font-normal whitespace-nowrap">{t(`res_${k}`, k)}</th>)}
                </tr>
              </thead>
              <tbody>
                {(list as Array<Record<string, unknown>>).map((r, i) => (
                  <tr key={i} className="border-t border-[#2A2A2A]">
                    {Object.keys(list[0] as Record<string, unknown>).map((k) => (
                      <td key={k} className={`px-2 py-1.5 text-gray-200 whitespace-nowrap ${isAmount(r[k]) ? 'text-right tabular-nums' : ''} ${r[k] === 'mismatch' ? 'text-red-400' : r[k] === 'ok' ? 'text-emerald-400' : ''}`}>{valueText(lang, r[k], pkg)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function CompareView({ lang, confirmed, draft, table, labelPrefix }: { lang: WorkLang; confirmed: unknown; draft: unknown; table: string; labelPrefix: string }) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const a = (getPath(confirmed, table) ?? {}) as Record<string, unknown>
  const b = (getPath(draft, table) ?? {}) as Record<string, unknown>
  const rest = Object.entries((draft ?? confirmed ?? {}) as Record<string, unknown>).filter(([k, v]) => k !== table && (v === null || typeof v !== 'object'))
  return (
    <div className="space-y-3">
      {rest.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rest.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-gray-400">{t(`res_${k}`, k)}</dt>
              <dd className="text-gray-100">{valueText(lang, v, pkg)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full max-w-xl text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400">
              <th className="py-1 pr-3 font-normal" colSpan={2} />
              <th className="py-1 pr-3 font-normal text-right whitespace-nowrap">{t('preview_confirmed')}</th>
              <th className="py-1 font-normal text-right whitespace-nowrap">{t('preview_draft')}</th>
            </tr>
          </thead>
          <tbody>
            {boxOrder(Object.keys(draft ? b : a)).map((k) => (
              <tr key={k} className="border-t border-[#2A2A2A]">
                <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap tabular-nums">{boxCode(k)}</td>
                <td className="py-1.5 pr-3 text-gray-300">{t(`${labelPrefix}${k}`, '')}</td>
                <td className="py-1.5 pr-3 text-right text-white tabular-nums">{valueText(lang, a[k], pkg)}</td>
                <td className={`py-1.5 text-right tabular-nums ${draft && a[k] !== b[k] ? 'text-amber-300' : 'text-gray-400'}`}>{draft ? valueText(lang, b[k], pkg) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function TaskPanel({ api, files, lang, projectId, task, appTemplate, modules, readOnly, onChanged, refresh = 0, onOpenSheet, choices = [], onChoose, onGoto }: Props) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const base = `/projects/${projectId}/tasks/${task.id}`
  const calcInput = appTemplate?.hasCalc ? appTemplate.ui.calcInput : []
  const checks = (appTemplate?.ui.taskChecks ?? []).filter((c) => modules.includes(c.module))
  const [statusNow, setStatusNow] = useState<string | null>(null)
  useEffect(() => { setStatusNow(null) }, [task.status])
  const status = statusNow ?? task.status
  const submitted = status === 'submitted'
  const awaiting = status === 'awaiting'

  const [approvalRaw, setApproval] = useState<TaskApproval | null | undefined>(undefined)
  const approvalSeq = useRef(0)
  const [rejectReason, setRejectReason] = useState('')

  const [values, setValues] = useState<FieldValues>({})
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [checkOut, setCheckOut] = useState<Record<string, unknown>>({})
  const [subs, setSubs] = useState<SubmissionItem[] | null>(null)
  const [openSub, setOpenSub] = useState<{ id: string; view: SubmissionView } | null>(null)
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState<'submit' | 'warn' | 'unlock' | 'approve' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadSubs = useCallback(async () => {
    try { setSubs((await api<{ submissions: SubmissionItem[] }>('GET', `${base}/submissions`)).submissions) } catch (e) { setError(errorText(lang, e, pkg)) }
  }, [api, base, lang, pkg])
  useEffect(() => { void loadSubs() }, [loadSubs, refresh])
  const loadApproval = useCallback(async () => {
    const my = ++approvalSeq.current
    try {
      const a = await api<TaskApproval>('GET', `${base}/approval`)
      if (my === approvalSeq.current) setApproval(a)
    } catch (e) {
      if (my === approvalSeq.current) { setApproval((prev) => (prev === undefined ? null : prev)); setError(errorText(lang, e, pkg)) }
    }
  }, [api, base, lang, pkg])
  const approval = approvalRaw && approvalRaw.status !== status ? undefined : approvalRaw
  const resetApproval = () => { approvalSeq.current++ }
  useEffect(() => { void loadApproval() }, [loadApproval, refresh, status])
  const viaApproval = approval?.can.request === true

  const [refStatus, setRefStatus] = useState<TaskReferenceStatus | null>(null)
  const refSeq = useRef(0)
  const loadRefStatus = useCallback(async () => {
    const my = ++refSeq.current
    if (!submitted) { setRefStatus(null); return }
    try {
      const s = (await api<{ status: TaskReferenceStatus | null }>('GET', `${base}/references`)).status
      if (my === refSeq.current) setRefStatus(s)
    } catch (e) { if (my === refSeq.current) setError(errorText(lang, e, pkg)) }
  }, [api, base, lang, submitted, pkg])
  useEffect(() => { void loadRefStatus() }, [loadRefStatus, refresh])

  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null)
  useEffect(() => {
    let live = true
    api<{ items: ChecklistItem[] }>('GET', `${base}/checklist`).then((r) => { if (live) setChecklist(r.items) }).catch((e) => { if (live) { setChecklist([]); setError(errorText(lang, e, pkg)) } })
    return () => { live = false }
  }, [api, base, lang, refresh, pkg])

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setError(null); setNotice(null)
    try { await fn() } catch (e) { setError(errorText(lang, e, pkg)) } finally { setBusy(null) }
  }
  const proofs = submitted ? (subs?.[0]?.proofs ?? []) : []
  const proofInput = useRef<HTMLInputElement>(null)
  const addProof = (f: File | undefined) => { if (f) void run('proof', async () => {
    const saved = await files.upload(projectId, f, 'report')
    await api('POST', `${base}/proof`, { fileId: saved.id })
    await loadSubs()
  }) }
  const removeProof = (fileId: string) => run(`proof:${fileId}`, async () => {
    await api('DELETE', `${base}/proof`, { fileId })
    await loadSubs()
  })

  const moduleInput = () => (calcInput.length ? fieldsToValues(calcInput, values) : undefined)
  const inputReady = fieldsComplete(calcInput, values)

  const previewSeq = useRef(0)
  useEffect(() => { previewSeq.current++; setConfirming((c) => (c === 'unlock' ? c : null)) }, [refresh])
  const doPreview = () => run('preview', async () => {
    const my = ++previewSeq.current
    const p = await api<PreviewResult>('POST', `${base}/preview`, { moduleInput: moduleInput() })
    if (my === previewSeq.current) setPreview(p)
  })
  const autoKey = `${refresh}:${JSON.stringify(values)}`
  const autoDone = useRef<string | null>(null)
  useEffect(() => {
    if (status !== 'open' || !appTemplate?.hasCalc || !inputReady || busy || autoDone.current === autoKey) return
    autoDone.current = autoKey
    void doPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, inputReady, status, busy])
  const startSubmit = () => run('submit', async () => {
    const p = await api<PreviewResult>('POST', `${base}/preview`, { moduleInput: moduleInput() })
    setPreview(p)
    if (p.unconfirmedCount > 0) { setConfirming(null); setError(t('preview_unconfirmed').replace('{n}', String(p.unconfirmedCount))); return }
    setConfirming(p.warnings?.length ? 'warn' : 'submit')
  })
  const doSubmit = () => run('submit', async () => {
    setConfirming(null)
    if (approval === undefined) return
    const seenWarningsDigest = preview?.warningsDigest ?? null
    const input = { ...(calcInput.length ? { moduleInput: moduleInput() } : {}), seenWarningsDigest }
    let r: { number: number }
    try {
      if (viaApproval) {
        await api('POST', `${base}/approval`, { action: 'request', ...input })
        resetApproval()
        setNotice(t('appr_requested'))
        setPreview(null)
        setStatusNow('awaiting')
        onChanged()
        return
      }
      r = await api<{ number: number }>('POST', `${base}/submit`, input)
    } catch (e) {
      if (e instanceof WorkApiError && e.code === 'STALE') {
        const p = await api<PreviewResult>('POST', `${base}/preview`, { moduleInput: moduleInput() })
        setPreview(p)
        setConfirming(p.warnings?.length ? 'warn' : 'submit')
        setNotice(t('submit_warn_changed'))
        return
      }
      throw e
    }
    setNotice(t('submitted_as').replace('{n}', String(r.number)))
    resetApproval()
    setPreview(null)
    setStatusNow('submitted')
    await loadSubs()
    onChanged()
  })
  const doUnlock = () => run('unlock', async () => {
    setConfirming(null)
    await api('POST', `${base}/unlock`, reason.trim() ? { reason: reason.trim() } : {})
    resetApproval()
    setReason('')
    setNotice(t('unlocked'))
    setStatusNow('open')
    onChanged()
  })
  const doApproval = (action: 'approve' | 'reject' | 'cancel') => run(`appr:${action}`, async () => {
    setConfirming(null)
    const r = await api<{ number?: number }>('POST', `${base}/approval`, action === 'reject' ? { action, reason: rejectReason.trim() } : { action })
    resetApproval()
    setRejectReason('')
    if (action === 'approve') {
      setNotice(t('appr_approved_as').replace('{n}', String(r.number ?? '')))
      setStatusNow('submitted')
      await loadSubs()
    } else {
      setNotice(t(action === 'reject' ? 'appr_rejected' : 'appr_cancelled'))
      setStatusNow('open')
    }
    onChanged()
  })
  const who = (owner: boolean, name: string | null, mine = false) => (mine ? t('appr_you') : owner ? t('appr_owner') : name ?? '?')
  const doCheck = (module: string) => run(`check:${module}`, async () => {
    const r = await api<{ output: unknown }>('POST', `/projects/${projectId}/modules/${encodeURIComponent(module)}`, { input: { taskId: task.id } })
    setCheckOut((x) => ({ ...x, [module]: r.output }))
  })
  const doAck = () => run('ack', async () => {
    if (!refStatus) return
    try {
      await api('POST', `${base}/references`, { digest: refStatus.digest })
      setNotice(t('ref_acked'))
    } catch (e) {
      if (e instanceof WorkApiError && e.code === 'STALE') { await loadRefStatus(); throw new WorkApiError('STALE', undefined) }
      throw e
    }
    await loadRefStatus()
  })
  const taskChangeText = (c: TaskReferenceStatus['tasks'][number]) => {
    const what = !c.now ? t('ref_task_gone') : c.now.status === 'open' ? t('ref_task_unlocked') : t('ref_task_resubmitted').replace('{n}', String(c.now.number ?? ''))
    return `${c.sourceName}${c.title ? ` · ${c.title}` : ''} — ${what}`
  }

  const showSub = (id: string) => run(`sub:${id}`, async () => {
    setOpenSub(openSub?.id === id ? null : { id, view: await api<SubmissionView>('GET', `${base}/submissions/${id}`) })
  })

  const btn = 'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md disabled:opacity-40'
  const spin = (what: string) => (busy === what ? <Loader2 className="w-4 h-4 animate-spin" /> : null)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        {choices.length > 1 && onChoose ? (
          <select value={task.id} onChange={(e) => onChoose(e.target.value)} className="rounded-md bg-[#2A2A2A] border border-[#3A3A3A] px-2 py-1 text-sm text-white" aria-label={t('report_choose')}>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        ) : (
          <h2 className="font-medium">{task.title}</h2>
        )}
        <span className="text-xs text-gray-400">{task.periodStart ? `${task.periodStart} – ${task.periodEnd}` : t('period_none')}</span>
        {awaiting ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/60 text-sky-300">{t('task_awaiting')}</span>
        ) : (!submitted || subs !== null) && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${!submitted ? 'bg-[#2A2A2A] text-gray-400' : proofs.length ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/50 text-amber-300'}`}>
            {!submitted ? t('task_open') : proofs.length ? t('task_closed') : t('task_closed_no_proof')}
          </span>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}

      {status === 'open' && checklist && checklist.length > 0 && (() => {
        const known = checklist.reduce((n, x) => n + (x.state !== 'todo' ? 0 : x.id === 'tx_confirm' || x.id === 'invoices_confirm' ? Number(x.params?.n ?? 0) : x.id === 'basis_confirm' ? 1 : 0), 0)
        const extra = preview ? Math.max(0, preview.unconfirmedCount - known) : 0
        const items: ChecklistItem[] = [
          ...checklist,
          ...(calcInput.length ? [{ id: 'input', state: inputReady ? 'ok' as const : 'todo' as const }] : []),
          ...(extra > 0 ? [{ id: 'unconfirmed', state: 'todo' as const, params: { n: extra } }] : []),
        ]
        const left = items.filter((x) => x.state === 'todo').length
        return (
          <section className="space-y-2">
            <h3 className="text-sm text-gray-300">{left ? t('checklist_left').replace('{n}', String(left)) : preview || !appTemplate?.hasCalc ? t('checklist_ready') : t('checklist_checking')}</h3>
            <ul className="space-y-1.5">
              {items.map((it) => {
                let text = t(`check_${it.id}_${it.state}`)
                for (const [k, v] of Object.entries(it.params ?? {})) text = text.replace(`{${k}}`, String(v))
                return (
                  <li key={it.id} className="flex items-start gap-2 text-sm">
                    {it.state === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
                      : it.state === 'warn' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                      : <Circle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />}
                    <span className={it.state === 'ok' ? 'text-gray-400' : 'text-gray-100'}>
                      {text}
                      {checks.find((c) => c.module === CHECK_OF[it.id]) && (
                        <button onClick={() => checkOut[CHECK_OF[it.id]] !== undefined ? setCheckOut((x) => { const n = { ...x }; delete n[CHECK_OF[it.id]]; return n }) : void doCheck(CHECK_OF[it.id])} disabled={!!busy} className="ml-2 text-xs text-gray-500 hover:text-white">
                          {spin(`check:${CHECK_OF[it.id]}`) ?? (checkOut[CHECK_OF[it.id]] !== undefined ? t('check_hide') : t('check_details'))}
                        </button>
                      )}
                      {checkOut[CHECK_OF[it.id]] !== undefined && (
                        <span className="block mt-2"><ResultView lang={lang} value={checkOut[CHECK_OF[it.id]]} listPath={checks.find((c) => c.module === CHECK_OF[it.id])!.table} /></span>
                      )}
                    </span>
                    {it.state !== 'ok' && it.goto && onGoto && (
                      <button onClick={() => onGoto(it.goto!)} className="ml-auto shrink-0 text-xs text-[#E07B53] hover:underline">{t('check_goto')}</button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })()}

      {status === 'open' && (
        <section className="space-y-3">
          <h3 className="text-sm text-gray-300">{appTemplate?.hasCalc ? t('calc_title') : t('submit_title')}</h3>
          {calcInput.length > 0 && (
            <div className="space-y-3 max-w-sm">
              <AppTemplateFields lang={lang} prefix="in_" fields={calcInput} values={values} onChange={(n, v) => { previewSeq.current++; setValues((x) => ({ ...x, [n]: v })); setPreview(null) }} idPrefix={`task-${task.id}`} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {appTemplate?.hasCalc && (
              <button onClick={() => void doPreview()} disabled={!!busy || !inputReady} className={`${btn} bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]`}>
                {spin('preview') ?? <Eye className="w-4 h-4" />} {t('preview')}
              </button>
            )}
            {!readOnly && (
              <button onClick={() => void startSubmit()} disabled={!!busy || !inputReady || approval === undefined} className={`${btn} bg-[#E07B53] text-white hover:opacity-90`}>
                {spin('submit') ?? (viaApproval ? <Stamp className="w-4 h-4" /> : <Send className="w-4 h-4" />)} {viaApproval ? t('appr_request') : appTemplate?.hasCalc ? t('close_return') : t('submit')}
              </button>
            )}
          </div>
          {viaApproval && !readOnly ? <p className="text-xs text-gray-500">{t('appr_request_help')}</p> : appTemplate?.hasCalc && !readOnly && <p className="text-xs text-gray-500">{t('close_return_help')}</p>}
          {preview && (
            <div className="rounded-lg border border-[#2A2A2A] p-3 space-y-3">
              <p className="text-xs text-gray-500">{t('preview_note')}</p>
              {preview.unconfirmedCount > 0 && <p className="text-sm text-amber-300">{t('preview_unconfirmed').replace('{n}', String(preview.unconfirmedCount))}</p>}
              {!!preview.aiConfirmed && <p className="text-sm text-sky-300">{t('preview_ai_confirmed').replace('{n}', String(preview.aiConfirmed))}</p>}
              {preview.twoWay && (() => {
                const ds = (preview.output as { draftStopped?: { code: string; params?: Record<string, string | number>; detail?: string } }).draftStopped
                if (!ds) return null
                const why = workStopText(lang, ds, pkg) ?? `${t(`err_${ds.code}`, t('err_INTERNAL'))}${ds.detail ? ` (${ds.detail})` : ''}`
                return <p className="text-sm text-amber-300 whitespace-pre-line">{t('preview_draft_stopped')}{'\n'}{why}</p>
              })()}
              {preview.twoWay && appTemplate?.ui.resultTable ? (
                <CompareView lang={lang} confirmed={(preview.output as { confirmed: unknown }).confirmed} draft={(preview.output as { draft: unknown }).draft} table={appTemplate.ui.resultTable.path} labelPrefix={appTemplate.ui.resultTable.labelPrefix} />
              ) : (
                <ResultView lang={lang} value={preview.output} table={appTemplate?.ui.resultTable?.path} labelPrefix={appTemplate?.ui.resultTable?.labelPrefix} />
              )}
            </div>
          )}
        </section>
      )}

      {awaiting && approval?.request && (
        <section className="rounded-lg border border-sky-800/60 bg-sky-950/30 p-3 space-y-3">
          <h3 className="text-sm text-sky-300 flex items-center gap-1"><Stamp className="w-4 h-4" /> {t('appr_waiting_title')}</h3>
          <p className="text-sm text-gray-200">
            {t('appr_requested_by')
              .replace('{who}', who(approval.request.byOwner, approval.request.byName, approval.request.mine))
              .replace('{when}', new Date(approval.request.at).toLocaleString(lang === 'ko' ? 'ko-KR' : lang === 'de' ? 'de-CH' : lang === 'fr' ? 'fr-CH' : 'en-GB'))}
          </p>
          {!approval.applies && <p className="text-sm text-amber-300">{t('appr_off_notice')}</p>}
          {approval.applies && !approval.can.approve && <p className="text-xs text-gray-500">{t('appr_not_you')}</p>}
          {(
            <div className="space-y-2">
              {approval.can.approve && !readOnly && (
                <button onClick={() => setConfirming('approve')} disabled={!!busy} className={`${btn} bg-[#E07B53] text-white hover:opacity-90`}>
                  {spin('appr:approve') ?? <CheckCheck className="w-4 h-4" />} {t('appr_approve')}
                </button>
              )}
              {approval.can.reject && (
                <div className="space-y-2">
                  <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} maxLength={1000} rows={2} placeholder={t('appr_reject_reason')} className={`${fieldInputCls} block max-w-md`} autoComplete="off" />
                  <button onClick={() => void doApproval('reject')} disabled={!!busy || !rejectReason.trim()} className={`${btn} bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]`}>
                    {spin('appr:reject') ?? <XCircle className="w-4 h-4" />} {t('appr_reject')}
                  </button>
                </div>
              )}
              {approval.can.cancel && (
                <button onClick={() => void doApproval('cancel')} disabled={!!busy} className={`${btn} bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]`}>
                  {spin('appr:cancel') ?? <Undo2 className="w-4 h-4" />} {t('appr_cancel')}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {refStatus?.hasReferences && (
        refStatus.flagged ? (
          <section className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 space-y-2">
            <h3 className="text-sm text-amber-300 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> {t('ref_changed_title')}</h3>
            <p className="text-xs text-gray-400">{t('ref_changed_help')}</p>
            <ul className="list-disc pl-5 space-y-0.5 text-sm text-gray-200">
              {refStatus.tasks.map((c, i) => <li key={i}>{taskChangeText(c)}</li>)}
              {refStatus.rowsChanged > 0 && <li>{t('ref_rows_changed').replace('{n}', String(refStatus.rowsChanged))}</li>}
              {refStatus.rowsGone > 0 && <li>{t('ref_rows_gone').replace('{n}', String(refStatus.rowsGone))}</li>}
              {refStatus.pairsChanged > 0 && <li>{t('ref_pairs_changed').replace('{n}', String(refStatus.pairsChanged))}</li>}
            </ul>
            {!readOnly && (
              <button onClick={() => void doAck()} disabled={!!busy} className={`${btn} bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]`}>
                {spin('ack') ?? <CheckCheck className="w-4 h-4" />} {t('ref_ack')}
              </button>
            )}
          </section>
        ) : (
          <p className="text-xs text-gray-500">{t(refStatus.differs ? 'ref_changed_checked' : 'ref_unchanged')}</p>
        )
      )}

      {submitted && subs !== null && (
        <section className="space-y-2">
          <h3 className="text-sm text-gray-300">{t('proof_title')}</h3>
          <p className="text-xs text-gray-500">{t('proof_help')}</p>
          {proofs.length > 0 && (
            <ul className="space-y-1">
              {proofs.map((p) => (
                <li key={p.fileId} className="flex items-center gap-2 text-sm">
                  <button onClick={() => void files.open(projectId, p.fileId).catch((e) => setError(errorText(lang, e, pkg)))} className="text-[#E07B53] hover:underline truncate">{p.name}</button>
                  {!readOnly && <button onClick={() => void removeProof(p.fileId)} disabled={!!busy} className="text-xs text-gray-500 hover:text-red-400">{spin(`proof:${p.fileId}`) ?? t('proof_remove')}</button>}
                </li>
              ))}
            </ul>
          )}
          {!readOnly && (
            <>
              <input ref={proofInput} type="file" hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => { addProof(e.target.files?.[0]); e.target.value = '' }} />
              <button onClick={() => proofInput.current?.click()} disabled={!!busy} className={`${btn} bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]`}>
                {spin('proof') ?? <Send className="w-4 h-4 rotate-[-90deg]" />} {proofs.length ? t('proof_add_more') : t('proof_add')}
              </button>
            </>
          )}
        </section>
      )}

      {submitted && !readOnly && (
        <section className="space-y-2">
          <h3 className="text-sm text-gray-300 flex items-center gap-1"><Lock className="w-4 h-4" /> {t('locked_task')}</h3>
          {approval?.seal && (
            <p className="text-xs text-sky-300">{t('appr_seal').replace('{p}', who(approval.seal.preparedByOwner, approval.seal.preparedBy)).replace('{a}', who(approval.seal.approvedByOwner, approval.seal.approvedBy))}</p>
          )}
          {approval === undefined ? null : approval && !approval.can.unlock ? (
            <p className="text-xs text-gray-500">{t('appr_unlock_only_approver')}</p>
          ) : (<>
          <p className="text-xs text-gray-500">{t('unlock_help')}</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2} placeholder={t('unlock_reason')} className={`${fieldInputCls} block max-w-md`} autoComplete="off" />
          <button onClick={() => setConfirming('unlock')} disabled={!!busy} className={`${btn} bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]`}>
            {spin('unlock') ?? <LockOpen className="w-4 h-4" />} {t('unlock')}
          </button>
          </>)}
        </section>
      )}

      {checks.length > 0 && !(checklist && checklist.length > 0 && status === 'open') && (
        <section className="space-y-3">
          <h3 className="text-sm text-gray-300">{t('checks_title')}</h3>
          {checks.map((c) => (
            <div key={c.module} className="space-y-2">
              <button onClick={() => void doCheck(c.module)} disabled={!!busy} className={`${btn} bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]`}>
                {spin(`check:${c.module}`) ?? <ShieldCheck className="w-4 h-4" />} {t(`mod_${c.module}`, c.module)}
              </button>
              {checkOut[c.module] !== undefined && <ResultView lang={lang} value={checkOut[c.module]} listPath={c.table} />}
            </div>
          ))}
        </section>
      )}

      {subs !== null && subs.length > 0 && (
      <section className="space-y-2">
        <h3 className="text-sm text-gray-300">{t('submissions_title')}</h3>
        {(
          <ul className="space-y-1">
            {subs.map((s) => (
              <li key={s.id}>
                <button onClick={() => void showSub(s.id)} className="text-sm text-gray-200 hover:text-white">
                  #{s.number} · {new Date(s.submittedAt).toLocaleString(lang === 'ko' ? 'ko-KR' : lang === 'de' ? 'de-CH' : lang === 'fr' ? 'fr-CH' : 'en-GB')}
                </button>
                {openSub?.id === s.id && openSub.view.result && (
                  <div className="mt-2 mb-3 rounded-lg border border-[#2A2A2A] p-3">
                    <ResultView lang={lang} value={openSub.view.result.output ?? openSub.view.result} table={appTemplate?.ui.resultTable?.path} labelPrefix={appTemplate?.ui.resultTable?.labelPrefix} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {confirming === 'warn' && approval !== undefined && preview?.warnings?.length ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirming(null)}>
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-lg bg-[#232323] border border-[#3A3A3A]" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-[#3A3A3A] space-y-1">
              <h3 className="text-base text-amber-300">{t('submit_warn_title').replace('{n}', String(preview.warningsTotal ?? preview.warnings.length))}</h3>
              <p className="text-sm text-gray-300">{t('submit_warn_help')}</p>
            </div>
            <ul className="flex-1 min-h-0 overflow-auto p-4 space-y-1 text-sm">
              {preview.warnings.map((w) => (
                <li key={w.rowId} className="flex flex-wrap gap-x-2 text-gray-200">
                  <span className="tabular-nums text-gray-400">{String(w.summary.date ?? '')}</span>
                  <span className="tabular-nums">{w.summary.direction === 'in' ? '+' : w.summary.direction === 'out' ? '−' : ''}{String(w.summary.amount ?? '')} {String(w.summary.currency ?? '')}</span>
                  <span className="truncate max-w-[14rem]">{String(w.summary.counterparty ?? '')}</span>
                  <span className="text-amber-300">{t(`submit_warn_${w.code}`, w.code)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2 p-4 border-t border-[#3A3A3A]">
              <button onClick={() => setConfirming(null)} className="px-3 py-1.5 text-sm rounded-md text-gray-300 hover:text-white">{t('cancel')}</button>
              {onOpenSheet && (
                <button onClick={() => { setConfirming(null); onOpenSheet(preview.warnings![0].sheetId) }} className="px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]">{t('submit_warn_fix')}</button>
              )}
              <button onClick={() => void doSubmit()} disabled={!!busy} className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">{t('submit_warn_anyway')}</button>
            </div>
          </div>
        </div>
      ) : null}
      {confirming === 'approve' && (
        <ConfirmDialog message={t('appr_approve_confirm')} okLabel={t('appr_approve')} cancelLabel={t('cancel')} busy={!!busy} tone="primary" onOk={() => void doApproval('approve')} onCancel={() => setConfirming(null)} />
      )}
      {confirming === 'submit' && approval !== undefined && (
        <ConfirmDialog message={viaApproval ? t('appr_request_confirm') : appTemplate?.hasCalc ? t('close_return_confirm') : t('submit_confirm')} okLabel={viaApproval ? t('appr_request') : appTemplate?.hasCalc ? t('close_return') : t('submit')} cancelLabel={t('cancel')} busy={!!busy} tone="primary" onOk={() => void doSubmit()} onCancel={() => setConfirming(null)} />
      )}
      {confirming === 'unlock' && (
        <ConfirmDialog message={t('unlock_confirm')} okLabel={t('unlock')} cancelLabel={t('cancel')} busy={!!busy} tone="primary" onOk={() => void doUnlock()} onCancel={() => setConfirming(null)} />
      )}
    </div>
  )
}
