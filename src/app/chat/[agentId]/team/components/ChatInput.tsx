import React, { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Paperclip, Send } from 'lucide-react'
import { FilePreview } from './FilePreview'
import type { UploadedFile } from '../types'
import type { FileInputConfig } from './TeamSidebar'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

interface ChatInputProps {
  isMobile: boolean
  input: string
  setInput: (value: string) => void
  isLoading: boolean
  isUploading: boolean
  uploadedFiles: UploadedFile[]
  lang?: SupportedLang
  onSend: () => void
  onFileSelect: (files: FileList | null) => void
  onRemoveFile: (fileId: string) => void
  onRemovePdf: (fileName: string) => void
  autoResize: () => void
  fileInputConfig?: FileInputConfig
  fileError?: string | null
  onClearFileError?: () => void
}

export const ChatInput: React.FC<ChatInputProps> = ({
  isMobile,
  input,
  setInput,
  isLoading,
  isUploading,
  uploadedFiles,
  lang,
  onSend,
  onFileSelect,
  onRemoveFile,
  onRemovePdf,
  autoResize,
  fileInputConfig,
  fileError,
  onClearFileError
}) => {
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasAnyFileInput = fileInputConfig && (
    fileInputConfig.imageInput ||
    fileInputConfig.pdfInput ||
    fileInputConfig.csvInput
  )

  const getAcceptTypes = () => {
    if (!fileInputConfig || !hasAnyFileInput) {
      return 'image/*,application/pdf,text/csv,.csv'
    }
    const types: string[] = []
    if (fileInputConfig.imageInput) types.push('image/*')
    if (fileInputConfig.pdfInput) types.push('application/pdf')
    if (fileInputConfig.csvInput) types.push('text/csv,.csv')
    return types.join(',')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const handleAutoResize = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const minHeight = isMobile ? 60 : 80
      const maxHeight = isMobile ? 150 : 200
      const newHeight = Math.min(Math.max(textareaRef.current.scrollHeight, minHeight), maxHeight)
      textareaRef.current.style.height = `${newHeight}px`
    }
  }

  return (
    <div className={`border-t border-gray-800 ${isMobile ? 'p-2' : 'p-4'}`}>
      <div className={`${isMobile ? 'max-w-full' : 'max-w-3xl'} mx-auto`}>
        {fileError && (
          <div className="mb-2 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-lg flex items-center justify-between">
            <span className="text-red-400 text-sm">{fileError}</span>
            <button onClick={onClearFileError} className="text-red-400 hover:text-red-300 ml-2 text-xs">✕</button>
          </div>
        )}

        <FilePreview
          isMobile={isMobile}
          uploadedFiles={uploadedFiles}
          onRemove={onRemoveFile}
          onRemovePdf={onRemovePdf}
        />

        <div
          className="relative bg-[#2A2A2A] rounded-xl border border-gray-700 cursor-text"
          onClick={() => textareaRef.current?.focus()}
        >
          <textarea
            ref={textareaRef}
            placeholder={t('team_chat_placeholder')}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              handleAutoResize()
            }}
            onKeyDown={handleKeyPress}
            disabled={isLoading}
            className={`w-full bg-transparent border-none text-white placeholder:text-gray-500 resize-none ${isMobile ? 'px-3 py-2 pb-10 text-base' : 'px-4 py-3 pb-12'} focus:outline-none focus:ring-0 overflow-y-auto scrollbar-hide`}
            style={{
              minHeight: isMobile ? '60px' : '80px',
              maxHeight: isMobile ? '150px' : '200px',
              fontSize: isMobile ? '16px' : undefined
            }}
          />

          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={getAcceptTypes()}
                multiple
                onChange={(e) => onFileSelect(e.target.files)}
                className="hidden"
              />
              <button
                className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-700"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || isUploading}
                title={t('team_chat_attach_file')}
              >
                <Paperclip className="h-4 w-4" />
              </button>
              {isUploading && (
                <span className="text-xs text-gray-400">{t('team_chat_uploading')}</span>
              )}
            </div>

            <Button
              onClick={onSend}
              disabled={(!input.trim() && uploadedFiles.length === 0) || isLoading}
              size="sm"
              className="bg-[#E07B53] hover:bg-[#D06A42] text-white rounded-lg px-3 py-1.5"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
