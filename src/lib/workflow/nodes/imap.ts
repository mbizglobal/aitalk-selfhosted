
import { ImapFlow } from 'imapflow'
import { maskEmail } from '@/lib/log-mask'
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'
import { getConnectionSecret } from '@/lib/secret-vault'
import { simpleParser, ParsedMail } from 'mailparser'
import { getValidAccessToken, isMicrosoftHost } from '@/lib/email/microsoft-oauth'
import { canReadTemplatePath } from '../template-scope'

// ============================================================
// ============================================================
interface CachedConnection {
  client: ImapFlow
  lastUsed: number
  lock: any | null
  folder: string | null
}

const connectionCache = new Map<string, CachedConnection>()

export const __imapConnectionCacheForTest = connectionCache
const CACHE_TTL = 30000
const isDev = process.env.NODE_ENV === 'development'

export async function closeCachedConnection(cached: CachedConnection): Promise<void> {
  try { cached.lock?.release() } catch { /* ignore */ }
  try { await cached.client.logout() } catch { /* ignore */ }
  try { cached.client.close() } catch { /* ignore */ }
}

let cleanupInterval: NodeJS.Timeout | null = null
function startCleanupTimer() {
  if (cleanupInterval) return
  cleanupInterval = setInterval(async () => {
    const now = Date.now()
    for (const [key, cached] of connectionCache) {
      if (now - cached.lastUsed > CACHE_TTL) {
        connectionCache.delete(key)
        await closeCachedConnection(cached)
        if (isDev) {
          console.log(`[IMAP/Cache] Cleaned up idle connection: ${key}`)
        }
      }
    }
  }, 10000)
}

export function discardCachedConnection(
  cacheKey: string,
  client: Pick<ImapFlow, 'close'> | undefined
): void {
  if (!client) return

  const cached = connectionCache.get(cacheKey)
  if (cached?.client === client) {
    connectionCache.delete(cacheKey)
    try { cached.lock?.release() } catch { /* ignore */ }
  }

  try { client.close() } catch { /* ignore */ }
}

export async function closeConnection(client: Pick<ImapFlow, 'logout' | 'close'>): Promise<void> {
  try { await client.logout() } catch { /* ignore */ }
  try { client.close() } catch { /* ignore */ }
}

