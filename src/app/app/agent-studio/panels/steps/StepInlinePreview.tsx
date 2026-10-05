'use client'

import React, { useState } from 'react'
import { Copy, Check, Maximize2 } from 'lucide-react'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'
import { formatOutputPreview, NodeTypeStyles } from './nodeTypeStyles'

interface StepInlinePreviewProps {
  log: WorkflowDebugLogEntry
  styles: NodeTypeStyles
  onViewDetails: () => void
  onOpenPopup?: (title: string, data: any) => void
  translations: {
    output: string
    error: string
    click_to_view_payload: string
    view_in_popup?: string
    copy?: string
  }
}

export function StepInlinePreview({
  log,
  styles,
  onViewDetails,
  onOpenPopup,
  translations: t
}: StepInlinePreviewProps) {
  const [copiedOutput, setCopiedOutput] = useState(false)
  const [copiedError, setCopiedError] = useState(false)

  const handleCopyOutput = (e: React.MouseEvent) => {
    e.stopPropagation()
    const text = typeof log.output === 'object' ? JSON.stringify(log.output, null, 2) : String(log.output)
    navigator.clipboard.writeText(text)
    setCopiedOutput(true)
    setTimeout(() => setCopiedOutput(false), 1500)
  }

  const handleCopyError = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(log.error || '')
    setCopiedError(true)
    setTimeout(() => setCopiedError(false), 1500)
  }

  const handleOpenOutputPopup = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onOpenPopup) {
      onOpenPopup(`${log.nodeName} - Output`, log.output)
    }
  }

  const handleOpenErrorPopup = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onOpenPopup) {
      onOpenPopup(`${log.nodeName} - Error`, log.error)
    }
  }

  return (
    <div className={`px-3 py-2 ${styles.bg} border-l-2 ${styles.border}`}>
      <div className="ml-6">
        <div className="flex items-center justify-between mb-1 group">
          <p className="text-[10px] text-gray-400">{t.output}</p>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onOpenPopup && (
              <button
                onClick={handleOpenOutputPopup}
                className="p-0.5 hover:bg-white/10 rounded transition-colors"
                title={t.view_in_popup || 'View in popup'}
              >
                <Maximize2 className="w-3 h-3 text-gray-500 hover:text-gray-300" />
              </button>
            )}
            <button
              onClick={handleCopyOutput}
              className="p-0.5 hover:bg-white/10 rounded transition-colors"
              title={t.copy || 'Copy'}
            >
              {copiedOutput ? (
                <Check className="w-3 h-3 text-green-400" />
              ) : (
                <Copy className="w-3 h-3 text-gray-500 hover:text-gray-300" />
              )}
            </button>
          </div>
        </div>
        <pre className="text-[10px] text-gray-300 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-24">
          {formatOutputPreview(log.output)}
        </pre>
        {log.status === 'error' && log.error && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1 group">
              <p className="text-[10px] text-red-400">{t.error}</p>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {onOpenPopup && (
                  <button
                    onClick={handleOpenErrorPopup}
                    className="p-0.5 hover:bg-white/10 rounded transition-colors"
                    title={t.view_in_popup || 'View in popup'}
                  >
                    <Maximize2 className="w-3 h-3 text-red-500 hover:text-red-300" />
                  </button>
                )}
                <button
                  onClick={handleCopyError}
                  className="p-0.5 hover:bg-white/10 rounded transition-colors"
                  title={t.copy || 'Copy'}
                >
                  {copiedError ? (
                    <Check className="w-3 h-3 text-green-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-red-500 hover:text-red-300" />
                  )}
                </button>
              </div>
            </div>
            <pre className="text-[10px] text-red-300 bg-red-900/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {log.error}
            </pre>
          </div>
        )}
        <button
          onClick={onViewDetails}
          className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 hover:underline"
        >
          {t.click_to_view_payload}
        </button>
      </div>
    </div>
  )
}
