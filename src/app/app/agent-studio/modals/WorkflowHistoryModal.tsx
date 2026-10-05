'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { X, History, RotateCcw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface VersionRow {
  version: number
  name: string
  source: string
  note: string | null
  createdAt: string
}

export function WorkflowHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { agent, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [loading, setLoading] = useState(false)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [currentVersion, setCurrentVersion] = useState<number | null>(null)
  const [status, setStatus] = useState<string>('draft')
  const [restoring, setRestoring] = useState<number | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<number | null>(null)
  const [reloadPending, setReloadPending] = useState(false)

  const workflowId = agent.workflowId
  const load = useCallback(async () => {
    if (!workflowId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/workflows/${workflowId}/versions`)
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        setVersions(data.versions || [])
        setCurrentVersion(data.currentVersion ?? null)
        setStatus(data.status || 'draft')
      } else {
        toast.error(t.history_load_failed || 'Failed to load version history.')
      }
    } catch {
      toast.error(t.history_load_failed || 'Failed to load version history.')
    } finally {
      setLoading(false)
    }
  }, [workflowId, t])

  useEffect(() => {
    if (open) {
      setConfirmTarget(null)
      load()
    }
  }, [open, load])

  if (!open) return null

  const isDraft = status === 'draft'

  const handleRestore = async (targetVersion: number) => {
    if (!workflowId || currentVersion == null || reloadPending) return
    if (ui.hasChanges && !window.confirm(t.history_unsaved_warning || 'You have unsaved changes that will be lost when restoring. Continue?')) {
      return
    }
    setRestoring(targetVersion)
    try {
      const res = await fetch(`/api/workflows/${workflowId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetVersion, expectedVersion: currentVersion }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        setReloadPending(true)
        toast.success(t.history_restored || 'Version restored. Reloading…')
        setTimeout(() => window.location.reload(), 600)
        return
      }
      if (data?.code === 'STALE_CONFLICT') {
        toast.error(t.workflow_version_conflict, { id: 'workflow-version-conflict' })
        load()
      } else if (data?.code === 'PRODUCTION_RESTORE_BLOCKED' || data?.code === 'RESTORE_REQUIRES_DRAFT') {
        toast.error(t.history_restore_requires_draft || 'Restore is only available on a Draft workflow.')
        load()
      } else {
        toast.error(t.history_restore_failed || 'Failed to restore version.')
      }
      setRestoring(null)
      setConfirmTarget(null)
    } catch {
      toast.error(t.history_restore_failed || 'Failed to restore version.')
      setRestoring(null)
      setConfirmTarget(null)
    }
  }

  const sourceLabel = (s: string) =>
    s === 'ui' ? 'Studio'
    : s === 'mcp' ? 'MCP'
    : s === 'ai-assistant' ? 'AI Assistant'
    : s === 'restore' ? 'Restore'
    : s === 'pstn-number' ? 'PSTN'
    : s === 'greeting' ? 'Greeting'
    : s

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-[#3A3A3A] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-blue-500/10">
              <History className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-200">{t.history_title || 'Version History'}</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                {t.history_subtitle || 'Last 10 saved versions of this workflow.'}
                {currentVersion != null && (
                  <span className="ml-2 text-gray-500">· {(t.history_current || 'current')} v{currentVersion}</span>
                )}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!isDraft && (
          <div className="mx-5 mt-4 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
            {t.history_restore_requires_draft || 'Restore is only available on a Draft workflow.'}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              {t.loading || 'Loading…'}
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">
              {t.history_empty || 'No saved versions yet. A snapshot is kept each time you save changes.'}
            </div>
          ) : (
            versions.map((v) => (
              <div
                key={v.version}
                className="flex items-center justify-between gap-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">v{v.version}</span>
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-500/15 text-gray-400 border border-gray-500/20">
                      {sourceLabel(v.source)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {new Date(v.createdAt).toLocaleString(lang)}
                    {v.note && <span className="ml-2 text-gray-400">· {v.note}</span>}
                  </div>
                </div>
                {confirmTarget === v.version ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={restoring != null}
                      onClick={() => handleRestore(v.version)}
                      className="h-7 px-2 text-xs text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30"
                    >
                      {restoring === v.version ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (t.history_restore_confirm || 'Confirm')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={restoring != null}
                      onClick={() => setConfirmTarget(null)}
                      className="h-7 px-2 text-xs text-gray-400 hover:text-gray-200"
                    >
                      {t.cancel || 'Cancel'}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!isDraft || restoring != null || reloadPending}
                    onClick={() => setConfirmTarget(v.version)}
                    title={!isDraft ? (t.history_restore_requires_draft || 'Restore is only available on a Draft workflow.') : undefined}
                    className="h-7 px-2 text-xs shrink-0 text-blue-300 hover:text-blue-200 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 disabled:opacity-40"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    {t.history_restore || 'Restore'}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
