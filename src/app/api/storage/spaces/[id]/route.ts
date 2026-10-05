import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { getKnowledgeStore, KnowledgeStoreUnavailable, SELFHOSTED_REGION, type KnowledgeStore } from '@/lib/knowledge'
import { isSelfHosted } from '@/lib/edition'

const DEFAULT_NAME = 'Default'

async function authSpace(idStr: string) {
  const session = (await getServerSession(authOptions as any)) as any
  if (!session?.user?.id) return { error: 'Unauthorized', status: 401 as const }
  if (!/^\d+$/.test(idStr)) return { error: 'Invalid space id', status: 400 as const }
  const spaceId = Number(idStr)

  const space = await prisma.ragSpace.findUnique({ where: { id: spaceId } })
  if (!space) return { error: 'Space not found', status: 404 as const }

  const agent = await prisma.agent.findUnique({ where: { agentId: space.agentId }, select: { userId: true } })
  if (!agent || agent.userId !== session.user.id) {
    return { error: 'Space not found or unauthorized', status: 404 as const }
  }
  if (isSelfHosted()) return { space, userId: session.user.id as string, managedRegion: SELFHOSTED_REGION }
  const sub = await prisma.subscription.findUnique({ where: { id: agent.userId }, select: { serviceVariant: true, managedRegion: true } })
  if (sub?.serviceVariant !== 'managed' || !sub.managedRegion) {
    return { error: 'RAG spaces are available for Managed plans only', status: 403 as const }
  }
  return { space, userId: session.user.id as string, managedRegion: sub.managedRegion }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await authSpace(id)
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (auth.space.isDefault) {
      return NextResponse.json({ error: 'Default space cannot be renamed', code: 'RAG_SPACE_DEFAULT_LOCKED' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const name = String(body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (name.length > 100) return NextResponse.json({ error: 'Name too long' }, { status: 400 })
    if (name.toLowerCase() === DEFAULT_NAME.toLowerCase()) {
      return NextResponse.json({ error: 'Name "Default" is reserved', code: 'RAG_SPACE_NAME_RESERVED' }, { status: 400 })
    }

    const dup = await prisma.ragSpace.findFirst({
      where: { agentId: auth.space.agentId, name: { equals: name, mode: 'insensitive' }, id: { not: auth.space.id } },
      select: { id: true },
    })
    if (dup) {
      return NextResponse.json({ error: 'A space with this name already exists', code: 'RAG_SPACE_NAME_DUP' }, { status: 400 })
    }

    try {
      const updated = await prisma.ragSpace.update({
        where: { id: auth.space.id },
        data: { name },
        select: { id: true, name: true, isDefault: true, sortOrder: true },
      })
      return NextResponse.json({ space: updated })
    } catch (e: any) {
      if (e?.code === 'P2002' || e?.code === '23505' || e?.meta?.code === '23505' || e?.cause?.code === '23505') {
        return NextResponse.json({ error: 'A space with this name already exists', code: 'RAG_SPACE_NAME_DUP' }, { status: 400 })
      }
      throw e
    }
  } catch (error) {
    console.error('[spaces PATCH] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await authSpace(id)
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (auth.space.isDefault) {
      return NextResponse.json({ error: 'Default space cannot be deleted', code: 'RAG_SPACE_DEFAULT_LOCKED' }, { status: 400 })
    }

    const { space, managedRegion: region } = auth
    const agentId = space.agentId

    const items = await prisma.storage.findMany({
      where: { agentId, ragSpaceId: space.id },
      select: { id: true, ragProvider: true, blobPath: true },
    })

    if (items.length > 0) {
      let store: KnowledgeStore | null = null
      if (!isSelfHosted()) try {
        store = await getKnowledgeStore({ regionId: region })
      } catch (e) {
        if (!(e instanceof KnowledgeStoreUnavailable)) throw e
        return NextResponse.json({ error: 'Azure AI Search not configured for region', code: 'RAG_SPACE_REGION_UNCONFIGURED' }, { status: 500 })
      }
      const { deleteFromBlob } = await import('@/lib/managed/blob-storage')
      const results = await Promise.allSettled(
        items.flatMap((it) => {
          const ops: Promise<any>[] = []
          if (it.ragProvider === 'azure_ai_search' && store) {
            ops.push(store.deleteDoc({ agentId }, String(it.id)))
            if (it.blobPath) ops.push(deleteFromBlob(region, it.blobPath))
          }
          if (it.ragProvider === 'pgvector' && it.blobPath) ops.push(deleteFromBlob(region, it.blobPath))
          return ops
        })
      )
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length > 0) {
        console.warn(`[spaces DELETE] ${failed.length} external delete(s) failed for space=${space.id}:`,
          failed.map((f: any) => describeCaughtError(f.reason)))
        return NextResponse.json(
          { error: 'Failed to delete some external resources, please retry', code: 'RAG_SPACE_CLEANUP_FAILED', failed: failed.length },
          { status: 502 }
        )
      }
    }

    await prisma.storage.deleteMany({ where: { agentId, ragSpaceId: space.id } })
    await prisma.ragSpace.delete({ where: { id: space.id } })

    return NextResponse.json({ success: true, deletedItems: items.length })
  } catch (error) {
    console.error('[spaces DELETE] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
