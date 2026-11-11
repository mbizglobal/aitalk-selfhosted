
import { xlsxText } from './xlsx-text'

const PDF_MAX_PAGES = 5
const SCANNED_BELOW = 40
export const READ_MAX_BYTES = 8 * 1024 * 1024
export const READ_TIMEOUT_MS = 10_000

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export class FileTextError extends Error {
  constructor(readonly reason: 'too_large' | 'timeout' | 'unreadable') { super(reason) }
}

export interface FileText {
  text: string
  pages?: number
  pagesRead?: number
  fromPage?: number
  nextPage?: number
  truncated?: boolean
  scanned?: boolean
  kind: 'pdf' | 'text' | 'image' | 'other'
}

export async function extractFileText(buffer: Buffer, mimeType: string, maxChars: number, opts?: { maxPages?: number; maxBytes?: number; timeoutMs?: number; startPage?: number }): Promise<FileText> {
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
      let nextPage: number | undefined
      let truncated = false
      const start = Math.max(1, Math.floor(opts?.startPage ?? 1))
      const last = Math.min(doc.numPages, start - 1 + (opts?.maxPages ?? PDF_MAX_PAGES))
      for (let i = start; i <= last; i++) {
        const page = await doc.getPage(i)
        const pageText = pageLines((await page.getTextContent()).items)
        const room = maxChars - used - (parts.length ? 1 : 0)
        if (pageText.length > Math.max(room, 0)) {
          if (room > 0) parts.push(pageText.slice(0, room))
          truncated = true
          nextPage = i > start ? i : i < doc.numPages ? i + 1 : undefined
          break
        }
        parts.push(pageText)
        used += pageText.length + (parts.length > 1 ? 1 : 0)
        if (i === last && last < doc.numPages) nextPage = last + 1
      }
      const text = parts.join('\n').slice(0, maxChars)
      return { kind: 'pdf', text, pages: doc.numPages, pagesRead: parts.length, ...(opts?.startPage !== undefined ? { fromPage: start } : {}), ...(nextPage ? { nextPage } : {}), ...(truncated ? { truncated } : {}), ...(text.length < SCANNED_BELOW && maxChars >= SCANNED_BELOW * 5 ? { scanned: true } : {}) }
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
  if (mimeType === 'text/csv' || mimeType === 'text/plain' || mimeType === 'application/xml' || mimeType === 'text/xml') {
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { text = new TextDecoder('windows-1252').decode(buffer) }
    return { kind: 'text', text: text.replace(/^﻿/, '').slice(0, maxChars) }
  }
  if (mimeType === XLSX_MIME) {
    const x = await xlsxText(buffer)
    if (!x.ok) throw new FileTextError(x.reason === 'too_big' ? 'too_large' : 'unreadable')
    const full = x.sheets.map((sh) => [`[Sheet ${sh.name}]`, ...sh.lines].join('\n')).join('\n')
    const cut = x.stopped || x.notRead.length > 0 || full.length > maxChars
    return { kind: 'text', text: full.slice(0, maxChars), ...(cut ? { truncated: true } : {}) }
  }
  if (mimeType.startsWith('image/')) return { kind: 'image', text: '' }
  return { kind: 'other', text: '' }
}

export function pageLines(items: readonly unknown[]): string {
  type Piece = { s: string; x: number; y: number; w: number; size: number; angle: number }
  const pieces: Piece[] = []
  const turned: string[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object' || !('str' in it) || !('transform' in it)) continue
    const { str: s, transform: t, width } = it as { str: string; transform: number[]; width?: number }
    if (!s || !s.trim() || !Array.isArray(t)) continue
    const size = Math.max(Math.hypot(t[0], t[1]), Math.hypot(t[2], t[3]))
    if (!(size >= 1)) continue
    if (!(t[0] > 0) || Math.abs(t[1]) > t[0] * 0.2) { turned.push(s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim()); continue }
    pieces.push({ s: s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ''), x: t[4], y: t[5], w: typeof width === 'number' ? width : 0, size, angle: Math.atan2(t[1], t[0]) })
  }
  const angles = pieces.map((p) => p.angle).sort((a, b) => a - b)
  const angle = angles.length ? angles[Math.floor(angles.length / 2)] : 0
  if (angle) {
    const cos = Math.cos(angle); const sin = Math.sin(angle)
    for (const p of pieces) { const x = p.x; p.x = x * cos + p.y * sin; p.y = p.y * cos - x * sin }
  }
  pieces.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Piece[][] = []
  for (const p of pieces) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(line[0].y - p.y) <= Math.max(2, Math.min(line[0].size, p.size) * 0.5)) line.push(p)
    else lines.push([p])
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x)
    let out = ''
    let prev: Piece | null = null
    for (const p of line) {
      const gap = prev ? p.x - (prev.x + prev.w) : 0
      out += !prev ? p.s : gap > p.size * 2 ? `  ${p.s}` : gap > p.size * 0.1 || /\s$/.test(prev.s) ? ` ${p.s}` : p.s
      prev = p
    }
    return out.replace(/\s+$/, '').replace(/(\S) {3,}/g, '$1  ').replace(/^\s+/, '')
  }).concat(turned.length ? [turned.join(' ')] : []).filter((l) => l).join('\n')
}
