import React, { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import {
  Save,
  Play,
  Pause,
  RefreshCw,
  Download,
  Upload,
  Settings,
  Code,
  Share2,
  Undo,
  Redo,
  Copy,
  Clipboard,
  Trash2,
  Bug,
  ArrowLeft,
  Eye,
  Sparkles,
  PhoneCall,
  History
} from 'lucide-react'
import { restoreNodesWithIcons, hasMiniAppOnUnsupportedChannel } from '../utils/nodeUtils'
import { WorkflowHistoryModal } from '../modals/WorkflowHistoryModal'

export const WorkflowHeader: React.FC = () => {
  const router = useRouter()
  const { workflow, ui, agent, test, workflowHandlers, hasOpenAIApiKey, reloadWorkflow, confirmLiveSave } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const statusChangingRef = useRef(false)
  const [isStatusChanging, setIsStatusChanging] = useState(false)

  const currentNodes = workflow.nodes
  const currentEdges = workflow.edges

  const pstnStartWithWebVoice = workflow.nodes.find(
    (n: any) =>
      n.data?.nodeType === 'start' &&
      n.data?.triggerType === 'pstn' &&
      n.data?.webVoice?.enabled === true
  )

  const openWebVoiceTest = () => {
    if (!agent.agentId) return
    const baseUrl =
      typeof window !== 'undefined'
        ? (process.env.NEXT_PUBLIC_APP_URL || window.location.origin)
        : ''
    const url = `${baseUrl}/voice/${agent.agentId}${agent.workflowId ? `?wf=${agent.workflowId}` : ''}`
    window.open(url, 'aitalk-voice', 'width=420,height=680,scrollbars=no')
  }

  const handleSave = async (opts?: { withStatus?: 'draft' }): Promise<boolean> => {
    if (!agent.workflowId) {
      console.error('No workflow ID available')
      ui.setSaveSuccess(false)
      return false
    }
    if (isReloading) return false

    if (!opts?.withStatus && !(await confirmLiveSave())) return false

    if (hasMiniAppOnUnsupportedChannel(workflow.nodes, workflow.edges)) {
      toast.warning(t.miniapp_channel_unsupported_warning)
    }

    workflow.setSelectedNode(null)
    workflow.deselectAll()

    ui.setIsSaving(true)
    try {
      const workflowJson = {
        nodes: workflow.nodes.map(node => ({
          ...node,
          data: {
            ...node.data,
            icon: null
          }
        })),
        edges: workflow.edges
      }

      const updateData = {
        name: agent.workflowName,
        workflowJson: JSON.stringify(workflowJson),
        expectedVersion: agent.workflowVersionRef.current, // optimistic concurrency (G1)
        expectedStatus: agent.workflowStatus,
        ...(opts?.withStatus ? { status: opts.withStatus } : {}),
      }

      const response = await fetch(`/api/workflows/${agent.workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })

      if (response.ok) {
        const data = await response.json().catch(() => null)
        if (typeof data?.workflow?.version === 'number') {
          agent.workflowVersionRef.current = data.workflow.version
        }
        ui.setSaveSuccess(true)
        ui.setHasChanges(false)

        ui.setSavedSnapshot({
          nodes: currentNodes,
          edges: currentEdges
        })
        if (opts?.withStatus) agent.setWorkflowStatus(opts.withStatus)
        return true
      } else {
        const error = await response.json().catch(() => null)
        if (error?.code === 'TRANSLATION_REQUIRES_RELIABLE_MODEL' && error?.error) {
          toast.error(error.error, { id: 'translation-model-guard', duration: Infinity, closeButton: true })
        } else if (error?.code === 'STALE_CONFLICT') {
          toast.error(t.workflow_version_conflict, { id: 'workflow-version-conflict', duration: Infinity, closeButton: true })
        } else if (error?.code === 'STATUS_CHANGED') {
          if (typeof error?.currentStatus === 'string') agent.setWorkflowStatus(error.currentStatus)
          toast.error(t.workflow_status_changed, { id: 'workflow-status-changed', duration: Infinity, closeButton: true })
        } else if (typeof error?.error === 'string' && error.error) {
          toast.error(error.error, { id: 'workflow-save-rejected', duration: Infinity, closeButton: true })
        } else {
          console.error('Save failed:', error)
        }
        ui.setSaveSuccess(false)
        setTimeout(() => ui.setSaveSuccess(null), 3000)
      }
    } catch (error) {
      console.error('Save error:', error)
      ui.setSaveSuccess(false)
      setTimeout(() => ui.setSaveSuccess(null), 3000)
    } finally {
      ui.setIsSaving(false)
    }
    return false
  }

  const handleReload = async () => {
    if (!agent.workflowId || isReloading) return

    if (ui.hasChanges) {
      const confirmed = window.confirm(t.reload_discard_confirm || t.unsaved_changes_confirm)
      if (!confirmed) return
    }

    setIsReloading(true)
    try {
      await reloadWorkflow()
    } finally {
      setIsReloading(false)
    }
  }

  const handleBackToWorkflowList = () => {
    if (ui.hasChanges) {
      const confirmed = window.confirm(t.unsaved_changes_confirm)
      if (!confirmed) {
        return
      }
    }
    if (agent.agentId) {
      router.push(`/app/agents/${agent.agentId}/workflows`)
    } else {
      router.push('/app')
    }
  }

  const handleDownloadJson = () => {
    try {
      const inferNodeType = (label?: string): string | undefined => {
        if (!label) return undefined
        const l = label.toLowerCase()
        if (l === 'imap' || l.startsWith('imap')) return 'imap'
        if (l === 'smtp' || l.startsWith('smtp')) return 'smtp'
        if (l === 'sendgrid') return 'sendgrid'
        if (l === 'telegram') return 'telegram'
        if (l === 'end') return 'end'
        return undefined
      }

      const workflowJson = {
        nodes: workflow.nodes.map(node => ({
          ...node,
          data: {
            ...node.data,
            icon: null,
            nodeType: node.data.nodeType || inferNodeType(node.data.label)
          }
        })),
        edges: workflow.edges
      }

      const formattedJson = JSON.stringify(workflowJson, null, 2)

      const blob = new Blob([formattedJson], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = `${agent.workflowName.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${agent.workflowId}.json`
      document.body.appendChild(link)
      link.click()

      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download workflow JSON:', error)
      alert(t.download_json_failed)
    }
  }

  const handleUploadJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const workflowJson = JSON.parse(content)

        if (!workflowJson.nodes || !Array.isArray(workflowJson.nodes)) {
          alert(t.upload_json_invalid)
          return
        }
        if (!workflowJson.edges || !Array.isArray(workflowJson.edges)) {
          alert(t.upload_json_invalid)
          return
        }

        if (!window.confirm(t.upload_json_confirm)) {
          return
        }

        const nodesWithIcons = restoreNodesWithIcons(workflowJson.nodes)
        workflow.setNodes(nodesWithIcons)
        workflow.setEdges(workflowJson.edges)

        ui.setHasChanges(true)
      } catch (error) {
        console.error('Failed to parse workflow JSON:', error)
        alert(t.upload_json_invalid)
      }
    }

    reader.onerror = () => {
      alert(t.upload_json_failed)
    }

    reader.readAsText(file)

    event.target.value = ''
  }

  return (
    <div className="flex items-center justify-between px-6 py-3 relative z-[60]">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToWorkflowList}
          className="text-gray-400 hover:text-white p-1"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>

        <input
          type="text"
          value={agent.workflowName}
          onChange={(e) => agent.setWorkflowName(e.target.value)}
          placeholder={t.workflow_name_placeholder}
          className="px-0 py-1 text-base font-medium bg-transparent text-white border-none outline-none focus:outline-none flex-shrink-0"
          style={{ width: `${Math.max(200, Math.min(500, (agent.workflowName?.length || 10) * 12 + 20))}px` }}
        />

        {ui.saveSuccess === false && (
          <span className="text-sm text-red-500">{t.save_failed}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {pstnStartWithWebVoice && (
          <Button
            variant="ghost"
            size="sm"
            onClick={openWebVoiceTest}
            className="px-2 h-auto py-1 text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30"
            title={t.web_voice_test || 'Test Web Voice call'}
          >
            <PhoneCall className="w-4 h-4" />
          </Button>
        )}

        {agent.workflowKind === 'sub' ? (
          <span
            className="px-2.5 py-1 text-xs font-medium rounded-md border text-pink-300 bg-pink-500/20 border-pink-500/30"
            title={t.subworkflow_header_hint || 'Sub-workflow — called by other workflows, no deploy. Saving takes effect immediately.'}
          >
            {t.toolsSubworkflow || 'Sub-workflow'}
          </span>
        ) : (
        <div className="flex items-center">
          <span className={`px-2.5 py-1 text-xs font-medium rounded-l-md border ${
            agent.workflowStatus === 'production'
              ? 'text-green-300 bg-green-500/20 border-green-500/30'
              : 'text-gray-400 bg-gray-500/10 border-gray-500/20'
          }`}>
            {agent.workflowStatus === 'production' ? (t.status_active || 'Active') : (t.status_draft || 'Draft')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={isStatusChanging || ui.isSaving}
            onClick={async () => {
              if (!agent.workflowId) return
              if (statusChangingRef.current) return
              setStatusError(null)
              const newStatus = agent.workflowStatus === 'production' ? 'draft' : 'production'

              const patchStatus = async (): Promise<boolean> => {
                const res = await fetch(`/api/workflows/${agent.workflowId}/status`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: newStatus })
                })
                if (res.ok) {
                  agent.setWorkflowStatus(newStatus)
                  return true
                }
                const data = await res.json().catch(() => null)
                const msg = (data?.error === 'free_limit_reached' || data?.error === 'paid_limit_reached')
                  ? (t.active_limit_reached || 'Active workflow limit reached.')
                  : (t.deploy_failed || 'Failed to change workflow status.')
                setStatusError(msg)
                setTimeout(() => setStatusError(null), 5000)
                return false
              }

              statusChangingRef.current = true
              setIsStatusChanging(true)
              try {
                if (newStatus === 'draft') {
                  //   (codex R1 #4 · kimi R1 #2 · kimi R2 #1)
                  if (ui.hasChanges) {
                    if (!(await handleSave({ withStatus: 'draft' }))) {
                      setStatusError(t.deploy_failed || 'Failed to change workflow status.')
                      setTimeout(() => setStatusError(null), 5000)
                    }
                  } else {
                    await patchStatus()
                  }
                } else {
                  if (ui.hasChanges && !(await handleSave())) return
                  await patchStatus()
                }
              } catch (err) {
                console.error('[WorkflowHeader] Status change failed:', err)
                setStatusError(t.deploy_failed || 'Failed to change workflow status.')
                setTimeout(() => setStatusError(null), 5000)
              } finally {
                statusChangingRef.current = false
                setIsStatusChanging(false)
              }
            }}
            className={`px-2.5 py-1 h-auto text-xs font-medium rounded-l-none rounded-r-md border border-l-0 transition-all ${
              agent.workflowStatus === 'production'
                ? 'text-gray-300 hover:text-white bg-gray-500/10 hover:bg-gray-500/20 border-green-500/30'
                : 'text-green-300 hover:text-green-200 bg-green-500/10 hover:bg-green-500/20 border-gray-500/20'
            }`}
          >
            {agent.workflowStatus === 'production' ? (t.status_draft || 'Draft') : (t.status_deploy || 'Deploy')}
          </Button>
        </div>
        )}

        {statusError && (
          <span className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded-md animate-in fade-in">
            {statusError}
          </span>
        )}

        {/* <Button
          variant="ghost"
          size="sm"
          onClick={() => ui.toggleAIAssistant()}
          className={`px-3 transition-all ${
            ui.showAIAssistant
              ? 'text-purple-300 hover:text-purple-200 bg-purple-500/20 hover:bg-purple-500/30'
              : 'text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20'
          }`}
        >
          <Sparkles className="w-4 h-4 mr-1.5" />
          {t.ai_assistant}
        </Button> */}

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleUploadJson}
          accept=".json"
          className="hidden"
        />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="text-gray-400 hover:text-white p-1"
          title={t.upload_json}
        >
          <Upload className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownloadJson}
          className="text-gray-400 hover:text-white p-1"
          title={t.download_json}
        >
          <Download className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleReload}
          disabled={isReloading}
          className="text-gray-400 hover:text-white p-1"
          title={t.reload_workflow || 'Reload from server'}
        >
          <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowHistory(true)}
          className="text-gray-400 hover:text-white p-1"
          title={t.history_title || 'Version History'}
        >
          <History className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => ui.setShowDebugPanel(!ui.showDebugPanel)}
          className={`px-3 transition-all ${
            test.isExecuting
              ? 'text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20'
              : ui.showDebugPanel
              ? 'text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20'
              : 'text-gray-400 hover:text-white hover:bg-transparent'
          }`}
        >
          <Eye className={`w-4 h-4 mr-1.5 ${test.isExecuting ? 'animate-pulse' : ''}`} />
          {test.isExecuting ? t.testing : t.test}
        </Button>

        <Button
          variant="default"
          size="sm"
          onClick={() => handleSave()}
          disabled={ui.isSaving || isStatusChanging || !ui.hasChanges}
          className={`px-4 transition-all ${
            !ui.hasChanges
              ? 'bg-gray-600 hover:bg-gray-600 text-white cursor-default'
              : 'bg-white hover:bg-gray-100 text-black'
          }`}
        >
          {ui.isSaving ? t.saving : !ui.hasChanges ? t.saved : t.save}
        </Button>
      </div>

      <WorkflowHistoryModal open={showHistory} onClose={() => setShowHistory(false)} />
    </div>
  )
}
