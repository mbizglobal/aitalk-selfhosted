import { Prisma, PrismaClient } from '@prisma/client'
import { extractButtonSettings, extractChatSettings, getDefaultWidgetSettings } from './widget-settings'
import defaultVoiceWorkflow from './default-voice-workflow.json'
import { getWorkAppTemplate } from '@/lib/work/workflow-template-catalog'
import { assertWorkflowActivationAllowed, activationStatusFor } from '@/lib/entitlement'
import { isSelfHosted } from '@/lib/edition'
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'
import { generateWorkflowId } from '@/lib/workflow/service'
import { isAppWorkflow } from '@/lib/workflow/start-trigger'
import { appNodesOf, isAppCanvas } from '@/lib/work/app-canvas'
import { isAppTemplateKind } from '@/lib/work/app-template-kinds'

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

async function createDefaultAppCanvas(
  tx: Prisma.TransactionClient,
  a: { userId: string; agentId: string; workApp: { name: string; description: string; workflowJson: string }; state: { status: string; trafficWeight: number }; key: Buffer | null },
) {
  const appCanvasId = generateWorkflowId()
  await tx.workflow.create({
    data: {
      workflowId: appCanvasId,
      agentId: a.agentId,
      name: a.workApp.name,
      description: a.workApp.description,
      workflowJson: a.workApp.workflowJson,
      status: a.state.status,
      trafficWeight: a.state.trafficWeight,
    },
  })
  console.log(`[createDefaultAgent] Created default work app canvas for agentId: ${a.agentId}`)
  if (a.key && a.state.status === 'production') {
    const { syncAppNodesLocked } = await import('@/lib/work/app-canvas-sync')
    await syncAppNodesLocked(tx, { userId: a.userId, agentId: a.agentId, parentWorkflowId: appCanvasId, workflowJson: a.workApp.workflowJson, key: a.key, newWorkflowId: generateWorkflowId })
  }
}

function loadDefaultWorkApp(welcome: string): { name: string; description: string; workflowJson: string } | null {
  try {
    const r = getWorkAppTemplate('work-app-receipts')?.template
    if (r?.workflowJson && isAppCanvas(r.workflowJson) && isAppTemplateKind('receipts')) {
      const g = JSON.parse(r.workflowJson) as { nodes: Array<{ id?: string; data?: Record<string, unknown> }>; edges?: Array<{ source?: string; target?: string }> }
      const apps = appNodesOf(g)
      if (apps.filter((n) => n.data?.appTemplate === 'receipts').length === 1) {
        const drop = new Set(g.nodes.filter((n) => typeof n.id === 'string' && (n.data?.nodeType === 'workAppLink' || (n.data?.nodeType === 'workApp' && n.data.appTemplate !== 'receipts'))).map((n) => n.id as string))
        g.nodes = g.nodes.filter((n) => !(typeof n.id === 'string' && drop.has(n.id)))
        if (g.edges) g.edges = g.edges.filter((e) => !(typeof e.source === 'string' && drop.has(e.source)) && !(typeof e.target === 'string' && drop.has(e.target)))
        if (welcome) for (const n of g.nodes) if (n.data?.nodeType === 'workApp') n.data.appWelcomeMessage = welcome
        return { name: r.name, description: r.description, workflowJson: JSON.stringify(g) }
      }
    }
    console.error('[createDefaultAgent] work-app-receipts template missing or not a receipts canvas — falling back to work-app')
  } catch {
    console.error('[createDefaultAgent] work-app-receipts template unreadable — falling back to work-app')
  }
  try {
    const t = getWorkAppTemplate('work-app')?.template
    if (!t?.workflowJson || !isAppWorkflow(t.workflowJson)) {
      console.error('[createDefaultAgent] work-app template missing or not a work app canvas — skipped')
      return null
    }
    return { name: t.name, description: t.description, workflowJson: t.workflowJson }
  } catch {
    console.error('[createDefaultAgent] work-app template unreadable — skipped')
    return null
  }
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
    const already = await dbClient.agent.findFirst({ where: { userId, isDefault: true } })
    if (already) return already

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
    const workApp = loadDefaultWorkApp((translations as { default_work_app_welcome?: string }).default_work_app_welcome ?? '')
    if (isSelfHosted() && !workApp) throw new Error('Work App template is missing or is not a work app canvas (src/lib/work/workflow-templates/work-app.json)')
    const canvasKey = isSelfHosted() && workApp && initialWorkflowState.status === 'production'
      ? await (await import('@/lib/user-data-key')).ensureUserDataKey(dbClient, userId)
      : null
    let createdAgentId: string | null = null

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
      if (!isSelfHosted()) {
        await tx.workflow.create({
          data: {
            workflowId: generateWorkflowId(),
            agentId: agentId,
            name: translations.default_workflow_name,
            description: translations.default_workflow_description,
            workflowJson: JSON.stringify(defaultVoiceWorkflow),
            status: initialWorkflowState.status,
            trafficWeight: initialWorkflowState.trafficWeight,
          }
        })
        console.log(`[createDefaultAgent] Created default voice workflow for agentId: ${agentId}`)
      }
      if (isSelfHosted() && workApp) await createDefaultAppCanvas(tx, { userId, agentId, workApp, state: initialWorkflowState, key: canvasKey })
      createdAgentId = agentId
      return newAgent
    })

    if (!isSelfHosted() && workApp && createdAgentId) {
      const agentId = createdAgentId
      try {
        const key = initialWorkflowState.status === 'production'
          ? await (await import('@/lib/user-data-key')).ensureUserDataKey(dbClient, userId)
          : null
        await dbClient.$transaction((tx) => createDefaultAppCanvas(tx, { userId, agentId, workApp, state: initialWorkflowState, key }))
      } catch (e) {
        console.error('[createDefaultAgent] default work app canvas skipped:', e instanceof Error ? e.message.slice(0, 200) : 'error')
      }
    }

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

