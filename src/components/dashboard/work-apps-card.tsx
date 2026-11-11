'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/hooks/useLanguage'
import { Briefcase, ExternalLink, Pencil, Plus } from 'lucide-react'
import { CreateWorkAppDialog } from '@/components/work/CreateWorkAppDialog'

interface ManagedApp { projectId: string; appWorkflowId: string | null; name: string; agentId: string | null; state: 'live' | 'paused' | 'removed' | 'orphan' }
interface ManagedGroup { type: 'canvas' | 'trash' | 'workflow' | 'none'; id: string; name: string; apps: ManagedApp[] }

interface Tile { app: ManagedApp; openHref: string | null }
interface Group { workflowId: string; name: string; tiles: Tile[] }

export function WorkAppsCard({ ready }: { ready: boolean }) {
  const { t, currentLanguage } = useLanguage()
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const lang = currentLanguage === 'de-ch' ? 'de' : (['en', 'de', 'fr', 'ko'] as const).find((l) => l === currentLanguage) ?? 'en'

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/work-projects', { cache: 'no-store' })
        if (!res.ok) return
        const j = (await res.json()) as { groups?: ManagedGroup[]; agents?: Array<{ agentId: string }> }
        const list: Group[] = []
        for (const g of j.groups ?? []) {
          if (g.type !== 'canvas' && g.type !== 'workflow') continue
          const tiles: Tile[] = []
          for (const a of g.apps) {
            if (a.state !== 'live' && a.state !== 'paused') continue
            const base = a.agentId ? `/chat/${encodeURIComponent(a.agentId)}/app?` : null
            const openHref = !base ? null
              : a.state === 'live' && a.appWorkflowId
                ? `${base}workflowId=${encodeURIComponent(a.appWorkflowId)}&lang=${lang}`
                : `${base}project=${encodeURIComponent(a.projectId)}&lang=${lang}`
            tiles.push({ app: a, openHref })
          }
          if (tiles.length) list.push({ workflowId: g.id, name: g.name || 'Untitled Workflow', tiles })
        }
        if (!cancelled) { setGroups(list); setAgentIds((j.agents ?? []).map((a) => a.agentId)) }
      } catch {
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, lang])

  if (!groups || groups.length === 0) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Briefcase className="h-4 w-4" />
          {t('work_page_title')}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={agentIds.length === 0} onClick={() => setCreating(true)} className="gap-1">
            <Plus className="h-4 w-4" />
            {t('work_create')}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/work">{t('work_card_manage')}</Link>
          </Button>
        </div>
        <CreateWorkAppDialog open={creating} onOpenChange={setCreating} agentIds={agentIds} />
      </CardHeader>
      <CardContent>
        <div
          ref={scroller}
          className="flex gap-3 overflow-x-auto pb-2 cursor-grab active:cursor-grabbing select-none [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/25 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50"
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse' || !scroller.current) return
            drag.current = { x: e.clientX, left: scroller.current.scrollLeft, moved: false }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d || !scroller.current) return
            if (e.buttons === 0) { drag.current = null; return }
            const dx = e.clientX - d.x
            if (!d.moved && Math.abs(dx) > 4) {
              d.moved = true
              scroller.current.setPointerCapture(e.pointerId)
            }
            if (d.moved) scroller.current.scrollLeft = d.left - dx
          }}
          onPointerUp={() => { setTimeout(() => { drag.current = null }, 0) }}
          onPointerCancel={() => { drag.current = null }}
          onClickCapture={(e) => { if (drag.current?.moved) { e.preventDefault(); e.stopPropagation() } }}
          onDragStart={(e) => e.preventDefault()}
        >
          {groups.map((g) => (
            <section key={g.workflowId} className="shrink-0 rounded-lg border bg-muted/30 p-2">
              <div className="w-0 min-w-full flex items-center gap-1 mb-2 pl-1">
                <span className="text-xs font-medium text-muted-foreground truncate min-w-0 flex-1" title={g.name}>{g.name}</span>
                <Link href={`/app/agent-studio?workflowId=${encodeURIComponent(g.workflowId)}`} aria-label={t('work_edit_workflow')} title={t('work_edit_workflow')} className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-muted shrink-0">
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="flex gap-2">
                {g.tiles.map(({ app, openHref }) => (
                  <div key={app.projectId} className="shrink-0 w-36 h-[7.5rem] rounded-md border bg-card p-3 flex flex-col justify-between">
                    <div className="min-w-0">
                      <Briefcase className={`h-4 w-4 mb-1.5 ${app.state === 'live' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <p className="font-medium text-sm leading-snug line-clamp-2 break-words" title={app.name}>{app.name}</p>
                    </div>
                    <div className="flex items-center justify-end gap-1 -mb-1 -mr-1">
                      {openHref && (
                        <Link href={openHref} target="_blank" aria-label={t('work_open')} title={t('work_open')} className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-muted">
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
