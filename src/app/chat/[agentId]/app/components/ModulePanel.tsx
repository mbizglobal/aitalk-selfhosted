'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { APP_TEMPLATE_FEATURES, featureLabel } from '@/lib/work/app-template-features'
import { isAppTemplateKind } from '@/lib/work/app-template-kinds'
import type { WorkApi } from '../lib/api'
import { errorText } from './SheetTable'

interface ModuleChoice {
  id: string
  title: Record<WorkLang, string>
  description: Record<WorkLang, string>
  enabled: boolean
  required: boolean
  usable: boolean
}

export function ModulePanel({ api, lang, projectId, kind, readOnly, onChanged }: { api: WorkApi; lang: WorkLang; projectId: string; kind: string; readOnly: boolean; onChanged: () => void }) {
  const t = (k: string) => workT(lang, k)
  const [list, setList] = useState<ModuleChoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    const r = await api<{ modules: ModuleChoice[] }>('GET', `/projects/${projectId}/modules`)
    setList(r.modules)
  }, [api, projectId])

  useEffect(() => { load().catch((e) => setError(errorText(lang, e))) }, [load, lang])

  const toggle = async (m: ModuleChoice) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true); setError(null)
    try {
      await api('PATCH', `/projects/${projectId}/modules/${encodeURIComponent(m.id)}`, { enabled: !m.enabled })
      await load()
      onChanged()
    } catch (e) {
      setError(errorText(lang, e))
      await load().catch(() => {})
    } finally { inFlight.current = false; setBusy(false) }
  }

  const planned = isAppTemplateKind(kind) ? APP_TEMPLATE_FEATURES[kind].planned : []

  if (!list) return error ? <p className="p-4 text-sm text-red-400">{error}</p> : <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        <p className="text-xs text-gray-400">{t('modules_help')}</p>
        {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
        {list.length === 0 && <p className="text-sm text-gray-500">{t('modules_empty')}</p>}
        <ul className="space-y-2">
          {list.map((m) => (
            <li key={m.id} className="flex items-start gap-3 rounded-lg border border-[#2A2A2A] bg-[#232323] p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white">{m.title[lang] ?? m.title.en}</p>
                <p className="text-xs text-gray-500">{m.description[lang] ?? m.description.en}</p>
                {m.required && <p className="mt-1 text-[11px] text-gray-400">{t('module_required')}</p>}
                {!m.usable && !m.enabled && <p className="mt-1 text-[11px] text-amber-300">{t('module_unusable')}</p>}
              </div>
              <button
                role="switch"
                aria-checked={m.enabled}
                aria-label={m.title[lang] ?? m.title.en}
                disabled={busy || readOnly || m.required || (!m.enabled && !m.usable)}
                onClick={() => void toggle(m)}
                className={`mt-0.5 w-10 h-6 shrink-0 rounded-full transition-colors disabled:opacity-40 ${m.enabled ? 'bg-emerald-600' : 'bg-[#3A3A3A]'}`}
              >
                <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${m.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </li>
          ))}
        </ul>
        {planned.length > 0 && (
          <div className="space-y-1 pt-2">
            <p className="text-xs text-gray-500">{t('app_template_planned')}</p>
            <ul className="space-y-1">
              {planned.map((f) => (
                <li key={f.id} className="flex items-start gap-1.5 text-xs text-gray-500"><Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />{featureLabel(f, lang)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
