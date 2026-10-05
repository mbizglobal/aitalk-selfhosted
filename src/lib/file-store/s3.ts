import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import type { FileStore } from './index'
import { segmentsOf } from './keys'

export interface S3FileStoreConfig {
  bucket: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle?: boolean
}

export function createS3FileStore(cfg: S3FileStoreConfig, client?: S3Client): FileStore {
  if (!cfg.bucket) throw new Error('[FileStore] S3_BUCKET is not set')
  if (!!cfg.accessKeyId !== !!cfg.secretAccessKey) throw new Error('[FileStore] set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither')
  const s3 = client ?? new S3Client({
    region: cfg.region || 'us-east-1',
    ...(cfg.endpoint && { endpoint: cfg.endpoint }),
    forcePathStyle: !!cfg.forcePathStyle,
    ...(cfg.accessKeyId && { credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey! } }),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  const Bucket = cfg.bucket

  return {
    async put(key, data) {
      segmentsOf(key, 'key')
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: data, ContentLength: data.length }))
    },
    async get(key) {
      segmentsOf(key, 'key')
      const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }))
      if (!r.Body) throw new Error('[FileStore] empty S3 response body')
      return Buffer.from(await r.Body.transformToByteArray())
    },
    async delete(key) {
      segmentsOf(key, 'key')
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },
    async deletePrefix(prefix) {
      segmentsOf(prefix, 'prefix')
      let deleted = 0
      let failed = 0
      let firstError = ''
      let ContinuationToken: string | undefined
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken }))
        const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k)
        if (keys.length) {
          try {
            const r = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }))
            const errs = r.Errors ?? []
            failed += errs.length
            deleted += keys.length - errs.length
            if (errs.length && !firstError) firstError = `${errs[0].Code ?? ''} ${errs[0].Message ?? ''}`.trim()
          } catch (e) {
            failed += keys.length
            if (!firstError) firstError = e instanceof Error ? e.name : 'request failed'
          }
        }
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (ContinuationToken)
      if (failed) throw new Error(`[FileStore] S3 delete partially failed (${failed}/${deleted + failed}): ${firstError}`)
      return deleted
    },
  }
}
