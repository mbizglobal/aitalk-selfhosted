'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { X, Plus, GraduationCap, GripHorizontal, FileSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { isAiNode } from '../utils'
import type { Node } from 'reactflow'
import { toast } from 'sonner'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { isQuizAllowedModel, QUIZ_ALLOWED_MODELS, QUIZ_MODEL_FALLBACK } from '@/lib/workflow/validate-quiz-model'
import { useDraggable } from '../hooks/useDraggable'
import { MINI_APP_REGISTRY, miniAppChannelOf, miniAppsForChannel, type MiniAppType } from '@/lib/workflow/mini-app-registry'
import { replaceRetiredChatModel } from '@/lib/managed/model-lineup'

interface MiniAppItem {
  id: string
  name: string
}

const MINIAPP_STYLE: Record<MiniAppType, { color: string; textColor: string }> = {
  quiz: { color: 'bg-purple-500', textColor: 'text-white' },
  voice_quiz: { color: 'bg-purple-500', textColor: 'text-white' },
}

export function MiniAppModal() {
  const { ui, workflow, nodeHandlers } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [tempQuizItems, setTempQuizItems] = useState<MiniAppItem[]>([])
  const [confirmAddSource, setConfirmAddSource] = useState(false)
  const [autoAddSource, setAutoAddSource] = useState(false)
  const [confirmSwitchModel, setConfirmSwitchModel] = useState(false)

  const closeModal = () => {
    ui.setShowMiniAppModal(false)
    ui.setMiniAppModalAiNodeId(null)
  }

  const activeAiNode = useMemo(
    () => {
      const nodeId = ui.miniAppModalAiNodeId || workflow.selectedNode
      return workflow.nodes.find(node => node.id === nodeId && isAiNode(node))
    },
    [workflow.nodes, workflow.selectedNode, ui.miniAppModalAiNodeId]
  )

  const channel = useMemo(() => miniAppChannelOf(workflow.nodes), [workflow.nodes])
  const selectableTypes = useMemo(() => (channel ? miniAppsForChannel(channel) : []), [channel])
  const appType: MiniAppType | null = selectableTypes[0] ?? null
  const appLabel = appType ? MINI_APP_REGISTRY[appType].label : 'Quiz'
  const appStyle = MINIAPP_STYLE[appType ?? 'quiz']

  const hasSourceTool = useMemo(() => {
    if (!activeAiNode) return false
    const toolEdges = workflow.edges.filter(
      e => e.source === activeAiNode.id && e.sourceHandle === 'tools'
    )
    const toolNodeIds = toolEdges.map(e => e.target)
    return workflow.nodes.some(n =>
      toolNodeIds.includes(n.id) && n.type === 'tool' && n.data?.toolType === 'source'
    )
  }, [activeAiNode, workflow.edges, workflow.nodes])

  const currentModel: string = (activeAiNode?.data as any)?.model || ''
  const modelBlocked = appType === 'quiz' && !!currentModel && !isQuizAllowedModel(replaceRetiredChatModel(currentModel))

  const addQuizItem = () => setTempQuizItems([{ id: `${appType ?? 'quiz'}-${Date.now()}`, name: appLabel }])

  // Sync with canvas on modal open
  useEffect(() => {
    if (!ui.showMiniAppModal || !activeAiNode) return

    const connectedEdges = workflow.edges.filter(
      e => e.source === activeAiNode.id && e.sourceHandle === 'miniapps'
    )
    const connectedIds = connectedEdges.map(e => e.target)
    const miniAppNodes = workflow.nodes.filter(n =>
      connectedIds.includes(n.id) && n.type === 'tool' && n.data?.nodeType === 'miniapp'
    )
    setTempQuizItems(
      miniAppNodes
        .filter(n => appType !== null && n.data?.miniAppType === appType)
        .map(n => ({ id: n.id, name: n.data.label }))
    )
    setConfirmAddSource(false)
    setAutoAddSource(false)
    setConfirmSwitchModel(false)
  }, [ui.showMiniAppModal, activeAiNode, workflow.edges, workflow.nodes, appType])

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showMiniAppModal })

  if (!ui.showMiniAppModal) return null

  const handleSave = () => {
    if (!activeAiNode) {
      toast.error(t.please_select_ai_node)
      return
    }

    const existingIds = workflow.nodes
      .filter(n => n.type === 'tool' && n.data?.nodeType === 'miniapp')
      .filter(n => workflow.edges.some(
        e => e.source === activeAiNode.id && e.sourceHandle === 'miniapps' && e.target === n.id
      ))
      .map(n => n.id)

    const hasMiniApps = tempQuizItems.length > 0
    const keptId = hasMiniApps && existingIds.includes(tempQuizItems[0].id) ? tempQuizItems[0].id : null
    const removeIds = existingIds.filter(id => id !== keptId)

    const newNodes: Node[] = []
    const newEdges: any[] = []

    if (hasMiniApps && !keptId && appType) {
      const item = tempQuizItems[0]
      const nodeId = `miniapp-${appType}-${Date.now()}`
      newNodes.push({
        id: nodeId,
        type: 'tool',
        data: {
          label: item.name,
          icon: GraduationCap,
          color: appStyle.color,
          toolType: 'miniapp',
          nodeType: 'miniapp',
          miniAppType: appType,
        },
        position: {
          x: activeAiNode.position.x + 260,
          y: activeAiNode.position.y + 150,
        }
      })
      newEdges.push({
        id: `e-${activeAiNode.id}-${nodeId}`,
        source: activeAiNode.id,
        sourceHandle: 'miniapps',
        target: nodeId,
        type: 'toolEdge',
        animated: false,
        markerEnd: undefined,
        style: { stroke: '#a855f7' },
      })
    }

    if (hasMiniApps && autoAddSource && !hasSourceTool) {
      const sourceNodeId = `tool-source-${Date.now()}`
      newNodes.push({
        id: sourceNodeId,
        type: 'tool',
        data: {
          label: 'Source',
          icon: FileSearch,
          color: 'bg-yellow-500',
          toolType: 'source',
        },
        position: {
          x: activeAiNode.position.x + 150,
          y: activeAiNode.position.y + 150,
        }
      })
      newEdges.push({
        id: `e-${activeAiNode.id}-${sourceNodeId}`,
        source: activeAiNode.id,
        sourceHandle: 'tools',
        target: sourceNodeId,
        type: 'toolEdge',
        animated: false,
        markerEnd: undefined,
      })
    }

    workflow.setNodes(nds => [
      ...nds
        .filter(n => !removeIds.includes(n.id))
        .map(n => n.id === activeAiNode.id
          ? {
              ...n,
              data: {
                ...n.data,
                hasMiniAppsConnection: hasMiniApps,
                selectedMiniApps: { ...(n.data?.selectedMiniApps || {}), ...(appType ? { [appType]: hasMiniApps } : {}) },
              }
            }
          : n
        ),
      ...newNodes,
    ])
    workflow.setEdges(eds => [
      ...eds.filter(e => !removeIds.includes(e.source) && !removeIds.includes(e.target)),
      ...newEdges,
    ])

    closeModal()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-md w-full max-h-[85vh] flex flex-col"
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="p-6 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-200">{t.select_mini_app}</h2>
              <p className="text-sm text-gray-400 mt-1">{appType === 'voice_quiz' ? t.choose_miniapp_desc_pstn : t.choose_miniapp_desc}</p>
            </div>
          </div>
          <button
            onClick={() => closeModal()}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto system-message-scrollbar p-6 space-y-6">
          {/* Quiz Section (max 1) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded ${appStyle.color}`}>
                  <GraduationCap className="w-4 h-4 text-white" />
                </div>
                <label className="text-sm font-medium text-gray-200">{appLabel}</label>
              </div>
              <span className="text-xs text-gray-400">{tempQuizItems.length}/1</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">{appType === 'voice_quiz' ? t.miniapp_voice_quiz_desc : t.miniapp_quiz_desc}</p>
            <div className="flex flex-wrap gap-2">
              {tempQuizItems.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg ${appStyle.color} text-white`}
                >
                  <span className="text-sm font-medium">{item.name}</span>
                  <button onClick={() => setTempQuizItems([])} className="hover:opacity-70">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {tempQuizItems.length === 0 && appType && (
                <button
                  onClick={() => {
                    if (modelBlocked) {
                      setConfirmSwitchModel(true)
                      return
                    }
                    if (!hasSourceTool && !autoAddSource) {
                      setConfirmAddSource(true)
                      return
                    }
                    addQuizItem()
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-sm font-medium">{appType === 'voice_quiz' ? t.add_voice_quiz : t.add_quiz}</span>
                </button>
              )}
            </div>

            {confirmSwitchModel && (
              <div className="mt-3 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                <p className="text-xs text-gray-300 mb-3">
                  {t.quiz_model_not_supported.replace('{model}', currentModel).replace('{allowed}', QUIZ_ALLOWED_MODELS.join(', '))}
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A]"
                    onClick={() => setConfirmSwitchModel(false)}
                  >
                    {t.cancel}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => {
                      nodeHandlers.updateNodeData(activeAiNode!.id, { model: QUIZ_MODEL_FALLBACK })
                      setConfirmSwitchModel(false)
                      if (!hasSourceTool && !autoAddSource) { setConfirmAddSource(true); return }
                      addQuizItem()
                    }}
                  >
                    {t.quiz_model_switch_ok.replace('{model}', QUIZ_MODEL_FALLBACK)}
                  </Button>
                </div>
              </div>
            )}

            {confirmAddSource && (
              <div className="mt-3 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
                <p className="text-xs text-gray-300 mb-3">{t.miniapp_add_source_question}</p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A]"
                    onClick={() => setConfirmAddSource(false)}
                  >
                    {t.cancel}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs bg-yellow-600 hover:bg-yellow-700 text-white"
                    onClick={() => {
                      setAutoAddSource(true)
                      setConfirmAddSource(false)
                      addQuizItem()
                    }}
                  >
                    {t.miniapp_add_source_ok}
                  </Button>
                </div>
              </div>
            )}

            {autoAddSource && !hasSourceTool && tempQuizItems.length > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400">
                <FileSearch className="w-3.5 h-3.5" />
                {t.miniapp_source_will_be_added}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#3A3A3A] flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A]"
            onClick={() => closeModal()}
          >
            {t.cancel}
          </Button>
          <Button
            size="sm"
            className="bg-purple-600 hover:bg-purple-700 text-white"
            onClick={handleSave}
          >
            {t.save}
          </Button>
        </div>
      </div>
    </div>
  )
}
