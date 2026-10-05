
const MIN_SUFFIX_DIGITS = 8

export function phoneSuffixMatch(
  haystack: string,
  phone: string,
  minSuffix = MIN_SUFFIX_DIGITS
): boolean {
  if (!haystack || !phone) return false
  const phoneDigits = phone.replace(/\D/g, '')
  if (phoneDigits.length < minSuffix) return false
  const suffix = phoneDigits.slice(-minSuffix)
  // Phone-run = digit, then optional in-number separators (space, tab, hyphen, dot,
  // parens, +), then digit. So a stored "079-123-4567" / "079 123 4567" / "(079) 123-4567"
  // collapses to one digit run. Newlines and ':' are excluded → ISO times ("09:00") and
  // newline-separated description fields never merge into a false candidate.
  const runs = haystack.match(/\d[\d().+ \t-]*\d/g)
  if (!runs) return false
  return runs.some((run) => run.replace(/\D/g, '').endsWith(suffix))
}

export function normalizePhoneForStorage(phone: string): string {
  if (!phone) return phone
  const hasPlus = phone.trim().startsWith('+')
  const digits = phone.replace(/\D/g, '')
  if (!digits) return phone
  return hasPlus ? `+${digits}` : digits
}
