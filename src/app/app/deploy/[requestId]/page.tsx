import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getDeployRequestForOwner } from '@/lib/workflow/service'
import { summarizeDeployRisk } from '@/lib/workflow/deploy-summary'
import { DeployConfirmClient } from './deploy-confirm-client'

export const dynamic = 'force-dynamic'

export default async function DeployConfirmPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params

  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/auth?callbackUrl=${encodeURIComponent('/app/deploy/' + requestId)}`)
  }
  const userId = session.user.id

  const result = await getDeployRequestForOwner({ userId, requestId })
  if (!result.ok) {
    return <DeployConfirmClient requestId={requestId} notFound />
  }

  const summary = summarizeDeployRisk(result.workflow.workflowJson)

  return (
    <DeployConfirmClient
      requestId={requestId}
      derivedState={result.derivedState}
      workflow={{ name: result.workflow.name, workflowId: result.workflow.workflowId, agentId: result.workflow.agentId }}
      expiresAt={result.request.expiresAt.toISOString()}
      approvedAt={result.request.approvedAt ? result.request.approvedAt.toISOString() : null}
      summary={summary}
    />
  )
}
