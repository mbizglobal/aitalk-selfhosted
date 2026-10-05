import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getErrorMessage, getLanguageFromHeaders, getTranslations } from '@/lib/translations/dashboard'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    const language = getLanguageFromHeaders(request.headers)
    const t = getTranslations(language)

    if (!session || !session.user?.id) {
      return NextResponse.json(
        { ok: false, message: getErrorMessage('api_error_unauthorized', language) },
        { status: 401 }
      )
    }

    const userId = session.user.id

    const body = await request.json()
    const { agentId } = body

    if (!agentId) {
      return NextResponse.json(
        { ok: false, message: getErrorMessage('api_error_agent_id_required', language) },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId: agentId,
        userId: userId
      }
    })

    if (!agent) {
      return NextResponse.json(
        { ok: false, message: getErrorMessage('api_error_agent_not_found_or_unauthorized', language) },
        { status: 403 }
      )
    }

    const result = await prisma.cpaUsageLog.deleteMany({
      where: {
        agentId: agentId
      }
    })

    return NextResponse.json(
      {
        ok: true,
        message: t.delete_usage_logs_success.replace('{count}', result.count.toString()),
        deletedCount: result.count
      },
      { status: 200 }
    )

  } catch (error) {
    console.error('Error deleting usage logs:', error)
    const language = getLanguageFromHeaders(request.headers)
    const t = getTranslations(language)
    return NextResponse.json(
      { ok: false, message: t.delete_usage_logs_error },
      { status: 500 }
    )
  }
}
