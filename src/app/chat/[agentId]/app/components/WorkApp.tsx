'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Loader2, LogOut, Menu, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { makeAppApi, makeWorkApi, makeWorkFiles, type ProjectOverview, type TaskSummary, type WorkAppOpen, type WorkAppProposal } from '../lib/api'
import { SheetTable, errorText } from './SheetTable'
import { TaskPanel } from './TaskPanel'
import { ReferencePanel } from './ReferencePanel'
import { NotePanel } from './NotePanel'
import { ModulePanel } from './ModulePanel'
import { FilesPanel } from './FilesPanel'
import { ScrollTabs } from './ScrollTabs'
import { ChatPane } from './ChatPane'
import { ApplyTemplateDialog, NewTaskDialog, type NewTaskInput } from './CreateDialogs'
import { ConfirmDialog } from './ConfirmDialog'
import { ImportDialog, type ImportStart } from './ImportDialog'

interface Props {
  agentId: string
  workflowId: string
  token: string | null
  lang: WorkLang
  memberName: string
  isOwner: boolean
  onLogout: () => void
  onAuthError: () => void
}

type DataView = 'task' | 'notes' | 'files' | 'sheet' | 'refs' | 'modules'

const DATA_WIDTH_KEY = 'aitalk.workApp.dataWidth'
const DATA_WIDTH_DEFAULT = 45
const DATA_WIDTH_MIN = 25
const DATA_WIDTH_MAX = 70
const clampWidth = (n: number) => Math.min(DATA_WIDTH_MAX, Math.max(DATA_WIDTH_MIN, n))

