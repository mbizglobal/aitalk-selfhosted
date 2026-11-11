import type { Prisma } from '@prisma/client'

export async function deleteAccountLeftovers(
  tx: Prisma.TransactionClient,
  a: { userId: string; agentIds: readonly string[]; email: string | null },
): Promise<void> {
  const { userId, email } = a
  if (!userId) throw new Error('deleteAccountLeftovers: userId is required')
  const agentId = { in: [...a.agentIds] }

  await tx.emailChangeToken.deleteMany({ where: { userId } })
  await tx.workflowAiAssistantSession.deleteMany({ where: { userId } })
  await tx.mcpAuditLog.deleteMany({ where: { userId } })
  await tx.verificationToken.deleteMany({ where: { identifier: { contains: userId } } })

  if (a.agentIds.length > 0) {
    await tx.voiceQuizConsent.deleteMany({ where: { agentId } })
    await tx.voiceQuizConsentNotice.deleteMany({ where: { agentId } })
    await tx.voiceQuizRound.deleteMany({ where: { agentId } })
    await tx.voiceQuizLesson.deleteMany({ where: { agentId } })
    await tx.voiceQuizProgress.deleteMany({ where: { agentId } })
    await tx.voiceQuizReservation.deleteMany({ where: { agentId } })
    await tx.voiceQuizDialClaim.deleteMany({ where: { agentId } })
    await tx.voiceQuizMemberAction.deleteMany({ where: { agentId } })
    await tx.voiceQuizWithdrawal.deleteMany({ where: { agentId } })
  }
  await tx.voiceQuizConsentExport.deleteMany({ where: { OR: [{ userId }, { agentId }] } })

  await tx.trialLead.updateMany({
    where: { OR: [{ userId }, ...(email ? [{ email, userId: null }] : [])] },
    data: {
      companyName: 'Deleted',
      contactName: 'Deleted User',
      email: `deleted_${userId}@anonymized.local`,
      phone: null,
      country: null,
      useCase: null,
    },
  })
}
