
import Papa from 'papaparse'

export class BankFormatError extends Error {
  constructor(message: string, readonly code = 'bank_format', readonly params?: Record<string, string | number>) {
    super(message)
    this.name = 'BankFormatError'
  }
}

export function parseDelimited(text: string, delimiter: ',' | ';' | '\t'): string[][] {
  const t = text.replace(/^\uFEFF/, '')
  const r = Papa.parse<string[]>(t, { delimiter, header: false, skipEmptyLines: false })
  const fatal = r.errors.filter((e) => e.type === 'Quotes')
  if (fatal.length > 0) throw new BankFormatError(`CSV 따옴표 오류 (${fatal.length}건, 첫 줄 ${(fatal[0].row ?? 0) + 1})`, 'bank_csv_quotes', { line: (fatal[0].row ?? 0) + 1 })
  return r.data
}

export function normalizeAmount(raw: string): string | null {
  const t = raw.trim()
  if (t === '') return null
  const m = /^([+-])?(\d{1,3}(?:['’]\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return null
  const int = m[2].replace(/['’]/g, '')
  const neg = m[1] === '-' && /[1-9]/.test(int + (m[3] ?? ''))
  return `${neg ? '-' : ''}${BigInt(int).toString()}.${(m[3] ?? '').padEnd(2, '0')}`
}
