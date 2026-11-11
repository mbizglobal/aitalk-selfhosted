'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import { packageOfKind, workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type AppTemplateScreen, type PeerSettings, type SetupMember, type WorkApi } from '../lib/api'
import { AppTemplateFields, fieldsComplete, fieldsToValues, valuesToFields, type FieldValues } from './AppTemplateFields'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

export function SetupPanel({ api, lang, projectId, appTemplate, readOnly, isOwner, onSetUp, onChanged }: {
  api: WorkApi
  lang: WorkLang
  projectId: string
  appTemplate: AppTemplateScreen | null
  readOnly: boolean
  isOwner: boolean
  onSetUp?: () => void
  onChanged: () => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const fields = appTemplate?.ui.settings ?? []
  const [loaded, setLoaded] = useState<{ values: Record<string, unknown>; seen: string } | null>(null)
  const [values, setValues] = useState<FieldValues>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const seq = useRef(0)
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields
  const errRef = useRef((e: unknown) => errorText(lang, e, pkg))
  errRef.current = (e: unknown) => errorText(lang, e, pkg)
  const kind = appTemplate?.kind ?? null

  const load = useCallback(async () => {
    const my = ++seq.current
    let r: { values: Record<string, unknown>; seen: string }
    try {
      r = await api<{ values: Record<string, unknown>; seen: string }>('GET', `/projects/${projectId}/settings`)
    } catch (e) {
      if (my === seq.current) throw e
      return
    }
    if (my !== seq.current) return
    setLoaded(r)
    setValues(valuesToFields(fieldsRef.current, r.values))
  }, [api, projectId])

  const hasMembers = fields.some((f) => f.type === 'members')
  const [members, setMembers] = useState<SetupMember[] | null>(null)
  useEffect(() => {
    if (!hasMembers) return
    let live = true
    api<{ members: SetupMember[] }>('GET', `/projects/${projectId}/members`).then((r) => { if (live) setMembers(r.members) }).catch((e) => { if (live) setError(errRef.current(e)) })
    return () => { live = false }
  }, [api, projectId, hasMembers])

  const hasPeers = !!appTemplate?.ui.peerSettings?.length
  const [peers, setPeers] = useState<PeerSettings[] | null>(null)
  useEffect(() => {
    if (!hasPeers) return
    let live = true
    api<{ peers: PeerSettings[] }>('GET', `/projects/${projectId}/peer-settings`).then((r) => { if (live) setPeers(r.peers) }).catch(() => { if (live) setPeers(null) })
    return () => { live = false }
  }, [api, projectId, hasPeers])
  const peerValue = (v: unknown) => (v === true ? t('yes') : v === false ? t('no') : v === null || v === undefined || v === '' ? '—' : String(v))

  useEffect(() => { if (kind) load().catch((e) => setError(errRef.current(e))) }, [kind, load])

  const save = async () => {
    if (inFlight.current || !loaded) return
    inFlight.current = true
    setBusy(true); setError(null); setSaved(false)
    try {
      const shown = new Set(fields.map((f) => f.name))
      const rest = Object.fromEntries(Object.entries(loaded.values).filter(([k]) => !shown.has(k)))
      const typed = fieldsToValues(fields, values)
      for (const f of fields) if (f.type !== 'boolean' && f.type !== 'members' && !(f.name in typed)) typed[f.name] = ''
      const r = await api<{ changed: boolean; values: Record<string, unknown>; seen: string }>('PUT', `/projects/${projectId}/settings`, { settings: { ...rest, ...typed }, seen: loaded.seen })
      seq.current++
      setLoaded({ values: r.values, seen: r.seen })
      setValues(valuesToFields(fields, r.values))
      setSaved(true)
      if (r.changed) onChanged()
    } catch (e) {
      setError(errorText(lang, e, pkg))
      if (e instanceof WorkApiError && e.code === 'STALE') await load().catch(() => {})
    } finally { inFlight.current = false; setBusy(false) }
  }

  const body = (() => {
    if (!appTemplate) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">{t('setup_no_template')}</p>
          {onSetUp && !readOnly && <button onClick={onSetUp} className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90">{t('fixed_template_apply')}</button>}
        </div>
      )
    }
    const title = workT(lang, `kind_${appTemplate.kind}`, appTemplate.kind, pkg)
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs text-gray-500">{t('setup_template')}</p>
          <p className="text-sm text-white">{title}</p>
        </div>
        {fields.length === 0 ? (
          <p className="text-sm text-gray-400">{t('setup_no_fields')}</p>
        ) : !loaded || (hasMembers && !members) ? (
          error ? null : <div className="p-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
        ) : (
          <>
            <p className="text-xs text-gray-400">{t('setup_help')}</p>
            {peers?.map((x) => {
              const ppkg = packageOfKind(x.kind)
              return (
                <div key={x.url} className="rounded-md border border-[#2A2A2A] bg-[#232323] px-3 py-2 text-xs space-y-1">
                  <p className="text-gray-300">{t('peer_settings_title').replace('{app}', x.name)}</p>
                  <dl className="space-y-0.5">
                    {Object.entries(x.values).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="text-gray-500">{workT(lang, `set_${k}`, k, ppkg)}</dt>
                        <dd className="text-white">{peerValue(v)}</dd>
                      </div>
                    ))}
                  </dl>
                  <a href={x.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#E07B53] hover:underline">
                    {t('peer_settings_open').replace('{app}', x.name)} <ArrowUpRight className="w-3 h-3" />
                  </a>
                </div>
              )
            })}
            <AppTemplateFields lang={lang} prefix="set_" fields={fields} values={values} onChange={(n, v) => { setSaved(false); setValues((x) => ({ ...x, [n]: v })) }} idPrefix="setup" disabled={readOnly || busy} isOwner={isOwner} {...(members ? { members } : {})} />
            {!isOwner && fields.some((f) => f.ownerOnly) && <p className="text-xs text-gray-500">{t('setup_owner_only_fields')}</p>}
            {!readOnly && (
              <div className="flex items-center gap-3">
                <button disabled={busy || !fieldsComplete(fields, values)} onClick={() => void save()} className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">{t('setup_save')}</button>
                {saved && <span role="status" className="text-xs text-emerald-400">{t('setup_saved')}</span>}
              </div>
            )}
          </>
        )}
      </div>
    )
  })()

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
        {body}
      </div>
    </div>
  )
}
