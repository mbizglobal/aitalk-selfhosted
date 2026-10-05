'use client'

import React, { useEffect, useState } from 'react'
import { X, GripHorizontal, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useDraggable } from '../hooks/useDraggable'

export function SendGridBodyModal() {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { ui, workflow, nodeHandlers, reloadWorkflow } = useWorkflowContext()

  const selectedNode = workflow.nodes.find(
    node => node.id === workflow.selectedNode && node.data?.nodeType === 'sendgrid'
  )

  const [bodyTemplate, setBodyTemplate] = useState('')
  const [initialBodyTemplate, setInitialBodyTemplate] = useState('')
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  useEffect(() => {
    if (ui.showSendGridBodyModal && selectedNode) {
      const currentValue = selectedNode.data?.bodyTemplate || '{{context.aiResponse}}'
      setBodyTemplate(currentValue)
      setInitialBodyTemplate(currentValue)
    }
  }, [ui.showSendGridBodyModal, selectedNode])

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showSendGridBodyModal })

  if (!ui.showSendGridBodyModal) return null

  const hasChanges = bodyTemplate !== initialBodyTemplate

  const handleSave = () => {
    if (selectedNode) {
      nodeHandlers.updateNodeData(selectedNode.id, { bodyTemplate })
    }
    ui.setShowSendGridBodyModal(false)
  }

  const handleClose = () => {
    if (hasChanges) {
      setShowConfirmDialog(true)
    } else {
      ui.setShowSendGridBodyModal(false)
    }
  }

  const handleDiscardAndClose = () => {
    setShowConfirmDialog(false)
    ui.setShowSendGridBodyModal(false)
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
              <h2 className="text-lg font-semibold text-gray-200">{t.email_body_template}</h2>
              <p className="text-sm text-gray-400 mt-1">
                {t.email_body_template_desc}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if ((hasChanges || ui.hasChanges) && !window.confirm(t.reload_discard_confirm || t.unsaved_changes_confirm)) return
                await reloadWorkflow()
              }}
              className="p-1.5 rounded transition-colors text-gray-400 hover:text-gray-200"
              title={t.reload_workflow || 'Reload from server'}
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
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <textarea
            className="w-full h-[400px] px-4 py-3 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary text-sm resize-none font-mono"
            placeholder="{{context.aiResponse}}"
            value={bodyTemplate}
            onChange={(e) => setBodyTemplate(e.target.value)}
          />

          {/* Template Variables Help */}
          <div className="mt-4 p-4 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
            <p className="text-sm font-medium text-gray-200 mb-3">{t.available_variables}</p>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <code className="text-xs px-2 py-1 bg-[#2A2A2A] text-indigo-400 rounded whitespace-nowrap">{`{{context.aiResponse}}`}</code>
                <span className="text-xs text-gray-400">{t.var_ai_response_desc}</span>
              </div>
              <div className="flex items-start gap-3">
                <code className="text-xs px-2 py-1 bg-[#2A2A2A] text-indigo-400 rounded whitespace-nowrap">{`{{message}}`}</code>
                <span className="text-xs text-gray-400">{t.var_message_desc}</span>
              </div>
              <div className="flex items-start gap-3">
                <code className="text-xs px-2 py-1 bg-[#2A2A2A] text-indigo-400 rounded whitespace-nowrap">{`{{context.userName}}`}</code>
                <span className="text-xs text-gray-400">{t.var_user_name_desc}</span>
              </div>
              <div className="flex items-start gap-3">
                <code className="text-xs px-2 py-1 bg-[#2A2A2A] text-indigo-400 rounded whitespace-nowrap">{`{{jsonData.xxx}}`}</code>
                <span className="text-xs text-gray-400">{t.var_json_data_desc}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3 pt-3 border-t border-[#3A3A3A]">
              💡 {t.markdown_tip}
            </p>
          </div>
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
