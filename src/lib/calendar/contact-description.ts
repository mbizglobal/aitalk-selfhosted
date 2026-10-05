
import { normalizePhoneForStorage } from './phone-match'

const NAME_LINE_REGEX = /^[ \t]*name[ \t]*[:：][ \t]*(.+?)[ \t]*$/im
const PHONE_LINE_REGEX = /^[ \t]*phone[ \t]*[:：][ \t]*(.+?)[ \t]*$/im

export interface ContactEvent {
  description?: string | null
  body?: { content?: string | null; contentType?: string | null } | null
}

function findMetadataEnd(text: string): number {
  const lines = text.split('\n')
  let cursor = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') return cursor
    if (/^[ \t]*(notes|source)[ \t]*[:：]/i.test(trimmed)) return cursor
    cursor += line.length + 1
  }
  return text.length
}

function fromCodePointSafe(cp: number, original: string): string {
  if (!(cp > 0 && cp <= 0x10ffff)) return original
  return cp < 0x20 || cp === 0x85 || cp === 0x2028 || cp === 0x2029 ? ' ' : String.fromCodePoint(cp)
}

export function descriptionLineValue(value: string | null | undefined): string {
  return String(value ?? '').replace(/[\r\n\v\f\u0085\u2028\u2029]+/g, ' ').replace(/[<>]/g, '').trim()
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/(?:tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/(?:td|th)\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d{1,7});/g, (m, d) => fromCodePointSafe(Number(d), m))
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => fromCodePointSafe(parseInt(h, 16), m))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

export function parseContactFromDescription(
  description: string | null | undefined,
): { name?: string; phone?: string } {
  const text = String(description || '').trim()
  if (!text) return {}
  const metaText = text.slice(0, findMetadataEnd(text))
  const result: { name?: string; phone?: string } = {}
  const nameMatch = metaText.match(NAME_LINE_REGEX)
  if (nameMatch) result.name = nameMatch[1].trim()
  const phoneMatch = metaText.match(PHONE_LINE_REGEX)
  if (phoneMatch) result.phone = phoneMatch[1].trim()
  return result
}

export function contactFromEvent(ev: ContactEvent): { name?: string; phone?: string } {
  if (ev?.description) return parseContactFromDescription(ev.description)
  const bodyContent = ev?.body?.content
  if (bodyContent) {
    const isHtml = (ev?.body?.contentType || '').toLowerCase() === 'html'
    return parseContactFromDescription(isHtml ? stripHtml(bodyContent) : bodyContent)
  }
  return {}
}

export function replaceContactInDescription(
  description: string | null | undefined,
  field: 'name' | 'phone',
  newValue: string,
): string {
  const regex = field === 'name' ? NAME_LINE_REGEX : PHONE_LINE_REGEX
  const label = field === 'name' ? 'Name' : 'Phone'
  const storedValue = field === 'phone' ? normalizePhoneForStorage(newValue) : descriptionLineValue(newValue)
  const newLine = `${label}: ${storedValue}`

  const text = String(description || '')
  if (!text) return newLine

  const metaEnd = findMetadataEnd(text)
  const metaText = text.slice(0, metaEnd)
  const rest = text.slice(metaEnd)

  if (regex.test(metaText)) {
    const replacedMeta = metaText.replace(regex, newLine)
    return replacedMeta + rest
  }
  return text.startsWith(newLine + '\n') ? text : `${newLine}\n${text}`
}

export function replaceNameInTitle(
  title: string | null | undefined,
  oldName: string | null | undefined,
  newName: string | null | undefined,
): string | null {
  const text = String(title || '')
  const oldN = String(oldName || '').trim()
  const newN = String(newName || '').trim()
  if (!text || !oldN || !newN || oldN === newN) return null
  const idx = text.lastIndexOf(oldN)
  if (idx === -1) return null
  return text.slice(0, idx) + newN + text.slice(idx + oldN.length)
}

export function buildPatchedDescription(
  current: string | null | undefined,
  isHtmlBody: boolean,
  field: 'name' | 'phone',
  newValue: string,
): string {
  const source = isHtmlBody && current ? stripHtml(current) : current
  return replaceContactInDescription(source, field, newValue)
}
