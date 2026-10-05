'use client'

import React from 'react'
import { Play, Loader2, RotateCcw, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../types'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useLanguage } from '@/hooks/useLanguage'

interface SchedulePanelProps {
  chatMessages: ChatMessage[]
  isExecuting: boolean
  onScheduleTest: () => void
  onReset?: () => void
}

const markdownComponents = {
  p: ({ children }: any) => <p className="mb-1 last:mb-0 text-xs">{children}</p>,
  strong: ({ children }: any) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
  ul: ({ children }: any) => <ul className="list-disc list-inside ml-2 space-y-0.5 text-xs">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal list-inside ml-2 space-y-0.5 text-xs">{children}</ol>,
  li: ({ children }: any) => <li className="text-xs">{children}</li>,
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-xs">
      {children}
    </a>
  ),
  code: ({ children }: any) => (
    <code className="bg-[#1A1A1A] px-1 py-0.5 rounded text-[10px] font-mono text-green-400">{children}</code>
  ),
  pre: ({ children }: any) => (
    <pre className="bg-[#1A1A1A] p-2 rounded overflow-x-auto text-[10px] my-1">{children}</pre>
  ),
}

export function SchedulePanel({
  chatMessages,
  isExecuting,
  onScheduleTest,
  onReset
}: SchedulePanelProps) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  return (
    <div className="flex flex-col border-r border-[#3A3A3A] h-full bg-[#1A1A1A]">
      <div className="p-3 border-b border-[#3A3A3A] flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">{t.schedule || 'Schedule'}</h3>
        {onReset && (
          <button
            onClick={onReset}
            disabled={isExecuting}
            className="p-1 hover:bg-[#3A3A3A] rounded transition-colors disabled:opacity-50"
            title={t.reset || 'Reset'}
          >
            <RotateCcw className="w-3.5 h-3.5 text-gray-400 hover:text-gray-200" />
          </button>
        )}
      </div>

      <div className={`p-4 flex flex-col items-center justify-center gap-3 ${chatMessages.length === 0 ? 'flex-1' : ''}`}>
        <div className="w-12 h-12 rounded-full bg-purple-600/20 flex items-center justify-center">
          <Clock className="w-6 h-6 text-purple-400" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-200">{t.schedule_test_title}</p>
          <p className="text-xs text-gray-500 mt-1">{t.schedule_test_desc}</p>
        </div>
        <Button
          onClick={onScheduleTest}
          disabled={isExecuting}
          className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 flex items-center gap-2"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.executing}
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              {t.run_schedule}
            </>
          )}
        </Button>
      </div>

      {(chatMessages.length > 0 || isExecuting) && (
        <div className="flex-1 overflow-y-scroll p-3 space-y-2 test-panel-scrollbar border-t border-[#3A3A3A]">
          <div className="text-xs text-gray-400 mb-2">{t.execution_results}</div>
          {chatMessages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] p-2 rounded text-xs ${
                msg.role === 'user'
                  ? 'bg-purple-600 text-white'
                  : 'bg-[#2A2A2A] text-gray-200'
              }`}>
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div className="prose prose-invert prose-xs max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                )}
                <p className="text-[10px] mt-1 opacity-60">{new Date(msg.timestamp).toLocaleTimeString()}</p>
              </div>
            </div>
          ))}
          {isExecuting && (
            <div className="flex justify-start">
              <div className="bg-[#2A2A2A] text-gray-200 p-2 rounded">
                <Loader2 className="w-3 h-3 animate-spin" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
