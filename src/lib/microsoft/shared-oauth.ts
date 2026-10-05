
import { PrismaClient } from '@prisma/client'
import { decryptData } from '@/lib/encryption'

const SHARED_MS_PROVIDER = 'microsoft_workspace'

export interface SharedOauthCredentials {
  clientId: string
  clientSecret: string
}

export async function getSharedMicrosoftApp(
  prisma: PrismaClient
): Promise<SharedOauthCredentials | null> {
  const row = await prisma.sharedOauthApp.findFirst({
    where: { provider: SHARED_MS_PROVIDER, enabled: true },
    select: { clientId: true, clientSecret: true },
  })
  if (!row) return null
  return {
    clientId: await decryptData(row.clientId),
    clientSecret: await decryptData(row.clientSecret),
  }
}
