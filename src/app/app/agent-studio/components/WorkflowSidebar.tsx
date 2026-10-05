import React, { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { getHeaderInfo, isEditableLabelNode, renderNodePanel } from './sidebar'

export const WorkflowSidebar: React.FC = () => {
  const { workflow, nodeHandlers, ui, reloadWorkflow, reloadGeneration } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const [isReloading, setIsReloading] = useState(false)

  const handleReload = async () => {
    if (isReloading) return
    if (ui.hasChanges && !window.confirm(t.reload_discard_confirm || t.unsaved_changes_confirm)) return
    setIsReloading(true)
    try {
      await reloadWorkflow()
    } finally {
      setIsReloading(false)
    }
  }

  const selectedNode = workflow.nodes.find(n => n.id === workflow.selectedNode)
  const updateSelectedNode = React.useCallback(
    (patch: Record<string, any>) => {
      if (!selectedNode) return
      nodeHandlers.updateNodeData(selectedNode.id, patch)
    },
    [selectedNode, nodeHandlers]
  )

  const headerInfo = useMemo(
    () => getHeaderInfo(selectedNode, t),
    [selectedNode, t]
  )

  if (!selectedNode) return null

  const { title, description } = headerInfo

  return (
    <div className="absolute right-4 top-20 w-[370px] max-h-[calc(100vh-6rem)] bg-[#2A2A2A]/95 backdrop-blur-sm rounded-lg shadow-2xl border border-[#3A3A3A] flex flex-col overflow-hidden">
      <div className="p-4 border-b border-[#3A3A3A] flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isEditableLabelNode(selectedNode) ? (
            <>
              <Input
                value={selectedNode.data?.label || ''}
                onChange={(e) => updateSelectedNode({ label: e.target.value })}
                className="text-sm font-semibold text-gray-200 bg-transparent border-transparent hover:border-[#3A3A3A] focus:border-[#3A3A3A] px-3 mb-1"
                placeholder={title}
              />
              <p className="text-xs text-gray-400">{description}</p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
              <p className="text-xs text-gray-400 mt-1">{description}</p>
            </>
          )}
        </div>
        <button
          onClick={handleReload}
          disabled={isReloading}
          aria-label={t.reload_workflow || 'Reload from server'}
          aria-busy={isReloading}
          className="shrink-0 p-1.5 rounded transition-colors text-gray-400 hover:text-gray-200"
          title={t.reload_workflow || 'Reload from server'}
        >
          <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div
        className="flex-1 p-4 overflow-y-auto properties-panel-scrollbar"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#3A3A3A #2A2A2A'
        }}
      >
        <div key={`${selectedNode.id}:${reloadGeneration}`}>
          {renderNodePanel(selectedNode, updateSelectedNode, t)}
        </div>
      </div>
    </div>
  )
}
