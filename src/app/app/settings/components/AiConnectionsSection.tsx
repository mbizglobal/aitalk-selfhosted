'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Cpu, Loader2, Trash2, Star, Pencil, PlugZap, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'
import { AI_CONNECTION_PRESETS } from './ai-connection-presets'

type Kind = 'azure' | 'openai_compatible' | 'anthropic'
interface Check { ok: boolean; at: string; tools: boolean; json: boolean; context?: boolean; image: boolean | null; embedding: boolean | null; error?: string }
interface Connection {
  id: string; name: string; kind: Kind; baseUrl: string; apiVersion: string | null
  textModel: string; imageModel: string | null; embeddingModel: string | null; maxOutputTokens: number | null
  isDefault: boolean; hasHeaders: boolean; readable: boolean; check: Check | null; checkValid: boolean
}
interface Form { id?: string; name: string; kind: Kind; baseUrl: string; apiKey: string; apiVersion: string; textModel: string; imageModel: string; embeddingModel: string; maxOutputTokens: string }

const EMPTY: Form = { name: '', kind: 'openai_compatible', baseUrl: '', apiKey: '', apiVersion: '', textModel: '', imageModel: '', embeddingModel: '', maxOutputTokens: '' }

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
    const ok = await act('save', { action: id ? 'update' : 'create', ...(id ? { id } : {}), ...rest, maxOutputTokens: maxOutputTokens.trim() ? Number(maxOutputTokens) : null })
    if (ok) setForm(null)
  }

  const choosePreset = (id: string) => {
    if (!form) return
    const p = AI_CONNECTION_PRESETS.find((x) => x.id === id)
    setPresetId(id)
    if (!p) return
    const prevName = AI_CONNECTION_PRESETS.find((x) => x.id === presetId)?.name
    setForm({
      ...form, kind: p.kind, baseUrl: p.baseUrl, textModel: p.textModel, imageModel: p.imageModel, embeddingModel: p.embeddingModel,
      name: !form.name.trim() || form.name === prevName ? p.name : form.name,
      apiKey: p.baseUrl === form.baseUrl ? form.apiKey : '',
    })
  }
  const preset = AI_CONNECTION_PRESETS.find((x) => x.id === presetId)

  const edit = (c: Connection) => setForm({
    id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl, apiKey: '', apiVersion: c.apiVersion ?? '',
    textModel: c.textModel, imageModel: c.imageModel ?? '', embeddingModel: c.embeddingModel ?? '', maxOutputTokens: c.maxOutputTokens ? String(c.maxOutputTokens) : '',
  })

  const status = (c: Connection) => {
    if (!c.check) return <Badge variant="outline" className="gap-1"><AlertTriangle className="h-3 w-3" />{t('aic_status_unchecked')}</Badge>
    if (c.checkValid) return <Badge className="gap-1 bg-green-600 hover:bg-green-600"><CheckCircle2 className="h-3 w-3" />{t('aic_status_ok')}</Badge>
    if (c.check.ok) return <Badge variant="outline" className="gap-1"><AlertTriangle className="h-3 w-3" />{t('aic_status_changed')}</Badge>
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />{t('aic_status_failed')}</Badge>
  }

  const mark = (v: boolean | null | undefined) => (v === null ? '—' : v ? '✓' : '✗')

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
              <Badge variant="secondary">{t(`aic_kind_${c.kind}`)}</Badge>
              {c.isDefault && <Badge variant="outline" className="gap-1"><Star className="h-3 w-3" />{t('aic_default')}</Badge>}
              {status(c)}
            </div>
            <div className="text-xs text-muted-foreground break-all space-y-0.5">
              <div>{c.baseUrl}</div>
              <div>{t('aic_text_model')}: {c.textModel} · {t('aic_image_model')}: {c.imageModel || '—'} · {t('aic_embedding_model')}: {c.embeddingModel || '—'}</div>
              {c.check && (
                <div>
                  {t('aic_check_tools')} {mark(c.check.tools)} · JSON {mark(c.check.json)} · {t('aic_check_context')} {mark(c.check.context ?? null)} · {t('aic_check_image')} {mark(c.check.image)} · {t('aic_check_embedding')} {mark(c.check.embedding)}
                  {' · '}{new Date(c.check.at).toLocaleString()}
                </div>
              )}
              {c.check?.error && <div className="text-red-500">{c.check.error}</div>}
              {c.kind !== 'azure' && <div>{t('aic_note_no_web_search')}</div>}
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

        {canManage && !form && <Button onClick={() => { setPresetId(null); setForm({ ...EMPTY }) }}>{t('aic_add')}</Button>}

        {canManage && form && (
          <div className="rounded-md border p-4 space-y-3">
            <p className="font-medium">{form.id ? t('aic_edit_title') : t('aic_add_title')}</p>
            {!form.id && (
              <div className="space-y-2">
                <span className="block text-sm">{t('aic_preset_title')}</span>
                <div className="flex flex-wrap gap-2">
                  {AI_CONNECTION_PRESETS.map((p) => (
                    <Button key={p.id} type="button" size="sm" variant={presetId === p.id ? 'default' : 'outline'} onClick={() => choosePreset(p.id)}>
                      {p.id === 'own_server' ? t('aic_preset_own_server') : p.label}
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant={presetId === 'custom' ? 'default' : 'outline'} onClick={() => choosePreset('custom')}>
                    {t('aic_preset_custom')}
                  </Button>
                </div>
                {preset && <span className="block text-xs text-muted-foreground">{t('aic_preset_note')}</span>}
              </div>
            )}
            <label className="block text-sm space-y-1">
              <span>{t('aic_name')}</span>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} autoComplete="off" />
            </label>
            <label className="block text-sm space-y-1">
              <span>{t('aic_kind')}</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="openai_compatible">{t('aic_kind_openai_compatible')}</option>
                <option value="azure">{t('aic_kind_azure')}</option>
                <option value="anthropic">{t('aic_kind_anthropic')}</option>
              </select>
              <span className="block text-xs text-muted-foreground">{t(`aic_kind_hint_${form.kind}`)}</span>
            </label>
            <label className="block text-sm space-y-1">
              <span>{t('aic_base_url')}</span>
              <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={form.kind === 'anthropic' ? 'https://api.anthropic.com' : form.kind === 'azure' ? 'https://<resource>.openai.azure.com' : 'http://localhost:11434/v1'} autoComplete="off" spellCheck={false} />
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
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm space-y-1">
                <span>{t('aic_text_model')}</span>
                <Input value={form.textModel} onChange={(e) => setForm({ ...form, textModel: e.target.value })} autoComplete="off" spellCheck={false} />
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
            <label className="block text-sm space-y-1">
              <span>{t('aic_max_output')}</span>
              <Input type="number" min={1024} value={form.maxOutputTokens} onChange={(e) => setForm({ ...form, maxOutputTokens: e.target.value })} placeholder={t('aic_optional')} autoComplete="off" className="max-w-[12rem]" />
            </label>
            <p className="text-xs text-muted-foreground">{t('aic_save_note')}</p>
            <div className="flex gap-2">
              <Button onClick={save} disabled={!!busy || !form.name.trim() || !form.baseUrl.trim() || !form.textModel.trim() || (!form.id && !form.apiKey.trim())}>
                {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin mr-1" />}{t('aic_save')}
              </Button>
              <Button variant="outline" onClick={() => { setForm(null); setError(null) }} disabled={!!busy}>{t('aic_cancel')}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
