
import { decryptStrict, encryptBuffer } from '@/lib/encryption'

export function encryptJson(value: unknown, key: Buffer): Uint8Array<ArrayBuffer> {
  const enc = encryptBuffer(Buffer.from(JSON.stringify(value), 'utf8'), key)
  const out = new Uint8Array(new ArrayBuffer(enc.length))
  out.set(enc)
  return out
}

export function decryptJson<T>(data: Uint8Array, key: Buffer): T {
  return JSON.parse(decryptStrict(Buffer.from(data), key)) as T
}
