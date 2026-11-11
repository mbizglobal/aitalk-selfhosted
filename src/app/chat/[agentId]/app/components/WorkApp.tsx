'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ArrowUpRight, Inbox, Loader2, LogOut, Menu, MessageSquare, Plus, Settings, Stamp, Trash2, Users } from 'lucide-react'
import { packageOfKind, workKindLabel, workT, type WorkLang } from '@/lib/translations/work'
import { makeAppApi, makeArchiveApi, makeWorkApi, makeWorkFiles, type AttentionView, type CapabilitiesView, type ChatRoom, type ProjectOverview, type TaskSummary, type WorkAppOpen, type WorkAppProposal } from '../lib/api'
import { SheetTable, errorText } from './SheetTable'
import { DesignPanel } from './DesignPanel'
import { TaskPanel } from './TaskPanel'
import { ReferencePanel } from './ReferencePanel'
import { NotePanel } from './NotePanel'
import { ModulePanel } from './ModulePanel'
import { SetupPanel } from './SetupPanel'
import { FilesPanel } from './FilesPanel'
import { AttentionMenu } from './AttentionMenu'
import { ScrollTabs } from './ScrollTabs'
import { ChatPane } from './ChatPane'
import { SendsPanel } from './SendsPanel'
import { ActivityPanel } from './ActivityPanel'
import { MembersDialog } from './MembersDialog'
import { ReviewDialog } from './ReviewDialog'
import { ApplyTemplateDialog, NewTaskDialog, type NewTaskInput } from './CreateDialogs'
import { ConfirmDialog } from './ConfirmDialog'
import { ImportDialog, type ImportStart } from './ImportDialog'
import { WorkPkg } from './work-pkg'
import { LangSwitch } from './LangSwitch'
import type { LedgerImportOpen } from './LedgerStatementCard'

interface Props {
  agentId: string
  workflowId: string
  token: string | null
  lang: WorkLang
  memberName: string
  isOwner: boolean
  onLogout: () => void
  onAuthError: () => void
  displayName?: string | null
  jobTitle?: string | null
  onSaveProfile?: (fields: { displayName?: string; jobTitle?: string }) => Promise<boolean>
  archiveProjectId?: string
}

type DataView = 'task' | 'notes' | 'files' | 'sheet' | 'design' | 'refs' | 'modules' | 'sends' | 'activity' | 'setup'

const DATA_WIDTH_KEY = 'aitalk.workApp.dataWidth'
const DATA_WIDTH_DEFAULT = 45
const DATA_WIDTH_MIN = 25
const DATA_WIDTH_MAX = 70
const clampWidth = (n: number) => Math.min(DATA_WIDTH_MAX, Math.max(DATA_WIDTH_MIN, n))

