
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { getApiTranslation } from '@/lib/translations'
import { getLanguageFromHeaders, getErrorMessage } from '@/lib/translations/dashboard'
import { createTextSource } from '@/lib/storage/create-text'

export async function POST(request: NextRequest) {
  try {
    const t = getApiTranslation(request)
    const language = getLanguageFromHeaders(request.headers)
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const body = await request.json()
    const { agentId, title, content, ragProvider: requestRagProvider, ragSpaceId: ragSpaceIdInput } = body

    const result = await createTextSource({
      userId: session.user.id,
      agentId,
      title,
      content,
      requestRagProvider,
      ragSpaceIdInput,
    })

    if (!result.ok) {
      switch (result.code) {
        case 'AGENT_ID_REQUIRED':
          return NextResponse.json({ error: t('api_error_agent_id_required') }, { status: 400 })
        case 'TITLE_REQUIRED':
          return NextResponse.json({ error: t('api_error_title_required') }, { status: 400 })
        case 'CONTENT_REQUIRED':
          return NextResponse.json({ error: t('api_error_content_required') }, { status: 400 })
        case 'AGENT_NOT_FOUND':
          return NextResponse.json({ error: t('api_error_agent_not_found_or_unauthorized') }, { status: 404 })
        case 'STORAGE_LIMIT_EXCEEDED':
          return NextResponse.json({
            error: getErrorMessage('api_error_storage_limit_exceeded', language),
            code: 'STORAGE_LIMIT_EXCEEDED'
          }, { status: 400 })
        default:
          return NextResponse.json(
            result.code.startsWith('RAG_SPACE')
              ? { error: result.message, code: result.code }
              : { error: result.message },
            { status: 400 }
          )
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: result.storageId,
        message: 'Text document created. Processing in background.',
      },
    })

  } catch (error) {
    console.error('Failed to create text document:', error)
    return NextResponse.json(
      { error: 'Failed to create text document' },
      { status: 500 }
    )
  }
}
