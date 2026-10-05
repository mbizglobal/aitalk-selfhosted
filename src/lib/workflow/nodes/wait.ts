
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'
import { canReadTemplatePath } from '../template-scope'

function formatJsonToMarkdownTable(obj: any, sectionTitle?: string): string {
  let result = ''

  if (obj === null || obj === undefined) {
    return 'N/A'
  }

  if (typeof obj !== 'object') {
    return String(obj)
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '(empty)'

    if (obj.every(item => typeof item === 'object' && item !== null)) {
      const allKeys = new Set<string>()
      obj.forEach(item => Object.keys(item).forEach(key => allKeys.add(key)))
      const keys = Array.from(allKeys)

      result += `| ${keys.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(' | ')} |\n`
      result += `| ${keys.map(() => '---').join(' | ')} |\n`

      obj.forEach(item => {
        const row = keys.map(key => {
          const value = item[key]
          if (value === null || value === undefined) return 'N/A'
          if (typeof value === 'object') return JSON.stringify(value)
          return String(value)
        })
        result += `| ${row.join(' | ')} |\n`
      })
    } else {
      obj.forEach((item, idx) => {
        result += `${idx + 1}. ${item}\n`
      })
    }
    return result
  }

  if (sectionTitle) {
    result += `### ${sectionTitle}\n\n`
  }

  result += '| Field | Value |\n'
  result += '| --- | --- |\n'

  Object.entries(obj).forEach(([key, value]) => {
    const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')

    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value) && value.length > 0) {
        result += `| ${formattedKey} | See below |\n`
      } else if (!Array.isArray(value)) {
        result += `| ${formattedKey} | See below |\n`
      }
    } else {
      const displayValue = value !== null && value !== undefined ? String(value) : 'N/A'
      result += `| ${formattedKey} | ${displayValue} |\n`
    }
  })

  result += '\n'

  Object.entries(obj).forEach(([key, value]) => {
    const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')

    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value) && value.length > 0) {
        result += `#### ${formattedKey}\n\n`
        result += formatJsonToMarkdownTable(value)
        result += '\n'
      } else if (!Array.isArray(value)) {
        result += formatJsonToMarkdownTable(value, formattedKey)
      }
    }
  })

  return result
}

export class WaitNodeExecutor extends BaseNodeExecutor {
  private substituteTemplate(template: string, context: any): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      let trimmed = path.trim()
      if (trimmed.startsWith('context.')) {
        trimmed = trimmed.substring(8)
      }
      if (!canReadTemplatePath(context, trimmed)) return match
      const value = this.getNestedValue(context, trimmed)

      if (value === undefined || value === null) {
        return match
      }

      if (typeof value === 'object') {
        return JSON.stringify(value)
      }

      return String(value)
    })
  }

  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined
      }
      current = current[part]
    }

    return current
  }

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    console.log('[Workflow] Executing Wait node:', node.id)

    let waitMessage = node.data?.waitMessage || 'Waiting for user input...'

    waitMessage = this.substituteTemplate(waitMessage, context)

    if (context.isResuming && context.waitingNodeId === node.id) {
      console.log('[Workflow] Resuming from Wait node:', node.id)

      //
      const resumedContext = {
        ...context,
        isResuming: false,
        waitingNodeId: undefined,
        finalAnswer: undefined
      }

      return this.createSuccessResult(
        resumedContext,
        {
          input: { waitMessage, isResuming: true },
          output: { resumed: true, nodeId: node.id }
        }
      )
    }

    console.log('[Workflow] Pausing workflow at Wait node:', node.id)

    if (context.conversationId && context.agentId) {
      try {
        console.log('[Wait] Saving wait state to TempStorage:')
        console.log('  conversationId:', context.conversationId)
        console.log('  agentId:', context.agentId)
        console.log('  waitNodeId:', node.id)

        const existingPending = await prisma.workflowTempStorage.findFirst({
          where: {
            conversationId: context.conversationId,
            agentId: context.agentId,
            status: 'pending'
          }
        })

        const existingWaiting = await prisma.workflowTempStorage.findFirst({
          where: {
            conversationId: context.conversationId,
            agentId: context.agentId,
            status: 'waiting'
          }
        })

        const executionContext = JSON.stringify({
          context: {
            ...context,
            request: undefined
          },
          waitNodeId: node.id,
          whileLoopContext: context.whileLoopContext,
          aiResponse: context.aiResponse,
          pausedAt: new Date().toISOString()
        })

        if (existingPending) {
          await prisma.workflowTempStorage.update({
            where: { id: existingPending.id },
            data: {
              waitNodeId: node.id,
              executionContext,
              status: 'waiting',
              updatedAt: new Date()
            }
          })
          console.log('[Wait] Updated pending record to waiting state (preserving jsonData)')
        } else if (existingWaiting) {
          await prisma.workflowTempStorage.update({
            where: { id: existingWaiting.id },
            data: {
              waitNodeId: node.id,
              executionContext,
              status: 'waiting',
              updatedAt: new Date()
            }
          })
          console.log('[Wait] Updated existing wait state in TempStorage')
        } else {
          await prisma.workflowTempStorage.create({
            data: {
              conversationId: context.conversationId,
              agentId: context.agentId,
              jsonData: '{}',
              waitNodeId: node.id,
              executionContext,
              status: 'waiting'
            }
          })
          console.log('[Wait] Created new wait state in TempStorage')
        }
      } catch (error) {
        console.error('[Wait] Failed to save wait state:', error)
      }
    }

    let formattedMessage = waitMessage
    if (node.data?.displayMode === 'message') {
    } else if (context.aiResponse) {
      try {
        const data = JSON.parse(context.aiResponse)

        if ('isConfirmed' in data) {
          const { isConfirmed, ...displayData } = data

          formattedMessage = '## 📋 Data Review\n\n'

          Object.entries(displayData).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              const sectionTitle = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')
              formattedMessage += formatJsonToMarkdownTable(value, sectionTitle)
            } else if (Array.isArray(value)) {
              const sectionTitle = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')
              formattedMessage += `### ${sectionTitle}\n\n`
              formattedMessage += formatJsonToMarkdownTable(value)
              formattedMessage += '\n'
            }
          })

          formattedMessage += '\n---\n\n'
          formattedMessage += waitMessage || 'Please review the data above. If you need to make changes, let me know. Otherwise, type "confirm" or "ok" to proceed.'
        } else {
          formattedMessage = formatJsonToMarkdownTable(data)
          formattedMessage += '\n---\n\n' + waitMessage
        }
      } catch (error) {
        console.warn('[Wait] Failed to parse AI response for formatting:', error)
      }
    }

    const contextWithWait = {
      ...context,
      finalAnswer: formattedMessage,
      waitingNodeId: node.id
    }

    return {
      context: contextWithWait,
      debug: {
        input: { waitMessage },
        output: { waiting: true, nodeId: node.id },
        status: 'success'
      },
      shouldWait: true
    }
  }
}

// Singleton instance
export const waitNodeExecutor = new WaitNodeExecutor()