export function WorkApp({ agentId, workflowId, token, lang, memberName, isOwner, onLogout, onAuthError, archiveProjectId, displayName, jobTitle, onSaveProfile }: Props) {
  const api = useMemo(() => makeWorkApi(agentId, token, onAuthError), [agentId, token, onAuthError])
  const appApi = useMemo(() => (archiveProjectId ? makeArchiveApi(archiveProjectId, onAuthError) : makeAppApi(agentId, token, onAuthError)), [agentId, token, onAuthError, archiveProjectId])
  const files = useMemo(() => makeWorkFiles(agentId, token, onAuthError), [agentId, token, onAuthError])

  const [app, setApp] = useState<WorkAppOpen | null>(null)
  const [overview, setOverview] = useState<ProjectOverview | null>(null)
  const pkg = packageOfKind(overview?.kind)
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [view, setView] = useState<DataView>(() => (typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('view') === 'setup' ? 'setup' : 'task'))
  const [reportTaskId, setReportTaskId] = useState<string | null>(null)
  const [pane, setPane] = useState<'chat' | 'data'>(() => (typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('view') === 'setup' ? 'data' : 'chat'))
  const [room, setRoom] = useState<ChatRoom>('private')
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [refresh, setRefresh] = useState(0)
  const [chatReload, setChatReload] = useState(0)
  const [draft, setDraft] = useState<{ text: string; n: number } | null>(() =>
    typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('ask') === 'statements' ? { text: workT(lang, 'ask_ledger_statements'), n: 1 } : null)
  const [drawer, setDrawer] = useState(false)
  const [dialog, setDialog] = useState<'task' | null>(null)
  const [proposal, setProposal] = useState<Extract<WorkAppProposal, { type: 'apply_app_template' }> | null>(null)
  const [importing, setImporting] = useState<(ImportStart & { module: string; card?: { messageId: string; index: number } }) | null>(null)
  const [ledgerImport, setLedgerImport] = useState<LedgerImportOpen | null>(null)
  const [pageNotice, setPageNotice] = useState<string | null>(null)
  const [deletingTask, setDeletingTask] = useState<TaskSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [dataWidth, setDataWidth] = useState(DATA_WIDTH_DEFAULT)
  const splitRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try { const v = Number(localStorage.getItem(DATA_WIDTH_KEY)); if (v) setDataWidth(clampWidth(v)) } catch { }
  }, [])
  const saveDataWidth = (n: number) => {
    const w = clampWidth(n)
    setDataWidth(w)
    try { localStorage.setItem(DATA_WIDTH_KEY, String(Math.round(w))) } catch { }
  }
  const endResize = useRef<(() => void) | null>(null)
  useEffect(() => () => endResize.current?.(), [])
  useEffect(() => {
    const stop = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop) }
  }, [])
  const startResize = (e: React.PointerEvent) => {
    const box = splitRef.current?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    endResize.current?.()
    let last = dataWidth
    const move = (ev: PointerEvent) => { last = clampWidth(((box.right - ev.clientX) / box.width) * 100); setDataWidth(last) }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
      document.body.style.cursor = ''; document.body.style.userSelect = ''
      endResize.current = null
      saveDataWidth(last)
    }
    endResize.current = end
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
  }
  const overviewSeq = useRef(0)
  const pkgRef = useRef(pkg)
  pkgRef.current = pkg
  const askAi = (text: string) => { setRoom('private'); setPane('chat'); setDraft((d) => ({ text, n: (d?.n ?? 0) + 1 })) }

  const loadOverview = useCallback(async (projectId: string) => {
    const seq = ++overviewSeq.current
    try {
      const o = await api<ProjectOverview>('GET', `/projects/${projectId}`)
      if (seq !== overviewSeq.current) return
      setOverview(archiveProjectId ? { ...o, readOnly: true } : o)
      setSheetId((cur) => (cur && o.sheets.some((s) => s.id === cur) ? cur : o.sheets[0]?.id ?? null))
      setTaskId((cur) => (cur && o.tasks.some((x) => x.id === cur) ? cur : null))
    } catch (e) {
      if (seq === overviewSeq.current) setPageError(errorText(lang, e, pkgRef.current))
    }
  }, [api, lang, archiveProjectId])

  useEffect(() => {
    let live = true
    setApp(null); setOverview(null); setTaskId(null); setPageError(null)
    appApi<WorkAppOpen>('GET', `/${encodeURIComponent(workflowId)}`)
      .then((a) => { if (!live) return; setApp(a); void loadOverview(a.projectId) })
      .catch((e) => { if (live) setPageError(errorText(lang, e)) })
    return () => { live = false }
  }, [appApi, workflowId, lang, loadOverview])

  const [sendCap, setSendCap] = useState<CapabilitiesView | null>(null)
  const loadSendCap = useCallback(() => {
    if (!app) return
    const pid = app.projectId
    api<CapabilitiesView>('GET', `/projects/${encodeURIComponent(pid)}/capabilities`).then((c) => { if (app.projectId === pid) setSendCap(c) }).catch(() => setSendCap(null))
  }, [api, app])
  useEffect(() => { loadSendCap() }, [loadSendCap, refresh])

  const unreadSeq = useRef(0)
  const loadUnread = useCallback(() => {
    if (!app || archiveProjectId) return
    const my = ++unreadSeq.current
    appApi<{ unread: Record<string, number> }>('GET', `/${encodeURIComponent(workflowId)}/rooms`).then((r) => { if (my === unreadSeq.current) setUnread(r.unread) }).catch(() => { })
  }, [appApi, app, workflowId, archiveProjectId])
  useEffect(() => { unreadSeq.current++; setUnread({}) }, [workflowId, archiveProjectId])
  useEffect(() => { loadUnread() }, [loadUnread, refresh, taskId])
  const viewingUnread = room === 'team' ? unread[taskId ?? ''] ?? 0 : 0
  useEffect(() => { if (viewingUnread > 0) setChatReload((n) => n + 1) }, [viewingUnread])

  const [attention, setAttention] = useState<{ projectId: string; items: AttentionView[] } | null>(null)
  const [reviewing, setReviewing] = useState<{ item: AttentionView; tab: 'doc' | 'items' } | null>(null)
  const attentionSeq = useRef(0)
  const loadAttention = useCallback(() => {
    if (!app || archiveProjectId) return
    const pid = app.projectId
    const my = ++attentionSeq.current
    api<{ items: AttentionView[] }>('GET', `/projects/${encodeURIComponent(pid)}/attention`).then((r) => { if (my === attentionSeq.current) setAttention({ projectId: pid, items: r.items }) }).catch(() => { })
  }, [api, app, archiveProjectId])

  const [inboxes, setInboxes] = useState<{ projectId: string; list: Array<{ sheetId: string; family: string; waiting: number }> } | null>(null)
  const inboxSeq = useRef(0)
  const loadInboxes = useCallback(() => {
    if (!app) return
    const pid = app.projectId
    const my = ++inboxSeq.current
    api<{ inboxes: Array<{ sheetId: string; family: string; waiting: number }> }>('GET', `/projects/${encodeURIComponent(pid)}/inbox`)
      .then((r) => { if (my === inboxSeq.current) setInboxes({ projectId: pid, list: r.inboxes }) })
      .catch(() => { })
  }, [api, app])
  useEffect(() => { loadInboxes() }, [loadInboxes, refresh, view, sheetId])
  useEffect(() => { loadAttention() }, [loadAttention, refresh])
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') { loadInboxes(); loadUnread(); loadAttention() } }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [loadInboxes, loadUnread, loadAttention])

  const [ownerMenu, setOwnerMenu] = useState(false)
  const [renaming, setRenaming] = useState<{ value: string; title: string; busy: boolean; failed: boolean } | null>(null)
  const saveName = async () => {
    if (!onSaveProfile || !renaming || renaming.busy || !renaming.value.trim()) return
    setRenaming({ ...renaming, busy: true, failed: false })
    const ok = await onSaveProfile({ displayName: renaming.value.trim(), jobTitle: renaming.title.trim() }).catch(() => false)
    setRenaming(ok ? null : (x) => (x ? { ...x, busy: false, failed: true } : x))
  }

  const [peopleOpen, setPeopleOpen] = useState(false)
  const [people, setPeople] = useState<{ projectId: string; count: number } | null>(null)
  const peopleSeq = useRef(0)
  const loadPeople = useCallback(() => {
    if (!app || archiveProjectId) return
    const pid = app.projectId
    const my = ++peopleSeq.current
    api<{ count: number }>('GET', `/projects/${encodeURIComponent(pid)}/people?count=1`).then((r) => { if (my === peopleSeq.current) setPeople({ projectId: pid, count: r.count }) }).catch(() => { })
  }, [api, app, archiveProjectId])
  useEffect(() => { loadPeople() }, [loadPeople])

  const afterChange = useCallback(() => {
    if (app) void loadOverview(app.projectId)
    setRefresh((n) => n + 1)
  }, [app, loadOverview])

  const createTask = async (input: NewTaskInput) => {
    if (!app) return
    setBusy(true); setError(null)
    try {
      const r = await api<{ id: string }>('POST', `/projects/${app.projectId}/tasks`, input)
      setDialog(null)
      await loadOverview(app.projectId)
      setTaskId(r.id); setView('task')
    } catch (e) { setError(errorText(lang, e, pkg)) } finally { setBusy(false) }
  }

  const deleteTask = async (task: TaskSummary) => {
    if (!app) return
    setBusy(true); setPageError(null)
    try {
      await api('DELETE', `/projects/${app.projectId}/tasks/${task.id}`)
      setDeletingTask(null)
      if (taskId === task.id) setTaskId(null)
      await loadOverview(app.projectId)
    } catch (e) { setDeletingTask(null); setPageError(errorText(lang, e, pkg)) } finally { setBusy(false) }
  }

  const applyTemplate = async (settings: Record<string, unknown>, modules: string[] | undefined) => {
    if (!app || !proposal) return
    setBusy(true); setError(null)
    try {
      await api('POST', `/projects/${app.projectId}/app-template`, { kind: proposal.kind, settings, ...(modules ? { modules } : {}) })
      setProposal(null)
      afterChange()
    } catch (e) { setError(errorText(lang, e, packageOfKind(proposal.kind))) } finally { setBusy(false) }
  }

  const task = overview?.tasks.find((x) => x.id === taskId) ?? null
  const reportChoices = (overview?.tasks ?? []).filter((x) => (x.status === 'open' || x.status === 'awaiting') && x.periodStart).sort((a, b) => (a.periodStart! < b.periodStart! ? -1 : 1))
  const panelTask = task ?? overview?.tasks.find((x) => x.id === reportTaskId) ?? reportChoices[0] ?? overview?.tasks[0] ?? null
  const readApps = (app?.linkedApps ?? []).filter((x) => x.relation.includes('reads'))
  const refTabLabel = readApps.length === 1 && readApps[0].name ? readApps[0].name : t('ref_tab')
  const notesOff = overview?.appTemplate?.ui.notesTab === false
  const effView: DataView = view === 'task' && !panelTask ? (notesOff ? 'files' : 'notes') : view === 'notes' && notesOff ? 'files' : view
  useEffect(() => { if (!task && !reportTaskId && panelTask) setReportTaskId(panelTask.id) }, [task, reportTaskId, panelTask])
  const sheet = overview?.sheets.find((s) => s.id === sheetId) ?? null
  const designSpec = overview?.appTemplate?.ui.design ?? null
  const designSheet = designSpec ? overview?.sheets.find((s) => s.family === designSpec.family) ?? null : null
  const sheetLabel = (s: { family: string | null; name: string }) => (s.family ? t(`sheet_${s.family}`, s.name) : s.name)
  const projectIsEmpty = !!overview && overview.kind === 'free' && overview.sheets.length === 0 && overview.tasks.length === 0
  const proposalTemplate = proposal ? app?.appTemplates.find((a) => a.kind === proposal.kind) ?? null : null

  const pickTask = (id: string | null) => {
    setTaskId(id)
    setView('task')
    setDrawer(false)
  }

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-[#2A2A2A]">
        <Link href={`/chat/${encodeURIComponent(agentId)}/app?lang=${lang}`} className="flex items-center gap-1 text-xs text-gray-500 hover:text-white">
          <ArrowLeft className="w-3 h-3" /> {t('app_list_title')}
        </Link>
        <p className="text-white font-medium truncate mt-1">{app?.name ?? ''}</p>
        {overview && <p className="text-xs text-gray-500">{overview.appTemplate ? t(`kind_${overview.kind}`, overview.kind) : t('app_no_template')}</p>}
      </div>
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-2">
        <button onClick={() => pickTask(null)} className={`w-full flex items-start gap-2 px-4 py-2 text-left ${taskId === null ? 'bg-[#2A2A2A]' : 'hover:bg-[#232323]'}`}>
          <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-[#E07B53]" />
          <span className="min-w-0">
            <span className={`block text-sm ${taskId === null ? 'text-white' : 'text-gray-300'}`}>{t('conv_project')}{(unread[''] ?? 0) > 0 && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-[#E07B53] align-middle" title={t('room_unread')} />}</span>
            <span className="block text-[11px] text-gray-500">{t('conv_project_help')}</span>
          </span>
        </button>
        {overview && overview.taskRule !== 'none' && <>
        <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-gray-500">{t('tasks')}</p>
        {overview && overview.tasks.length === 0 && <p className="px-4 py-1 text-xs text-gray-500">{t('no_tasks')}</p>}
        {overview?.tasks.map((x) => (
          <div key={x.id} className={`group flex items-center pl-4 pr-2 ${x.id === taskId ? 'bg-[#2A2A2A]' : ''}`}>
            <button onClick={() => pickTask(x.id)} className="flex-1 flex items-center justify-between gap-2 py-1.5 text-left text-sm">
              <span className={x.id === taskId ? 'text-white' : 'text-gray-300'}>{x.title}{(unread[x.id] ?? 0) > 0 && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-[#E07B53] align-middle" title={t('room_unread')} />}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${x.status === 'submitted' ? 'bg-emerald-900/60 text-emerald-300' : x.status === 'awaiting' ? 'bg-sky-900/60 text-sky-300' : 'bg-[#2A2A2A] text-gray-400'}`}>
                {x.status === 'submitted' ? t('task_submitted') : x.status === 'awaiting' ? t('task_awaiting') : t('task_open')}
              </span>
            </button>
            {x.status === 'open' && !overview.readOnly && isOwner && (
              <button onClick={() => setDeletingTask(x)} className="p-1 text-gray-600 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100" title={t('delete')}><Trash2 className="w-3.5 h-3.5" /></button>
            )}
          </div>
        ))}
        {overview && !overview.readOnly && isOwner && (
          <button onClick={() => { setError(null); setDialog('task') }} className="flex items-center gap-1 px-4 py-1.5 text-xs text-gray-400 hover:text-white">
            <Plus className="w-3.5 h-3.5" /> {t('new_task')}
          </button>
        )}
        </>}
      </nav>
      {app && !archiveProjectId && (
        <div className="border-t border-[#2A2A2A] px-3 py-1.5">
          <button onClick={() => { setPeopleOpen(true); setDrawer(false) }} className="w-full flex items-center gap-2 px-1 py-1 rounded text-sm text-gray-300 hover:text-white hover:bg-[#232323]">
            <Users className="w-3.5 h-3.5 shrink-0 text-[#E07B53]" />
            <span>{t('people_button')}{people?.projectId === app.projectId && ` (${people.count})`}</span>
          </button>
        </div>
      )}
      {app?.linkedApps && app.linkedApps.length > 0 && (
        <div className="border-t border-[#2A2A2A] px-3 pt-2 pb-1">
          <p className="px-1 pb-1 text-[11px] uppercase tracking-wide text-gray-500">{t('linked_apps')}</p>
          {app.linkedApps.map((x) => (
            <Link key={x.workflowId} href={`${x.url}&lang=${lang}`} target="_blank" rel="noopener noreferrer" title={x.relation.map((r) => t(`linked_${r}`)).join(' · ')}
              className="flex items-center gap-2 px-1 py-1 rounded text-sm text-gray-300 hover:text-white hover:bg-[#232323]">
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-[#E07B53]" />
              <span className="min-w-0">
                <span className="block truncate">{x.name}</span>
                <span className="block text-[11px] text-gray-500 truncate">{x.relation.map((r) => t(`linked_${r}`)).join(' · ')}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      <div className="border-t border-[#2A2A2A] p-3">
        <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
          {renaming ? (
            <form className="flex-1 min-w-0 space-y-1" onSubmit={(e) => { e.preventDefault(); void saveName() }} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null) }}>
              <input autoFocus value={renaming.value} maxLength={50} autoComplete="off" disabled={renaming.busy} placeholder={t('name_placeholder')} aria-label={t('name_placeholder')}
                onChange={(e) => setRenaming({ ...renaming, value: e.target.value, failed: false })}
                className={`w-full rounded bg-[#141414] border px-2 py-1 text-xs text-gray-100 focus:outline-none ${renaming.failed ? 'border-red-500' : 'border-[#2A2A2A] focus:border-[#E07B53]'}`} />
              <input value={renaming.title} maxLength={50} autoComplete="off" disabled={renaming.busy} placeholder={t('job_title_placeholder')} aria-label={t('job_title_placeholder')}
                onChange={(e) => setRenaming({ ...renaming, title: e.target.value, failed: false })}
                className="w-full rounded bg-[#141414] border border-[#2A2A2A] px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-[#E07B53]" />
              {renaming.failed && <p className="text-[11px] text-red-400">{t('name_save_failed')}</p>}
              <div className="flex justify-end gap-1">
                <button type="button" onClick={() => setRenaming(null)} disabled={renaming.busy} className="px-2 py-1 rounded text-gray-300 hover:bg-[#2A2A2A]">{t('cancel')}</button>
                <button type="submit" disabled={renaming.busy || !renaming.value.trim()} className="px-2 py-1 rounded bg-[#E07B53] text-white disabled:opacity-50">{t('save')}</button>
              </div>
            </form>
          ) : onSaveProfile && !archiveProjectId ? (
            <button onClick={() => setRenaming({ value: displayName ?? '', title: jobTitle ?? '', busy: false, failed: false })} className="flex-1 min-w-0 truncate text-left hover:text-white" title={t('name_edit')}>
              {memberName} · {jobTitle || t('job_title_default')}
            </button>
          ) : isOwner ? (
            <div className="relative flex-1 min-w-0">
              <button onClick={() => setOwnerMenu((v) => !v)} className="w-full truncate text-left hover:text-white" aria-haspopup="menu" aria-expanded={ownerMenu}>
                {memberName} · {t('owner')}
              </button>
              {ownerMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOwnerMenu(false)} />
                  <div role="menu" className="absolute bottom-full left-0 mb-2 z-50 min-w-[10rem] rounded-lg border border-[#2A2A2A] bg-[#1E1E1E] py-1 shadow-xl">
                    <button role="menuitem" onClick={() => { setOwnerMenu(false); onLogout() }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-200 hover:bg-[#2A2A2A]">
                      <LogOut className="w-4 h-4" />{t('logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <span className="flex-1 min-w-0 truncate">{memberName} · {t('member')}</span>
          )}
          {!renaming && <LangSwitch lang={lang} title={t('language')} />}
          {!isOwner && <button onClick={onLogout} className="p-1 hover:text-white" title={t('logout')}><LogOut className="w-4 h-4" /></button>}
        </div>
      </div>
    </div>
  )


  const dataPane = overview && (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScrollTabs prevLabel={t('tabs_prev')} nextLabel={t('tabs_next')} items={[
        ...(panelTask ? [{ key: 'task', label: overview.appTemplate?.ui.filing ? t('report_tab') : t('task_tab'), active: effView === 'task', onClick: () => setView('task') }] : []),
        ...(!notesOff ? [{ key: 'notes', label: t('notes_tab'), active: effView === 'notes', onClick: () => setView('notes') }] : []),
        { key: 'files', label: t('files_tab'), active: effView === 'files', onClick: () => setView('files') },
        ...overview.sheets.map((s) => ({ key: `sheet:${s.id}`, label: sheetLabel(s), title: `${sheetLabel(s)} · ${t(`scope_${s.scope}`)}`, active: effView === 'sheet' && s.id === sheetId, onClick: () => { setSheetId(s.id); setView('sheet') } })),
        ...(designSheet ? [{ key: 'design', label: t('design_tab'), active: effView === 'design', onClick: () => setView('design') }] : []),
        ...(overview.references > 0 && overview.appTemplate?.ui.referenceTab !== false ? [{ key: 'refs', label: refTabLabel, active: effView === 'refs', onClick: () => setView('refs') }] : []),
        ...(overview.sheets.length > 0 && overview.appTemplate?.ui.modulesTab !== false ? [{ key: 'modules', label: t('modules_tab'), active: effView === 'modules', onClick: () => setView('modules') }] : []),
        ...(sendCap?.v3 ? [{ key: 'sends', label: sendCap.pending > 0 ? `${t('sends_tab')} (${sendCap.pending})` : t('sends_tab'), active: effView === 'sends', onClick: () => setView('sends') }] : []),
        ...(!archiveProjectId ? [{ key: 'activity', label: t('activity_tab'), active: effView === 'activity', onClick: () => setView('activity') }] : []),
      ]}
        extra={<AttentionMenu files={files} api={api} {...(overview.modules.includes('receipts.ledger-state') ? { missingFrom: 'receipts.ledger-state' } : {})} lang={lang} projectId={overview.id} refresh={refresh} readOnly={overview.readOnly} onAskAi={askAi} onChanged={() => setRefresh((n) => n + 1)} />}
        pinned={{ key: 'setup', label: t('setup_tab'), icon: <Settings className="w-4 h-4" />, active: effView === 'setup', onClick: () => setView('setup') }} />
      {overview.revising.length > 0 && (
        <div className="px-4 py-2 border-b border-[#2A2A2A] space-y-0.5">
          {overview.revising.map((x, i) => (
            <p key={i} className="flex items-start gap-1 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t('ref_revising_project').replace('{project}', x.sourceName).replace('{task}', x.title)}
            </p>
          ))}
        </div>
      )}
      {effView === 'setup' ? (
        <SetupPanel key={overview.id} api={api} lang={lang} projectId={overview.id} appTemplate={overview.appTemplate} readOnly={overview.readOnly} isOwner={isOwner} onChanged={afterChange}
          onSetUp={app?.fixedAppTemplate && projectIsEmpty ? () => { setError(null); setProposal({ type: 'apply_app_template', kind: app.fixedAppTemplate!, settings: {} }) } : undefined} />
      ) : effView === 'activity' && !archiveProjectId ? (
        <ActivityPanel key={overview.id} api={api} lang={lang} projectId={overview.id} refresh={refresh} />
      ) : effView === 'sends' && sendCap?.v3 ? (
        <SendsPanel key={`${overview.id}:${refresh}`} api={api} files={files} lang={lang} projectId={overview.id} readOnly={overview.readOnly} onChanged={loadSendCap} />
      ) : effView === 'design' && designSpec && designSheet ? (
        <DesignPanel key={`${overview.id}:${designSheet.id}`} api={api} files={files} lang={lang} projectId={overview.id} design={designSpec} sheet={designSheet} readOnly={overview.readOnly}
          onOpenSheet={() => { setSheetId(designSheet.id); setView('sheet') }} />
      ) : effView === 'files' ? (
        <FilesPanel key={overview.id} refresh={refresh} files={files} lang={lang} projectId={overview.id} readOnly={overview.readOnly} kept={overview.appTemplate?.ui.files === 'kept'} wholeDoc={overview.kind === 'assembled'} onChanged={() => setRefresh((n) => n + 1)}
          usedIn={{ sheets: Object.fromEntries(overview.sheets.map((s) => [s.id, { label: sheetLabel(s), family: s.family }])), apps: app?.linkedApps ?? [] }}
          onOpenSheet={(id) => { setSheetId(id); setView('sheet') }} />
      ) : effView === 'modules' && overview.sheets.length > 0 && overview.appTemplate?.ui.modulesTab !== false ? (
        <ModulePanel key={overview.id} api={api} lang={lang} projectId={overview.id} kind={overview.kind} readOnly={overview.readOnly} onChanged={afterChange} />
      ) : effView === 'refs' && overview.references > 0 && overview.appTemplate?.ui.referenceTab !== false ? (
        <ReferencePanel key={`${overview.id}:${refresh}`} api={api} lang={lang} projectId={overview.id} />
      ) : effView === 'task' && panelTask ? (
        <TaskPanel key={panelTask.id} refresh={refresh} api={api} files={files} lang={lang} projectId={overview.id} task={panelTask} appTemplate={overview.appTemplate} modules={overview.modules} readOnly={overview.readOnly} onChanged={afterChange}
          choices={!task ? (reportChoices.some((x) => x.id === panelTask.id) ? reportChoices : [panelTask, ...reportChoices]) : []} onChoose={setReportTaskId}
          onOpenSheet={(id) => { setSheetId(id); setView('sheet'); setPane('data') }}
          onGoto={(g) => {
            if (g === 'files') { setView('files'); setPane('data'); return }
            if (g === 'notes') { setView('notes'); setPane('data'); return }
            const s = overview.sheets.find((x) => x.family === g.family)
            if (s) { setSheetId(s.id); setView('sheet'); setPane('data') }
          }} />
      ) : effView === 'sheet' && sheet ? (
        <SheetTable
          key={`${sheet.id}:${taskId ?? ''}:${refresh}`}
          api={api}
          files={files}
          lang={lang}
          projectId={overview.id}
          sheet={sheet}
          task={task}
          readOnly={overview.readOnly}
          imports={(overview.appTemplate?.ui.sheetImports ?? []).filter((im) => im.family === sheet.family && overview.modules.includes(im.module))}
          onActed={() => { setChatReload((n) => n + 1); loadAttention(); loadInboxes() }}
          onAskAi={askAi}
        />
      ) : (
        <NotePanel key={`${overview.id}:${(task ?? panelTask)?.id ?? ''}:${(task ?? panelTask)?.status ?? ''}:${refresh}`} api={api} lang={lang} projectId={overview.id} task={task ?? panelTask} readOnly={overview.readOnly} />
      )}
    </div>
  )

  const chatShown = !!(app && overview)
  useEffect(() => {
    if (!chatShown) return
    const u = new URL(window.location.href)
    if (!u.searchParams.has('ask')) return
    u.searchParams.delete('ask')
    window.history.replaceState(window.history.state, '', u.toString())
  }, [chatShown])

  const chatPane = app && overview && (
    <ChatPane
      agentId={agentId}
      workflowId={workflowId}
      token={token}
      api={appApi}
      workApi={api}
      files={files}
      lang={lang}
      projectId={app.projectId}
      taskId={taskId}
      room={room}
      onRoomRead={loadUnread}
      blocked={app.chatBlocked || overview.readOnly}
      blockedText={archiveProjectId ? 'chat_archived' : app.chatBlocked && app.chatBlockedReason === 'no_tool' ? 'chat_blocked_no_tool' : undefined}
      readOnly={overview.readOnly}
      welcome={app.welcome}
      projectIsEmpty={projectIsEmpty}
      draft={draft}
      reloadKey={chatReload}
      onApplyProposal={(p, card) => {
        setError(null)
        if (p.type === 'bank_import') { setPageNotice(null); setImporting({ module: p.module, fileId: p.fileId, fileName: p.fileName, reader: p.reader, accounts: p.accounts, ...(p.balances ? { balances: p.balances } : {}), ...(p.label ? { label: p.label } : {}), ...(card ? { card } : {}) }) }
        else if (p.type === 'apply_app_template') setProposal(p)
      }}
      onOpenLedgerImport={setLedgerImport}
      onTurnDone={afterChange}
      onSendChanged={loadSendCap}
      onAuthError={onAuthError}
    />
  )

  return (
    <WorkPkg.Provider key={pkg ?? ''} value={pkg}>
    <div className="flex h-[100dvh] bg-[#1E1E1E] text-white overflow-hidden">
      <aside className="hidden md:block w-[260px] shrink-0 bg-[#171717] border-r border-[#2A2A2A]">{sidebar}</aside>
      {drawer && (
        <div className="md:hidden fixed inset-0 z-40 flex" onClick={() => setDrawer(false)}>
          <aside className="w-[280px] max-w-[85vw] h-full bg-[#171717] border-r border-[#2A2A2A]" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
          <div className="flex-1 bg-black/50" />
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-[#2A2A2A]">
          <button className="md:hidden text-gray-300" onClick={() => setDrawer(true)} aria-label={t('menu')}><Menu className="w-5 h-5" /></button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="font-medium truncate">{task ? task.title : t('conv_project')}</h1>
              {overview?.readOnly && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2A2A2A] text-gray-400 shrink-0">{t('read_only')}</span>}
            </div>
            {task && <p className="text-xs text-gray-400">{task.periodStart ? `${task.periodStart} – ${task.periodEnd}` : t('period_none')}</p>}
          </div>
          <div className="lg:hidden flex rounded-md bg-[#2A2A2A] p-0.5 text-xs">
            {(['chat', 'data'] as const).map((p) => (
              <button key={p} onClick={() => setPane(p)} className={`px-2.5 py-1 rounded ${pane === p ? 'bg-[#E07B53] text-white' : 'text-gray-300'}`}>{t(p === 'chat' ? 'chat_tab' : 'data_tab')}</button>
            ))}
          </div>
        </header>

        {pageError && <p className="px-4 py-2 text-sm text-red-400 whitespace-pre-line border-b border-[#2A2A2A]">{pageError}</p>}
        {pageNotice && <p className="px-4 py-2 text-sm text-emerald-300 border-b border-[#2A2A2A]">{pageNotice}</p>}
        {app?.fixedAppTemplate && projectIsEmpty && !overview?.readOnly && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-[#2A2A2A] bg-[#232323] text-sm">
            <span className="text-gray-300">{t('fixed_template_note').replace('{template}', workKindLabel(lang, app.fixedAppTemplate))}</span>
            <button onClick={() => { setError(null); setProposal({ type: 'apply_app_template', kind: app.fixedAppTemplate!, settings: {} }) }} className="px-3 py-1 rounded-md bg-[#E07B53] text-white hover:opacity-90">{t('fixed_template_apply')}</button>
          </div>
        )}

        {!app || !overview ? (
          pageError ? null : <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
        ) : (
          <div ref={splitRef} className="flex-1 min-h-0 flex">
            <section className={`${pane === 'chat' ? 'flex' : 'hidden'} lg:flex flex-1 min-w-0 flex-col`}>
              {attention?.projectId === overview.id && attention.items.map((x, i) => x.review?.items ? (
                <div key={`att-${i}`} className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[#2A2A2A] bg-amber-500/15 text-sm text-amber-100">
                  <Stamp className="w-4 h-4 shrink-0" />
                  <span className="flex-1 min-w-[12rem]">{Object.entries(x.params ?? {}).reduce((txt, [k, v]) => txt.replace(`{${k}}`, String(v)), t(`attention_${x.code}`))}</span>
                  <span className="flex shrink-0 gap-1.5">
                    <button onClick={() => setReviewing({ item: x, tab: 'items' })} className="px-2 py-0.5 rounded bg-[#E07B53] text-xs text-white hover:opacity-90">{t('review_pick_items')}</button>
                    <button onClick={() => setReviewing({ item: x, tab: 'doc' })} className="px-2 py-0.5 rounded border border-[#E07B53] text-xs text-amber-100 hover:bg-[#E07B53]/20">{t('review_pick_all')}</button>
                  </span>
                </div>
              ) : (
                <button key={`att-${i}`} onClick={() => { if (x.review) setReviewing({ item: x, tab: 'doc' }); else if (x.open) { const s = overview.sheets.find((y) => y.family === x.open!.family); if (s) { setSheetId(s.id); setView('sheet'); setPane('data') } } else if (x.ask) askAi(Object.entries(x.params ?? {}).reduce((txt, [k, v]) => txt.replace(`{${k}}`, String(v)), t(x.ask))) }}
                  className="flex items-center gap-2 px-4 py-2 border-b border-[#2A2A2A] bg-amber-500/15 text-left text-sm text-amber-100 hover:bg-amber-500/25">
                  <Stamp className="w-4 h-4 shrink-0" />
                  <span className="flex-1 min-w-0">{Object.entries(x.params ?? {}).reduce((txt, [k, v]) => txt.replace(`{${k}}`, String(v)), t(`attention_${x.code}`))}</span>
                  {x.review && <span className="shrink-0 px-2 py-0.5 rounded bg-[#E07B53] text-xs text-white">{t(`attention_${x.code}_open`, x.review.actions.length ? t('review_open') : t('review_view'))}</span>}
                  {!x.review && (x.ask || x.open) && <span className="shrink-0 px-2 py-0.5 rounded bg-[#E07B53] text-xs text-white">{t(`attention_${x.code}_open`, t('review_view'))}</span>}
                </button>
              ))}
              {(overview.setupIssues ?? []).map((x, i) => (
                <button key={`setup-${i}`} onClick={() => { setView('setup'); setPane('data') }}
                  className="flex items-center gap-2 px-4 py-2 border-b border-[#2A2A2A] bg-amber-500/10 text-left text-sm text-amber-200 hover:bg-amber-500/20">
                  <Settings className="w-4 h-4 shrink-0" />
                  <span className="flex-1 min-w-0">{Object.entries(x.params ?? {}).reduce((txt, [k, v]) => txt.replace(`{${k}}`, String(v)), t(`setup_issue_${x.code}`))}</span>
                  <span className="shrink-0 text-xs underline">{t('setup_issue_open')}</span>
                </button>
              ))}
              {inboxes?.projectId === overview.id && inboxes.list.map((x) => {
                const s = overview.sheets.find((y) => y.id === x.sheetId)
                if (!s) return null
                return (
                  <button key={x.sheetId} onClick={() => { setSheetId(s.id); setView('sheet'); setPane('data') }}
                    className="flex items-center gap-2 px-4 py-2 border-b border-[#2A2A2A] bg-amber-500/10 text-left text-sm text-amber-200 hover:bg-amber-500/20">
                    <Inbox className="w-4 h-4 shrink-0" />
                    <span className="flex-1 min-w-0">{t('inbox_waiting').replace('{n}', String(x.waiting)).replace('{sheet}', sheetLabel(s))}</span>
                    <span className="shrink-0 text-xs underline">{t('inbox_open').replace('{sheet}', sheetLabel(s))}</span>
                  </button>
                )
              })}
              <div role="tablist" className="flex items-center gap-1 px-4 pt-2 border-b border-[#2A2A2A]">
                {(['private', 'team'] as const).map((r) => {
                  const n = r === 'team' ? unread[taskId ?? ''] ?? 0 : 0
                  return (
                    <button key={r} role="tab" aria-selected={room === r} onClick={() => setRoom(r)}
                      className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${room === r ? 'border-[#E07B53] text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
                      {t(r === 'team' ? 'room_team' : 'room_private')}{n > 0 && <span className="ml-1.5 px-1.5 rounded-full bg-[#E07B53] text-[10px] text-white">{n}</span>}
                    </button>
                  )
                })}
              </div>
              {chatPane}
            </section>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={Math.round(dataWidth)}
              title={t('resize_panes')}
              onPointerDown={startResize}
              onDoubleClick={() => saveDataWidth(DATA_WIDTH_DEFAULT)}
              className="group hidden lg:flex relative z-10 w-[7px] -mx-[3px] shrink-0 justify-center cursor-col-resize"
            >
              <div className="w-px h-full bg-[#2A2A2A] group-hover:bg-[#E07B53]/70 group-active:bg-[#E07B53] transition-colors" />
            </div>
            <section
              className={`${pane === 'data' ? 'flex' : 'hidden'} lg:flex flex-1 lg:flex-none min-w-0 flex-col lg:w-[var(--data-w)]`}
              style={{ '--data-w': `${dataWidth}%` } as React.CSSProperties}
            >{dataPane}</section>
          </div>
        )}
      </main>

      {dialog === 'task' && overview && <NewTaskDialog lang={lang} period={overview.appTemplate?.ui.period ?? 'custom'} busy={busy} error={error} onCreate={(x) => void createTask(x)} onClose={() => setDialog(null)} />}
      {proposal && proposalTemplate && (
        <ApplyTemplateDialog lang={lang} appTemplate={proposalTemplate} settings={proposal.settings} busy={busy} error={error} onApply={(s, m) => void applyTemplate(s, m)} onClose={() => setProposal(null)} />
      )}
      {importing && app && overview && (() => {
        const spec = (overview.appTemplate?.ui.sheetImports ?? []).find((im) => im.module === importing.module)
        return spec ? (
          <ImportDialog api={api} files={files} lang={lang} projectId={app.projectId} spec={spec} start={importing}
            onDone={(n) => {
              const card = importing.card
              setImporting(null)
              if (card && !card.messageId.startsWith('local-')) void api('POST', `/projects/${encodeURIComponent(app.projectId)}/card-done`, { messageId: card.messageId, index: card.index, result: { rows: n } }).catch(() => undefined).finally(() => setChatReload((k) => k + 1))
              const target = overview.sheets.find((s) => s.family === spec.family)
              if (target) { setSheetId(target.id); setView('sheet'); setPane('data') }
              setPageNotice(target
                ? t('import_done_opened').replace('{n}', String(n)).replace('{sheet}', sheetLabel(target))
                : t('import_done').replace('{n}', String(n)))
              afterChange()
            }}
            onClose={() => setImporting(null)} />
        ) : null
      })()}
      {ledgerImport && (
        <WorkPkg.Provider value="ledger">
          <ImportDialog api={api} files={files} lang={lang} projectId={ledgerImport.projectId} spec={ledgerImport.spec} start={ledgerImport.start}
            onDone={(n) => {
              const period = ledgerImport.period
              setLedgerImport(null)
              askAi(t('ledger_statement_done').replace('{n}', String(n)).replace('{from}', period.from).replace('{until}', period.until))
              if (pane !== 'chat') setPane('chat')
              afterChange()
            }}
            onClose={() => setLedgerImport(null)} />
        </WorkPkg.Provider>
      )}
      {reviewing && app && (
        <ReviewDialog api={api} files={files} lang={lang} projectId={app.projectId} item={reviewing.item} startTab={reviewing.tab} onClose={() => setReviewing(null)}
          onDone={() => { afterChange(); setChatReload((n) => n + 1) }} />
      )}
      {peopleOpen && app && (
        <MembersDialog api={api} lang={lang} projectId={app.projectId} isOwner={isOwner} onChanged={loadPeople} onClose={() => setPeopleOpen(false)} />
      )}
      {deletingTask && (
        <ConfirmDialog message={t('delete_task_confirm')} okLabel={t('delete')} cancelLabel={t('cancel')} busy={busy} onOk={() => void deleteTask(deletingTask)} onCancel={() => setDeletingTask(null)} />
      )}
    </div>
    </WorkPkg.Provider>
  )
}
