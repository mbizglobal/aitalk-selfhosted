import { PrismaClient } from '@prisma/client'
import { extractButtonSettings, extractChatSettings, getDefaultWidgetSettings } from './widget-settings'
import defaultVoiceWorkflow from './default-voice-workflow.json'
import { getLocalTemplate } from '@/lib/local-templates'
import { assertWorkflowActivationAllowed, activationStatusFor } from '@/lib/entitlement'
import { isSelfHosted } from '@/lib/edition'
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'
import { generateWorkflowId } from '@/lib/workflow/service'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export const AGENT_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export function generateAgentId(): string {
  const chars = AGENT_ID_ALPHABET
  let result = ''
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export const defaultAgentTitles = {
  en: 'My Agent',
  de: 'Mein Agent',
  fr: 'Mon Agent',
  es: 'Mi Agente',
  ko: '내 에이전트'
}

export function getUserPreferredLanguage(request?: Request): 'en' | 'de' | 'fr' | 'es' | 'ko' {
  return 'en'
}

export async function createDefaultAgent(userId: string, language: 'en' | 'de' | 'fr' | 'es' | 'ko' = 'en', externalPrisma?: PrismaClient) {
  const dbClient = externalPrisma || prisma

  if (!dbClient) {
    throw new Error('Prisma client is not available')
  }

  if (!dbClient.agent) {
    throw new Error('agent model is not available on Prisma client')
  }

  try {

    let translations
    if (language === 'de') {
      translations = (await import('@/lib/translations/dashboard/de')).translations.de
    } else if (language === 'fr') {
      translations = (await import('@/lib/translations/dashboard/fr')).translations.fr
    } else if (language === 'es') {
      translations = (await import('@/lib/translations/dashboard/es')).translations.es
    } else if (language === 'ko') {
      translations = (await import('@/lib/translations/dashboard/ko')).translations.ko
    } else {
      translations = (await import('@/lib/translations/dashboard/en')).translations.en
    }

    const enTranslations = (await import('@/lib/translations/dashboard/en')).translations.en

    const widgetSettings = getDefaultWidgetSettings(language)
    const widgetButtonSettings = extractButtonSettings(widgetSettings)
    const widgetChatSettings = extractChatSettings(widgetSettings)

    const initialWorkflowState = activationStatusFor(await assertWorkflowActivationAllowed(userId))
    const workApp = isSelfHosted() ? getLocalTemplate('work-app') : null
    if (isSelfHosted() && !workApp?.workflowJson) throw new Error('Work App template is missing (src/data/workflow-templates/work-app.json)')

    const result = await dbClient.$transaction(async (tx) => {
      const existingAgent = await tx.agent.findFirst({
        where: {
          userId: userId,
          isDefault: true
        }
      })

      if (existingAgent) {
        console.log(`[createDefaultAgent] Default agent already exists for userId: ${userId}, agentId: ${existingAgent.agentId}`)
        return existingAgent
      }

      let agentId = generateAgentId()
      let attempts = 0
      const maxAttempts = 10

      while (attempts < maxAttempts) {
        const existingAgentId = await tx.agent.findUnique({
          where: { agentId }
        })

        if (!existingAgentId) {
          break
        }

        agentId = generateAgentId()
        attempts++
      }

      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique agent ID after multiple attempts')
      }

      console.log(`[createDefaultAgent] Creating new default agent for userId: ${userId}, agentId: ${agentId}`)
      const newAgent = await tx.agent.create({
        data: {
          agentId: agentId,
          title: defaultAgentTitles[language],
          userId: userId,
          defaultOwnerId: userId,
          isDefault: true,
          widgetSettings: JSON.stringify(widgetChatSettings),
          widgetButtonSettings: JSON.stringify(widgetButtonSettings),
          chatLimitMessage: translations.chat_limit_message,
          continuousAnswerLimitMessage: translations.continuous_answer_limit_message,
        }
      })
      console.log(`[createDefaultAgent] Successfully created agent for userId: ${userId}, agentId: ${agentId}`)

      //   start(pstn, webVoice.enabled) → AI(gpt-realtime-2.1) → source RAG + google_calendar → end.
      await tx.workflow.create({
        data: {
          workflowId: generateWorkflowId(),
          agentId: agentId,
          name: workApp ? workApp.name : translations.default_workflow_name,
          description: workApp ? workApp.description : translations.default_workflow_description,
          workflowJson: workApp ? workApp.workflowJson : JSON.stringify(defaultVoiceWorkflow),
          status: initialWorkflowState.status,
          trafficWeight: initialWorkflowState.trafficWeight,
        }
      })
      console.log(`[createDefaultAgent] Created default workflow for agentId: ${agentId}`)

      return newAgent
    })

    return result

  } catch (error: any) {
    let isDefaultOwnerIdConstraint = false
    if (error.code === 'P2002' && error.meta?.target) {
      const target = error.meta.target
      const targets = Array.isArray(target) ? target : [target]
      isDefaultOwnerIdConstraint = targets.some((t: string) =>
        t.includes('default_owner_id') || t.includes('defaultOwnerId')
      )
    }

    if (isDefaultOwnerIdConstraint) {
      console.log(`[createDefaultAgent] Unique constraint violation detected for userId: ${userId}, target: ${JSON.stringify(error.meta?.target)}`)
      const existingAgent = await dbClient.agent.findFirst({
        where: {
          userId: userId,
          isDefault: true
        }
      })
      if (existingAgent) {
        console.log(`[createDefaultAgent] Returning existing agent: ${existingAgent.agentId}`)
        return existingAgent
      }
      console.error(`[createDefaultAgent] Unique constraint violated but no existing agent found for userId: ${userId}`)
    }
    console.error(`[createDefaultAgent] Error creating default agent for userId: ${userId}`, error)
    throw error
  }
}

