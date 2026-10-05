
const NAME_LINE = /^Name:\s*(.+)$/i
const PHONE_LINE = /^Phone:\s*(.+)$/i

export function parseEventDescription(
  description?: string | null,
): { name?: string; phone?: string } {
  if (!description) return {}
  const lines = String(description).split('\n')
  let name: string | undefined
  let phone: string | undefined
  for (const raw of lines) {
    const line = raw.trim()
    if (!name) {
      const m = NAME_LINE.exec(line)
      if (m) {
        name = m[1].trim()
        continue
      }
    }
    if (!phone) {
      const m = PHONE_LINE.exec(line)
      if (m) {
        phone = m[1].trim()
        continue
      }
    }
    if (name && phone) break
  }
  return { name, phone }
}

export function maskName(input?: string | null): string {
  if (!input) return ''
  const name = String(input).trim()
  if (!name) return ''

  const nonLatin = name.replace(/[A-Za-z\s.\-']/g, '')
  if (nonLatin.length > 0 && nonLatin.length >= name.replace(/\s/g, '').length / 2) {
    const first = Array.from(name)[0] ?? ''
    return `${first}**`
  }

  const tokens = name.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ''
  if (tokens.length === 1) {
    return `${tokens[0][0].toUpperCase()}.`
  }
  const last = tokens[tokens.length - 1]
  const initials = tokens.slice(0, -1).map((t) => {
    const trimmed = t.replace(/[.\s]+$/, '')
    if (!trimmed) return ''
    if (/^[A-Za-z]\.?$/.test(trimmed)) return `${trimmed.replace('.', '').toUpperCase()}.`
    return `${trimmed[0].toUpperCase()}.`
  })
  return [...initials, last].filter(Boolean).join(' ')
}

export function maskPhone(input?: string | null): string {
  if (!input) return ''
  const raw = String(input).trim()
  if (!raw) return ''
  if (raw.length < 8) return '*'.repeat(Math.max(raw.length, 3))
  const head = raw.slice(0, 4)
  const tail = raw.slice(-4)
  return `${head}****${tail}`
}

export function maskEventDescription(description?: string | null): {
  maskedName: string
  maskedPhone: string
} {
  const parsed = parseEventDescription(description)
  return {
    maskedName: maskName(parsed.name),
    maskedPhone: maskPhone(parsed.phone),
  }
}

export function maskEventSummary(
  summary?: string | null,
  description?: string | null,
): string {
  if (!summary) return ''
  let result = String(summary)
  const { name, phone } = parseEventDescription(description)
  if (name && name.trim()) {
    const maskedNameStr = maskName(name)
    if (maskedNameStr) {
      const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(escaped, 'g'), maskedNameStr)
    }
  }
  if (phone && phone.trim()) {
    const maskedPhoneStr = maskPhone(phone)
    if (maskedPhoneStr) {
      const escaped = phone.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(escaped, 'g'), maskedPhoneStr)
    }
  }
  return result.trim()
}
