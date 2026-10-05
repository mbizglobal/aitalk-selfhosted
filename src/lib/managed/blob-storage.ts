
import { BlobServiceClient, ContainerClient, BlobSASPermissions } from '@azure/storage-blob'
import { getManagedAzureConfig } from './api-key'
import { decryptData } from '@/lib/encryption'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { isSelfHosted } from '@/lib/edition'
import { selfHostedFileStore } from '@/lib/file-store'

//
const containerCache = new Map<string, { client: ContainerClient; expiry: number }>()
const CACHE_TTL = 5 * 60 * 1000

async function getContainerClient(regionId: string): Promise<ContainerClient> {
  const cached = containerCache.get(regionId)
  if (cached && cached.expiry > Date.now()) {
    return cached.client
  }

  const regionConfig = await prisma.managedRegionConfig.findUnique({
    where: { regionId },
    select: { blobConnectionString: true, blobContainerName: true },
  })

  if (!regionConfig?.blobConnectionString || !regionConfig?.blobContainerName) {
    throw new Error(`[BlobStorage] Blob Storage not configured for region "${regionId}"`)
  }

  const connectionString = await decryptData(regionConfig.blobConnectionString)
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  const containerClient = blobServiceClient.getContainerClient(regionConfig.blobContainerName)

  await containerClient.createIfNotExists()

  containerCache.set(regionId, { client: containerClient, expiry: Date.now() + CACHE_TTL })
  return containerClient
}

export function generateBlobPath(userId: string, agentId: string, fileName: string, subdir?: string): string {
  const date = new Date().toISOString().split('T')[0] // 2026-03-09
  const uniqueId = Math.random().toString(36).substring(2, 8)
  const safeName = fileName.replace(/[/\\]/g, '_').slice(0, 200)
  const dir = subdir ? `${subdir.replace(/[/\\]/g, '')}/` : ''
  return `${userId}/${agentId}/${dir}${date}_${uniqueId}_${safeName}`
}

export async function uploadToBlob(
  regionId: string,
  blobPath: string,
  file: Buffer | Blob,
  mimeType?: string
): Promise<string> {
  if (isSelfHosted()) {
    const buf = Buffer.isBuffer(file) ? file : Buffer.from(await (file as Blob).arrayBuffer())
    await selfHostedFileStore().put(blobPath, buf)
    console.log(`[BlobStorage] Uploaded (disk): ${blobRef(blobPath)} (${buf.length} bytes)`)
    return blobPath
  }
  const container = await getContainerClient(regionId)
  const blockBlobClient = container.getBlockBlobClient(blobPath)

  let buffer: Buffer
  if (Buffer.isBuffer(file)) {
    buffer = file
  } else {
    const arrayBuffer = await (file as Blob).arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
  }

  await blockBlobClient.upload(buffer, buffer.length, {
    blobHTTPHeaders: {
      blobContentType: mimeType || 'application/octet-stream',
    },
  })

  console.log(`[BlobStorage] Uploaded: ${blobRef(blobPath)} (${buffer.length} bytes)`)
  return blobPath
}

export async function generateReadSasUrl(
  regionId: string,
  blobPath: string,
  ttlSeconds: number = 3600
): Promise<string> {
  if (isSelfHosted()) throw new Error('[BlobStorage] read URLs are not available in the self-hosted edition')
  const container = await getContainerClient(regionId)
  const blockBlobClient = container.getBlockBlobClient(blobPath)
  return blockBlobClient.generateSasUrl({
    permissions: BlobSASPermissions.parse('r'),
    expiresOn: new Date(Date.now() + ttlSeconds * 1000),
  })
}

export async function downloadFromBlob(
  regionId: string,
  blobPath: string
): Promise<{ buffer: Buffer; contentType: string }> {
  if (isSelfHosted()) return { buffer: await selfHostedFileStore().get(blobPath), contentType: '' }
  const container = await getContainerClient(regionId)
  const blockBlobClient = container.getBlockBlobClient(blobPath)

  const downloadResponse = await blockBlobClient.download(0)
  const chunks: Buffer[] = []

  if (downloadResponse.readableStreamBody) {
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType: downloadResponse.contentType || 'application/octet-stream',
  }
}

export function blobRef(blobPath: string): string {
  const slash = blobPath.lastIndexOf('/')
  const dir = blobPath.slice(0, slash + 1)
  const base = blobPath.slice(slash + 1)
  const m = base.match(/^(\d{4}-\d{2}-\d{2})_([a-z0-9]{6})_/)
  return m ? `${dir}${m[1]}_${m[2]}` : dir
}

export async function deleteFromBlob(regionId: string, blobPath: string): Promise<void> {
  if (isSelfHosted()) {
    await selfHostedFileStore().delete(blobPath)
    console.log(`[BlobStorage] Deleted (disk): ${blobRef(blobPath)}`)
    return
  }
  const container = await getContainerClient(regionId)
  const blockBlobClient = container.getBlockBlobClient(blobPath)
  await blockBlobClient.deleteIfExists()
  console.log(`[BlobStorage] Deleted: ${blobRef(blobPath)}`)
}

async function deleteBlobsByPrefix(regionId: string, prefix: string, label: string): Promise<void> {
  if (isSelfHosted()) {
    const deleted = await selfHostedFileStore().deletePrefix(prefix)
    console.log(`[BlobStorage] Deleted ${deleted} files (disk) for ${label}`)
    return
  }
  const container = await getContainerClient(regionId)

  let deleted = 0
  let failed = 0
  for await (const blob of container.listBlobsFlat({ prefix })) {
    try {
      await container.getBlockBlobClient(blob.name).deleteIfExists()
      deleted++
    } catch (error) {
      failed++
      console.error(`[BlobStorage] Failed to delete ${blobRef(blob.name)}:`, describeCaughtError(error))
    }
  }

  console.log(`[BlobStorage] Deleted ${deleted} blobs for ${label}${failed > 0 ? ` (failed ${failed})` : ''}`)
  if (failed > 0) {
    throw new Error(`blob delete partially failed (${failed}/${deleted + failed}) for ${label}`)
  }
}

export async function deleteAgentBlobs(regionId: string, userId: string, agentId: string): Promise<void> {
  await deleteBlobsByPrefix(regionId, `${userId}/${agentId}/`, `agent=${agentId}`)
}

export async function deleteProjectBlobs(regionId: string, userId: string, projectId: string): Promise<void> {
  await deleteBlobsByPrefix(regionId, `${userId}/project/${projectId}/`, `project=${projectId}`)
}

export async function deleteUserBlobs(regionId: string, userId: string): Promise<void> {
  await deleteBlobsByPrefix(regionId, `${userId}/`, `user=${userId}`)
}

export function invalidateBlobCache(regionId?: string) {
  if (regionId) {
    containerCache.delete(regionId)
  } else {
    containerCache.clear()
  }
}
