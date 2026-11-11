'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Cpu, Loader2, Trash2, Star, Pencil, PlugZap, CheckCircle2, AlertTriangle, XCircle, Info, RefreshCw } from 'lucide-react'
import { AI_CONNECTION_PRESETS, CONNECTION_LABEL_NAMES, REGION_NOTE_KEYS, connectionLabelOf, hasUrlPlaceholder, shouldShowModelSizeNote } from './ai-connection-presets'

type Kind = 'azure' | 'openai_compatible' | 'anthropic'
interface Check { ok: boolean; at: string; text?: boolean; tools?: boolean; json?: boolean; context?: boolean; image?: boolean | null; embedding: boolean | null; models?: Record<string, { tools: boolean; json: boolean; context: boolean }>; error?: string }
interface Connection {
  id: string; name: string; kind: Kind; baseUrl: string; apiVersion: string | null
  textModel: string; textModels: string[]; imageModel: string | null; embeddingModel: string | null; maxOutputTokens: number | null
  thinkingOff?: boolean; isDefault: boolean; hasHeaders: boolean; readable: boolean; check: Check | null; checkValid: boolean; passedModels: string[]
}
interface Form { id?: string; name: string; kind: Kind; baseUrl: string; apiKey: string; apiVersion: string; textModel: string; textModels: string[]; imageModel: string; embeddingModel: string; maxOutputTokens: string; thinkingOff: boolean }
interface ModelOption { id: string; model: string }
interface ModelLists { text: ModelOption[]; image: ModelOption[]; embedding: ModelOption[] }

const EMPTY: Form = { name: '', kind: 'openai_compatible', baseUrl: '', apiKey: '', apiVersion: '', textModel: '', textModels: [], imageModel: '', embeddingModel: '', maxOutputTokens: '', thinkingOff: false }
const LISTABLE = ['openai', 'azure', 'gemini', 'claude', 'infomaniak']
const withCurrent = (opts: ModelOption[], current: string[]): ModelOption[] => [...opts, ...current.filter((c) => c && !opts.some((o) => o.id === c)).map((c) => ({ id: c, model: c }))]
const optionLabel = (o: ModelOption) => (o.model && o.model !== o.id ? `${o.id} (${o.model})` : o.id)

interface Props { t: (key: string) => string; language?: string }

