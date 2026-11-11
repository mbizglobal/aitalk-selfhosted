import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { readSpecProposal } from '@/lib/work/assembled-proposals'
import { SpecConfirmClient } from './spec-confirm-client'

export const dynamic = 'force-dynamic'

export default async function SpecConfirmPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) redirect(`/auth?callbackUrl=${encodeURIComponent('/app/work/spec/' + proposalId)}`)
  const view = await readSpecProposal({ db: prisma, dataKey: ensureUserDataKey }, { userId: session.user.id, proposalId })
  if (!view) return <SpecConfirmClient proposalId={proposalId} notFound />
  return <SpecConfirmClient proposalId={proposalId} view={{ ...view, expiresAt: view.expiresAt.toISOString() }} />
}
