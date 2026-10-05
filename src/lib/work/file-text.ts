
const PDF_MAX_PAGES = 5
const SCANNED_BELOW = 40
export const READ_MAX_BYTES = 8 * 1024 * 1024
export const READ_TIMEOUT_MS = 10_000

export class FileTextError extends Error {
  constructor(readonly reason: 'too_large' | 'timeout' | 'unreadable') { super(reason) }
}

export interface FileText {
  text: string
  pages?: number
  pagesRead?: number
  scanned?: boolean
  kind: 'pdf' | 'text' | 'image' | 'other'
}

export async function extractFileText(buffer: Buffer, mimeType: string, maxChars: number, opts?: { maxPages?: number; maxBytes?: number; timeoutMs?: number }): Promise<FileText> {
  if (buffer.length > (opts?.maxBytes ?? READ_MAX_BYTES)) throw new FileTextError('too_large')
  if (mimeType === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new FileTextError('timeout')), opts?.timeoutMs ?? READ_TIMEOUT_MS) })
    const read = (async (): Promise<FileText> => {
      const doc = await task.promise
      const parts: string[] = []
      let used = 0
      for (let i = 1; i <= Math.min(doc.numPages, opts?.maxPages ?? PDF_MAX_PAGES) && used < maxChars; i++) {
        const page = await doc.getPage(i)
        const tc = await page.getTextContent()
        let line = ''
        for (const it of tc.items) {
          if (!('str' in it) || !it.str) continue
          line += `${it.str} `
          if (line.length > maxChars - used) break
        }
        line = line.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim()
        parts.push(line)
        used += line.length
      }
      const text = parts.join('\n').slice(0, maxChars)
      return { kind: 'pdf', text, pages: doc.numPages, pagesRead: parts.length, ...(text.length < SCANNED_BELOW && maxChars >= SCANNED_BELOW * 5 ? { scanned: true } : {}) }
    })()
    try {
      return await Promise.race([read, timeout])
    } catch (e) {
      if (e instanceof FileTextError) throw e
      throw new FileTextError('unreadable')
    } finally {
      clearTimeout(timer)
      await task.destroy().catch(() => {})
    }
  }
  if (mimeType === 'text/csv' || mimeType === 'text/plain') {
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { text = new TextDecoder('windows-1252').decode(buffer) }
    return { kind: 'text', text: text.replace(/^﻿/, '').slice(0, maxChars) }
  }
  if (mimeType.startsWith('image/')) return { kind: 'image', text: '' }
  return { kind: 'other', text: '' }
}
