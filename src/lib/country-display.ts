
export function countryFlagEmoji(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return ''
  const upper = code.toUpperCase()
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

export function countryName(code: string | null | undefined, locale = 'en'): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return ''
  const upper = code.toUpperCase()
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(upper) || upper
  } catch {
    return upper
  }
}
