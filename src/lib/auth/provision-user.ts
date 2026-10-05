import { prisma } from '@/lib/prisma'
import { createDefaultAgent } from '@/lib/agent'
import { getTimezoneByLanguage, getTimeFormatByLanguage } from '@/lib/timezone-helper'
import type { WidgetLanguage } from '@/lib/widget-settings'
import type { SubscriptionPlan, ServiceVariant } from '@prisma/client'
import {
  getManagedPlanAgentLimit,
  getManagedStoragePerAgent,
  getManagedDocPagesPerMonth,
} from '@/lib/invoice/subscription/utils'
import { hasEverPaidById } from '@/lib/subscription/payment-history'
import { isSelfHosted } from '@/lib/edition'

export type TrialGrantMode = 'server' | 'store'
export type ProvisionMode = 'best_effort' | 'strict'
export type SignupSource = 'web' | 'web_partner' | 'b2b_contact' | 'app' | 'web_pending'
export type SignupPlatform = 'web' | 'ios' | 'android'

export interface ProvisionUserInput {
  userId: string
  language: WidgetLanguage
  planType?: SubscriptionPlan // default 'free'
  serviceVariant?: ServiceVariant
  partnerId?: string | null
  signupSource?: SignupSource | null
  signupPlatform?: SignupPlatform | null
  trialGrantMode?: TrialGrantMode
  managedRegion?: string | null
  trialCpaAllocation?: number
  mode?: ProvisionMode // default 'best_effort'
  skipAgent?: boolean
}

export interface ProvisionResult {
  warnings: string[]
}

const TRIAL_DAYS = 14
const FREE_CPA = 50
const SUBSCRIPTION_DAYS = 30

function localeForLanguage(language: WidgetLanguage): string {
  if (language === 'de') return 'de-DE'
  if (language === 'fr') return 'fr-FR'
  if (language === 'es') return 'es-ES'
  if (language === 'ko') return 'ko-KR'
  return 'en-US'
}


export async function provisionTrialUser(input: ProvisionUserInput): Promise<ProvisionResult> {
  const mode = input.mode ?? 'best_effort'
  const warnings: string[] = []

  const trialGrantMode: TrialGrantMode | undefined = input.trialGrantMode

  const serviceVariant: ServiceVariant = input.serviceVariant ?? 'managed'

  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      if (mode === 'strict') throw e
      console.error(`[provisionTrialUser] ${label} failed:`, e)
      warnings.push(label)
    }
  }

  if (!input.skipAgent) {
    await run('agent', async () => {
      const has = await prisma.agent.findFirst({ where: { userId: input.userId }, select: { id: true } })
      if (!has) await createDefaultAgent(input.userId, input.language, prisma)
    })
  }

  // 2. Settings
  await run('settings', async () => {
    await prisma.settings.create({
      data: {
        id: input.userId,
        timezone: getTimezoneByLanguage(input.language),
        locale: localeForLanguage(input.language),
        time_format: getTimeFormatByLanguage(input.language),
        plan: input.planType ?? 'free',
        api_key_configured: false,
      },
    })
  })

  if (isSelfHosted()) return { warnings }
  await run('subscription', async () => {
    const now = new Date()
    const endDate = new Date(now)
    endDate.setDate(endDate.getDate() + SUBSCRIPTION_DAYS)
    const trialEndsAt =
      trialGrantMode === 'server'
        ? new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
        : null
    const planType = input.planType ?? 'free'
    const isManaged = serviceVariant === 'managed'
    const limitPlan = planType === 'free' ? 'starter' : planType
    const managedFields = isManaged
      ? {
          managedRegion: 'switzerlandnorth',
          num_assistant: getManagedPlanAgentLimit(limitPlan),
          storagePerAgent: getManagedStoragePerAgent(limitPlan),
          docPagesPerMonth: getManagedDocPagesPerMonth(limitPlan),
          ...(planType !== 'free'
            ? {
                paid_cpa: input.trialCpaAllocation ?? TRIAL_CPA,
                paid_total: input.trialCpaAllocation ?? TRIAL_CPA,
              }
            : {}),
        }
      : {}
    await prisma.subscription.create({
      data: {
        id: input.userId,
        planType,
        free_cpa: FREE_CPA,
        free_total: FREE_CPA,
        month: 1,
        start_date: now,
        end_date: endDate,
        status: 'active',
        ...(serviceVariant ? { serviceVariant } : {}),
        ...(input.partnerId ? { partnerId: input.partnerId } : {}),
        signupSource: input.signupSource ?? null,
        signupPlatform: input.signupPlatform ?? null,
        trialEndsAt,
        ...managedFields,
      },
    })
  })

  return { warnings }
}

