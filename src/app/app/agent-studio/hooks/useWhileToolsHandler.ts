import { useRef, useCallback, useEffect } from 'react'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { setGlobalAddLoopToolsHandler } from '../nodes/WhileNode'

export function useWhileToolsHandler() {
  const { workflow, ui } = useWorkflowContext()
  const handleAddLoopToolsRef = useRef<((whileNodeId: string) => void) | null>(null)

  handleAddLoopToolsRef.current = (whileNodeId: string) => {
    workflow.setSelectedNode(whileNodeId)

    setTimeout(() => {
      ui.setShowWhileToolsModal(true)
    }, 100)
  }

  const handleAddLoopTools = useCallback((whileNodeId: string) => {
    handleAddLoopToolsRef.current?.(whileNodeId)
  }, [])

  useEffect(() => {
    setGlobalAddLoopToolsHandler(handleAddLoopTools)
    return () => {
      setGlobalAddLoopToolsHandler(null)
    }
  }, [handleAddLoopTools])

  useEffect(() => {
    workflow.setNodes((nds) => {
      let changed = false
      const next = nds.map((node) => {
        const isWhileNode = node.type === 'while'
        if (!isWhileNode) return node

        const needUpdate = node.data.onAddLoopTools !== handleAddLoopTools

        if (needUpdate) {
          changed = true
          return {
            ...node,
            data: {
              ...node.data,
              onAddLoopTools: handleAddLoopTools
            }
          }
        }

        return node
      })
      return changed ? next : nds
    })
  }, [workflow.edges, workflow.setNodes, handleAddLoopTools])

  return {}
}
