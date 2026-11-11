'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, ExternalLink, FileText, Image as ImageIcon, Loader2, RefreshCw, RotateCcw, Trash2, Upload } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { convertPdfToImages } from '@/lib/pdf-to-image'
import type { AppTemplateScreen, SheetScreen, SheetSummary, WorkApi, WorkFiles } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

type Design = NonNullable<AppTemplateScreen['ui']['design']>

interface Props {
  api: WorkApi
  files: WorkFiles
  lang: WorkLang
  projectId: string
  design: Design
  sheet: SheetSummary
  readOnly: boolean
  onOpenSheet: () => void
}

const HEX = /^#[0-9A-Fa-f]{6}$/
const cellText = (v: unknown) => (typeof v === 'string' ? v : v === true ? 'true' : typeof v === 'number' ? String(v) : '')

function contrastOnWhite(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05)
}

export function DesignPanel({ api, files, lang, projectId, design, sheet, readOnly, onOpenSheet }: Props) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [screen, setScreen] = useState<SheetScreen | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [narrowView, setNarrowView] = useState<'settings' | 'preview'>('settings')
  const [docLang, setDocLang] = useState('')
  const [docCurrency, setDocCurrency] = useState('')
  const [inlinePdf, setInlinePdf] = useState(true)
  const [pageImages, setPageImages] = useState<string[] | null>(null)
  useEffect(() => { setInlinePdf((navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false) }, [])
  const names = useMemo(() => design.fields.filter((f) => f.kind !== 'file').map((f) => f.name), [design])
  const valueFields = useMemo(() => design.fields.filter((f) => f.kind !== 'file'), [design])
  const [fileBusy, setFileBusy] = useState<string | null>(null)
  const [fileError, setFileError] = useState<{ field: string; text: string } | null>(null)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const row = screen?.rows[0] ?? null
  const saved = useMemo(() => Object.fromEntries(names.map((n) => [n, cellText(row?.data[n])])), [names, row])
  const logoColumn = screen?.image?.column ?? null
  const hasLogo = !!(logoColumn && row && typeof row.data[logoColumn] === 'string')
  const locked = readOnly || !row || !!row.locked || !!screen?.moduleOnly
  const frozen = locked || busy

  const load = async () => {
    try {
      setLoadError(null)
      const s = await api<SheetScreen>('GET', `/projects/${projectId}/sheets/${sheet.id}`)
      setScreen(s)
      const r = s.rows[0]
      setValues(Object.fromEntries(names.map((n) => [n, cellText(r?.data[n])])))
    } catch (e) {
      setLoadError(errorText(lang, e, pkg))
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [projectId, sheet.id])
  const reloadRow = async () => {
    const s = await api<SheetScreen>('GET', `/projects/${projectId}/sheets/${sheet.id}`)
    setScreen(s)
  }

  const toggles = useMemo(() => new Set(design.fields.filter((f) => f.kind === 'toggle').map((f) => f.name)), [design])
  const visible = (f: (typeof design.fields)[number]) => {
    if (!f.showWhen) return true
    const by = design.fields.find((x) => x.name === f.showWhen!.field)
    return (values[f.showWhen.field] || by?.default) === f.showWhen.is
  }
  const numbers = useMemo(() => new Set(design.fields.filter((f) => f.kind === 'number').map((f) => f.name)), [design])
  const sent = useMemo(() => Object.fromEntries(valueFields.map((f) => {
    const v = visible(f) ? values[f.name] : saved[f.name]
    if (numbers.has(f.name)) return [f.name, v === undefined || v === '' ? null : /^\d+$/.test(v) ? (Number(v) === 0 ? null : Number(v)) : v]
    return [f.name, toggles.has(f.name) ? (v === 'true' ? true : null) : v ? v : null]
  })), [valueFields, values, saved, toggles, numbers])
  const sentKey = JSON.stringify(sent)
  const dirty = valueFields.some((f) => visible(f) && (values[f.name] ?? '') !== saved[f.name])
  const colorBad = design.fields.some((f) => f.kind === 'color' && visible(f) && values[f.name] && !HEX.test(values[f.name]))
  const numberBad = (f: (typeof design.fields)[number]) => {
    const v = values[f.name] ?? ''
    if (v === '') return false
    if (!/^\d+$/.test(v)) return true
    const n = Number(v)
    return (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)
  }
  const anyNumberBad = design.fields.some((f) => f.kind === 'number' && visible(f) && numberBad(f))
  const seq = useRef(0)
  useEffect(() => {
    const my = ++seq.current
    if (!screen || colorBad || anyNumberBad) { setPreviewing(false); return }
    const timer = setTimeout(() => {
      setPreviewing(true)
      setPreviewError(null)
      files.designPreview(projectId, sent, lang, docLang || undefined, docCurrency || undefined)
        .then(async (u) => {
          if (my !== seq.current) { URL.revokeObjectURL(u); return }
          if (!inlinePdf) {
            try {
              const blob = await (await fetch(u)).blob()
              const imgs = await convertPdfToImages(new File([blob], 'preview.pdf', { type: 'application/pdf' }), { scale: 1.5, maxPages: 5 })
              if (my !== seq.current) { URL.revokeObjectURL(u); return }
              setPageImages(imgs.map((i) => `data:image/jpeg;base64,${i.base64}`))
            } catch (e) {
              if (my !== seq.current) { URL.revokeObjectURL(u); return }
              setPageImages(null)
              setPreviewError(errorText(lang, e, pkg))
            }
          }
          setPdfUrl(u)
        })
        .catch((e) => { if (my === seq.current) setPreviewError(errorText(lang, e, pkg)) })
        .finally(() => { if (my === seq.current) setPreviewing(false) })
    }, 400)
    return () => { clearTimeout(timer); seq.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, sentKey, colorBad, anyNumberBad, projectId, lang, docLang, docCurrency, inlinePdf])
  const shown = useRef<string | null>(null)
  useEffect(() => {
    if (shown.current && shown.current !== pdfUrl) URL.revokeObjectURL(shown.current)
    shown.current = pdfUrl
  }, [pdfUrl])
  useEffect(() => () => { if (shown.current) URL.revokeObjectURL(shown.current) }, [])

  const save = async () => {
    if (!row) return
    setBusy(true)
    setNotice(null)
    try {
      await api('PATCH', `/projects/${projectId}/sheets/${sheet.id}/rows/${row.id}`, { data: sent, confirm: false })
      await load()
      setNotice({ ok: true, text: t('design_saved') })
    } catch (e) {
      setNotice({ ok: false, text: errorText(lang, e, pkg) })
    } finally {
      setBusy(false)
    }
  }

  const set = (name: string, v: string) => { setNotice(null); setValues((x) => ({ ...x, [name]: v })) }

  const attach = async (name: string, fileId: string | null, data: Record<string, unknown> = {}) => {
    if (!row) return
    await api('PATCH', `/projects/${projectId}/sheets/${sheet.id}/rows/${row.id}`, { data, confirm: false, fileId, fileColumn: name })
    await reloadRow()
  }
  const pickFile = async (name: string, file: File) => {
    setFileError(null)
    const rule = screen?.fileRules?.[name]
    if (rule && file.type && !rule.mime.includes(file.type)) { setFileError({ field: name, text: t('design_file_bad_type') }); return }
    if (rule && file.size > rule.maxBytes) { setFileError({ field: name, text: t('image_too_big').replace('{mb}', String(Math.floor(rule.maxBytes / 1024 / 1024))) }); return }
    setFileBusy(name)
    const extra: Record<string, unknown> = {}
    for (const g of design.fields) {
      if (g.needsFile !== name || !g.default) continue
      if (g.kind === 'toggle') extra[g.name] = g.default === 'true'
      else if (g.kind === 'number' && !values[g.name] && !saved[g.name]) extra[g.name] = Number(g.default)
    }
    try {
      const up = await files.upload(projectId, file, 'other')
      try {
        await attach(name, up.id, extra)
      } catch {
        await attach(name, up.id)
        for (const k of Object.keys(extra)) delete extra[k]
      }
      if (Object.keys(extra).length) setValues((x) => ({ ...x, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v === true ? 'true' : String(v)])) }))
    } catch (e) {
      setFileError({ field: name, text: errorText(lang, e, pkg) })
    } finally {
      setFileBusy(null)
    }
  }
  const removeFile = async (name: string) => {
    setFileError(null)
    setFileBusy(name)
    try { await attach(name, null) } catch (e) { setFileError({ field: name, text: errorText(lang, e, pkg) }) } finally { setFileBusy(null) }
  }

  if (loadError) return <p className="p-4 text-sm text-red-400 whitespace-pre-line">{loadError}</p>
  if (!screen) return <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>

  const pill = (on: boolean) => `px-3 py-1.5 text-sm rounded-md border transition-colors ${on ? 'border-[#E07B53] bg-[#E07B53]/10 text-white' : 'border-[#3A3A3A] text-gray-300 hover:border-gray-500'} disabled:opacity-50`

  type Field = (typeof design.fields)[number]
  const groups: { key: string; name?: string; rows: Field[][] }[] = []
  for (const f of design.fields.filter(visible)) {
    let g = groups[groups.length - 1]
    if (!g || !f.group || g.name !== f.group) groups.push((g = { key: f.name, name: f.group, rows: [] }))
    const inline = f.kind === 'color' || f.kind === 'choice'
    const last = g.rows[g.rows.length - 1]
    if (inline && last && (last[0].kind === 'color' || last[0].kind === 'choice')) last.push(f)
    else if (f.kind === 'number' && last && last[0].kind === 'number' && last.length < 2) last.push(f)
    else g.rows.push([f])
  }

  const field = (f: Field) => {
    const opts = screen.options[f.name] ?? []
    const label = t(`col_${f.name}`, f.name)
    const off = !!f.needsFile && !(row && typeof row.data[f.needsFile] === 'string' && row.data[f.needsFile])
    const dim = frozen || off
    if (f.kind === 'file') {
      const id = row && typeof row.data[f.name] === 'string' ? (row.data[f.name] as string) : null
      const rule = screen.fileRules?.[f.name]
      const mb = rule ? String(Math.floor(rule.maxBytes / 1024 / 1024)) : ''
      const btn = 'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-40'
      return (
        <section key={f.name}>
          <p className="text-sm font-medium text-gray-200 mb-1">{label}</p>
          <p className="text-xs text-gray-500 mb-2">{t(`design_file_help_${f.name}`, '').replace('{mb}', mb)}</p>
          <div className="flex flex-wrap items-center gap-2">
            {id && <span className="inline-flex items-center gap-1 text-sm text-gray-200"><FileText className="w-4 h-4 text-[#E07B53]" /> {t('design_file_attached')}</span>}
            {!locked && (
              <>
                <input ref={(el) => { fileInputs.current[f.name] = el }} type="file" accept={(rule?.mime ?? []).join(',')} className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pickFile(f.name, file) }} />
                <button type="button" disabled={busy || fileBusy !== null} onClick={() => fileInputs.current[f.name]?.click()}
                  className={id ? btn : 'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40'}>
                  {fileBusy === f.name ? <Loader2 className="w-4 h-4 animate-spin" /> : id ? <RefreshCw className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                  {id ? t('design_file_replace') : t('design_file_upload')}
                </button>
                {id && (
                  <button type="button" disabled={busy || fileBusy !== null} onClick={() => void removeFile(f.name)} className={btn}>
                    <Trash2 className="w-4 h-4" /> {t('design_file_remove')}
                  </button>
                )}
              </>
            )}
            {f.sample && (
              <a href={f.sample} download className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-[#3A3A3A] text-gray-200 hover:bg-[#2A2A2A]">
                <Download className="w-4 h-4" /> {t('design_file_sample')}
              </a>
            )}
          </div>
          {fileError?.field === f.name && <p className="mt-2 text-sm text-amber-300 whitespace-pre-line">{fileError.text}</p>}
        </section>
      )
    }
    if (f.kind === 'number') {
      const bad = numberBad(f)
      return (
        <label key={f.name} className={`block w-36 ${off ? 'opacity-50' : ''}`}>
          <span className="block text-sm font-medium text-gray-200 mb-1">{label}</span>
          <span className="flex items-center gap-2">
            <input type="number" inputMode="numeric" min={f.min} max={f.max} step={1} disabled={dim} value={values[f.name] ?? ''} placeholder="0" autoComplete="off"
              onChange={(e) => set(f.name, e.target.value.trim())}
              className="w-20 rounded-md border border-[#3A3A3A] bg-[#171717] px-2 py-1.5 text-sm text-white disabled:opacity-60" />
            {f.unit && <span className="text-xs text-gray-400">{t(`unit_${f.unit}`, f.unit)}</span>}
          </span>
          {bad && <span className="block mt-1 text-xs text-amber-300">{t('design_number_bad').replace('{min}', String(f.min ?? 0)).replace('{max}', String(f.max ?? ''))}</span>}
          {!bad && !off && f.warnEmpty && !Number(values[f.name] || 0) && <span className="block mt-1 text-xs text-amber-300">{t(`design_warn_empty_${f.name}`, '')}</span>}
        </label>
      )
    }
    if (f.kind === 'cards') return (
      <section key={f.name}>
        <p className="text-sm font-medium text-gray-200 mb-2">{label}</p>
        <div className="grid grid-cols-2 gap-2">
          {opts.map((o) => {
            const on = (values[f.name] || f.default) === o
            return (
              <button key={o} type="button" disabled={frozen} onClick={() => set(f.name, o)}
                className={`text-left rounded-lg border px-3 py-3 transition-colors disabled:opacity-60 ${on ? 'border-[#E07B53] bg-[#E07B53]/10' : 'border-[#3A3A3A] hover:border-gray-500'}`}>
                <span className="flex items-center justify-between gap-2 text-sm text-white">{t(`opt_${o}`, o)}{on && <Check className="w-4 h-4 text-[#E07B53]" />}</span>
                <span className="block mt-1 text-xs text-gray-400">{t(`opt_${o}_help`, '')}</span>
              </button>
            )
          })}
        </div>
      </section>
    )
    if (f.kind === 'color') {
      const v = values[f.name] ?? ''
      const ok = HEX.test(v)
      return (
        <section key={f.name}>
          <p className="text-sm font-medium text-gray-200 mb-2">{label}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="color" disabled={frozen} value={ok ? v : '#000000'} onChange={(e) => set(f.name, e.target.value.toUpperCase())} className="h-9 w-12 rounded border border-[#3A3A3A] bg-transparent disabled:opacity-60" aria-label={label} />
            <input type="text" disabled={frozen} value={v} placeholder="#1A73E8" maxLength={7} autoComplete="off" onChange={(e) => set(f.name, e.target.value.trim())}
              className="w-28 rounded-md border border-[#3A3A3A] bg-[#171717] px-2 py-1.5 text-sm text-white disabled:opacity-60" />
            {v && !frozen && (
              <button type="button" onClick={() => set(f.name, '')} className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-white"><RotateCcw className="w-3.5 h-3.5" /> {t('design_color_clear')}</button>
            )}
          </div>
          {v && !ok && <p className="mt-1 text-xs text-amber-300">{t('design_color_bad')}</p>}
          {ok && contrastOnWhite(v) < 3 && <p className="mt-1 text-xs text-amber-300">{t('design_color_light')}</p>}
        </section>
      )
    }
    if (f.kind === 'text') return (
      <label key={f.name} className="block">
        <span className="block text-sm font-medium text-gray-200 mb-1">{label}</span>
        <span className="block text-xs text-gray-500 mb-2">{t(`design_text_help_${f.name}`, '')}</span>
        <textarea value={values[f.name] ?? ''} disabled={frozen} rows={3} maxLength={5000} autoComplete="off" onChange={(e) => set(f.name, e.target.value)}
          className="w-full resize-y scrollbar-thin rounded-md border border-[#3A3A3A] bg-[#171717] px-2 py-1.5 text-sm text-white disabled:opacity-60" />
      </label>
    )
    if (f.kind === 'toggle') {
      const on = values[f.name] === 'true'
      const help = on ? t(`design_toggle_help_${f.name}`, '') : ''
      return (
        <div key={f.name}>
          <label className={`flex items-center gap-3 ${dim ? 'opacity-60' : 'cursor-pointer'}`}>
            <button type="button" role="switch" aria-checked={on} disabled={dim} onClick={() => set(f.name, on ? '' : 'true')}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[#E07B53]' : 'bg-[#3A3A3A]'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <span className="text-sm text-gray-200">{label}</span>
          </label>
          {help && <p className="mt-1 ml-12 text-xs text-amber-300">{help}</p>}
        </div>
      )
    }
    const choices = [...new Set([...opts, ...(values[f.name] ? [values[f.name]] : [])])]
    if (f.auto) return (
      <label key={f.name} className="block min-w-0 max-w-full">
        <span className="block text-sm font-medium text-gray-200 mb-2">{label}</span>
        <select value={values[f.name] ?? ''} disabled={frozen} onChange={(e) => set(f.name, e.target.value)}
          className="w-full max-w-full truncate rounded-md border border-[#3A3A3A] bg-[#171717] px-2 py-1.5 text-sm text-white disabled:opacity-60">
          <option value="">{t(`auto_${f.name}`, t('design_auto'))}</option>
          {choices.map((o) => <option key={o} value={o}>{t(`opt_${o}`, o)}</option>)}
        </select>
      </label>
    )
    return (
      <section key={f.name}>
        <p className="text-sm font-medium text-gray-200 mb-2">{label}</p>
        <div className="flex flex-wrap gap-2">
          {choices.map((o) => (
            <button key={o} type="button" disabled={frozen} onClick={() => set(f.name, o)} className={pill((values[f.name] || f.default) === o)}>{t(`opt_${o}`, o)}</button>
          ))}
        </div>
      </section>
    )
  }

  const langOptions = screen.options.lang ?? []
  const currencyOptions = screen.options.currency ?? []
  const langName = (l: string) => { try { return new Intl.DisplayNames([lang], { type: 'language' }).of(l) ?? l } catch { return l } }
  const tabCls = (on: boolean) => `px-3 py-1 text-xs rounded-md ${on ? 'bg-[#2A2A2A] text-white' : 'text-gray-400 hover:text-white'}`
  return (
    <div className="@container flex-1 min-h-0 flex flex-col">
      <div className={`shrink-0 flex flex-wrap items-center gap-3 px-4 py-2 border-b border-[#2A2A2A] ${locked ? '@3xl:hidden' : ''}`}>
        {!locked && (
          <>
            <button onClick={() => void save()} disabled={busy || !dirty || colorBad || anyNumberBad} className="inline-flex items-center gap-1 px-4 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t('design_save')}
            </button>
            {dirty && <span className="text-xs text-gray-400">{t('design_unsaved')}</span>}
            {notice && <span className={`text-sm whitespace-pre-line ${notice.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{notice.text}</span>}
          </>
        )}
        <div className="ml-auto flex gap-1 @3xl:hidden">
          <button type="button" onClick={() => setNarrowView('settings')} className={tabCls(narrowView === 'settings')}>{t('design_show_settings')}</button>
          <button type="button" onClick={() => setNarrowView('preview')} className={tabCls(narrowView === 'preview')}>{t('design_show_preview')}</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 @3xl:grid @3xl:grid-cols-[minmax(320px,420px)_1fr] @3xl:grid-rows-[minmax(0,1fr)]">
        <div className={`${narrowView === 'preview' ? 'hidden' : 'block'} @3xl:block h-full min-h-0 overflow-auto scrollbar-thin p-4 space-y-6`}>
          {!row && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 px-4 py-3 text-sm text-amber-200 flex flex-wrap items-center gap-3">
              <span className="flex-1 min-w-[200px]">{t('design_need_row')}</span>
              <button onClick={onOpenSheet} className="px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]">{t('design_open_sheet')}</button>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.key} className="space-y-4">
              {g.name && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t(`design_group_${g.name}`, g.name)}</p>
                  {g.name === design.imageGroup && logoColumn && row && (
                    <button type="button" onClick={onOpenSheet} className="ml-auto inline-flex items-center gap-1 text-xs text-[#E07B53] hover:underline">
                      <ImageIcon className="w-3.5 h-3.5" /> {t(hasLogo ? 'design_logo_change' : 'design_logo_upload')}
                    </button>
                  )}
                </div>
              )}
              {g.name && t(`design_group_help_${g.name}`, '') && <p className="text-xs text-gray-500 -mt-2">{t(`design_group_help_${g.name}`, '')}</p>}
              {g.rows.map((r) => (r.length > 1
                ? <div key={r[0].name} className="flex flex-wrap items-start gap-x-6 gap-y-4">{r.map(field)}</div>
                : field(r[0])))}
            </div>
          ))}

        </div>

        <section className={`${narrowView === 'settings' ? 'hidden' : 'flex'} @3xl:flex h-full min-h-0 overflow-auto scrollbar-thin flex-col p-4 @3xl:border-l @3xl:border-[#2A2A2A]`}>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-sm font-medium text-gray-200 whitespace-nowrap">{t('design_preview')}</p>
            {previewing && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
            {langOptions.length > 1 && (
              <select value={docLang} onChange={(e) => setDocLang(e.target.value)} aria-label={t('design_preview_lang')}
                className="rounded-md border border-[#3A3A3A] bg-[#171717] px-2 py-1 text-xs text-white">
                <option value="">{t('design_preview_lang_company')}{row?.data.lang ? ` (${langName(String(row.data.lang))})` : ''}</option>
                {langOptions.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
              </select>
            )}
            {currencyOptions.length > 1 && (
              <select value={docCurrency} onChange={(e) => setDocCurrency(e.target.value)} aria-label={t('design_preview_currency')}
                className="rounded-md border border-[#3A3A3A] bg-[#171717] px-2 py-1 text-xs text-white">
                <option value="">{t('design_preview_currency_company')}{row?.data.currency ? ` (${String(row.data.currency)})` : ''}</option>
                {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1 text-xs rounded-md bg-[#2A2A2A] text-gray-200 hover:bg-[#3A3A3A]">
                <ExternalLink className="w-3.5 h-3.5" /> {t('design_preview_open')}
              </a>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-2">{t('design_preview_note')}</p>
          {previewError && <p className="mb-2 text-sm text-amber-300 whitespace-pre-line">{previewError}</p>}
          {pdfUrl && !inlinePdf && pageImages ? (
            <div className="flex-1 min-h-0 space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {pageImages.map((src, i) => <img key={i} src={src} alt={`${t('design_preview')} ${i + 1}`} className="w-full rounded-md border border-[#2A2A2A] bg-white" />)}
            </div>
          ) : pdfUrl && !inlinePdf ? (
            <a href={pdfUrl} target="_blank" rel="noreferrer" className="flex-1 min-h-48 flex items-center justify-center gap-2 rounded-md border border-dashed border-[#3A3A3A] text-sm text-gray-300 hover:text-white">
              <ExternalLink className="w-4 h-4" /> {t('design_preview_open')}
            </a>
          ) : pdfUrl && inlinePdf ? (
            <iframe src={`${pdfUrl}#view=Fit&navpanes=0`} title={t('design_preview')} className="w-full flex-1 min-h-[420px] rounded-md border border-[#2A2A2A] bg-white" />
          ) : (
            <div className="flex-1 min-h-48 flex items-center justify-center rounded-md border border-dashed border-[#3A3A3A]"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
          )}
        </section>
      </div>
    </div>
  )
}
