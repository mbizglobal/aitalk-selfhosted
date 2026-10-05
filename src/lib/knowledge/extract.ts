import { extractFileText, FileTextError } from '@/lib/work/file-text'
import type { ReadImagesFn } from '@/lib/workflow/nodes/ai/read-images'

export type ExtractFailure = 'unsupported_type' | 'scanned_pdf' | 'no_image_model' | 'empty_text' | 'truncated' | 'too_large' | 'timeout' | 'unreadable'

export class KnowledgeExtractError extends Error {
  constructor(readonly reason: ExtractFailure, message: string) { super(message); this.name = 'KnowledgeExtractError' }
}

const MAX_BYTES = 20 * 1024 * 1024
const MAX_PAGES = 1000
const MAX_CHARS = 5_000_000
const PDF_TIMEOUT_MS = 120_000

const TEXT_EXT = new Set(['txt', 'md', 'json', 'tex', 'csv'])
const OFFICE_EXT = new Set(['docx', 'pptx', 'xlsx'])
const IMAGE_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }

function extOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

const MESSAGES: Record<ExtractFailure, string> = {
  unsupported_type: 'This file type cannot be read in this version yet (Word, PowerPoint and Excel). Save it as PDF or text and upload again.',
  scanned_pdf: 'This PDF has no text layer (scanned). Scanned PDFs cannot be read in this version yet — upload a PDF with selectable text.',
  no_image_model: 'This AI connection cannot read photos (no image model is set) — an administrator can add one in Settings → AI connections.',
  empty_text: 'No text could be read from this file.',
  truncated: 'This file is too long to read completely (page or text limit). Split it into smaller files and upload them again.',
  too_large: 'This file is too large to read.',
  timeout: 'Reading this file took too long.',
  unreadable: 'This file could not be read.',
}

export function extractFailure(reason: ExtractFailure): KnowledgeExtractError {
  return new KnowledgeExtractError(reason, MESSAGES[reason])
}

export async function extractKnowledgeText(
  buffer: Buffer,
  fileName: string,
  mimeType: string | undefined,
  readImages: ReadImagesFn | null,
): Promise<{ text: string; pageCount?: number }> {
  const ext = extOf(fileName)
  const mime = (mimeType || '').toLowerCase()
  if (buffer.length > MAX_BYTES) throw extractFailure('too_large')

  let out: { text: string; pageCount?: number }
  if (mime === 'application/pdf' || ext === 'pdf') {
    try {
      const t = await extractFileText(buffer, 'application/pdf', MAX_CHARS + 1, { maxPages: MAX_PAGES, maxBytes: MAX_BYTES, timeoutMs: PDF_TIMEOUT_MS })
      if (t.scanned) throw extractFailure('scanned_pdf')
      if ((t.pages ?? 0) > (t.pagesRead ?? 0) || t.text.length > MAX_CHARS) throw extractFailure('truncated')
      out = { text: t.text, pageCount: t.pages }
    } catch (e) {
      if (e instanceof FileTextError) throw extractFailure(e.reason)
      throw e
    }
  } else if (IMAGE_MIME[ext] || mime === 'image/jpeg' || mime === 'image/png') {
    if (!readImages) throw extractFailure('no_image_model')
    try {
      const r = await readImages([{ mime: IMAGE_MIME[ext] || mime, base64: buffer.toString('base64') }], `File: ${fileName}`)
      if (r.truncated) throw extractFailure('truncated')
      out = { text: r.text, pageCount: 1 }
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === 'NO_IMAGE_MODEL') throw extractFailure('no_image_model')
      throw e
    }
  } else if (OFFICE_EXT.has(ext) || mime.includes('officedocument')) {
    throw extractFailure('unsupported_type')
  } else if (TEXT_EXT.has(ext) || mime.startsWith('text/') || mime === 'application/json') {
    out = { text: (await extractFileText(buffer, 'text/plain', MAX_CHARS + 1, { maxBytes: MAX_BYTES })).text }
    if (out.text.length > MAX_CHARS) throw extractFailure('truncated')
  } else {
    throw extractFailure('unsupported_type')
  }
  if (!out.text.trim()) throw extractFailure('empty_text')
  return out
}
