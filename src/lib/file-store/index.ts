import { createDiskFileStore } from './disk'
import { createS3FileStore } from './s3'

export interface FileStore {
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  deletePrefix(prefix: string): Promise<number>
}

export const LOCAL_REGION = 'local'

let cached: { sig: string; store: FileStore } | null = null

export function selfHostedFileStore(env: Record<string, string | undefined> = process.env): FileStore {
  const kind = env.FILE_STORE || 'disk'
  const s3Keys = ['S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE'] as const
  const sig = [kind, env.FILE_STORE_DIR ?? '', ...s3Keys.map((k) => env[k] ?? '')].join('|')
  if (cached?.sig === sig) return cached.store
  let store: FileStore
  if (kind === 's3') {
    store = createS3FileStore({
      bucket: env.S3_BUCKET ?? '',
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    })
  } else if (kind === 'disk') {
    const root = env.FILE_STORE_DIR
    if (!root) throw new Error('[FileStore] FILE_STORE_DIR is not set — set it to the absolute path of the file volume')
    store = createDiskFileStore(root)
  } else {
    throw new Error(`[FileStore] unknown FILE_STORE "${kind}" (disk | s3)`)
  }
  cached = { sig, store }
  return store
}
