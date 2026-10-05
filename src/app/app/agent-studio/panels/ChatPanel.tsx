'use client'

import React, { useRef } from 'react'
import { Send, Loader2, RotateCcw, Clock, MessageCircle, Paperclip, X, FileText } from 'lucide-react'
import { TelegramIcon } from '../constants/components'
import { Button } from '@/components/ui/button'
import { MessageContent } from '@/components/chat/MessageContent'
import type { ChatMessage, UploadedFile, FileInputConfig } from '../types'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useLanguage } from '@/hooks/useLanguage'

interface ChatPanelProps {
  chatMessages: ChatMessage[]
  isExecuting: boolean
  testMessage: string
  setTestMessage: (value: string) => void
  handleExecuteWorkflow: () => void
  onReset?: () => void
  hasScheduleNode?: boolean
  onScheduleTest?: () => void
  isTelegramStart?: boolean
  fileInputConfig?: FileInputConfig
  uploadedFiles?: UploadedFile[]
  isUploading?: boolean
  onFileSelect?: (files: FileList | null) => void
  onRemoveFile?: (fileId: string) => void
  onRemovePdf?: (fileName: string) => void
}

function MessageItem({ msg, isStreaming = false }: { msg: ChatMessage; isStreaming?: boolean }) {
  const [hasTable, setHasTable] = React.useState(false)

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`${hasTable ? 'w-full' : 'max-w-[85%]'} p-2 rounded text-xs ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-[#2A2A2A] text-gray-200'}`}>
        <div className={msg.role === 'assistant' ? 'prose prose-invert prose-xs max-w-none' : ''}>
          <MessageContent
            content={msg.content}
            role={msg.role}
            theme="dark"
            size="xs"
            onHasTable={setHasTable}
            isStreaming={isStreaming}
            enableJsonTable={true}
          />
        </div>
        <p className="text-[10px] mt-1 opacity-60">{new Date(msg.timestamp).toLocaleTimeString()}</p>
      </div>
    </div>
  )
}

export function ChatPanel({
  chatMessages,
  isExecuting,
  testMessage,
  setTestMessage,
  handleExecuteWorkflow,
  onReset,
  hasScheduleNode,
  onScheduleTest,
  isTelegramStart,
  fileInputConfig,
  uploadedFiles = [],
  isUploading = false,
  onFileSelect,
  onRemoveFile,
  onRemovePdf
}: ChatPanelProps) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasFileInput = fileInputConfig && (
    fileInputConfig.imageInput ||
    fileInputConfig.pdfInput ||
    fileInputConfig.csvInput
  )

  const getAcceptTypes = () => {
    if (!fileInputConfig) return ''
    const types: string[] = []
    if (fileInputConfig.imageInput) types.push('image/*')
    if (fileInputConfig.pdfInput) types.push('application/pdf')
    if (fileInputConfig.csvInput) types.push('text/csv,.csv')
    return types.join(',')
  }

  const handleRemoveFile = (file: UploadedFile) => {
    if (file.isFirstPage && file.totalPages && file.totalPages > 1 && onRemovePdf) {
      onRemovePdf(file.name.replace(/\s*\(Page \d+\)$/, ''))
    } else if (onRemoveFile) {
      onRemoveFile(file.id)
    }
  }

  return (
    <div className="flex flex-col border-r border-[#3A3A3A] h-full bg-[#1A1A1A]">
      <div className="p-3 border-b border-[#3A3A3A] flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isTelegramStart ? (
            <TelegramIcon className="w-4 h-4" />
          ) : (
            <MessageCircle className="w-4 h-4 text-gray-400" />
          )}
          <h3 className="text-sm font-medium text-gray-200">
            {isTelegramStart ? 'Telegram' : t.chat}
          </h3>
          {isTelegramStart && (
            <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
              {t.test_mode || 'Test Mode'}
            </span>
          )}
        </div>
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
      <div className="flex-1 overflow-y-scroll p-3 space-y-2 test-panel-scrollbar">
        {chatMessages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <p className="text-xs">{t.send_message_below}</p>
            </div>
          </div>
        )}
        {chatMessages.map((msg, index) => (
          <MessageItem key={index} msg={msg} />
        ))}
        {isExecuting && (
          <div className="flex justify-start">
            <div className="bg-[#2A2A2A] text-gray-200 p-2 rounded">
              <Loader2 className="w-3 h-3 animate-spin" />
            </div>
          </div>
        )}
      </div>
      <div className="p-3 border-t border-[#3A3A3A]">
        {uploadedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {uploadedFiles
              .filter(file => {
                if (file.isFirstPage !== undefined) {
                  return file.isFirstPage === true
                }
                return true
              })
              .map(file => (
                <div key={file.id} className="relative group">
                  <div className="w-12 h-12 rounded overflow-hidden border border-[#3A3A3A] bg-[#2A2A2A] flex items-center justify-center">
                    {file.type === 'image' && file.previewUrl ? (
                      <img
                        src={file.previewUrl}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : file.type === 'csv' ? (
                      <div className="flex flex-col items-center">
                        <FileText className="w-5 h-5 text-green-500" />
                        <span className="text-[8px] text-gray-400">CSV</span>
                      </div>
                    ) : (
                      <FileText className="w-5 h-5 text-gray-500" />
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveFile(file)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-2.5 h-2.5 text-white" />
                  </button>
                  {file.isFirstPage && file.totalPages && file.totalPages > 1 && (
                    <span className="absolute bottom-0 right-0 text-[8px] bg-black/70 text-white px-1 rounded-tl">
                      {file.totalPages}p
                    </span>
                  )}
                </div>
              ))}
            {isUploading && (
              <div className="w-12 h-12 rounded border border-[#3A3A3A] bg-[#2A2A2A] flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {hasFileInput && onFileSelect && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={getAcceptTypes()}
                multiple
                onChange={(e) => {
                  onFileSelect(e.target.files)
                  e.target.value = ''
                }}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isExecuting || isUploading}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-[#3A3A3A] rounded transition-colors disabled:opacity-50"
                title={t.attach_file || 'Attach file'}
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </>
          )}
          <input
            type="text"
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleExecuteWorkflow()
              }
            }}
            placeholder={t.type_message}
            disabled={isExecuting}
            className="flex-1 bg-[#2A2A2A] border border-[#3A3A3A] rounded px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          {hasScheduleNode && onScheduleTest && (
            <Button
              onClick={onScheduleTest}
              disabled={isExecuting}
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white px-3"
              title={t.test_schedule_tooltip || 'Run workflow as scheduled trigger'}
            >
              <Clock className="w-3 h-3" />
            </Button>
          )}
          <Button
            onClick={handleExecuteWorkflow}
            disabled={isExecuting || !testMessage.trim()}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white px-3"
          >
            <Send className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
