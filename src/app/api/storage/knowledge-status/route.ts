import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { isSelfHosted } from '@/lib/edition'
import { prisma } from '@/lib/prisma'
import { selfHostedKnowledgeKind } from '@/lib/knowledge'
import { KnowledgeEmbeddingUnavailable, pickEmbeddingChoice } from '@/lib/knowledge/embedding'
import { defaultAiConnectionDeps, resolveAiConnection } from '@/lib/ai-connections'
import { describeCaughtError } from '@/lib/log-mask'

export const dynamic = 'force-dynamic'

async function embeddingReady(): Promise<boolean> {
  try {
    const choice = await pickEmbeddingChoice(prisma)
    const r = await resolveAiConnection(await defaultAiConnectionDeps(), choice.connectionId)
    return r.ok && r.connection.kind !== 'anthropic'
  } catch (e) {
    if (e instanceof KnowledgeEmbeddingUnavailable) return false
    throw e
  }
}

export async function GET() {
  if (!isSelfHosted()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = await getServerSession(authOptions as any) as any
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const provider = selfHostedKnowledgeKind()
    const uploadReady = provider === 'pgvector' && (await embeddingReady())
    return NextResponse.json({ provider, uploadReady, needsAiConnection: provider === 'pgvector' && !uploadReady }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[knowledge-status] failed:', describeCaughtError(e))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
