import { useEffect, useRef } from 'react'
import { useWorkflowContext } from '../contexts/WorkflowContext'

export const useAutoFitView = () => {
  const { ui, workflow } = useWorkflowContext()
  const prevShowDebugPanel = useRef(ui.showDebugPanel)

  useEffect(() => {
    if (prevShowDebugPanel.current !== ui.showDebugPanel) {
      setTimeout(() => {
        if (workflow.reactFlowInstance) {
          workflow.reactFlowInstance.fitView({
            padding: 0.2,
            duration: 300
          })
        }
      }, 150)
      prevShowDebugPanel.current = ui.showDebugPanel
    }
  }, [ui.showDebugPanel, workflow.reactFlowInstance])
}
