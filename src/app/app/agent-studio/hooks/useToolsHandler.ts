import { useEffect, useRef, useCallback } from 'react'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { setGlobalAddToolHandler } from '../nodes/CustomNode'
import { isAiNode, deriveToolFlags, selectedToolsEqual } from '../utils/derived-tool-flags'

export function useToolsHandler() {
  const { workflow, ui } = useWorkflowContext()
  const handleAddToolRef = useRef<((aiNodeId: string) => void) | null>(null)

  handleAddToolRef.current = (aiNodeId: string) => {
    workflow.setSelectedNode(aiNodeId)

    setTimeout(() => {
      ui.openModal('tools', aiNodeId)
    }, 100)
  }

  const handleAddTool = useCallback((aiNodeId: string) => {
    handleAddToolRef.current?.(aiNodeId)
  }, [])

  useEffect(() => {
    setGlobalAddToolHandler(handleAddTool)
    return () => {
      setGlobalAddToolHandler(null)
    }
  }, [handleAddTool])

  useEffect(() => {
    workflow.setNodes((nds) => {
      let changed = false
      const next = nds.map((node) => {
        if (!isAiNode(node)) return node

        const { hasToolsConnection, selectedTools } = deriveToolFlags(node, nds, workflow.edges)

        if (
          node.data.hasToolsConnection === hasToolsConnection &&
          node.data.onAddTool === handleAddTool &&
          selectedToolsEqual(node.data.selectedTools, selectedTools)
        ) {
          return node
        }

        changed = true

        return {
          ...node,
          data: {
            ...node.data,
            hasToolsConnection,
            onAddTool: handleAddTool,
            selectedTools,
          },
        }
      })

      return changed ? next : nds
    })
  }, [workflow.edges, handleAddTool, workflow.setNodes])
}
