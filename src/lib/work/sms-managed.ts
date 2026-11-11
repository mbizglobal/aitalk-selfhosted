import type { PrismaClient } from '@prisma/client'
import { decryptData } from '@/lib/encryption'
import { isValidSenderId, normalizeInfobipBaseUrl } from '@/lib/call/sms/types'

export const SMS_MANAGED_REGION = 'switzerlandnorth'

export interface ManagedInfobip { apiKey: string; baseUrl: string; sender: string }

export async function getManagedInfobip(db: Pick<PrismaClient, 'managedRegionConfig'>): Promise<ManagedInfobip | null> {
  const c = await db.managedRegionConfig.findUnique({ where: { regionId: SMS_MANAGED_REGION }, select: { enabled: true, infobipApiKey: true, infobipBaseUrl: true, infobipSender: true } })
  if (!c || !c.enabled || !c.infobipApiKey || !c.infobipSender) return null
  const baseUrl = normalizeInfobipBaseUrl(c.infobipBaseUrl)
  if (!baseUrl || !isValidSenderId(c.infobipSender)) {
    console.error('[work-sms] 관리형 Infobip 설정이 틀림 — 주소 또는 발신자(보내지 않음)')
    return null
  }
  try {
    return { apiKey: await decryptData(c.infobipApiKey), baseUrl, sender: c.infobipSender }
  } catch {
    console.error('[work-sms] 관리형 Infobip 키를 풀지 못함')
    return null
  }
}
