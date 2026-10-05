
import { CREDENTIAL_CONTEXT_FIELDS } from './template-scope'

export const REDACTED = '[REDACTED]'

export const TRUNCATED = '[TRUNCATED: max depth]'

export const GETTER_FAILED = '[UNREADABLE: getter threw]'

const MAX_DEPTH = 24

function isOpaqueObject(v: object): boolean {
  if (v instanceof Date && (v as { toJSON?: unknown }).toJSON !== Date.prototype.toJSON) return false

  return (
    v instanceof Date ||
    v instanceof Map ||
    v instanceof Set ||
    v instanceof RegExp ||
    v instanceof Promise ||
    ArrayBuffer.isView(v) ||
    v instanceof ArrayBuffer
  )
}

function errorShell(err: Error): Record<string, unknown> {
  return { name: err.name, message: err.message, stack: err.stack }
}


function safeEntries(obj: object): Array<[string, unknown]> {
  let keys: string[]
  try {
    keys = Object.keys(obj)
  } catch {
    return [['[keys]', GETTER_FAILED]]
  }

  const out: Array<[string, unknown]> = []
  for (const key of keys) {
    try {
      out.push([key, (obj as Record<string, unknown>)[key]])
    } catch {
      out.push([key, GETTER_FAILED])
    }
  }
  return out
}

function safeArrayItems(arr: unknown[]): unknown[] {
  let len: number
  try {
    len = arr.length
  } catch {
    return [GETTER_FAILED]
  }

  const out: unknown[] = []
  for (let i = 0; i < len; i++) {
    try {
      out.push(arr[i])
    } catch {
      out.push(GETTER_FAILED)
    }
  }
  return out
}

function customToJson(v: object): (() => unknown) | null {
  let fn: unknown
  try {
    fn = (v as { toJSON?: unknown }).toJSON
  } catch {
    return null
  }
  if (typeof fn !== 'function') return null
  return (fn as () => unknown).bind(v)
}

function containsCredential(value: unknown, depth: number, seen: WeakSet<object>): boolean {
  if (value === null || typeof value !== 'object') return false
  const obj = value as object
  if (isOpaqueObject(obj)) return false
  if (depth >= MAX_DEPTH) return true
  if (seen.has(obj)) return false
  seen.add(obj)

  if (Array.isArray(value)) {
    return safeArrayItems(value).some(item =>
      item === GETTER_FAILED ? true : containsCredential(item, depth + 1, seen),
    )
  }
  try {
    if (typeof (obj as { toJSON?: unknown }).toJSON === 'function') return true
  } catch {
    return true
  }
  for (const [key, item] of safeEntries(obj)) {
    if (CREDENTIAL_CONTEXT_FIELDS.has(key)) return true
    if (item === GETTER_FAILED) return true
    if (containsCredential(item, depth + 1, seen)) return true
  }
  return false
}

function redactInto(value: unknown, depth: number, cache: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value
  const obj = value as object
  if (isOpaqueObject(obj)) return value
  if (depth >= MAX_DEPTH) return TRUNCATED

  const cached = cache.get(obj)
  if (cached !== undefined) return cached

  if (Array.isArray(value)) {
    const out: unknown[] = []
    cache.set(obj, out)
    for (const item of safeArrayItems(value)) {
      out.push(item === GETTER_FAILED ? GETTER_FAILED : redactInto(item, depth + 1, cache))
    }
    return out
  }

  const toJson = customToJson(obj)
  if (toJson) {
    let produced: unknown
    try {
      produced = toJson()
    } catch {
      const failed = { toJSON: GETTER_FAILED }
      cache.set(obj, failed)
      return failed
    }
    const redacted = redactInto(produced, depth + 1, cache)
    cache.set(obj, redacted)
    return redacted
  }

  const out: Record<string, unknown> = value instanceof Error ? errorShell(value) : {}
  cache.set(obj, out)
  for (const [key, item] of safeEntries(obj)) {
    out[key] = CREDENTIAL_CONTEXT_FIELDS.has(key) ? REDACTED : redactInto(item, depth + 1, cache)
  }
  return out
}

export function redactCredentials<T>(value: T): T {
  if (!containsCredential(value, 0, new WeakSet<object>())) return value
  return redactInto(value, 0, new WeakMap<object, unknown>()) as T
}

export function redactDebugLogEntry<T extends Record<string, unknown>>(entry: T): T {
  return redactCredentials(entry)
}
