'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { workStopText, workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type ImportPlan, type ImportReader, type SheetImport, type WorkApi, type WorkFiles } from '../lib/api'
import { fieldInputCls } from './AppTemplateFields'
import { errorText } from './SheetTable'

export interface ImportStart {
  fileId: string
  fileName: string
  reader: ImportReader
  accounts: Record<string, string>
  balances?: Record<string, { opening: string; closing: string }>
  label?: string
}

interface Props {
  api: WorkApi
  files: WorkFiles
  lang: WorkLang
  projectId: string
  spec: SheetImport
  accounts?: string[]
  start?: ImportStart
  onDone: (inserted: number) => void
  onClose: () => void
}

export function asCsv(f: File): File {
  if (f.type === 'text/csv') return f
  return /\.csv$/i.test(f.name) ? new File([f], f.name, { type: 'text/csv' }) : f
}

const PREVIEW_ROWS = 50
type Balances = Record<string, { opening: string; closing: string }>

export function ImportDialog({ api, files, lang, projectId, spec, accounts = [], start, onDone, onClose }: Props) {
  const t = (k: string, f?: string) => workT(lang, k, f)
  const [file, setFile] = useState<File | null>(null)
  const [fileId, setFileId] = useState<string | null>(start?.fileId ?? null)
  const [chosen, setChosen] = useState<Record<string, string>>(start?.accounts ?? {})
  const [balances, setBalances] = useState<Balances>(start?.balances ?? {})
  const [aiBalances, setAiBalances] = useState<Set<string>>(() => new Set(Object.keys(start?.balances ?? {})))
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [approve, setApprove] = useState(false)
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const seq = useRef(0)
  const picked = useRef<File | null>(null)
  picked.current = file
  const reader = start?.reader

  const moduleUrl = `/projects/${projectId}/modules/${encodeURIComponent(spec.module)}`
  const filledBalances = (b: Balances) => Object.fromEntries(Object.entries(b).filter(([, v]) => v.opening.trim() && v.closing.trim()).map(([k, v]) => [k, { opening: v.opening.trim(), closing: v.closing.trim() }]))
  const baseInput = (id: string, acc: Record<string, string>, bal: Balances) => {
    const b = filledBalances(bal)
    return { fileId: id, ...(reader ? { reader } : {}), ...(Object.keys(acc).length ? { accounts: acc } : {}), ...(Object.keys(b).length ? { balances: b } : {}) }
  }

  const makePlan = async (id: string, why: string | undefined, acc: Record<string, string>, bal: Balances) => {
    const my = ++seq.current
    setBusy('plan'); setError(null); setNotice(why ?? null); setApprove(false)
    try {
      const r = await api<{ output: ImportPlan }>('POST', moduleUrl, { input: { step: 'plan', ...baseInput(id, acc, bal) } })
      if (my !== seq.current) return
      setPlan(r.output)
      const next = { ...acc }
      for (const g of r.output.groups) if (g.accountKey && !next[g.id]) next[g.id] = g.accountKey
      setChosen(next)
    } catch (e) {
      if (my === seq.current) { setPlan(null); setError(errorText(lang, e)) }
    } finally {
      if (my === seq.current) setBusy(null)
    }
  }

  useEffect(() => {
    if (start) void makePlan(start.fileId, undefined, start.accounts, start.balances ?? {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickFile = async (f: File | null) => {
    setFile(f); setFileId(null); setPlan(null); setChosen({}); setBalances({}); setAiBalances(new Set()); setError(null); setNotice(null)
    if (!f) return
    const my = ++seq.current
    setBusy('plan')
    let id: string
    try {
      id = (await files.upload(projectId, asCsv(f), spec.fileKind)).id
    } catch (e) {
      if (my === seq.current) { setBusy(null); setError(errorText(lang, e)) }
      return
    }
    if (my !== seq.current || picked.current !== f) return
    setFileId(id)
    await makePlan(id, undefined, {}, {})
  }

  const chooseAccount = (groupId: string, accountKey: string) => {
    if (!fileId) return
    const next = { ...chosen, [groupId]: accountKey }
    if (!accountKey) delete next[groupId]
    setChosen(next)
    void makePlan(fileId, undefined, next, balances)
  }

  const doApply = async () => {
    if (!plan || !fileId) return
    const my = ++seq.current
    setBusy('apply'); setError(null); setNotice(null)
    try {
      const r = await api<{ output: { inserted: number } }>('POST', moduleUrl, {
        input: { step: 'apply', ...baseInput(fileId, chosen, balances), ...(start?.label ? { label: start.label } : {}), digest: plan.digest, ...(anyProblem ? { approve } : {}) },
      })
      if (my === seq.current) onDone(r.output.inserted)
    } catch (e) {
      if (my !== seq.current) return
      setBusy(null)
      if (e instanceof WorkApiError && e.code === 'STALE') { await makePlan(fileId, t('import_stale'), chosen, balances); return }
      setError(errorText(lang, e))
    }
  }

  const problemText = (p: ImportPlan['problems'][number]) => workStopText(lang, p) ?? p.text
  const groups = plan?.groups ?? []
  const totalInsert = groups.reduce((n, g) => n + (g.plan?.insert.length ?? 0), 0)
  const anyProblem = !!plan && (plan.problems.length > 0 || groups.some((g) => (g.plan?.problems.length ?? 0) > 0))
  const blocksOf = (g: ImportPlan['groups'][number]) => !!g.plan && (g.plan.balance.file === 'mismatch' || (g.plan.insert.length > 0 && (g.plan.balance.ledger !== 'ok' || (plan?.reader.type === 'recipe' && g.plan.balance.file !== 'ok'))))
  const balanceBlocks = groups.some(blocksOf)
  const missingAccount = groups.some((g) => !g.plan)
  const canApply = !!plan && totalInsert > 0 && !missingAccount && !balanceBlocks && (!anyProblem || approve)
  const dirText = (d: 'in' | 'out') => t(`imp_dir_${d}`, d)
  const statusText = (s: string) => t(`imp_bal_${s}`, s)
  const readerText = !plan ? null
    : plan.reader.type === 'ubs' ? t('import_reader_ubs')
      : plan.reader.saved ? t('import_reader_saved').replace('{label}', plan.reader.label ?? plan.reader.bank)
        : t('import_reader_new')

  const close = () => { if (busy !== 'apply') onClose() }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={close}>
      <div className="w-full sm:max-w-2xl max-h-[90dvh] flex flex-col rounded-t-xl sm:rounded-xl bg-[#1E1E1E] border border-[#2A2A2A]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
          <h2 className="text-white font-medium">{t(`mod_${spec.module}`, spec.module)}</h2>
          <button onClick={close} disabled={busy === 'apply'} className="text-gray-400 hover:text-white disabled:opacity-40" aria-label={t('close')}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-4">
          <p className="text-xs text-gray-500">{t('import_help')}</p>
          {start ? (
            <p className="text-sm text-gray-200">{t('import_file_from_chat').replace('{name}', start.fileName)}</p>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs text-gray-400">{t('import_file')}</span>
              <input
                type="file"
                accept={spec.accept}
                disabled={!!busy}
                onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-gray-300 file:mr-2 file:rounded-md file:border-0 file:bg-[#2A2A2A] file:px-3 file:py-1.5 file:text-white"
              />
            </label>
          )}
          {(start ? !!plan && groups.some((g) => g.candidates.length === 0) : accounts.length === 0) && <p className="text-sm text-amber-300">{t('import_no_accounts')}</p>}
          {busy === 'plan' && <p className="inline-flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> {t('import_plan')}</p>}
          {notice && <p className="text-sm text-amber-300">{notice}</p>}

          {plan && (
            <div className="space-y-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-gray-400">{t('import_reader')}</dt>
                <dd className="text-gray-100">{readerText}</dd>
                {plan.filtered > 0 && (<>
                  <dt className="text-gray-400">{t('import_filtered_label')}</dt>
                  <dd className="text-gray-100 tabular-nums">{t('import_filtered').replace('{n}', String(plan.filtered))}</dd>
                </>)}
              </dl>
              {plan.problems.length > 0 && (
                <ul className="list-disc pl-5 space-y-0.5 text-sm text-amber-200">
                  {plan.problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}
                </ul>
              )}

              {groups.map((g) => {
                const gp = g.plan
                const lockedExisting = gp?.existing.filter((e) => e.locked).length ?? 0
                const bal = balances[g.id] ?? { opening: '', closing: '' }
                return (
                  <div key={g.id} className="space-y-3 rounded-lg border border-[#2A2A2A] p-3">
                    <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
                      <p className="text-sm text-white font-medium">{g.currency}{g.account ? ` · ${g.account}` : ''}</p>
                      <label className="block space-y-1">
                        <span className="text-xs text-gray-400">{t('import_group_account')}</span>
                        <select value={chosen[g.id] ?? g.accountKey ?? ''} disabled={!!busy} onChange={(e) => chooseAccount(g.id, e.target.value)} className={fieldInputCls}>
                          <option value="">{t('choose')}</option>
                          {(g.candidates.length ? g.candidates : accounts).map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </label>
                    </div>

                    {g.needsBalances && (
                      <div className="space-y-2">
                        {aiBalances.has(g.id)
                          ? <p className="text-sm text-sky-300">{t('import_balances_from_ai')}</p>
                          : <p className="text-sm text-amber-300">{t('import_balances_need')}</p>}
                        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                          {(['opening', 'closing'] as const).map((k) => (
                            <label key={k} className="block space-y-1">
                              <span className="text-xs text-gray-400">{t(`bankf_${k}`)}</span>
                              <input inputMode="decimal" autoComplete="off" value={bal[k]} disabled={!!busy}
                                onChange={(e) => { setBalances({ ...balances, [g.id]: { ...bal, [k]: e.target.value } }); setAiBalances((s) => { const n = new Set(s); n.delete(g.id); return n }) }} className={fieldInputCls} />
                            </label>
                          ))}
                          <button onClick={() => fileId && void makePlan(fileId, undefined, chosen, balances)} disabled={!!busy || !bal.opening.trim() || !bal.closing.trim()}
                            className="px-3 py-2 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-40">{t('import_balances_check')}</button>
                        </div>
                      </div>
                    )}

                    {gp && (<>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                        <dt className="text-gray-400">{t('period')}</dt>
                        <dd className="text-gray-100">{gp.statement.from ?? '?'} – {gp.statement.until ?? '?'}</dd>
                        <dt className="text-gray-400">{t('import_rows_file')}</dt>
                        <dd className="text-gray-100 tabular-nums">{gp.statement.rows}</dd>
                        <dt className="text-gray-400">{t('import_rows_new')}</dt>
                        <dd className="text-white tabular-nums font-medium">{gp.insert.length}</dd>
                        {gp.classified > 0 && (<>
                          <dt className="text-gray-400">{t('import_rows_classified')}</dt>
                          <dd className="text-gray-100 tabular-nums">{gp.classified} <span className="text-xs text-gray-500">{t('import_classified_help')}</span></dd>
                        </>)}
                        <dt className="text-gray-400">{t('import_rows_existing')}</dt>
                        <dd className="text-gray-100 tabular-nums">{gp.existing.length}{lockedExisting ? ` (${t('import_locked_n').replace('{n}', String(lockedExisting))})` : ''}</dd>
                        <dt className="text-gray-400">{t('imp_bal_file_label')}</dt>
                        <dd className={gp.balance.file === 'ok' ? 'text-emerald-400' : 'text-amber-300'}>{statusText(gp.balance.file)}</dd>
                        <dt className="text-gray-400">{t('imp_bal_ledger_label')}</dt>
                        <dd className={gp.balance.ledger === 'ok' ? 'text-emerald-400' : gp.balance.ledger === 'skipped' ? 'text-gray-400' : 'text-amber-300'}>{statusText(gp.balance.ledger)}</dd>
                        <dt className="text-gray-400">{t('import_account_number')}</dt>
                        <dd className={gp.statement.accountNumberMatches === true ? 'text-emerald-400' : 'text-amber-300'}>
                          {gp.statement.accountNumberMatches === true ? t('imp_bal_ok') : gp.statement.accountNumberMatches === false ? t('import_account_number_differs') : t('import_account_number_unchecked')}
                        </dd>
                      </dl>

                      {gp.problems.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-sm text-amber-300">{t('import_problems').replace('{n}', String(gp.problems.length))}</p>
                          <ul className="list-disc pl-5 space-y-0.5 text-sm text-gray-200">
                            {gp.problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}
                          </ul>
                        </div>
                      )}

                      {gp.insert.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-400">
                                <th className="px-2 py-1 font-normal">{t('import_line')}</th>
                                <th className="px-2 py-1 font-normal">{t('imp_col_date')}</th>
                                <th className="px-2 py-1 font-normal">{t('imp_col_direction')}</th>
                                <th className="px-2 py-1 font-normal text-right">{t('imp_col_amount')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {gp.insert.slice(0, PREVIEW_ROWS).map((r) => (
                                <tr key={r.lineNo} className="border-t border-[#2A2A2A]">
                                  <td className="px-2 py-1 text-gray-400 tabular-nums">{r.lineNo}</td>
                                  <td className="px-2 py-1 text-gray-200 whitespace-nowrap">{r.date}</td>
                                  <td className="px-2 py-1 text-gray-200">{dirText(r.direction)}</td>
                                  <td className="px-2 py-1 text-right text-white tabular-nums">{r.amount}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {gp.insert.length > PREVIEW_ROWS && <p className="px-2 py-1 text-xs text-gray-500">{t('pair_more').replace('{n}', String(gp.insert.length - PREVIEW_ROWS))}</p>}
                        </div>
                      )}
                      {blocksOf(g) && !g.needsBalances && <p className="text-sm text-red-400">{t('import_balance_blocks')}</p>}
                    </>)}
                  </div>
                )
              })}

              {totalInsert === 0 && !missingAccount ? (
                <p className="text-sm text-gray-400">{t('import_nothing')}</p>
              ) : !balanceBlocks && !missingAccount && anyProblem && (
                <label className="flex items-start gap-2 text-sm text-gray-200">
                  <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="mt-0.5 accent-[#E07B53]" />
                  <span>{t('import_approve')}</span>
                </label>
              )}
              <p className="text-xs text-gray-500">{t('import_unconfirmed_note')}</p>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#2A2A2A]">
          <button onClick={close} disabled={busy === 'apply'} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('cancel')}</button>
          <button onClick={() => void doApply()} disabled={!!busy || !canApply} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
            {busy === 'apply' && <Loader2 className="w-4 h-4 animate-spin" />} {plan ? t('import_apply').replace('{n}', String(totalInsert)) : t('import_apply_plain')}
          </button>
        </div>
      </div>
    </div>
  )
}
