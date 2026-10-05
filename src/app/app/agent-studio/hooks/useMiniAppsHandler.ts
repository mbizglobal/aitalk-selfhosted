import { useEffect } from 'react'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { MINI_APP_TYPES } from '@/lib/workflow/mini-app-registry'

export function useMiniAppsHandler() {
  const { workflow } = useWorkflowContext()

  useEffect(() => {
    workflow.setNodes((nds) => {
      let changed = false
      const next = nds.map((node) => {
        const isAINode = node.data.nodeType === 'ai' || node.data.label === 'AI'
        if (!isAINode) return node

        const connectedEdges = workflow.edges.filter(
          (edge) => edge.source === node.id && edge.sourceHandle === 'miniapps'
        )
        const connectedIds = connectedEdges.map(e => e.target)
        const connectedMiniAppNodes = nds.filter(n =>
          connectedIds.includes(n.id) && n.type === 'tool' && n.data.nodeType === 'miniapp'
        )

        const hasMiniAppsConnection = connectedMiniAppNodes.length > 0
        const selectedMiniApps: Record<string, boolean> = {}
        for (const t of MINI_APP_TYPES) selectedMiniApps[t] = connectedMiniAppNodes.some(n => n.data.miniAppType === t)

        const current = node.data.selectedMiniApps || {}
        if (
          (node.data.hasMiniAppsConnection || false) === hasMiniAppsConnection &&
          MINI_APP_TYPES.every(t => (current[t] || false) === selectedMiniApps[t])
        ) {
          return node
        }

        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            hasMiniAppsConnection,
            selectedMiniApps,
          },
        }
      })

      return changed ? next : nds
    })
  }, [workflow.edges, workflow.setNodes])
}
