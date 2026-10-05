export function segmentsOf(key: string, what: 'key' | 'prefix'): string[] {
  if (typeof key !== 'string' || !key) throw new Error(`[FileStore] empty ${what}`)
  if (key.includes('\0') || key.includes('\\')) throw new Error(`[FileStore] invalid ${what}`)
  if (key.startsWith('/')) throw new Error(`[FileStore] absolute ${what}`)
  const body = what === 'prefix' ? key.slice(0, -1) : key
  if (what === 'prefix' && !key.endsWith('/')) throw new Error('[FileStore] prefix must end with /')
  const parts = body.split('/')
  for (const p of parts) if (!p || p === '.' || p === '..') throw new Error(`[FileStore] invalid ${what}`)
  return parts
}
