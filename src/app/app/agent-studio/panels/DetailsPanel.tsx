'use client'

import React, { useState } from 'react'
import { AlertCircle, Copy, Check, Maximize2 } from 'lucide-react'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'
import { formatPayloadPreview } from '../utils'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useLanguage } from '@/hooks/useLanguage'

interface DetailsPanelProps {
  selectedStepIndex: number | null
  executionLogs: WorkflowDebugLogEntry[]
  canExpandPayload: boolean
  handleLogBoxClick: (type: 'input' | 'output') => void
}

export function DetailsPanel({
  selectedStepIndex,
  executionLogs,
  canExpandPayload,
  handleLogBoxClick
}: DetailsPanelProps) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const [copiedInput, setCopiedInput] = useState(false)
  const [copiedOutput, setCopiedOutput] = useState(false)

  const handleCopy = (data: any, type: 'input' | 'output') => {
    const text = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data)
    navigator.clipboard.writeText(text)
    if (type === 'input') {
      setCopiedInput(true)
      setTimeout(() => setCopiedInput(false), 1500)
    } else {
      setCopiedOutput(true)
      setTimeout(() => setCopiedOutput(false), 1500)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#1A1A1A]">
      <div className="p-3 border-b border-[#3A3A3A]">
        <h3 className="text-sm font-medium text-gray-200">{t.details}</h3>
        {selectedStepIndex !== null && executionLogs[selectedStepIndex] && (
          <p className="text-[10px] text-gray-500 mt-1">
            {t.step_x_of_y.replace('{x}', String(selectedStepIndex + 1)).replace('{y}', String(executionLogs.length))}
          </p>
        )}
      </div>
      <div className="flex-1 overflow-y-scroll p-3 test-panel-scrollbar">
        {selectedStepIndex === null ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <p className="text-xs">{t.no_step_selected}</p>
              <p className="text-[10px] mt-1">{t.click_step_to_view}</p>
            </div>
          </div>
        ) : executionLogs[selectedStepIndex] ? (
          <div className="space-y-3">
            {/* Step Header */}
            <div className={`bg-[#0A0A0A] border rounded-lg p-3 ${
              executionLogs[selectedStepIndex].status === 'error'
                ? 'border-red-500/50'
                : 'border-[#3A3A3A]'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <h4 className={`text-sm font-semibold ${
                  executionLogs[selectedStepIndex].status === 'error'
                    ? 'text-red-400'
                    : 'text-white'
                }`}>
                  {executionLogs[selectedStepIndex].nodeName}
                </h4>
                <span className="text-xs text-gray-400">
                  {executionLogs[selectedStepIndex].duration}ms
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  executionLogs[selectedStepIndex].status === 'error'
                    ? 'bg-red-500'
                    : 'bg-green-500'
                }`} />
                <span className={`text-xs font-medium ${
                  executionLogs[selectedStepIndex].status === 'error'
                    ? 'text-red-400'
                    : 'text-green-400'
                }`}>
                  {executionLogs[selectedStepIndex].status === 'error' ? t.failed : t.success}
                </span>
              </div>
            </div>

            {/* Error Message */}
            {executionLogs[selectedStepIndex].status === 'error' && executionLogs[selectedStepIndex].error && (
              <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-red-400 mb-1">{t.error}</p>
                    <p className="text-xs text-red-300 leading-relaxed">
                      {executionLogs[selectedStepIndex].error}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="group">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-400 font-medium">{t.input}</p>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canExpandPayload && (
                    <button
                      onClick={() => handleLogBoxClick('input')}
                      className="p-1 hover:bg-[#3A3A3A] rounded transition-colors"
                      title={t.view_in_popup}
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300" />
                    </button>
                  )}
                  <button
                    onClick={() => handleCopy(executionLogs[selectedStepIndex].input, 'input')}
                    className="p-1 hover:bg-[#3A3A3A] rounded transition-colors"
                    title={t.copy}
                  >
                    {copiedInput ? (
                      <Check className="w-3.5 h-3.5 text-green-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300" />
                    )}
                  </button>
                </div>
              </div>
              <div
                className={`bg-[#0A0A0A] border border-[#3A3A3A] rounded-lg relative ${
                  canExpandPayload ? 'cursor-pointer hover:border-gray-400 transition-colors' : ''
                }`}
                onClick={() => {
                  if (canExpandPayload) {
                    handleLogBoxClick('input')
                  }
                }}
              >
                <div className="max-h-56 overflow-hidden">
                  <pre className="text-[10px] text-gray-300 p-3 whitespace-pre-wrap break-all">
                    {formatPayloadPreview(executionLogs[selectedStepIndex].input)}
                  </pre>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#0A0A0A] to-transparent" />
              </div>
            </div>

            {/* Output */}
            <div className="group">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-400 font-medium">{t.output}</p>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canExpandPayload && (
                    <button
                      onClick={() => handleLogBoxClick('output')}
                      className="p-1 hover:bg-[#3A3A3A] rounded transition-colors"
                      title={t.view_in_popup}
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300" />
                    </button>
                  )}
                  <button
                    onClick={() => handleCopy(executionLogs[selectedStepIndex].output, 'output')}
                    className="p-1 hover:bg-[#3A3A3A] rounded transition-colors"
                    title={t.copy}
                  >
                    {copiedOutput ? (
                      <Check className="w-3.5 h-3.5 text-green-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300" />
                    )}
                  </button>
                </div>
              </div>
              <div
                className={`bg-[#0A0A0A] border border-[#3A3A3A] rounded-lg relative ${
                  canExpandPayload ? 'cursor-pointer hover:border-gray-400 transition-colors' : ''
                }`}
                onClick={() => {
                  if (canExpandPayload) {
                    handleLogBoxClick('output')
                  }
                }}
              >
                <div className="max-h-56 overflow-hidden">
                  <pre className="text-[10px] text-gray-300 p-3 whitespace-pre-wrap break-all">
                    {formatPayloadPreview(executionLogs[selectedStepIndex].output)}
                  </pre>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#0A0A0A] to-transparent" />
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <p className="text-xs">{t.step_not_found}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}