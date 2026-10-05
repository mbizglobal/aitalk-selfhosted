import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { uploadIconToS3, deleteIconFromS3, isUserOwnerOfIcon } from '@/lib/s3'
import { getLanguageFromHeaders, getTranslations, getErrorMessage } from '@/lib/translations/dashboard'

export async function POST(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)

  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const { dataUrl, agentId } = await request.json()

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: t.upload_icon_invalid_data }, { status: 400 })
    }

    const result = await uploadIconToS3(dataUrl, session.user.id, agentId)

    return NextResponse.json({
      success: true,
      url: result.url,
      key: result.key,
      fileName: result.fileName
    })

  } catch (error) {
    return NextResponse.json({ error: t.upload_icon_upload_failed }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)

  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const { iconUrl } = await request.json()

    if (!iconUrl) {
      return NextResponse.json({ error: t.upload_icon_no_url }, { status: 400 })
    }

    if (!isUserOwnerOfIcon(iconUrl, session.user.id)) {
      return NextResponse.json({ error: t.upload_icon_unauthorized_delete }, { status: 403 })
    }

    await deleteIconFromS3(iconUrl)

    return NextResponse.json({ success: true })

  } catch (error) {
    return NextResponse.json({ error: t.upload_icon_delete_failed }, { status: 500 })
  }
}