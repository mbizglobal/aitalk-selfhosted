'use client'

import React, { useEffect, useState } from 'react'
import { X, Save, Download, HelpCircle, MessageSquare, GripHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { isAiNode } from '../utils'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useDraggable } from '../hooks/useDraggable'

export function JsonOptionsModal() {
  const { ui, workflow, nodeHandlers } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const selectedAiNode = workflow.nodes.find(
    node => node.id === workflow.selectedNode && isAiNode(node)
  ) || workflow.nodes.find(isAiNode)

  // Local state
  const [saveAs, setSaveAs] = useState('')
  const [saveTempStorage, setSaveTempStorage] = useState(false)
  const [loadTempStorage, setLoadTempStorage] = useState(false)
  const [displayJsonInChat, setDisplayJsonInChat] = useState(false)

  const [initialState, setInitialState] = useState({ saveAs: '', saveTempStorage: false, loadTempStorage: false, displayJsonInChat: false })
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  useEffect(() => {
    if (ui.showJsonOptionsModal && selectedAiNode) {
      const nodeData = selectedAiNode.data || {}
      const initial = {
        saveAs: nodeData.saveAs || '',
        saveTempStorage: nodeData.saveTempStorage || false,
        loadTempStorage: nodeData.loadTempStorage || false,
        displayJsonInChat: nodeData.displayJsonInChat || false
      }
      setSaveAs(initial.saveAs)
      setSaveTempStorage(initial.saveTempStorage)
      setLoadTempStorage(initial.loadTempStorage)
      setDisplayJsonInChat(initial.displayJsonInChat)
      setInitialState(initial)
    }
  }, [ui.showJsonOptionsModal, selectedAiNode])

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showJsonOptionsModal })

  if (!ui.showJsonOptionsModal) return null

  const hasChanges =
    saveAs !== initialState.saveAs ||
    saveTempStorage !== initialState.saveTempStorage ||
    loadTempStorage !== initialState.loadTempStorage ||
    displayJsonInChat !== initialState.displayJsonInChat

  const handleSave = () => {
    if (selectedAiNode) {
      nodeHandlers.updateNodeData(selectedAiNode.id, {
        saveAs,
        saveTempStorage,
        loadTempStorage,
        displayJsonInChat
      })
    }
    ui.setShowJsonOptionsModal(false)
  }

  const handleClose = () => {
    if (hasChanges) {
      setShowConfirmDialog(true)
    } else {
      ui.setShowJsonOptionsModal(false)
    }
  }

  const handleDiscardAndClose = () => {
    setShowConfirmDialog(false)
    ui.setShowJsonOptionsModal(false)
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
          className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-2xl w-full max-h-[85vh] flex flex-col"
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
                <h2 className="text-lg font-semibold text-gray-200">{t.json_output_options}</h2>
                <p className="text-sm text-gray-400 mt-1">{t.configure_json_results}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
            {/* Save As */}
            <div className="p-4 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 rounded bg-blue-500/10">
                  <Save className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-gray-200">{t.save_as_variable}</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    {t.save_json_to_variable}
                  </p>
                </div>
              </div>
              <input
                type="text"
                value={saveAs}
                onChange={(e) => setSaveAs(e.target.value)}
                placeholder={t.variable_name_example}
                className="w-full px-3 py-2 bg-[#2A2A2A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600"
              />
              {saveAs && (
                <div className="mt-3 p-3 bg-[#2A2A2A] rounded border border-[#3A3A3A]">
                  <p className="text-xs text-gray-400">
                    <span className="text-blue-400">{t.usage}:</span> {t.access_in_next_nodes}{' '}
                    <code className="px-1.5 py-0.5 bg-[#1A1A1A] text-indigo-400 rounded">
                      {`{{context.${saveAs}}}`}
                    </code>
                  </p>
                </div>
              )}
            </div>

            {/* Save to Temp Storage */}
            <div className="p-4 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 rounded bg-green-500/10">
                    <Save className="w-5 h-5 text-green-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-200">{t.save_to_temp_storage}</h3>
                    <p className="text-xs text-gray-400 mt-1">
                      {t.persist_json_result}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={saveTempStorage}
                  onChange={(e) => setSaveTempStorage(e.target.checked)}
                  className="w-5 h-5 rounded bg-[#3A3A3A] border-[#3A3A3A] mt-1"
                />
              </div>
              <div className="mt-4 p-3 bg-[#2A2A2A] rounded border border-[#3A3A3A]">
                <div className="flex items-start gap-2">
                  <HelpCircle className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-gray-400 space-y-2">
                    <p><span className="text-green-400 font-medium">{t.use_case}:</span> {t.multi_turn_extraction}</p>
                    <p>{t.first_conversation_step}</p>
                    <p>{t.user_reviews_step}</p>
                    <p>{t.next_conversation_step}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Load from Temp Storage */}
            <div className="p-4 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 rounded bg-purple-500/10">
                    <Download className="w-5 h-5 text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-200">{t.load_from_temp_storage}</h3>
                    <p className="text-xs text-gray-400 mt-1">
                      {t.load_saved_data}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={loadTempStorage}
                  onChange={(e) => setLoadTempStorage(e.target.checked)}
                  className="w-5 h-5 rounded bg-[#3A3A3A] border-[#3A3A3A] mt-1"
                />
              </div>
              <div className="mt-4 p-3 bg-[#2A2A2A] rounded border border-[#3A3A3A]">
                <div className="flex items-start gap-2">
                  <HelpCircle className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-gray-400 space-y-2">
                    <p><span className="text-purple-400 font-medium">{t.how_it_works}:</span></p>
                    <p>• {t.json_loaded_as_context}</p>
                    <p>• {t.user_can_verify}</p>
                    <p>• {t.ai_updates_json}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Display JSON in Chat */}
            <div className="p-4 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 rounded bg-cyan-500/10">
                    <MessageSquare className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-200">{t.display_json_in_chat}</h3>
                    <p className="text-xs text-gray-400 mt-1">
                      {t.display_json_in_chat_desc}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={displayJsonInChat}
                  onChange={(e) => setDisplayJsonInChat(e.target.checked)}
                  className="w-5 h-5 rounded bg-[#3A3A3A] border-[#3A3A3A] mt-1"
                />
              </div>
              <div className="mt-4 p-3 bg-[#2A2A2A] rounded border border-[#3A3A3A]">
                <div className="flex items-start gap-2">
                  <HelpCircle className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-400">
                    {t.display_json_in_chat_note}
                  </p>
                </div>
              </div>
            </div>

            {/* Combined Workflow Example */}
            <div className="p-4 bg-gradient-to-r from-blue-500/5 to-purple-500/5 rounded-lg border border-[#3A3A3A]">
              <h4 className="text-sm font-medium text-gray-200 mb-3 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 rounded text-xs">{t.example_label}</span>
                {t.receipt_extraction_workflow}
              </h4>
              <div className="space-y-2 text-xs text-gray-400">
                <p className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs">1</span>
                  {t.user_uploads_receipt}
                </p>
                <p className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-xs">2</span>
                  {t.ai_extracts_saves} → <code className="px-1 bg-[#2A2A2A] rounded">{t.save_to_temp_storage}</code>
                </p>
                <p className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center text-xs">3</span>
                  {t.user_total_correction}
                </p>
                <p className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs">4</span>
                  <code className="px-1 bg-[#2A2A2A] rounded">{t.load_from_temp_storage}</code> → {t.load_correct_save}
                </p>
              </div>
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
              {t.unsaved_changes_desc}
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={handleSaveAndClose} className="w-full">
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
