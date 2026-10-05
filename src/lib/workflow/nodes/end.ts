
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { substituteTemplate } from './ai/utils'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'

function transformCitations(text: string, baseUrl?: string | null): string {
  if (!text) return text

  const citationPattern = /【\d+:([^\】]+)】/g

  if (!baseUrl) {
    return text.replace(citationPattern, '')
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')

  const citations: { path: string; original: string }[] = []
  let match
  while ((match = citationPattern.exec(text)) !== null) {
    citations.push({
      path: match[1],
      original: match[0]
    })
  }

  if (citations.length === 0) {
    return text
  }

  const uniquePaths = [...new Set(citations.map(c => c.path))]

  let result = text.replace(citationPattern, '')

  if (uniquePaths.length > 0) {
    const linkSection = uniquePaths
      .map(path => `- [${path}](${normalizedBaseUrl}/${path})`)
      .join('\n')

    result = result.replace(/[,\s]+$/, '')

    result = `${result}\n\n${linkSection}`
  }

  return result
}

export class EndNodeExecutor extends BaseNodeExecutor {
  private formatJsonAsTable(jsonData: any): string {
    if (!jsonData || typeof jsonData !== 'object') {
      return JSON.stringify(jsonData, null, 2)
    }

    if (Array.isArray(jsonData)) {
      if (jsonData.length === 0) {
        return '*No data*'
      }

      const headers = Object.keys(jsonData[0])
      let table = '| ' + headers.join(' | ') + ' |\n'
      table += '| ' + headers.map(() => '---').join(' | ') + ' |\n'

      for (const item of jsonData) {
        const values = headers.map(key => {
          const value = item[key]
          if (value === null || value === undefined) return '-'
          if (typeof value === 'object') return JSON.stringify(value)
          return String(value)
        })
        table += '| ' + values.join(' | ') + ' |\n'
      }

      return table
    }

    let table = '| Field | Value |\n'
    table += '| --- | --- |\n'

    for (const [key, value] of Object.entries(jsonData)) {
      const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')
      let formattedValue: string

      if (value === null || value === undefined) {
        formattedValue = '-'
      } else if (typeof value === 'object') {
        if (Array.isArray(value)) {
          formattedValue = `${value.length} item(s)`
        } else {
          formattedValue = JSON.stringify(value)
        }
      } else {
        formattedValue = String(value)
      }

      table += `| ${formattedKey} | ${formattedValue} |\n`
    }

    return table
  }

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    if (!context) {
      return this.createSuccessResult(
        {
          message: '',
          agentId: '',
          userId: '',
          finalAnswer: 'Workflow completed.'
        } as WorkflowContext,
        {
          input: {},
          output: { finalAnswer: 'Workflow completed.' }
        }
      )
    }

    let citationBaseUrl: string | null = null
    if (context.agentId) {
      const agent = await prisma.agent.findUnique({
        where: { agentId: context.agentId },
        select: { gitbookPublishedUrl: true }
      })
      citationBaseUrl = agent?.gitbookPublishedUrl || null
    }

    let finalMessage = ''

    const endNodeMessage = node.data?.message
    if (endNodeMessage && typeof endNodeMessage === 'string' && endNodeMessage.trim()) {
      const isSubWorkflowRun = (context.subWorkflowDepth ?? 0) >= 1
      finalMessage = isSubWorkflowRun ? substituteTemplate(endNodeMessage.trim(), context) : endNodeMessage.trim()

      return this.createSuccessResult(
        {
          ...context,
          finalAnswer: finalMessage
        },
        {
          input: {
            aiResponse: context.aiResponse,
            endNodeMessage: endNodeMessage
          },
          output: {
            finalAnswer: finalMessage
          }
        }
      )
    }

    if (context.dataSheetsResult) {
      const result = context.dataSheetsResult as any

      if (result.success) {
        if (result.operation === 'insert' || result.operation === 'upsert') {
          if (result.row) {
            finalMessage = '## ✅ Data Saved Successfully\n\n'
            finalMessage += '| Field | Value |\n'
            finalMessage += '| --- | --- |\n'

            Object.entries(result.row)
              .filter(([key]) => key !== 'createdAt' && key !== 'updatedAt' && key !== 'id')
              .forEach(([key, value]) => {
                const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')

                let formattedValue: any = value
                let arr: any[] | null = null
                if (Array.isArray(value)) {
                  arr = value
                } else if (typeof value === 'string' && value.startsWith('[')) {
                  try { arr = JSON.parse(value) } catch { /* ignore */ }
                }

                if (arr && Array.isArray(arr)) {
                  formattedValue = arr.map((item, i) => {
                    if (typeof item === 'object' && item !== null) {
                      return Object.entries(item).map(([k, v]) => `${k}: ${v}`).join(', ')
                    }
                    return String(item)
                  }).join('<br/>')
                } else if (typeof value === 'object' && value !== null) {
                  formattedValue = Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ')
                } else if (typeof value === 'string' && value.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(value)
                    formattedValue = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(', ')
                  } catch {
                    formattedValue = value
                  }
                } else if (value === null || value === undefined || value === '') {
                  formattedValue = 'N/A'
                }

                finalMessage += `| ${formattedKey} | ${formattedValue} |\n`
              })

            finalMessage += `\n*Record #${result.row.No || 'N/A'} has been saved to the sheet.*`
          } else {
            finalMessage = '✅ ' + (result.message || 'Data operation completed successfully.')
          }
        } else if (result.operation === 'read') {
          finalMessage = `## ✅ Data Retrieved\n\n${result.rowCount || 0} row(s) retrieved from the sheet.`
        } else if (result.operation === 'update') {
          finalMessage = `## ✅ Data Updated\n\n${result.updatedCount || 0} row(s) updated in the sheet.`
        } else if (result.operation === 'delete') {
          finalMessage = `## ✅ Data Deleted\n\n${result.deletedCount || 0} row(s) deleted from the sheet.`
        }
      } else {
        finalMessage = `## ❌ Error\n\n${result.message || result.error || 'An error occurred while processing data.'}`

        if (result.error && result.error !== result.message) {
          finalMessage += `\n\n**Details:** ${result.error}`
        }
      }
    }

    else if (context.finalAnswer) {
      finalMessage = context.finalAnswer
    }

    else if (context.jsonData?.aiResponse) {
      finalMessage = context.jsonData.aiResponse
    }

    else if (context.aiResponse) {
      const aiResponseStr = typeof context.aiResponse === 'string' ? context.aiResponse : JSON.stringify(context.aiResponse)
      const isJsonResponse = aiResponseStr.trim().startsWith('{') || aiResponseStr.trim().startsWith('[')

      if (!isJsonResponse) {
        finalMessage = aiResponseStr
      } else if (context.displayJsonInChat && context.jsonData) {
        finalMessage = this.formatJsonAsTable(context.jsonData)
      } else {
        finalMessage = 'Workflow completed successfully.'
      }
    }

    else {
      finalMessage = 'Workflow completed successfully.'
    }

    finalMessage = transformCitations(finalMessage, citationBaseUrl)

    return this.createSuccessResult(
      {
        ...context,
        finalAnswer: finalMessage
      },
      {
        input: {
          aiResponse: context.aiResponse,
          finalAnswer: context.finalAnswer,
          dataSheetsResult: context.dataSheetsResult
        },
        output: {
          finalAnswer: finalMessage
        }
      }
    )
  }
}

// Singleton instance
export const endNodeExecutor = new EndNodeExecutor()
