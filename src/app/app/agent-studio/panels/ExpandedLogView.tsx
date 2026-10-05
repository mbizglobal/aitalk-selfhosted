'use client'

import React, { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { ExpandedLogView as ExpandedLogViewType } from '../types'

interface ExpandedLogViewProps {
  expandedLogView: ExpandedLogViewType | null
  setExpandedLogView: (value: ExpandedLogViewType | null) => void
}

export function ExpandedLogView({ expandedLogView, setExpandedLogView }: ExpandedLogViewProps) {
  const [copied, setCopied] = useState(false)

  if (!expandedLogView) return null

  const jsonString = JSON.stringify(expandedLogView.data, null, 2)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/80 flex items-center justify-center p-4"
      onClick={() => setExpandedLogView(null)}
    >
      <div
        className="bg-[#0A0A0A] border border-[#3A3A3A] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#1f1f1f]">
          <div>
            <p className="text-sm font-semibold text-white">{expandedLogView.title}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Showing full {expandedLogView.type === 'input' ? 'input' : 'output'} payload
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                copied
                  ? 'bg-green-600/20 text-green-400'
                  : 'bg-[#2A2A2A] text-gray-300 hover:bg-[#3A3A3A] hover:text-white'
              }`}
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy
                </>
              )}
            </button>
            <button
              className="text-gray-400 hover:text-white text-sm"
              onClick={() => setExpandedLogView(null)}
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-[12px] text-gray-200 whitespace-pre-wrap break-all leading-relaxed font-mono">
            {jsonString}
          </pre>
        </div>
      </div>
    </div>
  )
}