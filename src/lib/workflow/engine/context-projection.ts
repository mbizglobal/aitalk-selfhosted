import type { WorkflowContext } from '../types'

export function extractContextVariables(data: WorkflowContext): Record<string, any> {
    const variables: Record<string, any> = {}

    if (data.message !== undefined) variables.message = data.message

    if (data.aiResponse !== undefined) variables.aiResponse = data.aiResponse
    if (data.finalAnswer !== undefined) variables.finalAnswer = data.finalAnswer

    if (data.jsonData !== undefined) variables.jsonData = data.jsonData

    if (data.searchResults !== undefined) variables.searchResults = data.searchResults

    if (data.whileResult !== undefined) variables.whileResult = data.whileResult

    if (data.ifElseResult !== undefined) variables.ifElseResult = data.ifElseResult

    if (data.mcpResult !== undefined) variables.mcpResult = data.mcpResult
    if (data.mcpTools !== undefined) variables.mcpTools = data.mcpTools

    if (data.vectorStoreId !== undefined) variables.vectorStoreId = data.vectorStoreId
    if (data.sourceVectorStoreName !== undefined) variables.sourceVectorStoreName = data.sourceVectorStoreName

    if (data.geminiFiles !== undefined) variables.geminiFiles = data.geminiFiles

    return variables
}
