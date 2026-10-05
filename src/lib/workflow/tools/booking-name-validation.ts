
const EXACT_PLACEHOLDER = new Set([
  'unknown', 'unknown user', 'n/a', 'na', 'none', 'no name', 'noname', 'not provided',
  'null', 'nil', 'anonymous', 'auto', 'tbd', 'test',
  'customer', 'caller', 'visitor', 'patient',
  '미상', '익명', '미정', '모름', '없음', '이름없음', '미확인', '미확정', '확인안됨', '확인불가', 'unknown name', 'name unknown',
  '顾客', '客户', '访客', 'お客様', 'お客さま', '客様',
])

const KO_GENERIC_ROOTS = ['고객', '손님', '환자', '예약자', '방문자', '사용자']

export function isPlaceholderName(name: unknown): boolean {
  if (typeof name !== 'string') return true
  const raw = name.trim()
  if (raw.length === 0) return true
  const t = raw.toLowerCase().replace(/\s+/g, ' ')
  if (EXACT_PLACEHOLDER.has(t)) return true
  if (EXACT_PLACEHOLDER.has(t.replace(/^(the|a|an)\s+/, ''))) return true
  for (const root of KO_GENERIC_ROOTS) {
    if (raw.startsWith(root)) return true
  }
  return false
}

export function isPlaceholderPhone(phone: unknown): boolean {
  if (typeof phone !== 'string') return true
  return phone.replace(/\D/g, '').length < 7
}

export function normalizeForGrounding(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

export function isNameGroundedInUtterances(name: unknown, utterances: string[] | undefined): boolean {
  if (typeof name !== 'string' || !utterances || utterances.length === 0) return false
  const n = normalizeForGrounding(name)
  if (n.length < 2) return false
  for (const u of utterances) {
    if (typeof u === 'string' && normalizeForGrounding(u).includes(n)) return true
  }
  return false
}

export function isNameGroundingApplicable(
  callerUtterances: string[] | undefined,
  transcriptSource?: 'model_input_asr' | 'external_whisper'
): boolean {
  return !!callerUtterances && transcriptSource !== 'external_whisper'
}

const SPOKEN_DIGITS: Array<[RegExp, string]> = [
  [/하나/g, '1'], [/다섯/g, '5'], [/여섯/g, '6'], [/일곱/g, '7'], [/여덟/g, '8'], [/아홉/g, '9'],
  [/둘/g, '2'], [/셋/g, '3'], [/넷/g, '4'],
  [/영|공/g, '0'], [/일/g, '1'], [/이/g, '2'], [/삼/g, '3'], [/사/g, '4'], [/오/g, '5'], [/육/g, '6'], [/칠/g, '7'], [/팔/g, '8'], [/구/g, '9'],
  [/\b(?:zero|oh)\b/gi, '0'], [/\bone\b/gi, '1'], [/\btwo\b/gi, '2'], [/\bthree\b/gi, '3'], [/\bfour\b/gi, '4'],
  [/\bfive\b/gi, '5'], [/\bsix\b/gi, '6'], [/\bseven\b/gi, '7'], [/\beight\b/gi, '8'], [/\bnine\b/gi, '9'],
]
export function spokenDigitsToNumeric(s: string): string {
  let out = s.replace(EN_TENS_UNIT, (_, t: string, u: string) => String(EN_TENS[t.toLowerCase()] + EN_UNITS[u.toLowerCase()]))
  out = out.normalize('NFC')
  for (let prev = ''; prev !== out; ) {
    prev = out
    out = out.replace(FR_SPACED_COMPOUND, (_, a: string, b: string) => `${a}-${b.replace(/\s+/g, '-')}`)
  }
  out = out.replace(/\p{L}+(?:-\p{L}+)*/gu, (w) => {
    const lw = w.toLowerCase()
    const n = numberOf(EN_TEENS_TENS, lw) ?? parseGermanNumberWord(lw)
    return n !== null ? String(n) : parseFrenchNumberWord(lw) ?? w
  })
  for (const [re, d] of SPOKEN_DIGITS) out = out.replace(re, d)
  return out
}

function numberOf(map: Record<string, number>, w: string): number | null {
  return Object.hasOwn(map, w) ? map[w] : null
}

const EN_UNITS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const EN_TEENS_TENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  ...EN_TENS,
}
const EN_TENS_UNIT = /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/gi

const DE_UNITS: Record<string, number> = { eins: 1, ein: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9 }
const DE_TEENS: Record<string, number> = {
  zehn: 10, elf: 11, 'zwölf': 12, dreizehn: 13, vierzehn: 14, 'fünfzehn': 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
}
const DE_TENS: Record<string, number> = {
  zwanzig: 20, 'dreißig': 30, dreissig: 30, vierzig: 40, 'fünfzig': 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90,
}

