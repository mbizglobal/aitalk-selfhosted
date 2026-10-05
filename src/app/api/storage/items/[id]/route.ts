import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { getLanguageFromHeaders, getTranslations, getErrorMessage } from '@/lib/translations/dashboard'
import { deleteStorageItem } from '@/lib/storage/delete-item'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)

  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: t.storage_items_agent_required }, { status: 400 })
    }

    const { id } = await params
    const storageId = parseInt(id)

    if (isNaN(storageId)) {
      return NextResponse.json({ error: t.storage_items_invalid_id }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: t.storage_items_agent_not_found }, { status: 404 })
    }

    const storageItem = await prisma.storage.findUnique({
      where: {
        id: storageId,
        agentId,
      },
    })

    if (!storageItem) {
      return NextResponse.json({ error: t.storage_items_not_found }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: storageItem,
    })

  } catch (error) {
    console.error('Failed to fetch storage item:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to fetch storage item' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)

  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: t.storage_items_agent_required }, { status: 400 })
    }

    const { id } = await params
    const storageId = parseInt(id)

    if (isNaN(storageId)) {
      return NextResponse.json({ error: t.storage_items_invalid_id }, { status: 400 })
    }

    const result = await deleteStorageItem({ userId: session.user.id, agentId, storageId })

    if (!result.ok) {
      if (result.code === 'CLEANUP_FAILED') {
        return NextResponse.json({ error: result.message, code: result.code }, { status: 502 })
      }
      const message = result.code === 'AGENT_NOT_FOUND'
        ? t.storage_items_agent_not_found
        : t.storage_items_not_found
      return NextResponse.json({ error: message }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'Storage item deleted successfully',
    })

  } catch (error) {
    console.error('Failed to delete storage item:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to delete storage item' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string; id: string }> }
) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)

  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const { agentId, id } = await params
    const storageId = parseInt(id)
    const body = await request.json()

    if (isNaN(storageId)) {
      return NextResponse.json({ error: t.storage_items_invalid_id }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: t.storage_items_agent_not_found }, { status: 404 })
    }

    const allowedFields = ['title']
    const updateData: any = {}

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: t.storage_items_no_valid_fields }, { status: 400 })
    }

    const updatedItem = await prisma.storage.update({
      where: {
        id: storageId,
        agentId,
      },
      data: updateData,
    })

    return NextResponse.json({
      success: true,
      data: updatedItem,
    })

  } catch (error) {
    console.error('Failed to update storage item:', describeCaughtError(error))
    const errorWithCode = error as { code?: string }

    if (errorWithCode?.code === 'P2025') {
      return NextResponse.json({ error: t.storage_items_not_found }, { status: 404 })
    }
    
    return NextResponse.json(
      { error: 'Failed to update storage item' },
      { status: 500 }
    )
  }
}