export function WorkApp({ agentId, workflowId, token, lang, memberName, isOwner, onLogout, onAuthError }: Props) {
  const t = (k: string, f?: string) => workT(lang, k, f)
  const api = useMemo(() => makeWorkApi(agentId, token, onAuthError), [agentId, token, onAuthError])
  const appApi = useMemo(() => makeAppApi(agentId, token, onAuthError), [agentId, token, onAuthError])
  const files = useMemo(() => makeWorkFiles(agentId, token, onAuthError), [agentId, token, onAuthError])

  const [app, setApp] = useState<WorkAppOpen | null>(null)
  const [overview, setOverview] = useState<ProjectOverview | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [view, setView] = useState<DataView>('task')
  const [reportTaskId, setReportTaskId] = useState<string | null>(null)
  const [pane, setPane] = useState<'chat' | 'data'>('chat')
  const [refresh, setRefresh] = useState(0)
  const [drawer, setDrawer] = useState(false)
  const [dialog, setDialog] = useState<'task' | null>(null)
  const [proposal, setProposal] = useState<Extract<WorkAppProposal, { type: 'apply_app_template' }> | null>(null)
  const [importing, setImporting] = useState<(ImportStart & { module: string }) | null>(null)
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

  const loadOverview = useCallback(async (projectId: string) => {
    const seq = ++overviewSeq.current
    try {
      const o = await api<ProjectOverview>('GET', `/projects/${projectId}`)
      if (seq !== overviewSeq.current) return
      setOverview(o)
      setSheetId((cur) => (cur && o.sheets.some((s) => s.id === cur) ? cur : o.sheets[0]?.id ?? null))
      setTaskId((cur) => (cur && o.tasks.some((x) => x.id === cur) ? cur : null))
    } catch (e) {
      if (seq === overviewSeq.current) setPageError(errorText(lang, e))
    }
  }, [api, lang])

  useEffect(() => {
    let live = true
    setApp(null); setOverview(null); setTaskId(null); setPageError(null)
    appApi<WorkAppOpen>('GET', `/${encodeURIComponent(workflowId)}`)
      .then((a) => { if (!live) return; setApp(a); void loadOverview(a.projectId) })
      .catch((e) => { if (live) setPageError(errorText(lang, e)) })
    return () => { live = false }
  }, [appApi, workflowId, lang, loadOverview])

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
    } catch (e) { setError(errorText(lang, e)) } finally { setBusy(false) }
  }

  const deleteTask = async (task: TaskSummary) => {
    if (!app) return
    setBusy(true); setPageError(null)
    try {
      await api('DELETE', `/projects/${app.projectId}/tasks/${task.id}`)
      setDeletingTask(null)
      if (taskId === task.id) setTaskId(null)
      await loadOverview(app.projectId)
    } catch (e) { setDeletingTask(null); setPageError(errorText(lang, e)) } finally { setBusy(false) }
  }

  const applyTemplate = async (settings: Record<string, unknown>, modules: string[] | undefined) => {
    if (!app || !proposal) return
    setBusy(true); setError(null)
    try {
      await api('POST', `/projects/${app.projectId}/app-template`, { kind: proposal.kind, settings, ...(modules ? { modules } : {}) })
      setProposal(null)
      afterChange()
    } catch (e) { setError(errorText(lang, e)) } finally { setBusy(false) }
  }

  const task = overview?.tasks.find((x) => x.id === taskId) ?? null
  const reportChoices = (overview?.tasks ?? []).filter((x) => (x.status === 'open' || x.status === 'awaiting') && x.periodStart).sort((a, b) => (a.periodStart! < b.periodStart! ? -1 : 1))
  const panelTask = task ?? overview?.tasks.find((x) => x.id === reportTaskId) ?? reportChoices[0] ?? overview?.tasks[0] ?? null
  const effView: DataView = view === 'task' && !panelTask ? 'notes' : view
  useEffect(() => { if (!task && !reportTaskId && panelTask) setReportTaskId(panelTask.id) }, [task, reportTaskId, panelTask])
  const sheet = overview?.sheets.find((s) => s.id === sheetId) ?? null
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
            <span className={`block text-sm ${taskId === null ? 'text-white' : 'text-gray-300'}`}>{t('conv_project')}</span>
            <span className="block text-[11px] text-gray-500">{t('conv_project_help')}</span>
          </span>
        </button>
        <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-gray-500">{t('tasks')}</p>
        {overview && overview.tasks.length === 0 && <p className="px-4 py-1 text-xs text-gray-500">{t('no_tasks')}</p>}
        {overview?.tasks.map((x) => (
          <div key={x.id} className={`group flex items-center pl-4 pr-2 ${x.id === taskId ? 'bg-[#2A2A2A]' : ''}`}>
            <button onClick={() => pickTask(x.id)} className="flex-1 flex items-center justify-between gap-2 py-1.5 text-left text-sm">
              <span className={x.id === taskId ? 'text-white' : 'text-gray-300'}>{x.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${x.status === 'submitted' ? 'bg-emerald-900/60 text-emerald-300' : x.status === 'awaiting' ? 'bg-sky-900/60 text-sky-300' : 'bg-[#2A2A2A] text-gray-400'}`}>
                {x.status === 'submitted' ? t('task_submitted') : x.status === 'awaiting' ? t('task_awaiting') : t('task_open')}
              </span>
            </button>
            {x.status === 'open' && !overview.readOnly && (
              <button onClick={() => setDeletingTask(x)} className="p-1 text-gray-600 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100" title={t('delete')}><Trash2 className="w-3.5 h-3.5" /></button>
            )}
          </div>
        ))}
        {overview && !overview.readOnly && (
          <button onClick={() => { setError(null); setDialog('task') }} className="flex items-center gap-1 px-4 py-1.5 text-xs text-gray-400 hover:text-white">
            <Plus className="w-3.5 h-3.5" /> {t('new_task')}
          </button>
        )}
      </nav>
      <div className="border-t border-[#2A2A2A] p-3">
        <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
          <span className="truncate">{memberName} · {isOwner ? t('owner') : t('member')}</span>
          {!isOwner && <button onClick={onLogout} className="p-1 hover:text-white" title={t('logout')}><LogOut className="w-4 h-4" /></button>}
        </div>
      </div>
    </div>
  )


  const dataPane = overview && (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScrollTabs prevLabel={t('tabs_prev')} nextLabel={t('tabs_next')} items={[
        ...(panelTask ? [{ key: 'task', label: overview.appTemplate?.hasCalc ? t('report_tab') : t('task_tab'), active: effView === 'task', onClick: () => setView('task') }] : []),
        { key: 'notes', label: t('notes_tab'), active: effView === 'notes', onClick: () => setView('notes') },
        { key: 'files', label: t('files_tab'), active: effView === 'files', onClick: () => setView('files') },
        ...overview.sheets.map((s) => ({ key: `sheet:${s.id}`, label: sheetLabel(s), title: `${sheetLabel(s)} · ${t(`scope_${s.scope}`)}`, active: effView === 'sheet' && s.id === sheetId, onClick: () => { setSheetId(s.id); setView('sheet') } })),
        ...(overview.references > 0 ? [{ key: 'refs', label: t('ref_tab'), active: effView === 'refs', onClick: () => setView('refs') }] : []),
        ...(overview.sheets.length > 0 ? [{ key: 'modules', label: t('modules_tab'), active: effView === 'modules', onClick: () => setView('modules') }] : []),
      ]} />
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
      {effView === 'files' ? (
        <FilesPanel key={`${overview.id}:${refresh}`} files={files} lang={lang} projectId={overview.id} readOnly={overview.readOnly} />
      ) : effView === 'modules' && overview.sheets.length > 0 ? (
        <ModulePanel key={overview.id} api={api} lang={lang} projectId={overview.id} kind={overview.kind} readOnly={overview.readOnly} onChanged={afterChange} />
      ) : effView === 'refs' && overview.references > 0 ? (
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
        />
      ) : (
        <NotePanel key={`${overview.id}:${(task ?? panelTask)?.id ?? ''}:${(task ?? panelTask)?.status ?? ''}:${refresh}`} api={api} lang={lang} projectId={overview.id} task={task ?? panelTask} readOnly={overview.readOnly} />
      )}
    </div>
  )

  const chatPane = app && overview && (
    <ChatPane
      agentId={agentId}
      workflowId={workflowId}
      token={token}
      api={appApi}
      files={files}
      lang={lang}
      projectId={app.projectId}
      taskId={taskId}
      blocked={app.chatBlocked || overview.readOnly}
      blockedText={app.chatBlocked && app.chatBlockedReason === 'no_tool' ? 'chat_blocked_no_tool' : undefined}
      welcome={app.welcome}
      projectIsEmpty={projectIsEmpty}
      onApplyProposal={(p) => {
        setError(null)
        if (p.type === 'bank_import') { setPageNotice(null); setImporting({ module: p.module, fileId: p.fileId, fileName: p.fileName, reader: p.reader, accounts: p.accounts, ...(p.balances ? { balances: p.balances } : {}), ...(p.label ? { label: p.label } : {}) }) }
        else setProposal(p)
      }}
      onTurnDone={afterChange}
      onAuthError={onAuthError}
    />
  )

  return (
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
            <span className="text-gray-300">{t('fixed_template_note').replace('{template}', t(`kind_${app.fixedAppTemplate}`, app.fixedAppTemplate))}</span>
            <button onClick={() => { setError(null); setProposal({ type: 'apply_app_template', kind: app.fixedAppTemplate!, settings: {} }) }} className="px-3 py-1 rounded-md bg-[#E07B53] text-white hover:opacity-90">{t('fixed_template_apply')}</button>
          </div>
        )}

        {!app || !overview ? (
          pageError ? null : <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
        ) : (
          <div ref={splitRef} className="flex-1 min-h-0 flex">
            <section className={`${pane === 'chat' ? 'flex' : 'hidden'} lg:flex flex-1 min-w-0 flex-col`}>{chatPane}</section>
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
              setImporting(null)
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
      {deletingTask && (
        <ConfirmDialog message={t('delete_task_confirm')} okLabel={t('delete')} cancelLabel={t('cancel')} busy={busy} onOk={() => void deleteTask(deletingTask)} onCancel={() => setDeletingTask(null)} />
      )}
    </div>
  )
}
