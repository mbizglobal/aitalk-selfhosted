import React, { useMemo, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { MobileBottomSheet } from './MobileBottomSheet'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { getHeaderInfo, isEditableLabelNode, renderNodePanel } from './sidebar'

export const WorkflowSidebarMobile: React.FC = () => {
  const { workflow, nodeHandlers } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const selectedNode = workflow.nodes.find(n => n.id === workflow.selectedNode)
  const updateSelectedNode = useCallback(
    (patch: Record<string, any>) => {
      if (!selectedNode) return
      nodeHandlers.updateNodeData(selectedNode.id, patch)
    },
    [selectedNode, nodeHandlers]
  )

  const handleClose = useCallback(() => {
    workflow.setSelectedNode(null)
    workflow.deselectAll()
  }, [workflow.setSelectedNode, workflow.deselectAll])

  const handleDelete = useCallback(() => {
    if (!selectedNode) return
    nodeHandlers.deleteNode(selectedNode.id)
    workflow.setSelectedNode(null)
  }, [selectedNode, nodeHandlers, workflow.setSelectedNode])

  const headerInfo = useMemo(
    () => getHeaderInfo(selectedNode, t),
    [selectedNode, t]
  )

  if (!selectedNode) return null

  const { title, description } = headerInfo

  return (
    <MobileBottomSheet
      isOpen={!!selectedNode}
      onClose={handleClose}
      onDelete={handleDelete}
      deleteConfirmMessage={t.delete_node_confirm}
      title={title}
      height="medium"
    >
      <div className="p-4">
        {isEditableLabelNode(selectedNode) && (
          <div className="mb-4">
            <Input
              value={selectedNode.data?.label || ''}
              onChange={(e) => updateSelectedNode({ label: e.target.value })}
              className="text-sm font-semibold text-gray-200 bg-[#1A1A1A] border-[#3A3A3A] focus:border-blue-500 px-3 mb-1"
              placeholder={title}
            />
            <p className="text-xs text-gray-400">{description}</p>
          </div>
        )}

        {renderNodePanel(selectedNode, updateSelectedNode, t)}
      </div>
    </MobileBottomSheet>
  )
}
