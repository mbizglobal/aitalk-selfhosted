'use client'

import React, { useEffect, useState, useRef, useMemo } from 'react'
import { X, Variable, ChevronDown, FileText, GripHorizontal, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { isAiNode } from '../utils'
import { getNodeTypeEmoji, getNodeTypeColor } from '../utils/analyzeDependencies'
import { VariableChipEditor, VariableChipEditorRef } from '../components/VariableChipEditor'
import { SYSTEM_MESSAGE_TEMPLATES } from '../constants/systemMessageTemplates'
import { useDraggable } from '../hooks/useDraggable'

export function InstructionsModal() {
  const { ui, agent, workflow, nodeHandlers, reloadWorkflow } = useWorkflowContext()
  const { lang, t: mainT } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const editorRef = useRef<VariableChipEditorRef>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const templateDropdownRef = useRef<HTMLDivElement>(null)
  const [showVariableDropdown, setShowVariableDropdown] = useState(false)
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowVariableDropdown(false)
      }
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(event.target as Node)) {
        setShowTemplateDropdown(false)
      }
    }

    if (showVariableDropdown || showTemplateDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showVariableDropdown, showTemplateDropdown])

  const selectedAiNode = workflow.nodes.find(node => node.id === workflow.selectedNode && isAiNode(node)) ||
    workflow.nodes.find(isAiNode)

  const currentNodeId = selectedAiNode?.id

  const availableVariables = useMemo(() => {
    if (!currentNodeId) return []

    const currentIndex = workflow.nodes.findIndex(n => n.id === currentNodeId)
    if (currentIndex === -1) return []

    const variables = workflow.nodes.slice(0, currentIndex)
      .filter(n => {
        const nodeType = n.data?.nodeType || n.type
        return nodeType !== 'start' && nodeType !== 'end' && nodeType !== 'note'
      })
      .map(node => ({
        nodeId: node.id,
        nodeName: node.data?.label || node.id,
        nodeType: node.data?.nodeType || node.type || 'unknown',
      }))

    variables.push({
      nodeId: 'message',
      nodeName: 'User Message',
      nodeType: 'system'
    })

    return variables
  }, [workflow.nodes, currentNodeId])

  const insertVariable = (nodeId: string) => {
    if (!editorRef.current) return
    editorRef.current.insertVariable(nodeId)
    setShowVariableDropdown(false)
  }

  const insertTemplate = (templateId: string) => {
    const template = SYSTEM_MESSAGE_TEMPLATES.find(t => t.id === templateId)
    if (!template) return

    const currentValue = instructions.trim()
    const newValue = currentValue
      ? `${currentValue}\n\n${template.content}`
      : template.content

    setInstructions(newValue)
    setShowTemplateDropdown(false)
  }

  const defaultMessage = mainT.default_system_message || 'You are a helpful AI assistant.'

  const getCurrentValue = () => {
    const nodeMessage = selectedAiNode?.data?.systemMessage

    if (nodeMessage !== undefined && nodeMessage !== null) {
      return nodeMessage
    }

    const agentMessage = agent.aiSystemMessage
    if (agentMessage !== undefined && agentMessage !== null && agentMessage !== '') {
      return agentMessage
    }

    return ''
  }

  const [instructions, setInstructions] = useState(getCurrentValue())
  const [initialInstructions, setInitialInstructions] = useState('')
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showInstructionsModal })

  useEffect(() => {
    if (ui.showInstructionsModal) {
      const currentValue = getCurrentValue()
      setInstructions(currentValue)
      setInitialInstructions(currentValue)
    }
  }, [ui.showInstructionsModal])

  if (!ui.showInstructionsModal) return null

  const updateSelectedAiNodeData = (data: any) => {
    const selected =
      workflow.nodes.find(node => node.id === workflow.selectedNode && isAiNode(node)) ||
      workflow.nodes.find(isAiNode)

    if (selected) {
      nodeHandlers.updateNodeData(selected.id, data)
    }
  }

  const hasChanges = instructions !== initialInstructions

  const handleReloadInstructions = async () => {
    if (hasChanges || ui.hasChanges) {
      const confirmed = window.confirm(t.reload_discard_confirm || t.unsaved_changes_confirm)
      if (!confirmed) return
    }
    const result = await reloadWorkflow()
    if (!result) return
    const fresh = result.nodes.find((n: any) => n.id === currentNodeId && isAiNode(n))
    if (!fresh) return
    workflow.setSelectedNode(fresh.id)
    const value = fresh.data?.systemMessage ?? ''
    setInstructions(value)
    setInitialInstructions(value)
  }

  const handleSave = () => {
    agent.setAiSystemMessage(instructions)
    updateSelectedAiNodeData({ systemMessage: instructions })
    ui.setShowInstructionsModal(false)
  }

  const handleClose = () => {
    if (hasChanges) {
      setShowConfirmDialog(true)
    } else {
      ui.setShowInstructionsModal(false)
    }
  }

  const handleDiscardAndClose = () => {
    setShowConfirmDialog(false)
    ui.setShowInstructionsModal(false)
  }

  const handleSaveAndClose = () => {
    setShowConfirmDialog(false)
    handleSave()
  }

  return (
    <>
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    >
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-3xl w-full max-h-[85vh] flex flex-col"
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
              <h2 className="text-lg font-semibold text-gray-200">{t.system_message_title}</h2>
              <p className="text-sm text-gray-400 mt-1">{t.system_message_desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReloadInstructions}
              className="p-1.5 rounded transition-colors text-gray-400 hover:text-gray-200"
              title={t.reload_instructions || 'Reload from canvas'}
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto system-message-scrollbar p-6">
          <div className="mb-3 flex items-center gap-2">
            <div className="relative" ref={dropdownRef}>
              <Button
                variant="outline"
                size="sm"
                className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] gap-2"
                onClick={() => setShowVariableDropdown(!showVariableDropdown)}
              >
                <Variable className="w-4 h-4" />
                Insert Variable
                <ChevronDown className="w-3 h-3" />
              </Button>
              {showVariableDropdown && availableVariables.length > 0 && (
                <div className="absolute top-full left-0 mt-1 z-10 bg-[#1E1E1E] border border-gray-700 rounded-lg shadow-lg max-h-[200px] overflow-y-auto scrollbar-thin min-w-[220px]">
                  <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-700">
                    Select a variable to insert
                  </div>
                  {availableVariables.map((item) => {
                    const emoji = getNodeTypeEmoji(item.nodeType)
                    const colorClass = getNodeTypeColor(item.nodeType)

                    return (
                      <button
                        key={item.nodeId}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-700/50 transition-colors"
                        onClick={() => insertVariable(item.nodeId)}
                      >
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded border ${colorClass}`}>
                          <span className="text-[10px]">{emoji}</span>
                          <span className="truncate max-w-[140px]">{item.nodeName}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="relative" ref={templateDropdownRef}>
              <Button
                variant="outline"
                size="sm"
                className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] gap-2"
                onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
              >
                <FileText className="w-4 h-4" />
                {t.insert_template}
                <ChevronDown className="w-3 h-3" />
              </Button>
              {showTemplateDropdown && (
                <div className="absolute top-full left-0 mt-1 z-10 bg-[#1E1E1E] border border-gray-700 rounded-lg shadow-lg min-w-[280px]">
                  <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-700">
                    {t.select_template_to_insert}
                  </div>
                  {SYSTEM_MESSAGE_TEMPLATES.map((template) => {
                    const templateName = template.id === 'ai-chatbot' ? t.template_ai_chatbot : t.template_web_search_stock
                    const templateDesc = template.id === 'ai-chatbot' ? t.template_ai_chatbot_desc : t.template_web_search_stock_desc

                    return (
                      <button
                        key={template.id}
                        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-700/50 transition-colors"
                        onClick={() => insertTemplate(template.id)}
                      >
                        <span className="text-lg flex-shrink-0">{template.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-200 font-medium">{templateName}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{templateDesc}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <VariableChipEditor
            ref={editorRef}
            value={instructions}
            onChange={setInstructions}
            placeholder={defaultMessage}
            availableVariables={availableVariables}
            minHeight="350px"
          />
      </div>

        {/* Footer */}
        <div className="p-6 border-t border-[#3A3A3A] flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={handleClose}
          className="border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A]"
        >
          {t.cancel}
        </Button>
        <Button onClick={handleSave}>
          {t.save}
        </Button>
        </div>
      </div>
    </div>

    {showConfirmDialog && (
      <div
        className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
      >
        <div
          className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-md w-full p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-gray-200 mb-2">{t.unsaved_changes}</h3>
          <p className="text-sm text-gray-400 mb-6">
            {t.unsaved_changes_question}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleSaveAndClose}
              className="w-full"
            >
              {t.save_and_close}
            </Button>
            <Button
              variant="outline"
              onClick={handleDiscardAndClose}
              className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A]"
            >
              {t.discard_changes}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowConfirmDialog(false)}
              className="w-full text-gray-400 hover:text-gray-200"
            >
              {t.cancel}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
