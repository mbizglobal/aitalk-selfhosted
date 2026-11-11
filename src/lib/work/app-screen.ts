
import { packageOfKind, workT, type WorkLang } from '@/lib/translations/work'
import type { ProjectOverview } from './views'

export type AppTabKey = 'task' | 'notes' | 'files' | 'sheet' | 'refs' | 'modules' | 'sends' | 'activity'

export interface AppTab {
  key: AppTabKey
  label: string
  sheetId?: string
  family?: string
  count?: number
  kept?: true
}

const LANGS: ReadonlySet<string> = new Set(['en', 'de', 'fr', 'ko'])

export const appLang = (v: string | null | undefined): WorkLang => (v && LANGS.has(v) ? (v as WorkLang) : 'en')

export function appScreenTabs(
  lang: WorkLang,
  o: Pick<ProjectOverview, 'kind' | 'appTemplate' | 'sheets' | 'tasks' | 'references'>,
  x: { readApps: readonly string[]; sends: { v3: boolean; pending: number }; archived: boolean },
): AppTab[] {
  const pkg = packageOfKind(o.kind)
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const named = (v: string | null | undefined) => (v && v.trim() ? v : null)
  const tabs: AppTab[] = []
  if (o.tasks.length > 0) tabs.push({ key: 'task', label: t(o.appTemplate?.ui.filing ? 'report_tab' : 'task_tab') })
  if (o.appTemplate?.ui.notesTab !== false) tabs.push({ key: 'notes', label: t('notes_tab') })
  tabs.push({ key: 'files', label: t('files_tab'), ...(o.appTemplate?.ui.files === 'kept' ? { kept: true as const } : {}) })
  for (const s of o.sheets) tabs.push({ key: 'sheet', sheetId: s.id, ...(s.family ? { family: s.family } : {}), label: named(s.family ? t(`sheet_${s.family}`, named(s.name) ?? s.family) : s.name) ?? s.id })
  if (o.references > 0 && o.appTemplate?.ui.referenceTab !== false) {
    const one = x.readApps.length === 1 ? named(x.readApps[0]) : null
    tabs.push({ key: 'refs', label: one ?? t('ref_tab') })
  }
  if (o.sheets.length > 0 && o.appTemplate?.ui.modulesTab !== false) tabs.push({ key: 'modules', label: t('modules_tab') })
  if (x.sends.v3) tabs.push({ key: 'sends', label: t('sends_tab'), count: x.sends.pending })
  if (!x.archived) tabs.push({ key: 'activity', label: t('activity_tab') })
  return tabs
}

export function appScreenImports(o: Pick<ProjectOverview, 'appTemplate' | 'modules'>): Array<{ module: string; family: string; accountColumn: string; fileKind: string; accept: string }> {
  return (o.appTemplate?.ui.sheetImports ?? []).filter((im) => o.modules.includes(im.module)).map((im) => ({ module: im.module, family: im.family, accountColumn: im.accountColumn, fileKind: im.fileKind, accept: im.accept }))
}

export const MISSING_RECEIPTS_MODULE = 'receipts.ledger-state'
export function appScreenMissingFrom(o: Pick<ProjectOverview, 'modules'>): string | null {
  return o.modules.includes(MISSING_RECEIPTS_MODULE) ? MISSING_RECEIPTS_MODULE : null
}