const WEB_TRIAL_PLAN: SubscriptionPlan = 'starter'
const TRIAL_CPA = 500

const AUTO_TRIAL_PARAMS = {
  planType: WEB_TRIAL_PLAN,
  serviceVariant: 'managed',
  trialGrantMode: 'server',
} as const

export async function provisionWebTrialUser(input: {
  userId: string
  language: WidgetLanguage
  partnerId?: string | null
  mode?: ProvisionMode
  skipAgent?: boolean
}): Promise<ProvisionResult> {
  return provisionTrialUser({
    userId: input.userId,
    language: input.language,
    signupSource: 'web',
    signupPlatform: 'web',
    ...AUTO_TRIAL_PARAMS,
    partnerId: input.partnerId ?? null,
    mode: input.mode ?? 'best_effort',
    skipAgent: input.skipAgent,
  })
}

export async function provisionAppTrialUser(input: {
  userId: string
  language: WidgetLanguage
  signupPlatform?: SignupPlatform | null
  mode?: ProvisionMode
}): Promise<ProvisionResult> {
  return provisionTrialUser({
    userId: input.userId,
    language: input.language,
    signupSource: 'app',
    signupPlatform: input.signupPlatform ?? null,
    ...AUTO_TRIAL_PARAMS,
    mode: input.mode ?? 'best_effort',
  })
}

export async function ensurePendingSubscription(userId: string, language: WidgetLanguage = 'en'): Promise<void> {
  const existing = await prisma.subscription.findUnique({ where: { id: userId }, select: { id: true } })
  if (existing) return
  await provisionTrialUser({
    userId,
    language,
    signupSource: 'web_pending',
    signupPlatform: 'web',
    mode: 'best_effort',
    skipAgent: true,
  }).catch((err) => console.error('[ensurePendingSubscription] repair failed (non-fatal):', err))
}

export async function hasReceivedTrialOrPaid(
  sub: { id: string; trialEndsAt: Date | null },
): Promise<boolean> {
  if (sub.trialEndsAt !== null) return true
  return hasEverPaidById(sub.id)
}

export async function upgradePendingToTrial(input: {
  userId: string
  language: WidgetLanguage
  planType: SubscriptionPlan
  partnerId?: string | null
  signupSource: Exclude<SignupSource, 'app' | 'web_pending'>
  managedRegion?: string
  trialCpaAllocation?: number
}): Promise<boolean> {
  const now = new Date()
  const endDate = new Date(now)
  endDate.setDate(endDate.getDate() + SUBSCRIPTION_DAYS)
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
  const cpa = input.trialCpaAllocation ?? TRIAL_CPA
  const region = 'switzerlandnorth'

  const current = await prisma.subscription.findUnique({
    where: { id: input.userId },
    select: { id: true, trialEndsAt: true },
  })
  if (!current || (await hasReceivedTrialOrPaid(current))) return false

  const upgraded = await prisma.$transaction(async (tx) => {
    const res = await tx.subscription.updateMany({
      where: { id: input.userId, signupSource: { in: ['web_pending', 'app'] }, planType: 'free', trialEndsAt: null },
      data: {
        planType: input.planType,
        serviceVariant: 'managed',
        status: 'active',
        start_date: now,
        end_date: endDate,
        trialEndsAt,
        signupSource: input.signupSource,
        partnerId: input.partnerId ?? null,
        managedRegion: region,
        num_assistant: getManagedPlanAgentLimit(input.planType),
        storagePerAgent: getManagedStoragePerAgent(input.planType),
        docPagesPerMonth: getManagedDocPagesPerMonth(input.planType),
        paid_cpa: cpa,
        paid_total: cpa,
      },
    })
    if (res.count === 0) return false
    await tx.settings.update({ where: { id: input.userId }, data: { plan: input.planType } })
    return true
  })
  if (!upgraded) return false

  try {
    const hasAgent = await prisma.agent.findFirst({ where: { userId: input.userId }, select: { id: true } })
    if (!hasAgent) {
      await createDefaultAgent(input.userId, input.language, prisma)
    }
  } catch (e) {
    console.error('[upgradePendingToTrial] default agent creation failed (non-fatal):', e)
  }
  return true
}
