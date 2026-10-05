import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { isSelfHosted } from '@/lib/edition'
import {
  MAX_RAG_SPACES,
  RAG_SPACE_LIMIT_ERROR,
  getOrCreateDefaultSpace,
} from '@/lib/rag-space'

const DEFAULT_NAME = 'Default'

async function authAgent(request: NextRequest, agentId: string | null) {
  const session = (await getServerSession(authOptions as any)) as any
  if (!session?.user?.id) return { error: 'Unauthorized', status: 401 as const }
  if (!agentId) return { error: 'Agent ID is required', status: 400 as const }
  const agent = await prisma.agent.findUnique({ where: { agentId }, select: { userId: true } })
  if (!agent || agent.userId !== session.user.id) {
    return { error: 'Agent not found or unauthorized', status: 404 as const }
  }
  if (isSelfHosted()) return { userId: session.user.id as string, isManaged: true }
  const sub = await prisma.subscription.findUnique({ where: { id: agent.userId }, select: { serviceVariant: true, managedRegion: true } })
  const isManaged = sub?.serviceVariant === 'managed' && !!sub?.managedRegion
  return { userId: session.user.id as string, isManaged }
}

export async function GET(request: NextRequest) {
  try {
    const agentId = new URL(request.url).searchParams.get('agentId')
    const auth = await authAgent(request, agentId)
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (!auth.isManaged) {
      return NextResponse.json({ spaces: [], max: MAX_RAG_SPACES, defaultSpaceId: null, managed: false })
    }

    await getOrCreateDefaultSpace(agentId!)

    const spaces = await prisma.ragSpace.findMany({
      where: { agentId: agentId! },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, isDefault: true, sortOrder: true },
    })

    const counts = await prisma.storage.groupBy({
      by: ['ragSpaceId'],
      where: { agentId: agentId! },
      _count: { _all: true },
    })
    const countMap = new Map<number | null, number>()
    for (const c of counts) countMap.set(c.ragSpaceId, c._count._all)
    const defaultSpace = spaces.find((s) => s.isDefault)

    const result = spaces.map((s) => ({
      ...s,
      itemCount:
        (countMap.get(s.id) || 0) + (s.isDefault ? countMap.get(null) || 0 : 0),
    }))

    return NextResponse.json({ spaces: result, max: MAX_RAG_SPACES, defaultSpaceId: defaultSpace?.id ?? null, managed: true })
  } catch (error) {
    console.error('[spaces GET] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const agentId: string | null = body.agentId ?? null
    const auth = await authAgent(request, agentId)
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (!auth.isManaged) {
      return NextResponse.json({ error: 'RAG spaces are available for Managed plans only', code: 'RAG_SPACE_MANAGED_ONLY' }, { status: 403 })
    }

    const name = String(body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (name.length > 100) return NextResponse.json({ error: 'Name too long' }, { status: 400 })
    if (name.toLowerCase() === DEFAULT_NAME.toLowerCase()) {
      return NextResponse.json({ error: 'Name "Default" is reserved', code: 'RAG_SPACE_NAME_RESERVED' }, { status: 400 })
    }

    await getOrCreateDefaultSpace(agentId!)

    try {
      const space = await prisma.$transaction(
        async (tx) => {
          const count = await tx.ragSpace.count({ where: { agentId: agentId! } })
          if (count >= MAX_RAG_SPACES) {
            throw new Error(RAG_SPACE_LIMIT_ERROR)
          }
          const dup = await tx.ragSpace.findFirst({
            where: { agentId: agentId!, name: { equals: name, mode: 'insensitive' } },
            select: { id: true },
          })
          if (dup) throw new Error('RAG_SPACE_NAME_DUP')
          return tx.ragSpace.create({
            data: { agentId: agentId!, name, isDefault: false, sortOrder: count },
            select: { id: true, name: true, isDefault: true, sortOrder: true },
          })
        },
        { isolationLevel: 'Serializable' }
      )
      return NextResponse.json({ space: { ...space, itemCount: 0 } }, { status: 201 })
    } catch (e: any) {
      if (e?.message === RAG_SPACE_LIMIT_ERROR) {
        return NextResponse.json({ error: `Maximum ${MAX_RAG_SPACES} RAG spaces per agent`, code: RAG_SPACE_LIMIT_ERROR }, { status: 400 })
      }
      if (e?.message === 'RAG_SPACE_NAME_DUP' || e?.code === 'P2002' || e?.code === '23505' || e?.meta?.code === '23505' || e?.cause?.code === '23505') {
        return NextResponse.json({ error: 'A space with this name already exists', code: 'RAG_SPACE_NAME_DUP' }, { status: 400 })
      }
      if (e?.code === 'P2034') {
        return NextResponse.json({ error: 'Concurrent modification, please retry', code: 'RAG_SPACE_RETRY' }, { status: 409 })
      }
      throw e
    }
  } catch (error) {
    console.error('[spaces POST] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
