import React from 'react'
import { X, FileText } from 'lucide-react'
import type { UploadedFile } from '../types'

interface FilePreviewProps {
  isMobile: boolean
  uploadedFiles: UploadedFile[]
  onRemove: (fileId: string) => void
  onRemovePdf: (fileName: string) => void
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  isMobile,
  uploadedFiles,
  onRemove,
  onRemovePdf
}) => {
  if (uploadedFiles.length === 0) return null

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {uploadedFiles
        .filter(file => {
          if (file.isFirstPage !== undefined) {
            return file.isFirstPage === true
          }
          return true
        })
        .map(file => {
          const handleRemove = () => {
            if (file.isFirstPage && file.totalPages && file.totalPages > 1) {
              onRemovePdf(file.name.replace(/\s*\(Page \d+\)$/, ''))
            } else {
              onRemove(file.id)
            }
          }

          return (
            <div key={file.id} className="relative group">
              <div className={`${isMobile ? 'w-16 h-16' : 'w-20 h-20'} rounded-lg overflow-hidden border border-gray-700 bg-gray-800 flex items-center justify-center`}>
                {file.type === 'image' && file.previewUrl ? (
                  <img
                    src={file.previewUrl}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                ) : file.type === 'csv' ? (
                  <div className="flex flex-col items-center justify-center">
                    <FileText className={`${isMobile ? 'w-6 h-6' : 'w-8 h-8'} text-green-500`} />
                    <span className="text-[10px] text-gray-400 mt-1">CSV</span>
                  </div>
                ) : (
                  <FileText className={`${isMobile ? 'w-6 h-6' : 'w-8 h-8'} text-gray-500`} />
                )}
              </div>
              <button
                onClick={handleRemove}
                className={`absolute -top-1 -right-1 ${isMobile ? 'w-5 h-5' : 'w-5 h-5'} bg-red-500 rounded-full flex items-center justify-center ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
              >
                <X className="w-3 h-3 text-white" />
              </button>
              <div className={`text-xs text-gray-400 mt-1 truncate ${isMobile ? 'max-w-[64px]' : 'max-w-[80px]'}`} title={file.name}>
                {file.name}
                {file.isFirstPage && file.totalPages && file.totalPages > 1 && (
                  <span className="block text-[10px] text-gray-500">
                    ({file.totalPages} pages)
                  </span>
                )}
              </div>
            </div>
          )
        })}
    </div>
  )
}
