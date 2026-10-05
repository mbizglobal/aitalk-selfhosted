'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'

interface Candidate { id: number; name: string; active: boolean }
interface State { licensed: boolean; applies: boolean; settings: { enabled: boolean; owner: boolean; members: number[] }; candidates?: Candidate[] }

async function failText(res: Response, t: (k: string) => string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string }
  if (j.error === 'NO_APPROVER') return t('work_appr_err_no_approver')
  if (j.error === 'FORBIDDEN') return t('work_appr_err_license')
  if (j.error === 'READ_ONLY') return t('work_ref_err_read_only')
  return t('work_error')
}

export function ApprovalEditor({ projectId, agentId }: { projectId: string; agentId: string }) {
  const { t } = useLanguage()
  const [state, setState] = useState<State | null>(null)
  const [draft, setDraft] = useState<State['settings'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const url = `/api/work/${encodeURIComponent(agentId)}/projects/${encodeURIComponent(projectId)}/approval`

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) { setError(await failText(res, t)); return }
    const s = (await res.json()) as State
    setState(s)
    setDraft(s.settings)
  }, [url, t])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    setBusy(true); setError(null); setSaved(false)
    try {
      const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
      if (!res.ok) { setError(await failText(res, t)); return }
      setSaved(true)
      await load()
    } finally { setBusy(false) }
  }

  if (!state || !draft) return error ? <p className="text-sm text-red-500">{error}</p> : <Loader2 className="w-4 h-4 animate-spin" />
  const members = state.candidates ?? []
  const toggleMember = (id: number, on: boolean) => setDraft({ ...draft, members: on ? [...draft.members, id] : draft.members.filter((x) => x !== id) })
  const canEnable = state.licensed || state.settings.enabled
  return (
    <div className="space-y-3 pl-6">
      <p className="text-sm text-muted-foreground">{t('work_appr_desc')}</p>
      {!state.licensed && <p className="text-sm text-amber-600 dark:text-amber-400">{t('work_appr_no_license')}</p>}
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={busy || !canEnable} checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        {t('work_appr_enabled')}
      </label>
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('work_appr_approvers')}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={busy} checked={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.checked })} />
          {t('work_appr_owner')}
        </label>
        {members.length === 0 && <p className="text-xs text-muted-foreground">{t('work_appr_no_members')}</p>}
        {members.map((m) => (
          <label key={m.id} className={`flex items-center gap-2 text-sm ${m.active ? '' : 'text-muted-foreground'}`}>
            <input type="checkbox" disabled={busy} checked={draft.members.includes(m.id)} onChange={(e) => toggleMember(m.id, e.target.checked)} />
            {m.name}{!m.active && ` (${t('work_appr_suspended')})`}
          </label>
        ))}
        <p className="text-xs text-muted-foreground">{t('work_appr_rule')}</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => void save()} disabled={busy} className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('work_appr_save')}
        </button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">{t('work_appr_saved')}</span>}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
