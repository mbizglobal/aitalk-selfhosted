import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import OpenAI from 'openai'

export function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex')
}

export function generateFingerprint(userAgent: string | null, ipAddress: string | null): string {
  const data = [userAgent || 'unknown', ipAddress || 'unknown'].join('|')
  return crypto.createHash('sha256').update(data).digest('hex')
}

export function getClientIP(req: Request): string {
  const headers = req.headers
  const forwarded = headers.get('x-forwarded-for')
  const realIp = headers.get('x-real-ip')

  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  if (realIp) {
    return realIp
  }
  return 'unknown'
}

export async function isPaidUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      settings: {
        select: { plan: true }
      },
      subscription: {
        select: {
          end_date: true,
          paid_cpa: true,
          paid_total: true
        }
      }
    }
  })

  if (!user) {
    return false
  }

  const plan = user.settings?.plan?.toLowerCase() ?? 'free'
  const subscription = user.subscription

  if (!subscription) {
    return false
  }

  const hasPaidPlan = !plan.includes('free')
  const membershipActive = subscription.end_date ? new Date(subscription.end_date) > new Date() : false
  const hasPaidCredits = (subscription.paid_cpa ?? 0) > 0 || (subscription.paid_total ?? 0) > 0

  return hasPaidPlan && membershipActive && hasPaidCredits
}

export async function deleteOpenAIFile(fileId: string, apiKey?: string): Promise<void> {
  try {
    if (!apiKey) {
      console.warn(`[Anonymization] No API key provided, skipping file deletion: ${fileId}`)
      return
    }
    const openai = new OpenAI({ apiKey })
    await openai.files.delete(fileId)
    console.log(`[Anonymization] ✓ OpenAI file deleted: ${fileId}`)
  } catch (error: any) {
    if (error?.status === 404) {
      console.log(`[Anonymization] ✓ OpenAI file already deleted or not found: ${fileId}`)
    } else {
      console.error(`[Anonymization] ✗ Failed to delete OpenAI file ${fileId}:`, error)
    }
  }
}

export async function deleteVectorStoreFile(vectorStoreId: string, fileId: string, apiKey?: string): Promise<void> {
  try {
    if (!apiKey) {
      console.warn(`[Anonymization] No API key provided, skipping vector store file deletion: ${vectorStoreId}/${fileId}`)
      return
    }
    const openai = new OpenAI({ apiKey })
    await openai.vectorStores.files.delete(fileId, { vector_store_id: vectorStoreId })
    console.log(`[Anonymization] ✓ Vector Store file deleted: ${vectorStoreId}/${fileId}`)
  } catch (error: any) {
    if (error?.status === 404) {
      console.log(`[Anonymization] ✓ Vector Store file already deleted or not found: ${vectorStoreId}/${fileId}`)
    } else {
      console.error(`[Anonymization] ✗ Failed to delete Vector Store file ${vectorStoreId}/${fileId}:`, error)
    }
  }
}

export async function deleteVectorStore(vectorStoreId: string, apiKey?: string): Promise<void> {
  try {
    if (!apiKey) {
      console.warn(`[Anonymization] No API key provided, skipping vector store deletion: ${vectorStoreId}`)
      return
    }
    const openai = new OpenAI({ apiKey })
    await openai.vectorStores.delete(vectorStoreId)
    console.log(`[Anonymization] ✓ Vector Store deleted: ${vectorStoreId}`)
  } catch (error: any) {
    if (error?.status === 404) {
      console.log(`[Anonymization] ✓ Vector Store already deleted or not found: ${vectorStoreId}`)
    } else {
      console.error(`[Anonymization] ✗ Failed to delete Vector Store ${vectorStoreId}:`, error)
    }
  }
}

export async function checkRecentAnonymizationByEmail(email: string): Promise<boolean> {
  const emailHash = hashEmail(email)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const recentHistory = await prisma.anonymizationHistory.findFirst({
    where: {
      emailHash,
      anonymizedAt: { gte: thirtyDaysAgo }
    }
  })

  return recentHistory !== null
}

export async function checkRecentAnonymizationByDevice(fingerprint: string): Promise<boolean> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const recentHistory = await prisma.anonymizationHistory.findFirst({
    where: {
      fingerprint,
      anonymizedAt: { gte: thirtyDaysAgo }
    }
  })

  return recentHistory !== null
}

export async function collectUserStats(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      cpaLedger: true,
      agents: {
        include: {
          storage: true
        }
      }
    }
  })

  if (!user) {
    throw new Error('User not found')
  }

  const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24))
  const totalCpaUsed = user.cpaLedger.reduce((sum, log) => sum + log.cpa_amount, 0)
  const agentCount = user.agents?.length || 0
  const storageCount = user.agents?.reduce((sum, agent) => sum + (agent.storage?.length || 0), 0) || 0

  return {
    accountAge,
    totalCpaUsed,
    agentCount,
    storageCount
  }
}
