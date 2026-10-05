import { useState } from 'react'
import { convertPdfToImages, isPdfFile } from '@/lib/pdf-to-image'
import { fileToBase64 } from '../utils/fileUtils'
import type { UploadedFile } from '../types'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

export const useFileUpload = () => {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const handleFileSelect = async (files: FileList | null, fileTooLargeMessage?: string) => {
    if (!files || files.length === 0) return

    setIsUploading(true)
    setFileError(null)

    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          const msg = fileTooLargeMessage
            ? fileTooLargeMessage.replace('{name}', file.name)
            : `File "${file.name}" exceeds the maximum size of 25MB.`
          setFileError(msg)
          continue
        }

        if (file.type.startsWith('image/')) {
          const base64 = await fileToBase64(file)
          const previewUrl = URL.createObjectURL(file)

          setUploadedFiles(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            name: file.name,
            type: 'image',
            base64: base64.split(',')[1], // Remove data:image/...;base64, prefix
            size: file.size,
            previewUrl
          }])
        }
        else if (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')) {
          const text = await file.text()

          setUploadedFiles(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            name: file.name,
            type: 'csv',
            text: text,
            size: file.size
          }])
        }
        else if (isPdfFile(file)) {
          try {
            console.log(`Converting PDF: ${file.name}`)
            const pdfImages = await convertPdfToImages(file, {
              scale: 2,
              maxPages: 10
            })

            for (const pdfImage of pdfImages) {
              setUploadedFiles(prev => [...prev, {
                id: Date.now().toString() + Math.random(),
                name: pdfImage.pageNumber === 1 ? file.name : `${file.name} (Page ${pdfImage.pageNumber})`,
                type: 'image',
                base64: pdfImage.base64,
                size: file.size / pdfImages.length,
                previewUrl: `data:image/jpeg;base64,${pdfImage.base64}`,
                isFirstPage: pdfImage.pageNumber === 1,
                totalPages: pdfImages.length
              }])
            }

            console.log(`PDF converted: ${pdfImages.length} page(s)`)
          } catch (error) {
            console.error('PDF conversion error:', error)
            alert(`${file.name} PDF 변환에 실패했습니다.`)
          }
        }
        else {
          alert(`${file.name}은(는) 지원하지 않는 파일 형식입니다.`)
        }
      }
    } catch (error) {
      console.error('File upload error:', error)
      alert('파일 업로드 중 오류가 발생했습니다.')
    } finally {
      setIsUploading(false)
    }
  }

  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const clearFiles = () => {
    setUploadedFiles([])
  }

  return {
    uploadedFiles,
    isUploading,
    fileError,
    setFileError,
    handleFileSelect,
    removeFile,
    clearFiles,
    setUploadedFiles
  }
}
