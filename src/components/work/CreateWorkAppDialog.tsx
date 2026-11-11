'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getTranslations as getAppTranslations } from '@/lib/translations/app'
import type { AppLanguage } from '@/lib/translations/app'
import { useLanguage } from '@/hooks/useLanguage'
import { CreateWorkflowDialog } from '@/app/app/agents/[agentId]/workflows/dialogs'

export function CreateWorkAppDialog({ open, onOpenChange, agentIds }: { open: boolean; onOpenChange: (open: boolean) => void; agentIds: string[] }) {
  const router = useRouter()
  const { currentLanguage } = useLanguage()
  const t = getAppTranslations(currentLanguage as AppLanguage)
  const [busy, setBusy] = useState(false)

  const pickAgent = () => {
    let stored: string | null = null
    try { stored = localStorage.getItem('activeAgentId') } catch { }
    return stored && agentIds.includes(stored) ? stored : agentIds[0] ?? null
  }

  const create = async (name: string, description: string, workflowJson?: string, dataSheetSchema?: unknown, _kind?: 'main' | 'sub', bundleTemplateId?: string) => {
    const agentId = pickAgent()
    if (!agentId) { alert(t.workflow_create_failed); return }
    if (!name.trim()) { alert(t.workflow_name_required); return }
    setBusy(true)
    try {
      const res = await fetch(
        bundleTemplateId ? `/api/agents/${encodeURIComponent(agentId)}/workflows/from-template` : `/api/agents/${encodeURIComponent(agentId)}/workflows`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bundleTemplateId
            ? { templateId: bundleTemplateId, name, ...(description ? { description } : {}) }
            : { name, description: description || null, status: 'draft', ...(workflowJson && { workflowJson }), ...(dataSheetSchema ? { dataSheetSchema } : {}) }),
        },
      )
      const j = await res.json().catch(() => ({})) as { error?: unknown; code?: unknown; workflow?: { workflowId: string } }
      if (!res.ok || !j.workflow) {
        if (j.error === 'workflow_limit_reached') { alert(t.workflow_limit_title); return }
        alert(typeof j.error === 'string' && j.code ? `${t.workflow_create_failed}\n${j.error}` : t.workflow_create_failed)
        return
      }
      onOpenChange(false)
      router.push(`/app/agent-studio?workflowId=${encodeURIComponent(j.workflow.workflowId)}`)
    } catch {
      alert(t.workflow_create_failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CreateWorkflowDialog
      isOpen={open}
      onOpenChange={onOpenChange}
      isLoading={busy}
      onCreate={(name, desc, workflowJson, dataSheetSchema, kind, bundleTemplateId) => void create(name, desc, workflowJson, dataSheetSchema, kind, bundleTemplateId)}
      t={t}
      workAppOnly
    />
  )
}