export async function refreshCachedLock(
  cached: CachedConnection,
  folder: string
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try { cached.lock?.release() } catch { /* ignore */ }
  cached.lock = null
  cached.folder = null

  try {
    cached.lock = await cached.client.getMailboxLock(folder)
    cached.folder = folder
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

export async function relockCachedConnection(
  cacheKey: string,
  cached: CachedConnection,
  folder: string
): Promise<void> {
  const result = await refreshCachedLock(cached, folder)
  if (result.ok) return

  if (connectionCache.get(cacheKey) === cached) connectionCache.delete(cacheKey)
  try { cached.client.close() } catch { /* ignore */ }
  throw result.error
}

export async function connectAndLock(
  client: Pick<ImapFlow, 'connect' | 'getMailboxLock' | 'close'>,
  folder: string
): Promise<any> {
  try {
    await client.connect()
    return await client.getMailboxLock(folder)
  } catch (err) {
    try { client.close() } catch { /* ignore */ }
    throw err
  }
}

async function getOrCreateConnection(
  cacheKey: string,
  config: { host: string; port: number; user: string },
  authCredentials: { user: string; pass?: string; accessToken?: string },
  folder: string
): Promise<{ client: ImapFlow; lock: any; isNew: boolean }> {
  startCleanupTimer()

  const cached = connectionCache.get(cacheKey)

  if (cached && cached.client.usable) {
    cached.lastUsed = Date.now()

    if (cached.folder !== folder) {
      await relockCachedConnection(cacheKey, cached, folder)
    }

    if (isDev) {
      console.log(`[IMAP/Cache] Reusing connection: ${cacheKey}`)
    }

    return { client: cached.client, lock: cached.lock, isNew: false }
  }

  if (cached) {
    connectionCache.delete(cacheKey)
    await closeCachedConnection(cached)
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.port === 993,
    auth: authCredentials.accessToken
      ? { user: authCredentials.user, accessToken: authCredentials.accessToken }
      : { user: authCredentials.user, pass: authCredentials.pass! },
    logger: false
  })

  const lock = await connectAndLock(client, folder)

  connectionCache.set(cacheKey, {
    client,
    lastUsed: Date.now(),
    lock,
    folder
  })

  if (isDev) {
    console.log(`[IMAP/Cache] Created new connection: ${cacheKey}`)
  }

  return { client, lock, isNew: true }
}

interface ImapNodeData {
  action: 'read' | 'move' | 'copy' | 'delete' | 'markRead' | 'batchMove' | 'listFolders'
  connectionId?: string

  folder: string
  onlyUnseen: boolean
  maxEmails: number

  targetFolder: string
  emailUid: string

  uidToDelete: string

  uidToMark: string

  batchSource: string
  folderMapping: {
    [category: string]: string
  }
}

interface ImapEmail {
  uid: number
  messageId: string
  subject: string
  from: string
  to: string
  date: string
  body: string
  bodyHtml?: string
}

interface ImapFolder {
  path: string
  name: string
  delimiter: string
  flags: string[]
  specialUse?: string
}

interface ImapResult {
  success: boolean
  action: 'read' | 'move' | 'copy' | 'delete' | 'markRead' | 'batchMove' | 'listFolders'
  emails?: ImapEmail[]
  count?: number
  error?: string
  archiveFailed?: boolean
  failedUid?: number
  folderNotFound?: boolean
  folders?: ImapFolder[]
  batchResults?: {
    uid: number
    category: string
    folder: string
    success: boolean
    error?: string
  }[]
}

export class ImapNodeExecutor extends BaseNodeExecutor {
  private isDev = process.env.NODE_ENV === 'development'

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const nodeData = node.data as ImapNodeData
    const { action, connectionId } = nodeData

    if (!action) {
      const error = 'Missing required field: action'
      console.error(`[IMAP] Error: ${error}`)
      return this.createErrorResult(context, error, nodeData)
    }

    try {
      if (!context.agentId) {
        const error = 'Missing agentId in workflow context — refusing an unscoped connection lookup'
        console.error(`[IMAP] Error: ${error}`)
        return this.createErrorResult(context, error, nodeData)
      }

      const connection = await prisma.workflowConnection.findFirst({
        where: connectionId
          ? { id: connectionId, agentId: context.agentId, provider: 'imap' }
          : { agentId: context.agentId, provider: 'imap' },
        select: {
          id: true,
          authType: true,
          encryptedToken: true,
          refreshToken: true,
          tokenExpiresAt: true,
          serviceConfig: true
        }
      })

      if (!connection?.encryptedToken || !connection.serviceConfig) {
        const error = 'IMAP connection not configured for this agent'
        console.error(`[IMAP] Error: ${error}`)
        return this.createErrorResult(context, error, nodeData)
      }

      const config = JSON.parse(connection.serviceConfig) as {
        host: string
        port: number
        user: string
        email?: string
      }

      let authCredentials: { user: string; pass?: string; accessToken?: string }

      if (connection.authType === 'oauth') {
        const accessToken = await getValidAccessToken(connection, prisma)
        authCredentials = {
          user: config.email || config.user,
          accessToken
        }
        if (this.isDev) {
          console.log(`[IMAP] Using OAuth2 for ${maskEmail(config.email || config.user)}`)
        }
      } else {
        const password = await getConnectionSecret(prisma, context.userId, connection.id, connection.encryptedToken, connection.authType)
        authCredentials = {
          user: config.user,
          pass: password
        }
      }

      const password = authCredentials.pass || ''
      const useOAuth = connection.authType === 'oauth'

      let result: ImapResult

      switch (action) {
        case 'read':
          result = await this.executeRead(nodeData, config, authCredentials)
          break
        case 'move':
          result = await this.executeMove(nodeData, config, authCredentials, context)
          break
        case 'copy':
          result = await this.executeCopy(nodeData, config, authCredentials, context)
          break
        case 'delete':
          result = await this.executeDelete(nodeData, config, authCredentials, context)
          break
        case 'markRead':
          result = await this.executeMarkRead(nodeData, config, authCredentials, context)
          break
        case 'batchMove':
          result = await this.executeBatchMove(nodeData, config, authCredentials, context)
          break
        case 'listFolders':
          result = await this.executeListFolders(config, authCredentials)
          break
        default:
          throw new Error(`Unknown action: ${action}`)
      }

      const updatedContext = {
        ...context,
        imapResult: result
      }

      if (this.isDev) {
        console.log(`[IMAP] Action '${action}' completed:`, result.success)
      }

      return this.createSuccessResult(updatedContext, {
        input: nodeData,
        output: result
      })
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown IMAP error'
      console.error(`[IMAP] Exception: ${errorMessage}`)

      const result: ImapResult = {
        success: false,
        action,
        error: errorMessage
      }

      const updatedContext = {
        ...context,
        imapResult: result
      }

      return this.createErrorResult(updatedContext, errorMessage, nodeData)
    }
  }

  private async executeRead(
    nodeData: ImapNodeData,
    config: { host: string; port: number; user: string; email?: string },
    authCredentials: { user: string; pass?: string; accessToken?: string }
  ): Promise<ImapResult> {
    const { folder: rawFolder, onlyUnseen = true, maxEmails = 10 } = nodeData
    const folder = rawFolder || 'INBOX'

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.port === 993,
      auth: authCredentials.accessToken
        ? { user: authCredentials.user, accessToken: authCredentials.accessToken }
        : { user: authCredentials.user, pass: authCredentials.pass! },
      logger: false
    })

    try {
      await client.connect()

      const { resolvedFolder } = await this.resolveFolder(client, folder)
      const lock = await client.getMailboxLock(resolvedFolder)
      const emails: ImapEmail[] = []

      try {
        const searchCriteria = onlyUnseen ? { seen: false } : { all: true }

        const uids = await client.search(searchCriteria)
        const targetUids = uids.slice(-maxEmails)

        if (this.isDev) {
          console.log(`[IMAP] Found ${uids.length} emails, fetching ${targetUids.length}`)
        }

        for (const uid of targetUids) {
          const message = await client.fetchOne(String(uid), { source: true })
          if (message?.source) {
            const parsed = await simpleParser(message.source) as ParsedMail

            emails.push({
              uid: Number(uid),
              messageId: parsed.messageId || '',
              subject: parsed.subject || '(No Subject)',
              from: this.extractEmailAddress(parsed.from),
              to: this.extractEmailAddress(parsed.to),
              date: parsed.date?.toISOString() || new Date().toISOString(),
              body: parsed.text || '',
              bodyHtml: parsed.html || undefined
            })
          }
        }
      } finally {
        lock.release()
      }

      await client.logout()

      return {
        success: true,
        action: 'read',
        emails,
        count: emails.length
      }
    } catch (error: any) {
      await closeConnection(client)
      throw error
    }
  }

  private async executeMove(
    nodeData: ImapNodeData,
    config: { host: string; port: number; user: string; email?: string },
    authCredentials: { user: string; pass?: string; accessToken?: string },
    context: WorkflowContext
  ): Promise<ImapResult> {
    const { folder: rawFolder, targetFolder, emailUid } = nodeData
    const folder = rawFolder || 'INBOX'

    if (!targetFolder || !emailUid) {
      throw new Error('Missing required fields: targetFolder, emailUid')
    }

    const resolvedUid = this.substituteVariables(emailUid, context)
    const uid = parseInt(resolvedUid, 10)

    if (isNaN(uid)) {
      throw new Error(`Invalid email UID: ${resolvedUid}`)
    }

    const cacheKey = `move:${context.agentId}:${config.host}:${authCredentials.user}`

    let client: ImapFlow | undefined

    try {
      const conn = await getOrCreateConnection(cacheKey, config, authCredentials, folder)
      client = conn.client
      const isNew = conn.isNew

      const isGmail = config.host.includes('gmail') || config.host.includes('google')

      if (isGmail) {
        const gmailFolderMap: { [key: string]: string } = {
          'spam': '[Gmail]/Spam',
          'trash': '[Gmail]/Trash',
          'drafts': '[Gmail]/Drafts',
          'sent': '[Gmail]/Sent Mail',
          'starred': '[Gmail]/Starred',
          'important': '[Gmail]/Important',
          'all': '[Gmail]/All Mail',
          'allmail': '[Gmail]/All Mail'
        }

        const gmailTargetFolder = gmailFolderMap[targetFolder.toLowerCase()] || targetFolder
        const isSystemFolder = gmailTargetFolder.startsWith('[Gmail]/')

        if (this.isDev) {
          console.log(`[IMAP/Gmail] Target folder: "${targetFolder}" → "${gmailTargetFolder}" (system: ${isSystemFolder})`)
        }

        if (isSystemFolder) {
          const actualUid = await this.resolveUid(client, uid, context, 'gmail')

          try {
            await client.messageFlagsAdd(String(actualUid), ['\\Seen'])
            if (this.isDev) {
              console.log(`[IMAP/Gmail] Marked UID ${actualUid} as read`)
            }
          } catch (seenError: any) {
            console.error(`[IMAP/Gmail] Failed to mark UID ${actualUid} as read:`, seenError.message)
          }

          let archiveFailed = false
          try {
            const moveResult = await client.messageMove(String(actualUid), gmailTargetFolder)
            if (moveResult && moveResult.uidMap && moveResult.uidMap.size > 0) {
              if (this.isDev) {
                console.log(`[IMAP/Gmail] Moved UID ${actualUid} to ${gmailTargetFolder}`)
              }
            } else {
              archiveFailed = true
              if (this.isDev) {
                console.log(`[IMAP/Gmail] Move to ${gmailTargetFolder} failed for UID ${actualUid} (move returned empty)`)
              }
            }
          } catch (moveError: any) {
            archiveFailed = true
            console.error(`[IMAP/Gmail] Failed to move UID ${actualUid} to ${gmailTargetFolder}:`, moveError.message)
          }

          if (archiveFailed) {
            return {
              success: true,
              action: 'move',
              count: 1,
              archiveFailed: true,
              failedUid: actualUid
            }
          }

          await new Promise(resolve => setTimeout(resolve, 2000))

          return {
            success: true,
            action: 'move',
            count: 1
          }
        }

        const actualUid = await this.resolveUid(client, uid, context, 'gmail')

        try {
          await client.messageFlagsAdd(String(actualUid), [gmailTargetFolder], { useLabels: true })
          if (this.isDev) {
            console.log(`[IMAP/Gmail] Added label "${gmailTargetFolder}" to UID ${actualUid}`)
          }
        } catch (labelError: any) {
          console.error(`[IMAP/Gmail] Failed to add label "${gmailTargetFolder}" to UID ${actualUid}:`, labelError.message)
        }

        try {
          await client.messageFlagsAdd(String(actualUid), ['\\Seen'])
          if (this.isDev) {
            console.log(`[IMAP/Gmail] Marked UID ${actualUid} as read`)
          }
        } catch (seenError: any) {
          console.error(`[IMAP/Gmail] Failed to mark UID ${actualUid} as read:`, seenError.message)
        }

        let archiveFailed = false
        try {
          const moveResult = await client.messageMove(String(actualUid), '[Gmail]/All Mail')

          if (moveResult && moveResult.uidMap && moveResult.uidMap.size > 0) {
            if (this.isDev) {
              console.log(`[IMAP/Gmail] Archived UID ${actualUid}`)
            }
          } else {
            archiveFailed = true
            if (this.isDev) {
              console.log(`[IMAP/Gmail] Archive failed for UID ${actualUid} (move returned empty)`)
            }
          }
        } catch (archiveError: any) {
          archiveFailed = true
          console.error(`[IMAP/Gmail] Failed to archive UID ${actualUid}:`, archiveError.message)
        }

        if (archiveFailed) {
          return {
            success: true,
            action: 'move',
            count: 1,
            archiveFailed: true,
            failedUid: actualUid
          }
        }

        await new Promise(resolve => setTimeout(resolve, 2000))
      } else {
        let moveFailed = false

        const { resolvedFolder, found, availableFolders } = await this.resolveFolder(client, targetFolder)
        if (!found) {
          console.error(`[IMAP] Folder not found: "${targetFolder}". Available: ${availableFolders}`)
          return {
            success: false,
            action: 'move',
            error: `Folder "${targetFolder}" not found. Available folders: ${availableFolders}`,
            folderNotFound: true
          }
        }

        const provider = this.getProvider(config.host)
        const actualUid = await this.resolveUid(client, uid, context, provider)

        try {
          const moveResult = await client.messageMove(String(actualUid), resolvedFolder)

          if (moveResult && moveResult.uidMap && moveResult.uidMap.size > 0) {
            if (this.isDev) {
              console.log(`[IMAP] Moved UID ${actualUid} to ${resolvedFolder} (uidMap.size=${moveResult.uidMap.size})`)
            }

            await new Promise(resolve => setTimeout(resolve, 300))

            try {
              const remainingUids = await client.search({ uid: String(actualUid) })
              if (remainingUids.includes(actualUid)) {
                moveFailed = true
                console.log(`[IMAP] Move verification failed: UID ${actualUid} still exists in ${folder}`)
              } else {
                if (this.isDev) {
                  console.log(`[IMAP] Move verified: UID ${actualUid} removed from ${folder}`)
                }
              }
            } catch (verifyError: any) {
              if (this.isDev) {
                console.log(`[IMAP] Move verification skipped: ${verifyError.message}`)
              }
            }

            await new Promise(resolve => setTimeout(resolve, 2000))

            //
            const cachedForRefresh = connectionCache.get(cacheKey)
            if (cachedForRefresh && cachedForRefresh.client === client && cachedForRefresh.lock) {
              const refreshed = await refreshCachedLock(cachedForRefresh, folder)
              if (this.isDev) {
                console.log(refreshed.ok
                  ? `[IMAP] Mailbox refreshed for UID sync`
                  : `[IMAP] Mailbox refresh skipped: ${(refreshed.error as any)?.message}`)
              }
            }
          } else {
            moveFailed = true
            if (this.isDev) {
              console.log(`[IMAP] Move failed for UID ${actualUid} (empty result)`)
            }
          }
        } catch (moveError: any) {
          moveFailed = true
          console.error(`[IMAP] Failed to move UID ${actualUid} to ${resolvedFolder}:`, moveError.message)
        }

        if (moveFailed) {
          return {
            success: true,
            action: 'move',
            count: 1,
            archiveFailed: true,
            failedUid: actualUid
          }
        }
      }

      return {
        success: true,
        action: 'move',
        count: 1
      }
    } catch (error: any) {
      discardCachedConnection(cacheKey, client)
      throw error
    }
  }

  private async executeCopy(
    nodeData: ImapNodeData,
    config: { host: string; port: number; user: string; email?: string },
    authCredentials: { user: string; pass?: string; accessToken?: string },
    context: WorkflowContext
  ): Promise<ImapResult> {
    const { folder: rawFolder, targetFolder, emailUid } = nodeData
    const folder = rawFolder || 'INBOX'

    if (!targetFolder || !emailUid) {
      throw new Error('Missing required fields: targetFolder, emailUid')
    }

    const resolvedUidStr = this.substituteVariables(emailUid, context)
    const uid = parseInt(resolvedUidStr, 10)

    if (isNaN(uid)) {
      throw new Error(`Invalid email UID: ${resolvedUidStr}`)
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.port === 993,
      auth: authCredentials.accessToken
        ? { user: authCredentials.user, accessToken: authCredentials.accessToken }
        : { user: authCredentials.user, pass: authCredentials.pass! },
      logger: false
    })

    try {
      await client.connect()

      const { resolvedFolder: resolvedSourceFolder } = await this.resolveFolder(client, folder)
      const { resolvedFolder: resolvedTargetFolder, found, availableFolders } = await this.resolveFolder(client, targetFolder)

      if (!found) {
        await client.logout()
        return {
          success: false,
          action: 'copy',
          error: `Target folder "${targetFolder}" not found. Available folders: ${availableFolders}`,
          folderNotFound: true
        }
      }

      const lock = await client.getMailboxLock(resolvedSourceFolder)
      const provider = this.getProvider(config.host)

      try {
        const actualUid = await this.resolveUid(client, uid, context, provider)

        await client.messageCopy(String(actualUid), resolvedTargetFolder)

        if (this.isDev) {
          console.log(`[IMAP] Copied email UID ${actualUid} to ${resolvedTargetFolder}`)
        }
      } finally {
        lock.release()
      }

      await client.logout()

      return {
        success: true,
        action: 'copy',
        count: 1
      }
    } catch (error: any) {
      await closeConnection(client)
      throw error
    }
  }

  private async executeDelete(
    nodeData: ImapNodeData,
    config: { host: string; port: number; user: string; email?: string },
    authCredentials: { user: string; pass?: string; accessToken?: string },
    context: WorkflowContext
  ): Promise<ImapResult> {
    const { folder: rawFolder, uidToDelete } = nodeData
    const folder = rawFolder || 'INBOX'

    if (!uidToDelete) {
      throw new Error('Missing required field: uidToDelete')
    }

    const resolvedUidStr = this.substituteVariables(uidToDelete, context)
    const uid = parseInt(resolvedUidStr, 10)

    if (isNaN(uid)) {
      throw new Error(`Invalid email UID: ${resolvedUidStr}`)
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.port === 993,
      auth: authCredentials.accessToken
        ? { user: authCredentials.user, accessToken: authCredentials.accessToken }
        : { user: authCredentials.user, pass: authCredentials.pass! },
      logger: false
    })

    try {
      await client.connect()

      const { resolvedFolder } = await this.resolveFolder(client, folder)
      const lock = await client.getMailboxLock(resolvedFolder)

      try {
        const provider = this.getProvider(config.host)
        const actualUid = await this.resolveUid(client, uid, context, provider)

        await client.messageFlagsAdd(String(actualUid), ['\\Deleted'])
        await client.messageDelete(String(actualUid))

        if (this.isDev) {
          console.log(`[IMAP] Deleted email UID ${actualUid} from ${resolvedFolder}`)
        }
      } finally {
        lock.release()
      }

      await client.logout()

      return {
        success: true,
        action: 'delete',
        count: 1
      }
    } catch (error: any) {
      await closeConnection(client)
      throw error
    }
  }

  private async executeMarkRead(
    nodeData: ImapNodeData,
    config: { host: string; port: number; user: string; email?: string },
    authCredentials: { user: string; pass?: string; accessToken?: string },
    context: WorkflowContext
  ): Promise<ImapResult> {
    const { folder: rawFolder, uidToMark, emailUid } = nodeData
    const folder = rawFolder || 'INBOX'

    const uidField = emailUid || uidToMark
    if (!uidField) {
      throw new Error('Missing required field: emailUid or uidToMark')
    }

    const resolvedUidStr = this.substituteVariables(uidField, context)
    const uid = parseInt(resolvedUidStr, 10)

    if (isNaN(uid)) {
      throw new Error(`Invalid email UID: ${resolvedUidStr}`)
    }

    const cacheKey = `markRead:${context.agentId}:${config.host}:${authCredentials.user}`

    let client: ImapFlow | undefined

    try {
      client = (await getOrCreateConnection(cacheKey, config, authCredentials, folder)).client

      const { resolvedFolder } = await this.resolveFolder(client, folder)

      const cached = connectionCache.get(cacheKey)
      if (cached && cached.folder !== resolvedFolder) {
        if (cached.lock) {
          cached.lock.release()
        }
        const newLock = await client.getMailboxLock(resolvedFolder)
        cached.lock = newLock
        cached.folder = resolvedFolder
      }

      const provider = this.getProvider(config.host)
      const actualUid = await this.resolveUid(client, uid, context, provider)

      await client.messageFlagsAdd(String(actualUid), ['\\Seen'])

      if (this.isDev) {
        console.log(`[IMAP] Marked email UID ${actualUid} as read in ${resolvedFolder}`)
      }

      return {
        success: true,
        action: 'markRead',
        count: 1
      }
    } catch (error: any) {
      discardCachedConnection(cacheKey, client)
      throw error
    }
  }

  private async executeBatchMove(
    nodeData: ImapNodeData,
    config: { host: string; port: number; user: string; email?: string },
    authCredentials: { user: string; pass?: string; accessToken?: string },
    context: WorkflowContext
  ): Promise<ImapResult> {
    const { folder: rawFolder, batchSource, folderMapping } = nodeData
    const folder = rawFolder || 'INBOX'

    if (!batchSource) {
      throw new Error('Missing required field: batchSource')
    }

    if (!folderMapping || Object.keys(folderMapping).length === 0) {
      throw new Error('Missing required field: folderMapping')
    }

    const classifications = this.getValueFromPath(context, batchSource)

    if (!Array.isArray(classifications) || classifications.length === 0) {
      if (this.isDev) {
        console.log(`[IMAP/BatchMove] No classifications found at ${batchSource}`)
      }
      return {
        success: true,
        action: 'batchMove',
        count: 0,
        batchResults: []
      }
    }

    if (this.isDev) {
      console.log(`[IMAP/BatchMove] Processing ${classifications.length} emails`)
      console.log(`[IMAP/BatchMove] Folder mapping:`, folderMapping)
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.port === 993,
      auth: authCredentials.accessToken
        ? { user: authCredentials.user, accessToken: authCredentials.accessToken }
        : { user: authCredentials.user, pass: authCredentials.pass! },
      logger: false
    })

    const batchResults: ImapResult['batchResults'] = []
    const isGmail = config.host.includes('gmail') || config.host.includes('google')

    try {
      await client.connect()
      const lock = await client.getMailboxLock(folder)

      try {
        for (const item of classifications) {
          const uid = typeof item.uid === 'string' ? parseInt(item.uid, 10) : item.uid
          const category = item.category?.toLowerCase() || 'general'
          const targetFolder = folderMapping[category] || folderMapping['default'] || 'General'

          if (isNaN(uid)) {
            batchResults.push({
              uid: item.uid,
              category,
              folder: targetFolder,
              success: false,
              error: 'Invalid UID'
            })
            continue
          }

          try {
            if (isGmail) {
              await client.messageFlagsAdd(String(uid), [targetFolder], { useLabels: true })
              await client.messageFlagsAdd(String(uid), ['\\Seen'])
              await client.messageFlagsAdd(String(uid), ['\\Deleted'])
              await client.messageDelete(String(uid))

              if (this.isDev) {
                console.log(`[IMAP/BatchMove/Gmail] UID ${uid} → ${targetFolder} (${category})`)
              }
            } else {
              await client.messageCopy(String(uid), targetFolder)
              await client.messageFlagsAdd(String(uid), ['\\Seen'])
              await client.messageFlagsAdd(String(uid), ['\\Deleted'])
              await client.messageDelete(String(uid))

              if (this.isDev) {
                console.log(`[IMAP/BatchMove] UID ${uid} → ${targetFolder} (${category})`)
              }
            }

            batchResults.push({
              uid,
              category,
              folder: targetFolder,
              success: true
            })
          } catch (itemError: any) {
            console.error(`[IMAP/BatchMove] Failed UID ${uid}:`, itemError.message)
            batchResults.push({
              uid,
              category,
              folder: targetFolder,
              success: false,
              error: itemError.message
            })
          }
        }
      } finally {
        lock.release()
      }

      await client.logout()

      const successCount = batchResults.filter(r => r.success).length
      if (this.isDev) {
        console.log(`[IMAP/BatchMove] Completed: ${successCount}/${batchResults.length} successful`)
      }

      return {
        success: true,
        action: 'batchMove',
        count: successCount,
        batchResults
      }
    } catch (error: any) {
      await closeConnection(client)
      throw error
    }
  }

  private async executeListFolders(
    config: { host: string; port: number; user: string; email?: string },
    authCredentials: { user: string; pass?: string; accessToken?: string }
  ): Promise<ImapResult> {
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.port === 993,
      auth: authCredentials.accessToken
        ? { user: authCredentials.user, accessToken: authCredentials.accessToken }
        : { user: authCredentials.user, pass: authCredentials.pass! },
      logger: false
    })

    try {
      await client.connect()

      const mailboxes = await client.list()

      const folders: ImapFolder[] = mailboxes.map((mb: any) => ({
        path: mb.path,
        name: mb.name || mb.path.split(mb.delimiter || '/').pop() || mb.path,
        delimiter: mb.delimiter || '/',
        flags: Array.from(mb.flags || []),
        specialUse: mb.specialUse || undefined
      }))

      if (this.isDev) {
        console.log(`[IMAP] Found ${folders.length} folders:`)
        folders.forEach(f => {
          console.log(`  - ${f.path}${f.specialUse ? ` (${f.specialUse})` : ''}`)
        })
      }

      await client.logout()

      return {
        success: true,
        action: 'listFolders',
        folders,
        count: folders.length
      }
    } catch (error: any) {
      await closeConnection(client)
      throw error
    }
  }

  private async resolveFolder(
    client: ImapFlow,
    targetFolder: string
  ): Promise<{ resolvedFolder: string; found: boolean; availableFolders?: string }> {
    try {
      const mailboxes = await client.list()
      const targetLower = targetFolder.toLowerCase()

      const specialUseMap: { [key: string]: string } = {
        'spam': '\\Junk',
        'junk': '\\Junk',
        'trash': '\\Trash',
        'sent': '\\Sent',
        'drafts': '\\Drafts',
        'archive': '\\Archive',
        'inbox': '\\Inbox'
      }

      const localizedFolderMap: { [key: string]: string[] } = {
        'spam': [
          '스팸편지함', '스팸메일', '스팸메일함',
          'spam', 'junk-e-mail',
          'spams', 'indésirables', 'courrier indésirable',
          'correo no deseado', 'correo basura',
          'posta indesiderata',
          'lixo eletrônico'
        ],
        'junk': [
          '스팸편지함', '스팸메일', '스팸메일함',
          'spam', 'junk-e-mail',
          'spams', 'indésirables', 'courrier indésirable',
          'correo no deseado', 'correo basura',
          'posta indesiderata',
          'lixo eletrônico'
        ],
        'trash': [
          '휴지통', '삭제편지함', 'deleted messages',
          'papierkorb', 'gelöscht', 'gelöschte elemente',
          'corbeille', 'éléments supprimés',
          'papelera', 'elementos eliminados',
          'cestino', 'posta eliminata',
          'lixeira', 'itens excluídos'
        ],
        'sent': [
          '보낸편지함', '보낸메일함', 'sent messages', 'sent items',
          'gesendet', 'gesendete elemente', 'gesendete objekte',
          'envoyés', 'éléments envoyés', 'messages envoyés',
          'enviados', 'elementos enviados',
          'posta inviata', 'inviati',
          'enviados', 'itens enviados'
        ],
        'drafts': [
          '임시보관함', '임시저장',
          'entwürfe',
          'brouillons',
          'borradores',
          'bozze',
          'rascunhos'
        ],
        'inbox': [
          '받은편지함', '받은메일함',
          'posteingang',
          'boîte de réception', 'boite de reception',
          'bandeja de entrada',
          'posta in arrivo',
          'caixa de entrada'
        ],
        'archive': [
          '보관함',
          'archiv',
          'archives',
          'archivo',
          'archivio',
          'arquivados'
        ]
      }

      let matched = mailboxes.find((mb: any) => mb.path.toLowerCase() === targetLower)

      if (!matched && specialUseMap[targetLower]) {
        matched = mailboxes.find((mb: any) => mb.specialUse === specialUseMap[targetLower])
      }

      if (!matched && localizedFolderMap[targetLower]) {
        const localizedNames = localizedFolderMap[targetLower]
        matched = mailboxes.find((mb: any) => {
          const pathLower = mb.path.toLowerCase()
          const nameLower = (mb.name || '').toLowerCase()
          return localizedNames.some(name =>
            pathLower === name.toLowerCase() ||
            nameLower === name.toLowerCase() ||
            pathLower.includes(name.toLowerCase())
          )
        })
      }

      if (!matched) {
        matched = mailboxes.find((mb: any) => {
          const pathLower = mb.path.toLowerCase()
          const nameLower = (mb.name || '').toLowerCase()
          return pathLower.includes(targetLower) || nameLower.includes(targetLower)
        })
      }

      if (matched) {
        if (this.isDev && matched.path !== targetFolder) {
          console.log(`[IMAP] Folder auto-mapped: "${targetFolder}" → "${matched.path}"`)
        }
        return { resolvedFolder: matched.path, found: true }
      } else {
        const availableFolders = mailboxes.map((mb: any) => mb.path).join(', ')
        if (this.isDev) {
          console.log(`[IMAP] Folder not found: "${targetFolder}". Available: ${availableFolders}`)
        }
        return { resolvedFolder: targetFolder, found: false, availableFolders }
      }
    } catch (listError: any) {
      if (this.isDev) {
        console.log(`[IMAP] Folder list failed: ${listError.message}`)
      }
      return { resolvedFolder: targetFolder, found: true }
    }
  }

  private getProvider(host: string): 'gmail' | 'outlook' | 'standard' {
    if (host.includes('gmail') || host.includes('google')) {
      return 'gmail'
    }
    if (host.includes('outlook') || host.includes('office365') || host.includes('hotmail') || host.includes('live.com')) {
      return 'outlook'
    }
    return 'standard'
  }

  private async resolveUid(
    client: ImapFlow,
    uid: number,
    context: WorkflowContext,
    provider: 'gmail' | 'outlook' | 'standard' = 'standard'
  ): Promise<number> {
    const currentEmail = (context as any).currentEmail

    if (provider === 'outlook') {
      return uid
    }

    try {
      await client.noop()
    } catch (e) {
    }

    if (currentEmail?.messageId) {
      try {
        let foundUids: number[] = []

        if (provider === 'gmail') {
          foundUids = await client.search({ gmraw: `rfc822msgid:${currentEmail.messageId}` }) as number[]
        } else {
          foundUids = await client.search({ header: { 'Message-ID': currentEmail.messageId } }) as number[]
        }

        if (foundUids.length > 0) {
          const actualUid = foundUids[0] as number
          return actualUid
        }
      } catch (searchError: any) {
      }
    }

    return uid
  }

  private extractEmailAddress(addressField: any): string {
    if (!addressField) return ''
    if (typeof addressField === 'string') return addressField
    if (addressField.text) return addressField.text
    if (addressField.value && Array.isArray(addressField.value)) {
      return addressField.value.map((a: any) => a.address || a.name || '').join(', ')
    }
    return ''
  }

  private substituteVariables(template: string, context: WorkflowContext): string {
    if (!template) return ''

    let result = template

    result = result.replace(/\{\{context\.([^}]+)\}\}/g, (match, path) => {
      if (!canReadTemplatePath(context, path)) return ''
      const value = this.getValueFromPath(context, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    result = result.replace(/\{\{imapResult\.([^}]+)\}\}/g, (match, path) => {
      const imapResult = (context as any).imapResult
      if (!imapResult) return ''
      const value = this.getValueFromPath(imapResult, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    return result
  }

  private getValueFromPath(obj: any, path: string): any {
    if (!obj || !path) return undefined

    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined

      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/)
      if (arrayMatch) {
        const [, arrayName, indexStr] = arrayMatch
        const index = parseInt(indexStr, 10)
        current = current[arrayName]
        if (!Array.isArray(current)) return undefined
        current = current[index]
      } else {
        current = current[part]
      }
    }

    return current
  }
}
