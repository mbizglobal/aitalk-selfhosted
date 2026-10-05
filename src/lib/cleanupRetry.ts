// PR-D3: RAG cleanup retry helper

import type { PrismaClient } from '@prisma/client'

export interface CleanupRetryOptions {
  label: string
  maxAttempts?: number
  baseMs?: number
}

export type CleanupRetryResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: unknown; attempts: number }

export async function retryCleanup<T>(
  fn: () => Promise<T>,
  opts: CleanupRetryOptions
): Promise<CleanupRetryResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseMs = opts.baseMs ?? 500
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn()
      if (attempt > 1) {
        console.warn(`[CLEANUP] ${opts.label} succeeded on attempt ${attempt}/${maxAttempts}`)
      }
      return { ok: true, value, attempts: attempt }
    } catch (err) {
      lastError = err
      console.warn(`[CLEANUP] ${opts.label} attempt ${attempt}/${maxAttempts} failed:`, err)
      if (attempt < maxAttempts) {
        const sleepMs = baseMs * Math.pow(3, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, sleepMs))
      }
    }
  }
  console.warn(`[CLEANUP] ${opts.label} gave up after ${maxAttempts} attempts`)
  return { ok: false, error: lastError, attempts: maxAttempts }
}

export async function recordCleanupFailure(
  prismaClient: PrismaClient,
  storageId: number,
  provider: string,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const prefixed = `[cleanup_pending:${provider}] ${message}`
  try {
    await prismaClient.storage.update({
      where: { id: storageId },
      data: { errorMessage: prefixed },
    })
  } catch (dbErr) {
    console.warn(`[CLEANUP] failed to record cleanup_pending for storage ${storageId}:`, dbErr)
  }
}

export async function readCleanupPendingPrefix(
  prismaClient: PrismaClient,
  storageId: number
): Promise<string> {
  try {
    const existing = await prismaClient.storage.findUnique({
      where: { id: storageId },
      select: { errorMessage: true },
    })
    const msg = existing?.errorMessage ?? ''
    if (msg.startsWith('[cleanup_pending:')) {
      const firstLine = msg.split('\n')[0]
      return `${firstLine}\n`
    }
  } catch {
    // best-effort
  }
  return ''
}
