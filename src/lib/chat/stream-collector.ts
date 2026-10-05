
export const MAX_COLLECTED_CHARS = 200_000

export interface CollectedChat {
  content: string
  responseId?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  completed: boolean
  sawError: boolean
  done: boolean
  truncated: boolean
}

export class ChatStreamCollector {
  private buffer = ''
  private parts: string[] = []
  private meta: Partial<CollectedChat> = {}
  private total = 0
  private isTruncated = false
  private errored = false
  private isDone = false
  private isCompleted = false

  push(text: string): void {
    this.buffer += text
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) this.consumeLine(line)
  }

  end(): void {
    if (this.buffer) {
      this.consumeLine(this.buffer)
      this.buffer = ''
    }
  }

  private consumeLine(raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!line.startsWith('data: ')) return
    const payload = line.slice(6)
    if (payload === '[DONE]') {
      this.isDone = true
      return
    }
    let parsed: any
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    if (parsed == null || typeof parsed !== 'object') return

    if (typeof parsed.content === 'string') {
      if (this.total >= MAX_COLLECTED_CHARS) {
        this.isTruncated = true
        return
      }
      this.total += parsed.content.length
      this.parts.push(parsed.content)
      return
    }
    if (parsed.type === 'completed') {
      this.isCompleted = true
      if (typeof parsed.responseId === 'string') this.meta.responseId = parsed.responseId
      if (typeof parsed.model === 'string') this.meta.model = parsed.model
      if (typeof parsed.inputTokens === 'number') this.meta.inputTokens = parsed.inputTokens
      if (typeof parsed.outputTokens === 'number') this.meta.outputTokens = parsed.outputTokens
      return
    }
    if (parsed.error !== undefined) this.errored = true
  }

  get isFinished(): boolean {
    return this.isDone
  }

  get result(): CollectedChat {
    return {
      content: this.parts.join(''),
      responseId: this.meta.responseId,
      model: this.meta.model,
      inputTokens: this.meta.inputTokens,
      outputTokens: this.meta.outputTokens,
      completed: this.isCompleted,
      sawError: this.errored,
      done: this.isDone,
      truncated: this.isTruncated,
    }
  }
}

export function collectChatStream(
  response: Response,
  onFinish: (collected: CollectedChat) => void
): Response {
  if (!response.body) return response

  const collector = new ChatStreamCollector()
  const decoder = new TextDecoder('utf-8')
  let fired = false

  const fire = () => {
    if (fired) return
    fired = true
    try {
      onFinish(collector.result)
    } catch {
    }
  }

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      try {
        collector.push(decoder.decode(chunk, { stream: true }))
        if (collector.isFinished) fire()
      } catch {
      }
    },
    flush() {
      try {
        collector.push(decoder.decode())
        collector.end()
      } catch {
      }
      fire()
    },
  })

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
