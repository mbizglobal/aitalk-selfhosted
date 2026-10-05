import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getAppBaseUrl } from '@/lib/app-url'

type Env = Record<string, string | undefined>

export interface PreflightOptions {
  requireEdition?: boolean
  requireFileVolume?: boolean
}

export interface PreflightDeps {
  stat(p: string): Promise<{ dev: number }>
  mkdir(p: string): Promise<void>
  probeWrite(dir: string): Promise<void>
}

const realDeps: PreflightDeps = {
  stat: (p) => fs.stat(p),
  mkdir: async (p) => { await fs.mkdir(p, { recursive: true }) },
  probeWrite: async (dir) => {
    const f = path.join(dir, `.aitalk-write-check-${process.pid}`)
    await fs.writeFile(f, 'ok')
    await fs.rm(f, { force: true })
  },
}

const errCode = (e: unknown) => (e as NodeJS.ErrnoException)?.code

export async function selfHostedPreflight(env: Env = process.env, opts: PreflightOptions = {}, deps: PreflightDeps = realDeps): Promise<string[]> {
  const problems: string[] = []

  if (opts.requireEdition && env.AITALK_EDITION !== 'selfhosted') {
    problems.push(`AITALK_EDITION must be "selfhosted" in this installation (got ${env.AITALK_EDITION ? `"${env.AITALK_EDITION.slice(0, 20)}"` : 'nothing'})`)
  }

  try { getAppBaseUrl({ ...env, AITALK_EDITION: 'selfhosted' }) } catch (e) { problems.push((e as Error).message) }

  const authSecret = env.NEXTAUTH_SECRET?.trim() ?? ''
  if (authSecret.length < 32) {
    problems.push('NEXTAUTH_SECRET must be at least 32 characters (sign-in sessions are signed with it) — e.g. `openssl rand -base64 32`')
  }

  if (!/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_SECRET ?? '')) {
    problems.push('ENCRYPTION_SECRET must be exactly 64 hex characters (the master key for stored secrets) — e.g. `openssl rand -hex 32`. Keep a copy with your database backups: without it stored secrets cannot be read')
  }

  const store = env.FILE_STORE || 'disk'
  if (store === 's3') {
    if (!env.S3_BUCKET?.trim()) problems.push('FILE_STORE=s3 needs S3_BUCKET')
  } else if (store !== 'disk') {
    problems.push(`FILE_STORE must be "disk" or "s3" (got "${store.slice(0, 20)}")`)
  } else {
    const dir = env.FILE_STORE_DIR?.trim() ?? ''
    if (!dir) problems.push('FILE_STORE_DIR is not set — set it to the absolute path of the file volume (e.g. /data/files)')
    else if (!path.isAbsolute(dir)) problems.push(`FILE_STORE_DIR must be an absolute path (got "${dir.slice(0, 60)}")`)
    else {
      try {
        await deps.mkdir(dir)
        await deps.probeWrite(dir)
        if (opts.requireFileVolume && (await deps.stat(dir)).dev === (await deps.stat('/')).dev) {
          problems.push(`FILE_STORE_DIR (${dir}) is inside the container, not on a volume — uploaded files would be lost on the next upgrade. Mount a volume there (docker-compose.yml does)`)
        }
      } catch (e) {
        const c = errCode(e)
        problems.push(c === 'EACCES' || c === 'EPERM'
          ? `FILE_STORE_DIR (${dir}) is not writable by the app user — on the host run: chown -R 1000:1000 <the folder mounted at ${dir}>`
          : `FILE_STORE_DIR (${dir}) cannot be used (${c ?? 'error'})`)
      }
    }
  }

  return problems
}

export function formatPreflight(problems: string[]): string {
  return `Self-hosted installation is not configured correctly — not starting:\n${problems.map((p) => `  - ${p}`).join('\n')}`
}
