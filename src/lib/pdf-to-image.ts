
export interface PdfToImageOptions {
  scale?: number
  maxPages?: number
}

export interface ConvertedPdfImage {
  pageNumber: number
  base64: string
  width: number
  height: number
}

export async function convertPdfToImages(
  file: File,
  options: PdfToImageOptions = {}
): Promise<ConvertedPdfImage[]> {
  const { scale = 2, maxPages = 10 } = options

  const pdfjsLib = await import('pdfjs-dist')

  if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = document.documentElement.dataset.edition === 'selfhosted'
      ? '/pdf.worker.min.mjs'
      : `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
  }

  try {
    const arrayBuffer = await file.arrayBuffer()

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDoc = await loadingTask.promise

    const totalPages = Math.min(pdfDoc.numPages, maxPages)
    const images: ConvertedPdfImage[] = []

    console.log(`[PDF] Converting ${totalPages} page(s) from ${file.name}`)

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Failed to get canvas context')
      }

      canvas.width = viewport.width
      canvas.height = viewport.height

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      }

      await page.render(renderContext).promise

      const base64 = canvas.toDataURL('image/jpeg', 0.92)

      images.push({
        pageNumber: pageNum,
        base64: base64.split(',')[1], // Remove data:image/jpeg;base64, prefix
        width: viewport.width,
        height: viewport.height
      })

      console.log(`[PDF] Converted page ${pageNum}/${totalPages}`)
    }

    console.log(`[PDF] Successfully converted ${images.length} page(s)`)
    return images
  } catch (error) {
    console.error('[PDF] Conversion failed:', error)
    throw new Error('PDF 변환에 실패했습니다.')
  }
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf'
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}
