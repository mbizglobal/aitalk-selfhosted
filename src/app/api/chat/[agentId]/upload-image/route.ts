import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const ALLOWED_CSV_TYPES = ['text/csv', 'application/vnd.ms-excel']
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

interface RouteParams {
  params: Promise<{
    agentId: string
  }>
}

export async function POST(
  request: NextRequest,
  context: RouteParams
) {
  try {
    const { agentId } = await context.params

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`
      }, { status: 400 })
    }

    const fileType = file.type
    const fileName = file.name.toLowerCase()
    const isImage = ALLOWED_IMAGE_TYPES.includes(fileType)
    const isCsv = ALLOWED_CSV_TYPES.includes(fileType) || fileName.endsWith('.csv')

    if (!isImage && !isCsv) {
      return NextResponse.json({
        error: 'Unsupported file type. Only images (PNG, JPEG, WEBP, GIF) and CSV are allowed. PDF files are converted on the client side.'
      }, { status: 400 })
    }

    let base64Data: string | undefined
    let csvText: string | undefined
    let resultType: 'image' | 'csv'

    if (isImage) {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      base64Data = `data:${fileType};base64,${buffer.toString('base64')}`
      resultType = 'image'
    } else if (isCsv) {
      const text = await file.text()
      csvText = text
      resultType = 'csv'
    }

    return NextResponse.json({
      success: true,
      data: {
        type: resultType,
        base64: base64Data,
        text: csvText,
        originalFileName: file.name,
        fileSize: file.size
      }
    })

  } catch (error) {
    console.error('Upload image error:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to process file upload' },
      { status: 500 }
    )
  }
}
