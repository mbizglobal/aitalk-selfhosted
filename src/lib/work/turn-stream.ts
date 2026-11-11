
import { ChatStreamCollector, type CollectedChat } from '@/lib/chat/stream-collector'

export interface TurnStreamEnd extends CollectedChat {
  readFailed: boolean
}

export function streamThenSave(source: ReadableStream<Uint8Array>, onEnd: (end: TurnStreamEnd) => Promise<void>): ReadableStream<Uint8Array> {
  const [mine, theirs] = source.tee()
  const saved = (async () => {
    const collector = new ChatStreamCollector()
    const decoder = new TextDecoder('utf-8')
    let readFailed = false
    const reader = mine.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        try { collector.push(decoder.decode(value, { stream: true })) } catch { }
      }
    } catch {
      readFailed = true
    }
    try { collector.push(decoder.decode()); collector.end() } catch { }
    try { await onEnd({ ...collector.result, readFailed }) } catch { }
  })()
  return theirs.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    async flush() { await saved },
  }))
}