export function AiConnectionsSection({ t }: Props) {
  const [list, setList] = useState<Connection[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pgvectorMissing, setPgvectorMissing] = useState(false)
  const [presetId, setPresetId] = useState<string | null>(null)
  const [hostingOpen, setHostingOpen] = useState(false)
  const [appliedId, setAppliedId] = useState<string | null>(null)
  const [lists, setLists] = useState<ModelLists | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const listReq = useRef(0)
  const resetLists = () => { listReq.current++; setLists(null); setListError(null) }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai-connections')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'load failed')
      setCanManage(!!data.canManage)
      setList(data.connections ?? [])
      setPgvectorMissing(data.pgvector === false)
      setError(null)
    } catch {
      setError(t('aic_load_failed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    setError(null)
    try {
      const res = await fetch('/api/settings/ai-connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(res.status === 400 && data?.error ? data.error : t('aic_action_failed')); return false }
      await load()
      return true
    } catch {
      setError(t('aic_action_failed'))
      return false
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!form) return
    const { id, maxOutputTokens, ...rest } = form
    const thinkingOff = rest.thinkingOff && shouldShowModelSizeNote(connectionLabelOf(rest.kind, rest.baseUrl))
    const ok = await act('save', { action: id ? 'update' : 'create', ...(id ? { id } : {}), ...rest, thinkingOff, maxOutputTokens: maxOutputTokens.trim() ? Number(maxOutputTokens) : null })
    if (ok) setForm(null)
  }

  const choosePreset = (id: string) => {
    if (!form) return
    const p = AI_CONNECTION_PRESETS.find((x) => x.id === id)
    const nextKind = p ? p.kind : 'openai_compatible'
    const nextUrl = p ? p.baseUrl : form.baseUrl
    const changed = id !== appliedId || nextUrl !== form.baseUrl || nextKind !== form.kind
    setPresetId(id)
    setAppliedId(id)
    resetLists()
    const keyAndVersion = changed ? { apiKey: '', apiVersion: '' } : {}
    if (!p) {
      setForm({ ...form, ...keyAndVersion, kind: 'openai_compatible', textModels: [] })
      return
    }
    const prevName = AI_CONNECTION_PRESETS.find((x) => x.id === appliedId)?.name
    setForm({
      ...form, ...keyAndVersion, kind: p.kind, baseUrl: p.baseUrl, textModel: p.textModel, textModels: [], imageModel: p.imageModel, embeddingModel: p.embeddingModel,
      name: !form.name.trim() || form.name === prevName ? p.name : form.name,
    })
  }
  const preset = AI_CONNECTION_PRESETS.find((x) => x.id === presetId)

  const edit = (c: Connection) => { setPresetId(null); setAppliedId(null); setHostingOpen(false); resetLists(); setForm({
    id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl, apiKey: '', apiVersion: c.apiVersion ?? '',
    textModel: c.textModel, textModels: c.textModels ?? [], imageModel: c.imageModel ?? '', embeddingModel: c.embeddingModel ?? '', maxOutputTokens: c.maxOutputTokens ? String(c.maxOutputTokens) : '', thinkingOff: !!c.thinkingOff,
  }) }

  const listable = !!form && LISTABLE.includes(connectionLabelOf(form.kind, form.baseUrl))

  const loadModels = async () => {
    if (!form) return
    const req = ++listReq.current
    setBusy('models'); setListError(null); setError(null)
    try {
      const res = await fetch('/api/settings/ai-connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'models', id: form.id, kind: form.kind, baseUrl: form.baseUrl, apiKey: form.apiKey }) })
      const data = await res.json().catch(() => ({}))
      if (req !== listReq.current) return
      if (!res.ok) {
        setLists(null); setListError(res.status === 400 && data?.error ? data.error : t('aic_action_failed'))
        if (!form.id || appliedId) setForm((f) => (f ? { ...f, textModels: [] } : f))
        return
      }
      const l: ModelLists = data.models
      setLists(l)
      const p = AI_CONNECTION_PRESETS.find((x) => x.id === appliedId)
      const has = (arr: ModelOption[], v?: string) => !!v && arr.some((o) => o.id === v)
      setForm((f) => {
        if (!f) return f
        const saved = !!f.id && !appliedId
        const keep = (arr: ModelOption[], v: string) => !!v && (saved || has(arr, v))
        const chosen = (f.textModels.length ? f.textModels : f.textModel ? [f.textModel] : []).filter((m) => keep(l.text, m))
        const text = chosen.length ? chosen : has(l.text, p?.textModel) ? [p!.textModel] : l.text[0] ? [l.text[0].id] : []
        const def = text.includes(f.textModel) ? f.textModel : text[0] ?? ''
        if (saved) return { ...f, textModels: f.textModels.length ? f.textModels : f.textModel ? [f.textModel] : [] }
        const image = keep(l.image, f.imageModel) ? f.imageModel : has(l.image, p?.imageModel) ? p!.imageModel : has(l.image, def) ? def : l.image[0]?.id ?? ''
        const embedding = keep(l.embedding, f.embeddingModel) ? f.embeddingModel : has(l.embedding, p?.embeddingModel) ? p!.embeddingModel : l.embedding[0]?.id ?? ''
        return { ...f, textModel: def, textModels: text, imageModel: image, embeddingModel: f.kind === 'anthropic' ? '' : embedding }
      })
    } catch {
      if (req !== listReq.current) return
      setLists(null); setListError(t('aic_action_failed'))
    } finally {
      setBusy(null)
    }
  }

  const toggleText = (id: string, on: boolean) => {
    if (!form) return
    const cur = form.textModels.length ? form.textModels : form.textModel ? [form.textModel] : []
    const next = on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((m) => m !== id)
    const def = next.includes(form.textModel) ? form.textModel : next[0] ?? ''
    setForm({ ...form, textModels: next, textModel: def })
  }

  const status = (c: Connection) => {
    if (!c.check) return <Badge variant="outline" className="gap-1"><AlertTriangle className="h-3 w-3" />{t('aic_status_unchecked')}</Badge>
    if (c.checkValid) return <Badge className="gap-1 bg-green-600 hover:bg-green-600"><CheckCircle2 className="h-3 w-3" />{t('aic_status_ok')}</Badge>
    if (c.check.ok) return <Badge variant="outline" className="gap-1"><AlertTriangle className="h-3 w-3" />{t('aic_status_changed')}</Badge>
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />{t('aic_status_failed')}</Badge>
  }

  const mark = (v: boolean | null | undefined) => (v === null ? '—' : v ? '✓' : '✗')
  const labelOf = (kind: Kind, baseUrl: string) => {
    const l = connectionLabelOf(kind, baseUrl)
    return l === 'openai_compatible' ? t('aic_kind_openai_compatible') : CONNECTION_LABEL_NAMES[l]
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Cpu className="h-5 w-5" />{t('aic_title')}</CardTitle>
        <CardDescription>{t('aic_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {!loading && !canManage && (
          <div className="rounded-md border bg-muted/40 p-4 flex gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />{t('aic_not_admin')}
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {canManage && pgvectorMissing && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 flex gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />{t('aic_pgvector_missing')}
          </div>
        )}

        {canManage && list.length === 0 && !form && (
          <p className="text-sm text-muted-foreground">{t('aic_empty')}</p>
        )}

        {canManage && list.map((c) => (
          <div key={c.id} className="rounded-md border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.name}</span>
              <Badge variant="secondary">{labelOf(c.kind, c.baseUrl)}</Badge>
              {c.isDefault && <Badge variant="outline" className="gap-1"><Star className="h-3 w-3" />{t('aic_default')}</Badge>}
              {status(c)}
            </div>
            <div className="text-xs text-muted-foreground break-all space-y-0.5">
              <div>{c.baseUrl}</div>
              <div>{t('aic_text_model')}: {(c.textModels?.length ? c.textModels : [c.textModel]).map((m) => {
                const r = c.check?.models?.[m]
                const failed = r && !(r.tools && r.json && r.context)
                return `${m}${m === c.textModel && (c.textModels?.length ?? 0) > 1 ? ` (${t('aic_default_model')})` : ''}${failed ? ` ✗ ${t('aic_model_not_offered')}` : ''}`
              }).join(', ')} · {t('aic_image_model')}: {c.imageModel || '—'} · {t('aic_embedding_model')}: {c.embeddingModel || '—'}</div>
              {c.check && (
                <div>
                  {c.check.text !== undefined
                    ? <>{t('aic_check_connection')} {mark(c.check.text)} · {t('aic_check_embedding')} {mark(c.check.embedding)}</>
                    : <>{t('aic_check_tools')} {mark(c.check.tools)} · JSON {mark(c.check.json)} · {t('aic_check_context')} {mark(c.check.context ?? null)} · {t('aic_check_image')} {mark(c.check.image)} · {t('aic_check_embedding')} {mark(c.check.embedding)}</>}
                  {' · '}{new Date(c.check.at).toLocaleString()}
                </div>
              )}
              {c.check?.error && <div className="text-red-500">{c.check.error}</div>}
              {c.kind !== 'azure' && <div>{t('aic_note_no_web_search')}</div>}
              {c.thinkingOff && <div>{t('aic_thinking_off')}</div>}
              {c.hasHeaders && <div>{t('aic_has_headers')}</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => act(`check:${c.id}`, { action: 'check', id: c.id })} disabled={!!busy}>
                {busy === `check:${c.id}` ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <PlugZap className="h-4 w-4 mr-1" />}
                {busy === `check:${c.id}` ? t('aic_checking') : t('aic_check')}
              </Button>
              {!c.isDefault && (
                <Button size="sm" variant="outline" onClick={() => act(`default:${c.id}`, { action: 'setDefault', id: c.id })} disabled={!!busy}>
                  <Star className="h-4 w-4 mr-1" />{t('aic_make_default')}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => edit(c)} disabled={!!busy}><Pencil className="h-4 w-4 mr-1" />{t('aic_edit')}</Button>
              <Button size="sm" variant="outline" onClick={() => { if (confirm(t('aic_delete_confirm').replace('{name}', c.name))) act(`delete:${c.id}`, { action: 'delete', id: c.id }) }} disabled={!!busy}>
                <Trash2 className="h-4 w-4 mr-1" />{t('aic_delete')}
              </Button>
            </div>
          </div>
        ))}

        {canManage && !form && <Button onClick={() => {
          const az = AI_CONNECTION_PRESETS.find((p) => p.id === 'azure')!
          setPresetId('azure'); setAppliedId('azure'); setHostingOpen(false); resetLists()
          setForm({ ...EMPTY, kind: az.kind, baseUrl: az.baseUrl, name: az.name, textModel: az.textModel, imageModel: az.imageModel, embeddingModel: az.embeddingModel })
        }}>{t('aic_add')}</Button>}

        {canManage && form && (
          <div className="rounded-md border p-4 space-y-3">
            <p className="font-medium">{form.id ? t('aic_edit_title') : t('aic_add_title')}</p>
            {(
              <div className="space-y-2">
                <span className="block text-sm">{t('aic_preset_title')}</span>
                <div className="flex flex-wrap gap-2">
                  {AI_CONNECTION_PRESETS.filter((p) => !p.hosting && p.id !== 'own_server').map((p) => (
                    <Button key={p.id} type="button" size="sm" variant={presetId === p.id ? 'default' : 'outline'} onClick={() => { setHostingOpen(false); choosePreset(p.id) }}>
                      {p.label}
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant={(hostingOpen && !presetId) || preset?.hosting ? 'default' : 'outline'} onClick={() => { setHostingOpen(true); if (!preset?.hosting) setPresetId(null) }}>
                    {t('aic_preset_hosting')}
                  </Button>
                  <Button type="button" size="sm" variant={presetId === 'own_server' ? 'default' : 'outline'} onClick={() => { setHostingOpen(false); choosePreset('own_server') }}>
                    {t('aic_preset_own_server')}
                  </Button>
                  <Button type="button" size="sm" variant={presetId === 'custom' ? 'default' : 'outline'} onClick={() => { setHostingOpen(false); choosePreset('custom') }}>
                    {t('aic_preset_custom')}
                  </Button>
                </div>
                {(hostingOpen || preset?.hosting) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                    <span className="text-xs text-muted-foreground">{t('aic_hosting_country_ch')}</span>
                    {AI_CONNECTION_PRESETS.filter((p) => p.hosting?.country === 'CH').map((p) => (
                      <Button key={p.id} type="button" size="sm" variant={presetId === p.id ? 'default' : 'outline'} onClick={() => choosePreset(p.id)}>
                        {p.label}
                      </Button>
                    ))}
                  </div>
                )}
                {preset && <span className="block text-xs text-muted-foreground">{t(LISTABLE.includes(connectionLabelOf(preset.kind, preset.baseUrl)) ? 'aic_preset_note_list' : 'aic_preset_note')}</span>}
                {(() => {
                  const l = connectionLabelOf(form.kind, form.baseUrl)
                  const key = REGION_NOTE_KEYS[l]
                  if (!key || (!preset && !form.id)) return null
                  return l === 'azure'
                    ? <div className="rounded-md border border-green-500/60 bg-green-500/10 p-3 flex gap-2 text-sm text-green-800 dark:text-green-300"><Star className="h-4 w-4 mt-0.5 flex-shrink-0" /><span className="whitespace-pre-line"><span className="font-semibold">{t('aic_region_recommended')}</span> {t(key)}</span></div>
                    : <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 flex gap-2 text-sm"><Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" /><span>{t(key)}</span></div>
                })()}
                {connectionLabelOf(form.kind, form.baseUrl) === 'infomaniak' && (
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-1 text-sm">
                    <div className="flex gap-2"><Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" /><span>{t('aic_infomaniak_models')}</span></div>
                    {preset?.signupUrl && <div className="pl-6 text-xs">{t('aic_hosting_signup')}{' '}<a href={preset.signupUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{preset.signupUrl.replace(/^https:\/\//, '')}</a></div>}
                    <div className="pl-6 text-xs text-muted-foreground">{t('aic_hint_infomaniak')}</div>
                  </div>
                )}
              </div>
            )}
            {(form.id || presetId) && <>
            <label className="block text-sm space-y-1">
              <span>{t('aic_name')}</span>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} autoComplete="off" />
            </label>
            <div className="block text-sm space-y-1">
              <span>{t('aic_kind')}: <span className="font-medium">{labelOf(form.kind, form.baseUrl)}</span></span>
              {!['openai', 'gemini', 'phoeniqs', 'infomaniak'].includes(connectionLabelOf(form.kind, form.baseUrl)) && (
                <span className="block text-xs text-muted-foreground">{t(`aic_kind_hint_${form.kind}`)}</span>
              )}
            </div>
            {shouldShowModelSizeNote(connectionLabelOf(form.kind, form.baseUrl)) && (
              <div className="rounded-md border border-sky-400/60 bg-sky-400/10 p-3 flex gap-2 text-sm text-sky-700 dark:text-sky-300">
                <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />{t('aic_model_size_note')}
              </div>
            )}
            <label className="block text-sm space-y-1">
              <span>{t('aic_base_url')}</span>
              <Input value={form.baseUrl} onChange={(e) => { resetLists(); setForm({ ...form, baseUrl: e.target.value }) }} placeholder={form.kind === 'anthropic' ? 'https://api.anthropic.com' : form.kind === 'azure' ? 'https://<resource>.openai.azure.com' : 'http://localhost:11434/v1'} autoComplete="off" spellCheck={false} />
            </label>
            <label className="block text-sm space-y-1">
              <span>{t('aic_api_key')}</span>
              <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={form.id ? t('aic_api_key_keep') : ''} autoComplete="new-password" spellCheck={false} className="font-mono text-sm" />
              {!form.id && preset?.keyUrl && (
                <span className="block text-xs text-muted-foreground">
                  {t('aic_key_where')}{' '}
                  <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{preset.keyUrl.replace(/^https:\/\//, '')}</a>
                </span>
              )}
              {form.id && <span className="block text-xs text-muted-foreground">{t('aic_api_key_move_note')}</span>}
            </label>
            {form.kind === 'azure' && (
              <label className="block text-sm space-y-1">
                <span>{t('aic_api_version')}</span>
                <Input value={form.apiVersion} onChange={(e) => setForm({ ...form, apiVersion: e.target.value })} placeholder="2025-03-01-preview" autoComplete="off" />
              </label>
            )}
            {listable && (
              <div className="space-y-2">
                <Button type="button" size="sm" variant="outline" onClick={loadModels}
                  disabled={!!busy || !form.baseUrl.trim() || hasUrlPlaceholder(form.baseUrl) || (!form.apiKey.trim() && (!form.id || !!appliedId))}>
                  {busy === 'models' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  {busy === 'models' ? t('aic_loading_models') : t('aic_load_models')}
                </Button>
                {listError && <p className="text-sm text-red-500">{listError}</p>}
                {!lists && (
                  <p className="text-xs text-muted-foreground">
                    {!listError && t('aic_load_first')}
                    {form.textModel && <> {' '}{t('aic_text_model')}: {(form.textModels.length ? form.textModels : [form.textModel]).join(', ')} · {t('aic_image_model')}: {form.imageModel || '—'} · {t('aic_embedding_model')}: {form.embeddingModel || '—'}</>}
                  </p>
                )}
                {listError && <p className="text-xs text-muted-foreground">{t('aic_models_manual')}</p>}
              </div>
            )}
            {listable && lists && (() => {
              const chosen = form.textModels.length ? form.textModels : form.textModel ? [form.textModel] : []
              const textOpts = withCurrent(lists.text, chosen)
              const imageOpts = withCurrent(lists.image, [form.imageModel])
              const embOpts = withCurrent(lists.embedding, [form.embeddingModel])
              return (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="block text-sm space-y-1">
                    <span>{t('aic_text_model')}</span>
                    <div className="rounded-md border divide-y">
                      {textOpts.map((o) => {
                        const on = chosen.includes(o.id)
                        return (
                          <div key={o.id} className="flex items-center gap-2 px-2 py-1.5">
                            <input type="checkbox" checked={on} onChange={(e) => toggleText(o.id, e.target.checked)} className="h-4 w-4" />
                            <span className="flex-1 break-all">{optionLabel(o)}</span>
                            {on && chosen.length > 1 && (
                              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                                <input type="radio" name="aic-default-model" checked={form.textModel === o.id} onChange={() => setForm({ ...form, textModel: o.id })} />
                                {t('aic_default_model')}
                              </label>
                            )}
                          </div>
                        )
                      })}
                      {textOpts.length === 0 && <div className="px-2 py-1.5 text-muted-foreground">—</div>}
                    </div>
                    <span className="block text-xs text-muted-foreground">{t('aic_text_models_hint')}</span>
                  </div>
                  <label className="block text-sm space-y-1">
                    <span>{t('aic_image_model')}</span>
                    <select value={form.imageModel} onChange={(e) => setForm({ ...form, imageModel: e.target.value })} className="w-full h-9 rounded-md border bg-background px-2 text-sm">
                      <option value="">{t('aic_none')}</option>
                      {imageOpts.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}
                    </select>
                    <span className="block text-xs text-muted-foreground">{t('aic_image_hint')}</span>
                  </label>
                  <label className="block text-sm space-y-1">
                    <span>{t('aic_embedding_model')}</span>
                    <select value={form.embeddingModel} onChange={(e) => setForm({ ...form, embeddingModel: e.target.value })} disabled={form.kind === 'anthropic'} className="w-full h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-60">
                      <option value="">{form.kind === 'anthropic' ? t('aic_no_embeddings') : t('aic_none')}</option>
                      {embOpts.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}
                    </select>
                    <span className="block text-xs text-muted-foreground">{t('aic_embedding_hint')}</span>
                  </label>
                </div>
              )
            })()}
            {(!listable || listError) && (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm space-y-1">
                  <span>{t('aic_text_model')}</span>
                  <Input value={form.textModel} onChange={(e) => setForm({ ...form, textModel: e.target.value, textModels: [] })} autoComplete="off" spellCheck={false} />
                  <span className="block text-xs text-muted-foreground">{t('aic_text_hint')}</span>
                </label>
                <label className="block text-sm space-y-1">
                  <span>{t('aic_image_model')}</span>
                  <Input value={form.imageModel} onChange={(e) => setForm({ ...form, imageModel: e.target.value })} placeholder={t('aic_optional')} autoComplete="off" spellCheck={false} />
                  <span className="block text-xs text-muted-foreground">{t('aic_image_hint')}</span>
                </label>
                <label className="block text-sm space-y-1">
                  <span>{t('aic_embedding_model')}</span>
                  <Input value={form.embeddingModel} onChange={(e) => setForm({ ...form, embeddingModel: e.target.value })} placeholder={form.kind === 'anthropic' ? t('aic_no_embeddings') : t('aic_optional')} disabled={form.kind === 'anthropic'} autoComplete="off" spellCheck={false} />
                  <span className="block text-xs text-muted-foreground">{t('aic_embedding_hint')}</span>
                </label>
              </div>
            )}
            {shouldShowModelSizeNote(connectionLabelOf(form.kind, form.baseUrl)) && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={form.thinkingOff} onChange={(e) => setForm({ ...form, thinkingOff: e.target.checked })} />
                <span>
                  {t('aic_thinking_off')}
                  <span className="block text-xs text-muted-foreground">{t('aic_thinking_off_hint')}</span>
                </span>
              </label>
            )}
            <label className="block text-sm space-y-1">
              <span>{t('aic_max_output')}</span>
              <Input type="number" min={1024} value={form.maxOutputTokens} onChange={(e) => setForm({ ...form, maxOutputTokens: e.target.value })} placeholder={t('aic_optional')} autoComplete="off" className="max-w-[12rem]" />
            </label>
            <p className="text-xs text-muted-foreground">{t('aic_save_note')}</p>
            </>}
            <div className="flex gap-2">
              {(form.id || presetId) && <Button onClick={save} disabled={!!busy || !form.name.trim() || !form.baseUrl.trim() || hasUrlPlaceholder(form.baseUrl) || !form.textModel.trim() || ((!form.id || !!appliedId) && !form.apiKey.trim())}>
                {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin mr-1" />}{t('aic_save')}
              </Button>}
              <Button variant="outline" onClick={() => { setForm(null); setError(null) }} disabled={!!busy}>{t('aic_cancel')}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
