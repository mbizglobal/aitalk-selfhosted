
import { OpenAI } from 'openai'
import { WorkflowContext, RAGSearchResult } from '../../types'
import { PrismaClient } from '@prisma/client'
import { McpClient } from '../mcp'
import { TelegramMcpClient } from '@/lib/mcp/telegram'
import { AIToolClient } from '../../tools'
import { saveTempData } from '../../temp-storage'
import { extractPureJson, detectStreamFailure } from './utils'
import { reconcileFunctionCallId } from './function-call-ids'
import { reserveCpaForAiCall, type AiCallReservation } from '../../ai-call-cpa'
import { describeCaughtError, safeLogToken } from '@/lib/log-mask'
import { WORK_APP_TOOL_LIMITS, createToolExecutor, runToolFollowUps } from './tool-loop'

export async function createOpenAIStreamResponse(
  openai: OpenAI,
  requestConfig: any,
  context: WorkflowContext,
  nodeData: any,
  prisma: PrismaClient,
  initialReservation: AiCallReservation,
  mcpOptions?: {
    mcpClient: McpClient | TelegramMcpClient | null
    mcpToolsMap: Map<string, any>
  },
  appsToolClients?: Map<string, AIToolClient>,
  traceNodeId?: string
): Promise<Response> {
  const {
    model,
    outputFormat,
    saveTempStorage,
    saveAs,
    temperature,
    maxTokens,
  } = nodeData

  const mcpClient = mcpOptions?.mcpClient
  const mcpToolsMap = mcpOptions?.mcpToolsMap || new Map()

  const debugChildEnabled = context.__debugEnabled === true

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const keepAlive = context.workScope
        ? setInterval(() => { try { controller.enqueue(encoder.encode(': working\n\n')) } catch { clearInterval(keepAlive!) } }, 15_000)
        : null
      let fullContent = ''
      let responseId: string | null = null
      let usageData: any = null

      if (context.chatSummaryUpdate) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'summary-update',
          summary: context.chatSummaryUpdate.summary,
          foldedCount: context.chatSummaryUpdate.foldedCount,
        })}\n\n`))
      }

      let sawOutput = false
      let streamFailure: { message: string; code?: string; responseId?: string } | null = null
      let incompleteReason: string | null = null

      let mcpClosed = false
      const closeMcpQuietly = async () => {
        if (mcpClosed || !mcpClient) return
        mcpClosed = true
        try { await mcpClient.close() } catch { }
      }

      try {
        let response
        try {
          response = await openai.responses.create(requestConfig)
        } catch (error: any) {
          if (error?.code === 'previous_response_not_found' && requestConfig.previous_response_id) {
            delete requestConfig.previous_response_id
            response = await openai.responses.create(requestConfig)
          } else {
            throw error
          }
        }

        const fileSearchResults: RAGSearchResult[] = []

        const functionCallMap = new Map<string, { id: string; name: string; arguments: string }>()
        let functionCalls: Array<{ id: string; name: string; arguments: string }> = []

        const responseStream = response as unknown as AsyncIterable<any>
        for await (const chunk of responseStream) {
          const failure = detectStreamFailure(chunk)
          if (failure) {
            streamFailure = failure
            if (failure.usageInputTokens != null) initialReservation.settle(failure.usageInputTokens, failure.usageOutputTokens)
            break
          }
          if (chunk.type === 'response.output_text.delta' && chunk.delta) {
            fullContent += chunk.delta
            sawOutput = true
            const outputData = `data: ${JSON.stringify({ content: chunk.delta })}\n\n`
            controller.enqueue(encoder.encode(outputData))
          }

          if (chunk.type === 'response.function_call_arguments.delta' && chunk.delta) {
            sawOutput = true
          }

          if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call') {
            const item = chunk.item
            functionCallMap.set(item.id || item.call_id, {
              id: item.id || item.call_id || `call_${Date.now()}`,
              name: item.name,
              arguments: ''
            })
          }

          if (chunk.type === 'response.function_call_arguments.done') {
            sawOutput = true
            const itemId = chunk.item_id
            if (functionCallMap.has(itemId)) {
              const fc = functionCallMap.get(itemId)!
              fc.arguments = chunk.arguments || '{}'
              functionCalls.push(fc)
            } else {
              functionCalls.push({
                id: chunk.item_id || chunk.call_id || `call_${Date.now()}`,
                name: chunk.name || 'unknown',
                arguments: chunk.arguments || '{}'
              })
            }
          }

          if (chunk.type === 'response.completed' || chunk.type === 'response.incomplete') {
            if (chunk.type === 'response.incomplete') {
              incompleteReason = chunk.response?.incomplete_details?.reason || 'unknown'
            }
            if (chunk.response && chunk.response.id) {
              responseId = chunk.response.id
              usageData = chunk.response.usage

              initialReservation.settle(chunk.response.usage?.input_tokens, chunk.response.usage?.output_tokens)
              if (context.workScope) console.log(`[work-ai] round 0 in=${chunk.response.usage?.input_tokens ?? '?'} out=${chunk.response.usage?.output_tokens ?? '?'}`)

              if (chunk.response.output && Array.isArray(chunk.response.output)) {

                for (const outputItem of chunk.response.output) {
                  if (outputItem.type === 'file_search_call') {
                    const results = outputItem.results || []
                    if (results && results.length > 0) {
                      for (const result of results) {
                        fileSearchResults.push({
                          provider: 'openai',
                          source: result.file_name || result.file_id || 'unknown',
                          content: (result.text || '').substring(0, 500),
                          score: result.score,
                          metadata: {
                            fileId: result.file_id,
                            attributes: result.attributes
                          }
                        })
                      }
                    }
                  }

                  if (outputItem.type === 'web_search_call') {
                    const wsAction = outputItem.action || {}
                    const wsQueries: string[] = Array.isArray(wsAction.queries)
                      ? wsAction.queries
                      : (wsAction.query ? [wsAction.query] : [])
                    const wsLabel = wsQueries.join(' | ')
                      || (wsAction.pattern ? `find: ${wsAction.pattern}` : '')
                      || wsAction.url
                      || '(query n/a)'
                    const wsActionType = wsAction.type || 'unknown'
                    const wsChildStatus = outputItem.status === 'completed'
                      ? 'success'
                      : (outputItem.status === 'failed' ? 'error' : 'warning')
                    console.log(`[AI Node] OpenAI Web Search ${safeLogToken(outputItem.status)} (${safeLogToken(wsActionType)}): ${String(wsLabel ?? '').length} chars`)
                    if (debugChildEnabled) {
                      const webSearchDebugEntry = {
                        type: 'web_search',
                        name: 'Web Search',
                        duration: 0,
                        status: wsChildStatus,
                        ...(wsChildStatus === 'error'
                          ? { error: `Web search failed (status=${outputItem.status})` }
                          : {}),
                        input: { query: wsLabel, action: wsActionType },
                        output: {
                          status: outputItem.status,
                          action: wsActionType,
                          ...(wsQueries.length ? { queries: wsQueries } : {}),
                          ...(wsAction.url ? { url: wsAction.url } : {}),
                          ...(wsAction.pattern ? { pattern: wsAction.pattern } : {}),
                          note: 'The provider does not return result bodies — citations arrive as url_citation annotations.',
                          ...(wsChildStatus === 'warning' ? { incompleteReason: outputItem.status || 'unknown' } : {}),
                        }
                      }
                      const webSearchEvent = `data: ${JSON.stringify({
                        type: 'debug-child',
                        child: webSearchDebugEntry
                      })}\n\n`
                      controller.enqueue(encoder.encode(webSearchEvent))
                    }
                  }

                  reconcileFunctionCallId(functionCalls, outputItem)

                  if (outputItem.type === 'message' && outputItem.content) {
                    for (const content of outputItem.content) {
                      if (!fullContent && content.type === 'output_text' && content.text) {
                        fullContent = content.text
                        sawOutput = true
                        const outputData = `data: ${JSON.stringify({ content: fullContent })}\n\n`
                        controller.enqueue(encoder.encode(outputData))
                      }
                      if (content.annotations && Array.isArray(content.annotations)) {
                        for (const annotation of content.annotations) {
                          if (annotation.type === 'file_citation') {
                            fileSearchResults.push({
                              provider: 'openai',
                              source: annotation.filename || annotation.file_id || 'unknown',
                              content: (annotation.text || annotation.quote || '').substring(0, 500),
                              score: annotation.score,
                              metadata: {
                                fileId: annotation.file_id,
                                index: annotation.index
                              }
                            })
                          }
                        }
                        const fileCitations = content.annotations.filter((a: any) => a.type === 'file_citation').length
                        const urlCitations = content.annotations.filter((a: any) => a.type === 'url_citation').length
                        if (fileCitations > 0) {
                          console.log(`[AI Node] OpenAI File Search annotations: ${fileCitations} file citations`)
                        }
                        if (urlCitations > 0) {
                          console.log(`[AI Node] OpenAI Web Search annotations: ${urlCitations} url citations`)
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        if (streamFailure) {
          console.error(`[Workflow] OpenAI stream failed before tools: code=${streamFailure.code ?? '-'} resp=${streamFailure.responseId ?? '-'} (${streamFailure.message.length} chars)`)
          await closeMcpQuietly()
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
          return
        }

        const hasStreamMcpTools = mcpClient && mcpToolsMap.size > 0
        const hasStreamAppsTools = appsToolClients && appsToolClients.size > 0

        if (functionCalls.length > 0 && (hasStreamMcpTools || hasStreamAppsTools)) {
          const executor = createToolExecutor({
            mcpClient,
            mcpToolsMap,
            appsToolClients,
            traceSink: context.toolTraceSink,
            traceNodeId,
            onToolCall: rec => {
              if (!debugChildEnabled || rec.status !== 'success' || rec.kind === 'unknown') return
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'debug-child',
                child: {
                  type: rec.kind === 'mcp' ? 'mcp_call' : 'apps_tool_call',
                  name: rec.name,
                  status: 'success',
                  input: rec.args,
                  output: { preview: String(rec.resultText ?? '').substring(0, 100) }
                }
              })}\n\n`))
            },
          })

          const loop = await runToolFollowUps({
            openai,
            requestConfig,
            nodeData: { model, maxTokens, temperature },
            reserve: () => reserveCpaForAiCall(context, model),
            executor,
            ...(context.workScope ? {
              limits: WORK_APP_TOOL_LIMITS,
              onRoundDone: (i: { round: number; durationMs: number; usage: { input_tokens: number; output_tokens: number } | null; incompleteReason: string | null }) =>
                console.log(`[work-ai] round ${i.round} in=${i.usage?.input_tokens ?? '?'} out=${i.usage?.output_tokens ?? '?'} ${i.durationMs}ms${i.incompleteReason ? ` incomplete=${i.incompleteReason}` : ''}`),
            } : {}),
            responseId,
            functionCalls,
            onTextDelta: (delta, roundStart) => {
              const text = roundStart && fullContent && !fullContent.endsWith('\n\n') ? `\n\n${delta}` : delta
              fullContent += text
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`))
            },
          })

          if (loop.failure) streamFailure = loop.failure
          if (loop.responseId) responseId = loop.responseId
          if (loop.incompleteReason) incompleteReason = loop.incompleteReason
          if (loop.usage) {
            usageData = {
              input_tokens: (usageData?.input_tokens || 0) + loop.usage.input_tokens,
              output_tokens: (usageData?.output_tokens || 0) + loop.usage.output_tokens,
            }
          }

          await closeMcpQuietly()
        }

        if (streamFailure) {
          console.error(`[Workflow] OpenAI stream failed: code=${streamFailure.code ?? '-'} resp=${streamFailure.responseId ?? '-'} (${streamFailure.message.length} chars)`)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
          return
        }

        if (fileSearchResults.length > 0) {
          const searchResultsEvent = `data: ${JSON.stringify({ type: 'search-results', results: fileSearchResults })}\n\n`
          controller.enqueue(encoder.encode(searchResultsEvent))
        }

        let parsedJsonData: any = undefined
        if (outputFormat === 'json') {
          try {
            const cleanedJson = extractPureJson(fullContent)
            parsedJsonData = JSON.parse(cleanedJson)
            console.log(`[Workflow] OpenAI JSON parsed:`, `${Object.keys(parsedJsonData).length} keys`)
          } catch (parseError) {
            console.warn(`[Workflow] Failed to parse OpenAI response as JSON:`, describeCaughtError(parseError))
          }
        }

        if (saveTempStorage && parsedJsonData && context.conversationId && context.agentId) {
          try {
            await saveTempData(prisma, context.conversationId, context.agentId, parsedJsonData)
          } catch (saveError) {
            console.warn('[Workflow] Failed to save temp storage:', describeCaughtError(saveError))
          }
        }

        const completionData = {
          type: 'completed',
          responseId,
          model,
          ...(incompleteReason && { incomplete: true, incompleteReason }),
          inputTokens: usageData?.input_tokens || usageData?.prompt_tokens || 0,
          outputTokens: usageData?.output_tokens || usageData?.completion_tokens || 0,
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionData)}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()

      } catch (error: any) {
        const errorMsg = error?.message || 'Unknown error'
        const isAuthError = error?.code === 'invalid_api_key' || error?.status === 401
        const isCpaError = error?.code === 'INSUFFICIENT_CPA'
        if (isAuthError || isCpaError) {
          console.warn(`[Workflow] OpenAI stream stopped: ${describeCaughtError(error)}`)
        } else {
          console.error(`[Workflow] OpenAI stream error: ${describeCaughtError(error)}`)
        }
        const userError = isAuthError
          ? 'Invalid API key. Please check your API key in Settings.'
          : isCpaError
            ? 'Insufficient CPA balance.'
            : 'Stream error'
        const errorData = `data: ${JSON.stringify({ error: userError })}\n\n`
        controller.enqueue(encoder.encode(errorData))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } finally {
        if (keepAlive) clearInterval(keepAlive)
        initialReservation.finalize(sawOutput)
        await closeMcpQuietly()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
  })
}