export async function createAdditionalAgent(userId: string, language: 'en' | 'de' | 'fr' | 'es' | 'ko' = 'en', externalPrisma?: PrismaClient) {
  try {
    const dbClient = externalPrisma || prisma

    if (!dbClient) {
      throw new Error('Prisma client is not available')
    }

    if (!dbClient.agent) {
      throw new Error('agent model is not available on Prisma client')
    }

    let translations
    if (language === 'de') {
      translations = (await import('@/lib/translations/dashboard/de')).translations.de
    } else if (language === 'fr') {
      translations = (await import('@/lib/translations/dashboard/fr')).translations.fr
    } else if (language === 'es') {
      translations = (await import('@/lib/translations/dashboard/es')).translations.es
    } else if (language === 'ko') {
      translations = (await import('@/lib/translations/dashboard/ko')).translations.ko
    } else {
      translations = (await import('@/lib/translations/dashboard/en')).translations.en
    }

    const widgetSettings = getDefaultWidgetSettings(language)
    const widgetButtonSettings = extractButtonSettings(widgetSettings)
    const widgetChatSettings = extractChatSettings(widgetSettings)

    const result = await dbClient.$transaction(async (tx) => {
      const currentAgentCount = await tx.agent.count({
        where: { userId: userId }
      })

      const limit = isSelfHosted()
        ? SELF_HOSTED_POLICY.agentLimit
        : ((await tx.subscription.findUnique({
            where: { id: userId },
            select: { num_assistant: true }
          }))?.num_assistant || 1)

      if (currentAgentCount + 1 > limit) {
        throw new Error(`Cannot create agent: would exceed limit (${currentAgentCount} + 1 > ${limit})`)
      }

      let agentId = generateAgentId()
      let attempts = 0
      const maxAttempts = 10

      while (attempts < maxAttempts) {
        const existingAgent = await tx.agent.findUnique({
          where: { agentId }
        })

        if (!existingAgent) {
          break
        }

        agentId = generateAgentId()
        attempts++
      }

      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique agent ID after multiple attempts')
      }

      console.log(`[createAdditionalAgent] Creating additional agent for userId: ${userId}, agentId: ${agentId}`)
      const newAgent = await tx.agent.create({
        data: {
          agentId: agentId,
          title: defaultAgentTitles[language],
          userId: userId,
          defaultOwnerId: null,
          isDefault: false,
          widgetSettings: JSON.stringify(widgetChatSettings),
          widgetButtonSettings: JSON.stringify(widgetButtonSettings),
          chatLimitMessage: translations.chat_limit_message,
          continuousAnswerLimitMessage: translations.continuous_answer_limit_message,
        }
      })
      console.log(`[createAdditionalAgent] Successfully created additional agent for userId: ${userId}, agentId: ${agentId}`)

      return newAgent
    })

    return result

  } catch (error) {
    throw error
  }
}