export async function completeDefaultWorkApp(userId: string): Promise<'done' | 'partial' | 'skipped' | 'failed'> {
  if (isSelfHosted()) return 'skipped'
  try {
    const agent = await prisma.agent.findFirst({ where: { userId, isDefault: true }, select: { agentId: true } })
    const t = getWorkAppTemplate('work-app-receipts')?.template
    if (!agent || !t?.workflowJson || !isAppCanvas(t.workflowJson)) return 'skipped'
    const { linkNodesOf } = await import('@/lib/work/app-canvas')
    type G = { nodes: Array<{ id?: string; data?: Record<string, unknown> }>; edges?: Array<{ source?: string; target?: string; sourceHandle?: string | null }> }
    const tplApp = appNodesOf(t.workflowJson).find((n) => n.data?.appTemplate === 'receipts')
    const tplLink = linkNodesOf(t.workflowJson).filter((n) => n.data?.appTemplate === 'ledger')
    if (!tplApp?.id || tplLink.length !== 1) return 'skipped'
    const tpl = JSON.parse(t.workflowJson) as G
    const linkId = tplLink[0].id
    const sub = (drop: (n: G['nodes'][number]) => boolean): G => {
      const keep = new Set(tpl.nodes.filter((n) => !drop(n)).map((n) => n.id))
      return { nodes: tpl.nodes.filter((n) => keep.has(n.id)), edges: (tpl.edges ?? []).filter((e) => keep.has(e.source) && keep.has(e.target)) }
    }
    const sig = (g: G) => JSON.stringify([g.nodes.filter((n) => n.id !== tplApp.id).map((n) => JSON.stringify(n)).sort(), (g.edges ?? []).map((e) => JSON.stringify(e)).sort(), g.nodes.some((n) => n.id === tplApp.id)])
    const shapes = new Set([sig(sub((n) => n.data?.nodeType === 'workAppLink' || (n.data?.nodeType === 'workApp' && n.data.appTemplate !== 'receipts'))), sig(sub((n) => n.id === linkId))])
    const { findOrCreateDefaultLedger, updateWorkflow } = await import('@/lib/workflow/service')
    const findCanvas = async () => (await prisma.workflow.findMany({ where: { agentId: agent.agentId, kind: 'main', status: 'production' }, select: { workflowId: true, version: true, workflowJson: true } }))
      .find((w) => isAppCanvas(w.workflowJson) && shapes.has(sig(JSON.parse(w.workflowJson) as G)) && appNodesOf(w.workflowJson).some((n) => n.id === tplApp.id && n.data?.appTemplate === 'receipts'))
    let c = await findCanvas()
    if (!c) return 'skipped'
    const led = await findOrCreateDefaultLedger({ userId, agentId: agent.agentId, forWorkflowId: c.workflowId })
    if ('code' in led) console.error('[completeDefaultWorkApp] ledger not linked:', led.code)
    const book = 'appWorkflowId' in led ? led.appWorkflowId : null
    if (!book && linkNodesOf(c.workflowJson).length === 0 && appNodesOf(c.workflowJson).length > 1) return 'partial'
    for (let attempt = 0; attempt < 2 && c; attempt++) {
      const full = JSON.parse(t.workflowJson) as G
      const mine = (JSON.parse(c.workflowJson) as G).nodes.find((n) => n.id === tplApp.id)
      full.nodes = full.nodes.flatMap((n) => (n.id === tplApp.id && mine ? [mine] : n.id === linkId ? (book ? [{ ...n, data: { ...n.data, linkedAppWorkflowId: book } }] : []) : [n]))
      if (!book) full.edges = (full.edges ?? []).filter((e) => e.source !== linkId && e.target !== linkId)
      const w = await updateWorkflow({ userId, workflowId: c.workflowId, patch: { workflowJson: JSON.stringify(full) }, expectedVersion: c.version, expectedStatus: 'production', note: 'default work app: approvals + bank ledger' })
      if (w.ok) return book ? 'done' : 'partial'
      console.error('[completeDefaultWorkApp] canvas not updated:', w.code)
      if (w.code !== 'STALE_CONFLICT') return 'failed'
      c = await findCanvas()
    }
    return c ? 'failed' : 'skipped'
  } catch (e) {
    console.error('[completeDefaultWorkApp] failed:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return 'failed'
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
