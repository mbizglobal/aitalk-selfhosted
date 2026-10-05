
export interface StreamedFunctionCall {
  id: string
  name: string
  arguments: string
}

export interface ResponseOutputItem {
  type?: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
}

export function reconcileFunctionCallId(
  functionCalls: StreamedFunctionCall[],
  outputItem: ResponseOutputItem
): void {
  if (outputItem.type !== 'function_call' || !outputItem.name) return

  let existing = functionCalls.find(
    fc =>
      (!!outputItem.id && fc.id === outputItem.id) ||
      (!!outputItem.call_id && fc.id === outputItem.call_id)
  )

  if (!existing && !outputItem.id && !outputItem.call_id) {
    existing = functionCalls.find(fc => fc.name === outputItem.name)
  }

  if (existing) {
    if (outputItem.call_id) existing.id = outputItem.call_id
    return
  }

  functionCalls.push({
    id: outputItem.call_id || outputItem.id || `call_${Date.now()}`,
    name: outputItem.name,
    arguments: outputItem.arguments || '{}',
  })
}
