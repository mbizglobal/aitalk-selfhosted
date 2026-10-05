'use client'

import React, { useState } from 'react'
import { Clock, X } from 'lucide-react'
import { APP_TEMPLATE_FEATURES, featureLabel } from '@/lib/work/app-template-features'
import { isAppTemplateKind } from '@/lib/work/app-template-kinds'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { AppTemplatePeriodRule, AppTemplateScreen } from '../lib/api'
import { AppTemplateFields, fieldsComplete, fieldsToValues, type FieldValues } from './AppTemplateFields'

const inputCls = 'w-full rounded-md bg-[#2A2A2A] border border-[#3A3A3A] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E07B53]'

function Shell({ title, closeLabel, onClose, children, footer }: { title: string; closeLabel: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[90dvh] flex flex-col rounded-t-xl sm:rounded-xl bg-[#1E1E1E] border border-[#2A2A2A]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
          <h2 className="text-white font-medium">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label={closeLabel}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3">{children}</div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#2A2A2A]">{footer}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  )
}

function valuesToFields(fields: readonly AppTemplateScreen['ui']['settings'][number][], v: Record<string, unknown>): FieldValues {
  const out: FieldValues = {}
  for (const f of fields) {
    const x = v[f.name]
    if (x === undefined || x === null) continue
    out[f.name] = f.type === 'boolean' ? (x === true ? 'yes' : x === false ? 'no' : '') : String(x)
  }
  return out
}

export function ApplyTemplateDialog({ lang, appTemplate, settings, busy, error, onApply, onClose }: { lang: WorkLang; appTemplate: AppTemplateScreen; settings: Record<string, unknown>; busy: boolean; error: string | null; onApply: (settings: Record<string, unknown>, modules: string[] | undefined) => void; onClose: () => void }) {
  const t = (k: string) => workT(lang, k)
  const [values, setValues] = useState<FieldValues>(() => valuesToFields(appTemplate.ui.settings, settings))
  const features = isAppTemplateKind(appTemplate.kind) ? APP_TEMPLATE_FEATURES[appTemplate.kind] : null
  const modules = features?.available.filter((f) => f.module) ?? []
  const [picked, setPicked] = useState<Set<string>>(() => new Set(modules.map((m) => m.id)))
  const ok = fieldsComplete(appTemplate.ui.settings, values)
  const title = workT(lang, `kind_${appTemplate.kind}`, appTemplate.kind)
  return (
    <Shell
      title={t('start_template_title').replace('{template}', title)}
      closeLabel={t('close')}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} disabled={busy} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('cancel')}</button>
        <button disabled={busy || !ok} onClick={() => onApply(fieldsToValues(appTemplate.ui.settings, values), features ? [...picked] : undefined)} className="px-3 py-2 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">{t('start_template_ok')}</button>
      </>}
    >
      {features && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-white">{t('start_step_modules')}</h3>
          <p className="text-xs text-gray-400">{t('start_step_modules_help')}</p>
          <ul className="space-y-1.5">
            {modules.map((m) => {
              const required = m.id === appTemplate.calcModuleId
              const extras = features.available.filter((f) => f.partOf === m.id)
              return (
                <li key={m.id}>
                  <label className={`flex items-start gap-2 rounded-md border border-[#2A2A2A] px-3 py-2 ${required ? 'opacity-80' : 'cursor-pointer hover:border-[#3A3A3A]'}`}>
                    <input type="checkbox" className="mt-0.5 accent-[#E07B53]" checked={required || picked.has(m.id)} disabled={required || busy}
                      onChange={(e) => setPicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n })} />
                    <span className="min-w-0">
                      <span className="block text-sm text-white">{featureLabel(m, lang)}{required && <span className="ml-2 text-[11px] text-gray-400">{t('module_required_short')}</span>}</span>
                      {extras.map((x) => <span key={x.id} className="block text-xs text-gray-500">+ {featureLabel(x, lang)}</span>)}
                    </span>
                  </label>
                </li>
              )
            })}
            {features.planned.map((f) => (
              <li key={f.id} className="flex items-start gap-2 rounded-md border border-dashed border-[#2A2A2A] px-3 py-2 text-sm text-gray-500">
                <Clock className="w-3.5 h-3.5 mt-1 shrink-0" />
                <span>{featureLabel(f, lang)} <span className="text-[11px]">· {t('app_template_planned')}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {appTemplate.ui.settings.length > 0 && (
        <section className="space-y-2 pt-2 border-t border-[#2A2A2A]">
          <h3 className="text-sm font-medium text-white pt-2">{t('start_step_settings')}</h3>
          <AppTemplateFields lang={lang} prefix="set_" fields={appTemplate.ui.settings} values={values} onChange={(n, v) => setValues((x) => ({ ...x, [n]: v }))} idPrefix="apply-template" />
        </section>
      )}
      <p className="text-xs text-gray-500">{t('start_template_note')}</p>
      {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
    </Shell>
  )
}

export interface NewTaskInput { title: string; periodStart: string | null; periodEnd: string | null }

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m = 1..12

export function periodOf(rule: AppTemplatePeriodRule, year: number, n: number): NewTaskInput {
  if (rule === 'quarter') {
    const m0 = (n - 1) * 3 + 1
    return { title: `${year} Q${n}`, periodStart: `${year}-${pad(m0)}-01`, periodEnd: `${year}-${pad(m0 + 2)}-${lastDay(year, m0 + 2)}` }
  }
  if (rule === 'month') return { title: `${year}-${pad(n)}`, periodStart: `${year}-${pad(n)}-01`, periodEnd: `${year}-${pad(n)}-${lastDay(year, n)}` }
  return { title: String(year), periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` }
}

export function NewTaskDialog({ lang, period, busy, error, onCreate, onClose }: { lang: WorkLang; period: AppTemplatePeriodRule; busy: boolean; error: string | null; onCreate: (t: NewTaskInput) => void; onClose: () => void }) {
  const t = (k: string) => workT(lang, k)
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [n, setN] = useState(period === 'quarter' ? Math.floor(now.getMonth() / 3) + 1 : now.getMonth() + 1)
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const ruled = period !== 'custom'
  const validYear = Number.isInteger(year) && year >= 2000 && year <= 2100
  const input: NewTaskInput = ruled ? periodOf(period, year, n) : { title: title.trim(), periodStart: start || null, periodEnd: end || null }
  const ok = input.title !== '' && (!ruled || validYear) && (input.periodStart === null) === (input.periodEnd === null)
    && (input.periodStart === null || input.periodStart <= input.periodEnd!)
  return (
    <Shell
      title={t('new_task')}
      closeLabel={t('close')}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} disabled={busy} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('cancel')}</button>
        <button disabled={busy || !ok} onClick={() => onCreate(input)} className="px-3 py-2 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">{t('create')}</button>
      </>}
    >
      {ruled ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('year')}>
            <input type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(Number(e.target.value))} className={inputCls} />
          </Field>
          {period !== 'year' && (
            <Field label={period === 'quarter' ? t('quarter') : t('month')}>
              <select value={n} onChange={(e) => setN(Number(e.target.value))} className={inputCls}>
                {(period === 'quarter' ? [1, 2, 3, 4] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).map((q) => <option key={q} value={q}>{period === 'quarter' ? `Q${q}` : pad(q)}</option>)}
              </select>
            </Field>
          )}
          {validYear && <p className="col-span-2 text-xs text-gray-500">{input.title} · {input.periodStart} – {input.periodEnd}</p>}
        </div>
      ) : (
        <>
          <Field label={t('task_title')}><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={inputCls} autoComplete="off" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('period_start')}><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} /></Field>
            <Field label={t('period_end')}><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} /></Field>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
    </Shell>
  )
}
