'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface AccessOption { workflowId: string; name: string; group: string | null }
export interface AccessValue { workflowIds: string[] }
export interface AccessSave { workflowIds: string[]; add: string[]; remove: string[] }
interface Loaded { options: { workApps: AccessOption[]; teamChats: AccessOption[] }; value: AccessValue }

export function MemberAccessDialog({ title, load, onSave, onClose, t }: {
  title: string
  load: () => Promise<Loaded>
  onSave: (v: AccessSave) => Promise<void>
  onClose: () => void
  t: (key: string) => string
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    load()
      .then((d) => { if (!live) return; setData(d); setPicked(new Set(d.value.workflowIds)) })
      .catch(() => { if (live) setError(t('settings_team_access_load_failed')) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async () => {
    setBusy(true); setError(null)
    const shown = new Set([...(data?.options.workApps ?? []), ...(data?.options.teamChats ?? [])].map((o) => o.workflowId))
    const before = new Set(data?.value.workflowIds ?? [])
    const add = [...picked].filter((id) => shown.has(id) && !before.has(id))
    const remove = [...before].filter((id) => shown.has(id) && !picked.has(id))
    const workflowIds = [...new Set([...[...picked].filter((id) => shown.has(id)), ...[...before].filter((id) => !shown.has(id))])]
    try { await onSave({ workflowIds, add, remove }); onClose() } catch { setError(t('settings_team_access_save_failed')) } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('settings_team_access_desc')}</DialogDescription>
        </DialogHeader>
        {!data ? (
          <p className="text-sm text-muted-foreground">{error ?? t('loading')}</p>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto scrollbar-thin pr-1">
            <AccessChecklist options={data.options} picked={picked} onChange={setPicked} disabled={busy} t={t} />
            <p className="text-xs text-muted-foreground">{t('settings_team_access_refs_note')}</p>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button onClick={() => void save()} disabled={!data || busy}>{t('settings_team_access_save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AccessChecklist({ options, picked, onChange, disabled, t }: {
  options: { workApps: AccessOption[]; teamChats: AccessOption[] }
  picked: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  disabled?: boolean
  t: (key: string) => string
}) {
  const toggle = (id: string, on: boolean) => { const n = new Set(picked); if (on) n.add(id); else n.delete(id); onChange(n) }
  const list = (items: AccessOption[]) =>
    [...groupOptions(items).entries()].map(([g, os]) => (
      <div key={g || '_'} className="space-y-1">
        {g && <p className="text-xs text-muted-foreground pt-1">{g}</p>}
        {os.map((o) => (
          <label key={o.workflowId} className={`flex items-center gap-2 text-sm ${g ? 'pl-3' : ''}`}>
            <Checkbox checked={picked.has(o.workflowId)} onCheckedChange={(v) => toggle(o.workflowId, v === true)} disabled={disabled} />
            <span className="truncate">{o.name}</span>
          </label>
        ))}
      </div>
    ))
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('settings_team_access_no_auto')}</p>
        <Button variant="link" size="sm" className="h-auto p-0 text-xs shrink-0" disabled={disabled}
          onClick={() => onChange(new Set([...options.workApps, ...options.teamChats].map((o) => o.workflowId)))}>{t('settings_team_access_pick_all_now')}</Button>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium">{t('settings_team_access_work_apps')}</p>
        {options.workApps.length ? list(options.workApps) : <p className="text-xs text-muted-foreground">{t('settings_team_access_none_available')}</p>}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium">{t('settings_team_access_team_chats')}</p>
        {options.teamChats.length ? list(options.teamChats) : <p className="text-xs text-muted-foreground">{t('settings_team_access_none_available')}</p>}
      </div>
      {picked.size === 0 && <p className="text-xs text-amber-600">{t('settings_team_access_nothing')}</p>}
    </>
  )
}

function groupOptions(items: readonly AccessOption[]): Map<string, AccessOption[]> {
  const groups = new Map<string, AccessOption[]>()
  for (const o of items) groups.set(o.group ?? '', [...(groups.get(o.group ?? '') ?? []), o])
  return groups
}

export function shownOrder(options: { workApps: AccessOption[]; teamChats: AccessOption[] }): AccessOption[] {
  return [...[...groupOptions(options.workApps).values()].flat(), ...[...groupOptions(options.teamChats).values()].flat()]
}
