const MARK = /^[ \t]*<!-- (\/?)(cloud-only|selfhosted-only) -->[ \t]*$/

export function guideForEdition(md: string, selfHosted: boolean): string {
  const out: string[] = []
  let open: string | null = null
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const m = MARK.exec(line)
    if (!m && /(cloud|selfhosted)-only\s*-->/.test(line)) throw new Error(`guide marker malformed: ${line.trim()}`)
    if (m) {
      const [, close, kind] = m
      if (close ? open !== kind : open !== null) throw new Error(`guide marker out of order: ${line.trim()}`)
      open = close ? null : kind
      continue
    }
    if (open === 'cloud-only' && selfHosted) continue
    if (open === 'selfhosted-only' && !selfHosted) continue
    out.push(line)
  }
  if (open !== null) throw new Error(`guide marker not closed: ${open}`)
  return out.join('\n')
}