function parseGermanBelow100(w: string): number | null {
  if (Object.hasOwn(DE_TEENS, w)) return DE_TEENS[w]
  if (Object.hasOwn(DE_TENS, w)) return DE_TENS[w]
  if (Object.hasOwn(DE_UNITS, w)) return DE_UNITS[w]
  const m = /^(\p{L}+?)und(\p{L}+)$/u.exec(w)
  if (m && Object.hasOwn(DE_UNITS, m[1]) && m[1] !== 'eins' && Object.hasOwn(DE_TENS, m[2])) return DE_UNITS[m[1]] + DE_TENS[m[2]]
  return null
}

function parseGermanNumberWord(w: string): number | null {
  if (w === 'null') return 0
  if (w === 'ein') return null
  const h = /^(\p{L}*?)hundert(\p{L}*)$/u.exec(w)
  if (!h) return parseGermanBelow100(w)
  const hundreds = h[1] === '' ? 1 : Object.hasOwn(DE_UNITS, h[1]) && h[1] !== 'eins' ? DE_UNITS[h[1]] : null
  if (hundreds === null) return null
  if (h[2] === '') return hundreds * 100
  const rest = h[2] === 'ein' ? null : parseGermanBelow100(h[2])
  return rest === null ? null : hundreds * 100 + rest
}

const FR_WORDS: Record<string, number> = {
  'zéro': 0, zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
  septante: 70, huitante: 80, octante: 80, nonante: 90,
}

const FR_SPACED_COMPOUND = new RegExp(
  '(?<![\\p{L}-])((?:\\p{L}+-)*(?:vingts?|trente|quarante|cinquante|soixante|septante|huitante|octante|nonante|quatre|dix))\\s+' +
  '((?:et\\s+)?(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?))(?!\\p{L})',
  'giu',
)

function parseFrenchNumberWord(w: string): string | null {
  const parts = w.split('-').filter((p, i) => !(p === 'et' && i > 0))
  if (parts.length === 0 || !parts.every((p) => Object.hasOwn(FR_WORDS, p))) return null
  const values = parts.map((p) => FR_WORDS[p])
  let out = ''
  for (let i = 0; i < values.length; ) {
    let total = values[i]
    let prev = total
    let j = i + 1
    for (; j < values.length; j++) {
      const v = values[j]
      const fits =
        v === 20 ? prev === 4 && total === 4
        : v >= 10 && v <= 16 ? prev === 60 || prev === 80
        : v >= 1 && v <= 9 ? (prev === 10 ? v >= 7 : prev >= 20 && prev % 10 === 0)
        : false
      if (!fits) break
      total = v === 20 ? 80 : total + v
      prev = v === 20 ? 80 : v
    }
    out += String(total)
    i = j
  }
  return out
}

export function isPhoneGroundedInUtterances(phone: unknown, utterances: string[] | undefined): boolean {
  if (typeof phone !== 'string' || !utterances || utterances.length === 0) return false
  const phoneDigits = phone.replace(/\D/g, '')
  if (phoneDigits.length < 8) return false
  const suffix = phoneDigits.slice(-8)
  const digits = utterances.map((u) => (typeof u === 'string' ? spokenDigitsToNumeric(u).replace(/\D/g, '') : ''))
  for (let end = digits.length - 1; end >= 0; end--) {
    let window = ''
    for (let start = end; start >= Math.max(0, end - 2); start--) {
      window = digits[start] + window
      if (window.includes(suffix)) return true
    }
  }
  return false
}

export function phoneNotGroundedMessage(channel: 'pstn' | 'web_voice' | 'chat_widget' | undefined): string {
  const noGuess = 'Do NOT fill the phone from a known/previous contact, a summary, or your own guess.'
  if (channel === 'web_voice') {
    return 'The phone number you entered does not match what the caller said in this call — you may have misheard a digit ' +
      '(repeated digits such as "5555" are easy to miss). Do NOT call book_calendar_event again until the caller has given the number again. ' +
      'Read the number you entered back to the caller one digit at a time, in their language, then ask them to type their number into the phone box on their screen — ' +
      'that is the most reliable way. If they would rather say it, they may say the whole number once more, digit by digit — accept that too, never refuse a spoken number ' +
      '(a plain "yes" is not enough — only a number the caller has said or typed in this call can be booked). ' +
      'Then call book_calendar_event again with exactly the digits they just typed or said. ' + noGuess
  }
  return 'Ask the caller to say their phone number in this call and use exactly what they say. ' + noGuess +
    ' Do NOT call book_calendar_event again until the caller has spoken the number in this call.'
}
