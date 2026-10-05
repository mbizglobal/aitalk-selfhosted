import { prisma } from '@/lib/prisma'
import {
  hashEmail,
  generateFingerprint,
  deleteOpenAIFile,
  deleteVectorStoreFile,
  deleteVectorStore,
  collectUserStats
} from '@/lib/anonymization'
import { emailService } from '@/lib/email'
import { deleteIconFromS3, isStoredIconUrl } from '@/lib/s3'
import { Language } from '@/lib/translations'
import { decrypt, decryptDataKey, decryptDataKeyWithLegacy } from '@/lib/encryption'
import { getKnowledgeStore, SELFHOSTED_REGION } from '@/lib/knowledge'
import { isSelfHosted } from '@/lib/edition'
import { describeCaughtError, safeLogToken } from '@/lib/log-mask'
import { purgeMemberPersonalData, memberLookupWhere, lockSeatsForAccountDeletion } from '@/lib/team/member-purge'
import { lockAgentSeats } from '@/lib/teamSeats'

export async function executeAnonymization(userId: string, requestId: string) {
  const request = await prisma.anonymizationRequest.findUnique({
    where: { id: requestId }
  })

  if (!request) {
    throw new Error('Anonymization request not found')
  }

  const selfHosted = isSelfHosted()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: !selfHosted,
      agents: {
        include: {
          storage: true,
          members: true
        }
      },
      settings: true,
      cpaLedger: true,
      aiProviders: true,
      zki: true
    }
  })

  if (!user) {
    throw new Error('User not found')
  }

  if (user.isAnonymized) {
    throw new Error('User is already anonymized')
  }

  const userEmail = user.email!
  const userLanguage = (user.settings?.locale?.split('-')[0] || 'en') as Language

  let userApiKey: string | undefined
  if (user.aiProviders?.providers && user.encryptedDataKey) {
    try {
      const providersConfig = JSON.parse(user.aiProviders.providers)
      if (providersConfig.openai?.apiKey) {
        let dek: Buffer
        if (user.zkiId && user.zki?.masterKey) {
          dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
        } else {
          dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
        }
        const decryptedKey = decrypt(Buffer.from(providersConfig.openai.apiKey, 'base64'), dek)

        if (decryptedKey === 'Decryption failed' || !decryptedKey.startsWith('sk-')) {
          console.warn(`[Anonymization] API key decryption returned invalid value, skipping OpenAI resource deletion`)
          userApiKey = undefined
        } else {
          userApiKey = decryptedKey
        }
      }
    } catch (error) {
      console.error(`[Anonymization] Failed to decrypt user API key:`, error)
      userApiKey = undefined
    }
  }

  const stats = await collectUserStats(userId)

  try {
    if (isStoredIconUrl(user.image)) {
      await deleteIconFromS3(user.image)
      console.log(`[Anonymization] Deleted user icon from Blob`)
    }
    for (const agent of user.agents) {
      if (isStoredIconUrl((agent as any).icon)) {
        await deleteIconFromS3((agent as any).icon)
        console.log(`[Anonymization] Deleted agent icon from Blob: ${agent.agentId}`)
      }
    }
  } catch (error) {
    console.warn(`[Anonymization] Failed to delete icons from Blob:`, error)
  }

  console.log(`[Anonymization] Deleting OpenAI resources for user ${userId}`)

  for (const agent of user.agents) {
    const storageItems = agent.storage || []

    for (const item of storageItems) {
      if (item.openaiFileId) {
        await deleteOpenAIFile(item.openaiFileId, userApiKey)
      }

      if (item.vectorStoreFileId && agent.vectorStoreId) {
        await deleteVectorStoreFile(agent.vectorStoreId, item.vectorStoreFileId, userApiKey)
      }
    }

    if (agent.vectorStoreId) {
      await deleteVectorStore(agent.vectorStoreId, userApiKey)
    }
  }

  console.log(`[Anonymization] OpenAI resources deleted`)

  const isManaged = user.subscription?.serviceVariant === 'managed'
  const managedRegion = selfHosted ? SELFHOSTED_REGION : user.subscription?.managedRegion
  if (isManaged || selfHosted) {
    console.log(`[Anonymization] Deleting Azure AI Search + Blob resources for user ${userId}`)
    const cleanupErrors: string[] = []

    if (!selfHosted) try {
      if (!managedRegion) {
        throw new Error('managedRegion is not set for this managed account')
      }
      const store = await getKnowledgeStore({ regionId: managedRegion })
      for (const agent of user.agents) {
        try {
          await store.deleteAgent(agent.agentId)
          console.log(`[Anonymization] Azure AI Search chunks deleted for agent=${agent.agentId}`)
        } catch (error) {
          console.error(`[Anonymization] Azure AI Search cleanup failed for agent=${safeLogToken(agent.agentId)}:`, describeCaughtError(error))
          cleanupErrors.push(`search(${safeLogToken(agent.agentId)}): ${describeCaughtError(error)}`)
        }
      }
    } catch (error) {
      console.error(`[Anonymization] Azure AI Search client init failed:`, describeCaughtError(error))
      cleanupErrors.push(`search-init: ${describeCaughtError(error)}`)
    }

    try {
      if (!managedRegion) {
        throw new Error('managedRegion is not set for this managed account')
      }
      const { deleteUserBlobs } = await import('@/lib/managed/blob-storage')
      await deleteUserBlobs(managedRegion, userId)
      console.log(`[Anonymization] Blob files deleted for user=${userId}`)
    } catch (error) {
      console.error(`[Anonymization] Blob cleanup failed:`, describeCaughtError(error))
      cleanupErrors.push(`blob: ${describeCaughtError(error)}`)
    }

    if (cleanupErrors.length > 0) {
      throw new Error(`Managed resource cleanup failed — anonymization aborted before DB changes: ${cleanupErrors.join('; ')}`)
    }
  }

  console.log(`[Anonymization] Starting database transaction`)

  await prisma.$transaction(async (tx) => {
    const memberWhere = memberLookupWhere(userEmail, userId)
    const memberAgents = await tx.agentMember.findMany({
      where: memberWhere,
      select: { agentAgentId: true }
    })
    await lockSeatsForAccountDeletion(tx, lockAgentSeats, [
      ...user.agents.map(a => a.agentId),
      ...memberAgents.map(m => m.agentAgentId),
    ])

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4201, hashtext(${userId}))`

    const allMembers = await tx.agentMember.findMany({
      where: {
        OR: [
          { agentAgentId: { in: user.agents.map(a => a.agentId) } },
          memberWhere,
        ],
      },
      select: { id: true }
    })
    if (allMembers.length > 0) {
      const allMemberIds = allMembers.map(m => m.id)
      await tx.agentMemberPasskey.deleteMany({ where: { memberId: { in: allMemberIds } } })
      await tx.agentMember.deleteMany({ where: { id: { in: allMemberIds } } })
      const purged = await purgeMemberPersonalData(tx as any, allMemberIds)
      console.log(
        `[Anonymization] Purged member data: learning=${purged.learningStates} quiz=${purged.quizHistoryRows} result=${purged.results} ` +
        `payloadDetached=${purged.payloadsDetached} pwToken=${purged.passwordResetTokens} emailToken=${purged.emailChangeTokens}`
      )
    }

    const { deleteUserWorkData } = await import('@/lib/work/purge')
    const work = await deleteUserWorkData(tx, userId)
    console.log(`[Anonymization] Deleted work projects=${work.projects} events=${work.events}`)

    for (const agent of user.agents) {
      await tx.conversation.deleteMany({
        where: { agentId: agent.agentId }
      })

      await tx.cpaUsageLog.deleteMany({
        where: { agentId: agent.agentId }
      })

      await tx.workflowTempStorage.deleteMany({
        where: { agentId: agent.agentId }
      })

      await tx.workflowSchedule.deleteMany({
        where: { agentId: agent.agentId }
      })

      const workflowGroups = await tx.workflowGroup.findMany({
        where: { agentId: agent.agentId },
        select: { id: true }
      })
      if (workflowGroups.length > 0) {
        const groupIds = workflowGroups.map(g => g.id)
        await tx.workflowGroupItem.deleteMany({
          where: { groupId: { in: groupIds } }
        })
        await tx.workflowGroupDataSheet.deleteMany({
          where: { groupId: { in: groupIds } }
        })
      }

      const dataSheets = await tx.dataSheet.findMany({
        where: { agentId: agent.agentId },
        select: { id: true }
      })
      if (dataSheets.length > 0) {
        const sheetIds = dataSheets.map(s => s.id)
        await tx.dataSheetRow.deleteMany({
          where: { sheetId: { in: sheetIds } }
        })
      }

      await tx.dataSheet.deleteMany({
        where: { agentId: agent.agentId }
      })

      await tx.workflow.deleteMany({
        where: { agentId: agent.agentId }
      })

      await tx.workflowGroup.deleteMany({
        where: { agentId: agent.agentId }
      })

      await tx.ragStore.deleteMany({
        where: { agentId: agent.agentId }
      })

      await tx.workflowConnection.deleteMany({
        where: { agentId: agent.agentId }
      })

      await tx.agentMemberInvitation.deleteMany({
        where: { agentAgentId: agent.agentId }
      })

      await tx.agentMemberPasswordResetToken.deleteMany({
        where: { agentAgentId: agent.agentId }
      })

      await tx.agentMemberEmailChangeToken.deleteMany({
        where: { agentAgentId: agent.agentId }
      })

      await tx.storage.deleteMany({
        where: { agentId: agent.agentId }
      })

      await tx.agent.delete({ where: { id: agent.id } })
    }

    await tx.agentMemberPasswordResetToken.deleteMany({
      where: { email: userEmail }
    })

    await tx.agentMemberInvitation.deleteMany({
      where: { email: userEmail }
    })

    await tx.passwordResetToken.deleteMany({
      where: { email: userEmail }
    })

    await tx.emailResendAttempt.deleteMany({
      where: { email: userEmail }
    })

    await tx.account.deleteMany({
      where: { userId }
    })

    await tx.appRefreshToken.deleteMany({
      where: { userId }
    })

    await tx.appPushToken.deleteMany({
      where: { userId }
    })

    await tx.passkey.deleteMany({ where: { userId } })

    await tx.analyticsConfig.deleteMany({ where: { userId } })

    await tx.webVisitorContact.deleteMany({ where: { userId } })

    await tx.bookingIndex.deleteMany({ where: { userId } })

    await tx.emailChangeToken.deleteMany({ where: { userId } })

    await tx.mcpAccessToken.deleteMany({ where: { userId } })
    await tx.mcpDeployRequest.deleteMany({ where: { userId } })

    await tx.workflowAiAssistantSession.deleteMany({ where: { userId } })

    if (user.agents.length > 0) {
      const agentIds = user.agents.map(a => a.agentId)
      await tx.voiceQuizRound.deleteMany({ where: { agentId: { in: agentIds } } })
      await tx.voiceQuizLesson.deleteMany({ where: { agentId: { in: agentIds } } })
      await tx.voiceQuizConsent.deleteMany({ where: { agentId: { in: agentIds } } })
      await tx.voiceQuizConsentNotice.deleteMany({ where: { agentId: { in: agentIds } } })
      await tx.voiceQuizConsentExport.deleteMany({ where: { agentId: { in: agentIds } } })
    }

    await tx.trialLead.updateMany({
      where: {
        OR: [
          { userId },
          ...(userEmail ? [{ email: userEmail, userId: null }] : []),
        ],
      },
      data: {
        companyName: 'Deleted',
        contactName: 'Deleted User',
        email: `deleted_${userId}@anonymized.local`,
        phone: null,
        country: null,
        useCase: null,
      },
    })

    await tx.aiProviders.deleteMany({
      where: { id: userId }
    })

    await tx.ragProviders.deleteMany({
      where: { id: userId }
    })

    await tx.settings.deleteMany({
      where: { id: userId }
    })

    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted_${userId}@anonymized.local`,
        name: 'Deleted User',
        image: null,
        password: null,
        emailVerified: null,
        encryptedDataKey: null,
        isAnonymized: true,
        anonymizedAt: new Date()
      }
    })

    await tx.anonymizationHistory.create({
      data: {
        emailHash: hashEmail(userEmail),
        fingerprint: request.fingerprint,
        anonymizedAt: new Date(),
        accountAge: stats.accountAge,
        totalCpaUsed: stats.totalCpaUsed,
        hadPaidPlan: user.settings?.plan ? !user.settings.plan.toLowerCase().includes('free') : false,
        agentCount: stats.agentCount,
        storageCount: stats.storageCount
      }
    })

    await tx.anonymizationRequest.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        processedAt: new Date()
      }
    })
  })

  try {
    await emailService.sendAnonymizationCompletedEmail(userEmail, userLanguage)
  } catch (error) {
    console.error(`[Anonymization] Failed to send completion email:`, error)
  }

  return {
    success: true,
    hasApiKey: !!userApiKey
  }
}
