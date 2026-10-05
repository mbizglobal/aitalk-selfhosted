import { BlobServiceClient } from '@azure/storage-blob'
import { nanoid } from 'nanoid'
import { isSelfHosted } from '@/lib/edition'
import { selfHostedFileStore } from '@/lib/file-store'

export const SELF_HOSTED_ICON_PATH = '/api/icons/'
export const ICON_FILE_NAME = /^[A-Za-z0-9_-]{1,200}\.png$/

function selfHostedIconFileName(iconUrl: string): string | null {
  try {
    const url = new URL(iconUrl)
    const base = process.env.NEXTAUTH_URL
    if (!base || url.origin !== new URL(base).origin) return null
    if (!url.pathname.startsWith(SELF_HOSTED_ICON_PATH)) return null
    const name = url.pathname.slice(SELF_HOSTED_ICON_PATH.length)
    return ICON_FILE_NAME.test(name) ? name : null
  } catch {
    return null
  }
}

export function isStoredIconUrl(iconUrl: unknown): iconUrl is string {
  if (typeof iconUrl !== 'string') return false
  return isSelfHosted() ? selfHostedIconFileName(iconUrl) !== null : iconUrl.includes('blob.core.windows.net')
}

const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING!
const containerName = process.env.AZURE_BLOB_CONTAINER_ICONS || 'user-icons'
const accountName = process.env.AZURE_BLOB_ACCOUNT_NAME || 'aitalkblog'

const blobServiceClient = connectionString
  ? BlobServiceClient.fromConnectionString(connectionString)
  : null

export interface S3UploadResult {
  url: string
  key: string
  fileName: string
}

export async function uploadIconToS3(
  dataUrl: string,
  userId: string,
  agentId?: string
): Promise<S3UploadResult> {
  if (isSelfHosted()) {
    const base = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : ''
    if (!base) throw new Error('NEXTAUTH_URL is not set — needed for icon URLs')
    const buffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64')
    const fileName = agentId
      ? `${userId}-${String(agentId).replace(/[^A-Za-z0-9_-]/g, '')}-${nanoid()}.png`
      : `${userId}-${nanoid()}.png`
    if (!ICON_FILE_NAME.test(fileName)) throw new Error('invalid icon file name')
    const key = `icons/${fileName}`
    await selfHostedFileStore().put(key, buffer)
    return { url: `${base}${SELF_HOSTED_ICON_PATH}${fileName}`, key, fileName }
  }
  if (!blobServiceClient) {
    throw new Error('Azure Blob Storage not configured')
  }

  try {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    const fileName = agentId
      ? `${userId}-${agentId}-${nanoid()}.png`
      : `${userId}-${nanoid()}.png`
    const key = `icons/${fileName}`

    const containerClient = blobServiceClient.getContainerClient(containerName)
    const blockBlobClient = containerClient.getBlockBlobClient(key)

    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: 'image/png' },
    })

    const url = `https://${accountName}.blob.core.windows.net/${containerName}/${key}`

    return {
      url,
      key,
      fileName
    }
  } catch (error) {
    throw new Error('Failed to upload image to Blob Storage')
  }
}

export async function deleteIconFromS3(iconUrl: string): Promise<void> {
  if (isSelfHosted()) {
    const name = selfHostedIconFileName(iconUrl)
    if (!name) throw new Error('Not a stored icon URL')
    await selfHostedFileStore().delete(`icons/${name}`)
    return
  }
  if (!blobServiceClient) {
    throw new Error('Azure Blob Storage not configured')
  }

  try {
    let key: string

    const url = new URL(iconUrl)

    if (url.hostname.includes('blob.core.windows.net')) {
      // Azure Blob URL: https://aitalkblog.blob.core.windows.net/user-icons/icons/abc.png
      const pathParts = url.pathname.substring(1).split('/')
      key = pathParts.slice(1).join('/')
    } else if (url.hostname.includes('amazonaws.com')) {
      // Legacy S3 URL: https://s3.eu-west-1.amazonaws.com/aitalk.ch-user-icons/icons/abc.png
      const pathParts = url.pathname.substring(1).split('/')
      if (pathParts[0] === 'aitalk.ch-user-icons') {
        key = pathParts.slice(1).join('/')
      } else {
        key = url.pathname.substring(1)
      }
    } else {
      key = url.pathname.substring(1)
    }

    const containerClient = blobServiceClient.getContainerClient(containerName)
    const blockBlobClient = containerClient.getBlockBlobClient(key)

    await blockBlobClient.delete()
  } catch (error) {
    throw new Error('Failed to delete image from Blob Storage')
  }
}

export function isUserOwnerOfIcon(iconUrl: string, userId: string): boolean {
  try {
    const url = new URL(iconUrl)
    const fileName = url.pathname.split('/').pop() || ''
    return fileName.startsWith(`${userId}-`)
  } catch {
    return false
  }
}
