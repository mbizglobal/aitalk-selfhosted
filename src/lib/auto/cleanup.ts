import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { cloudJobs } from './cloud-jobs'
import { executeAnonymization } from '../execute-anonymization'
import { enabledJobs } from '@/lib/edition-features'

export class AutoRun {
  private static instance: AutoRun
  private cleanupInterval: NodeJS.Timeout | null = null
  private cpaLogInterval: NodeJS.Timeout | null = null
  private callSessionCleanupInterval: NodeJS.Timeout | null = null
  private readonly tempDir: string
  private readonly maxAge = 1 * 60 * 60 * 1000
  private consentExportInterval: NodeJS.Timeout | null = null
  private workSendInterval: NodeJS.Timeout | null = null
  private workTelegramBusy = false
  private workSignalInterval: NodeJS.Timeout | null = null
  private workAlertInterval: NodeJS.Timeout | null = null
  private jobs: ReadonlySet<string> = new Set()

  private constructor() {
    this.tempDir = path.join(process.cwd(), 'tmp')
  }


  static getInstance(): AutoRun {
    if (!AutoRun.instance) {
      AutoRun.instance = new AutoRun()
    }
    return AutoRun.instance
  }

  startCleanup() {
    if (this.cleanupInterval || this.cpaLogInterval || this.callSessionCleanupInterval) {
      return
    }
    if (process.env.AITALK_BACKGROUND_JOBS === 'off') return
    this.jobs = enabledJobs()


    this.run('cleanupStaleCallSessions', () => this.cleanupStaleCallSessions())
    this.run('cleanupStaleWebVoiceSessions', () => this.cleanupStaleWebVoiceSessions())
    this.run('sweepAiCallCpaReservations', () => this.sweepAiCallCpaReservations())
    this.run('sweepTeamSeats', () => this.sweepTeamSeats())
    this.run('sweepVoiceQuizRounds', () => this.sweepVoiceQuizRounds())
    this.run('retryStoreAcknowledgements', () => this.retryStoreAcknowledgements())
    this.run('retryOldContractCuts', () => this.retryOldContractCuts())
    const tenMinuteJobs = ['cleanupStaleCallSessions', 'cleanupStaleWebVoiceSessions', 'sweepAiCallCpaReservations', 'sweepTeamSeats', 'sweepVoiceQuizRounds', 'retryStoreAcknowledgements', 'retryOldContractCuts']
    if (tenMinuteJobs.some((job) => this.jobs.has(job))) this.callSessionCleanupInterval = setInterval(
      () => {
        this.run('cleanupStaleCallSessions', () => this.cleanupStaleCallSessions())
        this.run('cleanupStaleWebVoiceSessions', () => this.cleanupStaleWebVoiceSessions())
        this.run('sweepAiCallCpaReservations', () => this.sweepAiCallCpaReservations())
        this.run('sweepTeamSeats', () => this.sweepTeamSeats())
        this.run('sweepVoiceQuizRounds', () => this.sweepVoiceQuizRounds())
        this.run('retryStoreAcknowledgements', () => this.retryStoreAcknowledgements())
        this.run('retryOldContractCuts', () => this.retryOldContractCuts())
      },
      10 * 60 * 1000,
    )

    this.run('markStaleWorkSends', () => this.markStaleWorkSends())
    if (this.jobs.has('markStaleWorkSends')) this.workSendInterval = setInterval(
      () => { this.run('markStaleWorkSends', () => this.markStaleWorkSends()) },
      60 * 1000,
    )

    this.run('processWorkSignals', () => this.processWorkSignals())
    if (this.jobs.has('processWorkSignals')) this.workSignalInterval = setInterval(
      () => { this.run('processWorkSignals', () => this.processWorkSignals()) },
      30 * 1000,
    )

    this.run('processWorkAlerts', () => this.processWorkAlerts())
    if (this.jobs.has('processWorkAlerts')) this.workAlertInterval = setInterval(
      () => { this.run('processWorkAlerts', () => this.processWorkAlerts()) },
      60 * 60 * 1000,
    )

    if (this.jobs.has('processConsentLedgerExport')) this.consentExportInterval = setInterval(
      () => { this.run('processConsentLedgerExport', () => this.processConsentLedgerExport()) },
      6 * 60 * 60 * 1000,
    )

    this.run('cleanupOldTempFiles', () => this.cleanupOldTempFiles())

    setTimeout(() => {
      this.run('cleanupOldCPALogs', () => this.cleanupOldCPALogs())

      setTimeout(() => {
        this.run('monthlyResetCPA', () => this.monthlyResetCPA())

        setTimeout(() => {
          this.run('processScheduledAnonymizations', () => this.processScheduledAnonymizations())

          setTimeout(() => {
            this.run('cleanupOldConversations', () => this.cleanupOldConversations())
            this.run('cleanupExpiredVisitorContacts', () => this.cleanupExpiredVisitorContacts())
            this.run('cleanupExpiredMiniAppPayloads', () => this.cleanupExpiredMiniAppPayloads())
            this.run('cleanupExpiredPublicLinks', () => this.cleanupExpiredPublicLinks())
            this.run('purgeWorkPrivateMessages', () => this.purgeWorkPrivateMessages())
            this.run('purgeSupportReports', () => this.purgeSupportReports())
            this.run('reportQuizCpaShortfall', () => this.reportQuizCpaShortfall())

            setTimeout(() => {
              this.run('cleanupOldTempStorage', () => this.cleanupOldTempStorage())

              setTimeout(() => {
                this.run('processInvoicePlanChanges', () => this.processInvoicePlanChanges())

                setTimeout(() => {
                  this.run('processCancelledInvoiceSubscriptions', () => this.processCancelledInvoiceSubscriptions())

                  setTimeout(() => {
                    this.run('processInvoiceAutoRenewal', () => this.processInvoiceAutoRenewal())

                    setTimeout(() => {
                      this.run('processManagedCpaReset', () => this.processManagedCpaReset())

                      setTimeout(() => {
                        this.run('processExpiredSubscriptionGraceStart', () => this.processExpiredSubscriptionGraceStart())
                        this.run('reconcileStoreSubscriptions', () => this.reconcileStoreSubscriptions())

                        setTimeout(() => {
                          this.run('processGracePeriodExpiration', () => this.processGracePeriodExpiration())

                          setTimeout(() => {
                            this.run('processHardFreeConversion', () => this.processHardFreeConversion())

                            setTimeout(() => {
                              this.run('processBoosterExpiry', () => this.processBoosterExpiry())

                              setTimeout(() => {
                                this.run('processBoosterExpiryAlerts', () => this.processBoosterExpiryAlerts())
                                this.run('processTrialExpiry', () => this.processTrialExpiry())
                              }, 1 * 60 * 60 * 1000)
                            }, 1 * 60 * 60 * 1000)
                          }, 1 * 60 * 60 * 1000)
                        }, 1 * 60 * 60 * 1000)
                      }, 1 * 60 * 60 * 1000)
                    }, 1 * 60 * 60 * 1000)
                  }, 1 * 60 * 60 * 1000)
                }, 1 * 60 * 60 * 1000)
              }, 1 * 60 * 60 * 1000)
            }, 1 * 60 * 60 * 1000)
          }, 1 * 60 * 60 * 1000)
        }, 1 * 60 * 60 * 1000)
      }, 1 * 60 * 60 * 1000)
    }, 1 * 60 * 60 * 1000)

    this.cleanupInterval = setInterval(() => {
      this.run('cleanupOldTempFiles', () => this.cleanupOldTempFiles())

      setTimeout(() => {
        this.run('cleanupOldCPALogs', () => this.cleanupOldCPALogs())

        setTimeout(() => {
          this.run('monthlyResetCPA', () => this.monthlyResetCPA())

          setTimeout(() => {
            this.run('processScheduledAnonymizations', () => this.processScheduledAnonymizations())

            setTimeout(() => {
              this.run('cleanupOldConversations', () => this.cleanupOldConversations())
              this.run('cleanupExpiredVisitorContacts', () => this.cleanupExpiredVisitorContacts())
              this.run('cleanupExpiredMiniAppPayloads', () => this.cleanupExpiredMiniAppPayloads())
              this.run('cleanupExpiredPublicLinks', () => this.cleanupExpiredPublicLinks())
              this.run('purgeWorkPrivateMessages', () => this.purgeWorkPrivateMessages())
              this.run('purgeSupportReports', () => this.purgeSupportReports())
              this.run('reportQuizCpaShortfall', () => this.reportQuizCpaShortfall())

              setTimeout(() => {
                this.run('cleanupOldTempStorage', () => this.cleanupOldTempStorage())

                setTimeout(() => {
                  this.run('processInvoicePlanChanges', () => this.processInvoicePlanChanges())

                  setTimeout(() => {
                    this.run('processCancelledInvoiceSubscriptions', () => this.processCancelledInvoiceSubscriptions())

                    setTimeout(() => {
                      this.run('processInvoiceAutoRenewal', () => this.processInvoiceAutoRenewal())

                      setTimeout(() => {
                        this.run('processManagedCpaReset', () => this.processManagedCpaReset())

                        setTimeout(() => {
                          this.run('processExpiredSubscriptionGraceStart', () => this.processExpiredSubscriptionGraceStart())
                        this.run('reconcileStoreSubscriptions', () => this.reconcileStoreSubscriptions())

                          setTimeout(() => {
                            this.run('processGracePeriodExpiration', () => this.processGracePeriodExpiration())

                            setTimeout(() => {
                              this.run('processHardFreeConversion', () => this.processHardFreeConversion())

                              setTimeout(() => {
                                this.run('processBoosterExpiry', () => this.processBoosterExpiry())

                                setTimeout(() => {
                                  this.run('processBoosterExpiryAlerts', () => this.processBoosterExpiryAlerts())
                                  this.run('processTrialExpiry', () => this.processTrialExpiry())
                                }, 1 * 60 * 60 * 1000)
                              }, 1 * 60 * 60 * 1000)
                            }, 1 * 60 * 60 * 1000)
                          }, 1 * 60 * 60 * 1000)
                        }, 1 * 60 * 60 * 1000)
                      }, 1 * 60 * 60 * 1000)
                    }, 1 * 60 * 60 * 1000)
                  }, 1 * 60 * 60 * 1000)
                }, 1 * 60 * 60 * 1000)
              }, 1 * 60 * 60 * 1000)
            }, 1 * 60 * 60 * 1000)
          }, 1 * 60 * 60 * 1000)
        }, 1 * 60 * 60 * 1000)
      }, 1 * 60 * 60 * 1000)
    }, 12 * 60 * 60 * 1000)
  }

  private run(job: string, fn: () => unknown): void {
    if (this.jobs.has(job)) fn()
  }

  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    if (this.cpaLogInterval) {
      clearInterval(this.cpaLogInterval)
      this.cpaLogInterval = null
    }
    if (this.callSessionCleanupInterval) {
      clearInterval(this.callSessionCleanupInterval)
      this.callSessionCleanupInterval = null
    }
    if (this.consentExportInterval) {
      clearInterval(this.consentExportInterval)
      this.consentExportInterval = null
    }
    if (this.workSendInterval) {
      clearInterval(this.workSendInterval)
      this.workSendInterval = null
    }
    if (this.workSignalInterval) {
      clearInterval(this.workSignalInterval)
      this.workSignalInterval = null
    }
    if (this.workAlertInterval) {
      clearInterval(this.workAlertInterval)
      this.workAlertInterval = null
    }
  }

  async cleanupStaleCallSessions(): Promise<void> { return cloudJobs.cleanupStaleCallSessions() }

  async cleanupStaleWebVoiceSessions(): Promise<void> { return cloudJobs.cleanupStaleWebVoiceSessions() }

  async sweepTeamSeats(): Promise<void> { return cloudJobs.sweepTeamSeats() }

  async sweepVoiceQuizRounds(): Promise<void> { return cloudJobs.sweepVoiceQuizRounds() }

  async sweepAiCallCpaReservations(): Promise<void> { return cloudJobs.sweepAiCallCpaReservations() }

  async cleanupOldTempFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir)
      const tempFiles = files.filter(file => file !== '.DS_Store')

      let deletedCount = 0
      let totalSize = 0

      for (const file of tempFiles) {
        try {
          const filePath = path.join(this.tempDir, file)
          const stats = await fs.stat(filePath)
          if (stats.isDirectory()) {
            continue
          }
          const ageMs = Date.now() - stats.mtime.getTime()

          if (ageMs > this.maxAge) {
            await fs.unlink(filePath)
            deletedCount++
            totalSize += stats.size
          }
        } catch (error) {
          console.warn(`[CLEANUP] Failed to process file ${file}:`, error)
        }
      }

      console.log(`[CLEANUP] tmp scanned=${tempFiles.length}, deleted=${deletedCount}, freed=${(totalSize / 1024).toFixed(1)}KB`)
    } catch (error) {
      console.error('[CLEANUP] Failed to cleanup temp files:', error)
    }
  }

  async forceCleanupPattern(pattern: string): Promise<number> {
    try {
      const files = await fs.readdir(this.tempDir)
      const matchingFiles = files.filter(file => file.includes(pattern))
      
      let deletedCount = 0
      for (const file of matchingFiles) {
        try {
          const filePath = path.join(this.tempDir, file)
          await fs.unlink(filePath)
          deletedCount++
        } catch (error) {
          console.warn(`[CLEANUP] Failed to force delete ${file}:`, error)
        }
      }

      return deletedCount
    } catch (error) {
      console.error('[CLEANUP] Force cleanup failed:', error)
      return 0
    }
  }

  async getTempDirStats(): Promise<{
    totalFiles: number
    tempFiles: number
    totalSize: number
    oldFiles: number
  }> {
    try {
      const files = await fs.readdir(this.tempDir)
      const tempFiles = files.filter(file => file !== '.DS_Store')

      let totalSize = 0
      let oldFiles = 0

      for (const file of tempFiles) {
        try {
          const filePath = path.join(this.tempDir, file)
          const stats = await fs.stat(filePath)
          totalSize += stats.size
          
          const ageMs = Date.now() - stats.mtime.getTime()
          if (ageMs > this.maxAge) {
            oldFiles++
          }
        } catch (error) {
        }
      }

      return {
        totalFiles: files.length,
        tempFiles: tempFiles.length,
        totalSize,
        oldFiles
      }
    } catch (error) {
      console.error('[CLEANUP] Failed to get temp dir stats:', error)
      return { totalFiles: 0, tempFiles: 0, totalSize: 0, oldFiles: 0 }
    }
  }

  async cleanupOldCPALogs(): Promise<void> { return cloudJobs.cleanupOldCPALogs() }

  async monthlyResetCPA(): Promise<void> { return cloudJobs.monthlyResetCPA() }

  async processScheduledAnonymizations(): Promise<void> {
    try {
      const now = new Date()

      const pendingRequests = await prisma.anonymizationRequest.findMany({
        where: {
          status: 'scheduled',
          scheduledAt: { lte: now },
          user: { isAnonymized: false }
        },
        include: {
          user: {
            select: {
              email: true,
              settings: {
                select: {
                  locale: true
                }
              }
            }
          }
        }
      })

      if (pendingRequests.length === 0) {
        return
      }

      let successCount = 0
      let failCount = 0

      for (const request of pendingRequests) {
        try {
          await executeAnonymization(request.userId, request.id)
          successCount++
        } catch (error) {
          console.error(`[CLEANUP] Failed to anonymize user ${request.userId} — scheduled 로 유지, 다음 주기에 재시도:`, error)
          failCount++
        }
      }

      if (successCount > 0 || failCount > 0) {
        console.log(`[CLEANUP] Anonymization processing completed: ${successCount} succeeded, ${failCount} failed (will retry next cycle)`)
      }

    } catch (error) {
      console.error('[CLEANUP] Failed to process scheduled anonymizations:', error)
    }
  }

  async processInvoicePlanChanges(): Promise<void> { return cloudJobs.processInvoicePlanChanges() }

  async processCancelledInvoiceSubscriptions(): Promise<void> { return cloudJobs.processCancelledInvoiceSubscriptions() }

  async cleanupOldTempStorage(): Promise<void> {
    try {
      const now = new Date()

      const pendingCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      const staleCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

      const [pendingResult, staleResult] = await prisma.$transaction([
        prisma.workflowTempStorage.deleteMany({
          where: {
            status: 'pending',
            updatedAt: { lt: pendingCutoff }
          }
        }),

        //
        //
        // (`api/chat/route.ts`·`bots/common/workflow-runner.ts`·`api/telegram/webhook/[workflowId]`).
        //
        prisma.workflowTempStorage.deleteMany({
          where: {
            status: { in: ['waiting', 'confirmed', 'cancelled'] },
            updatedAt: { lt: staleCutoff }
          }
        })
      ])

      const totalDeleted = pendingResult.count + staleResult.count

      if (totalDeleted > 0) {
        console.log(`[CLEANUP] Deleted ${totalDeleted} old temp storage records (Pending: ${pendingResult.count}, Stale 7d: ${staleResult.count})`)
      }

    } catch (error) {
      console.error('[CLEANUP] Failed to cleanup temp storage:', error)
    }
  }

  async cleanupOldConversations(): Promise<void> { return cloudJobs.cleanupOldConversations() }

  async cleanupExpiredMiniAppPayloads(): Promise<void> { return cloudJobs.cleanupExpiredMiniAppPayloads() }

  async cleanupExpiredPublicLinks(): Promise<void> {
    try {
      const { deleteExpiredPublicLinks } = await import('@/lib/work/public-download')
      const n = await deleteExpiredPublicLinks(prisma)
      if (n > 0) console.log(`[CLEANUP] Deleted ${n} expired work download links`)
    } catch (error) {
      console.error('[CLEANUP] work download links:', error instanceof Error ? error.message : 'error')
    }
  }

  async purgeWorkPrivateMessages(): Promise<void> {
    try {
      await prisma.$executeRaw`UPDATE work_message m SET purge_at = (NOW() AT TIME ZONE 'UTC') + INTERVAL '30 days'
        WHERE m.room = 'private' AND m.purge_at IS NULL AND m.owner LIKE 'member:%'
          AND NOT EXISTS (SELECT 1 FROM agent_members a WHERE 'member:' || a.id = m.owner)`
      const r = await prisma.workMessage.deleteMany({ where: { room: 'private', purgeAt: { lt: new Date() } } })
      if (r.count > 0) console.log(`[CLEANUP] Deleted ${r.count} private work messages of removed members`)
    } catch (error) {
      console.error('[CLEANUP] work private messages:', error instanceof Error ? error.message.slice(0, 200) : 'error')
    }
  }

  async purgeSupportReports(): Promise<void> { return cloudJobs.purgeSupportReports() }
  async reportQuizCpaShortfall(): Promise<void> { return cloudJobs.reportQuizCpaShortfall() }

  async cleanupExpiredVisitorContacts(): Promise<void> {
    try {
      const result = await prisma.webVisitorContact.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      })
      if (result.count > 0) {
        console.log(`[CLEANUP] Deleted ${result.count} expired web visitor contacts`)
      }
    } catch (error) {
      console.error('[CLEANUP] Failed to cleanup expired web visitor contacts:', error)
    }
  }

  async processInvoiceAutoRenewal(): Promise<void> { return cloudJobs.processInvoiceAutoRenewal() }

  async processWorkSignals(): Promise<void> {
    try {
      const [{ processWorkSignals }, { ensureUserDataKey }] = await Promise.all([import('@/lib/work/flow-runs'), import('@/lib/user-data-key')])
      const r = await processWorkSignals({ db: prisma, dataKey: ensureUserDataKey })
      if (r.claimed || r.interrupted || r.started.length) console.log(`[CLEANUP] work signals — queued ${r.claimed} · interrupted ${r.interrupted} · started ${r.started.length}`)
    } catch (error) {
      console.error('[CLEANUP] Failed to process work signals:', error instanceof Error ? error.message.slice(0, 200) : 'error')
    }
    try {
      const [{ processWorkPurges }, { deleteProjectBlobs }] = await Promise.all([import('@/lib/work/app-admin'), import('@/lib/managed/blob-storage')])
      const r = await processWorkPurges({ db: prisma, deleteProjectBlobs })
      if (r.done || r.waiting) console.log(`[CLEANUP] work purges — done ${r.done} · waiting ${r.waiting}`)
    } catch (error) {
      console.error('[CLEANUP] Failed to process work purges:', error instanceof Error ? error.message.slice(0, 200) : 'error')
    }
    try {
      const [{ purgeExpiredBackupJobs }, { deleteBackupJobBlobs }] = await Promise.all([import('@/lib/work/backup-parts'), import('@/lib/managed/blob-storage')])
      const n = await purgeExpiredBackupJobs({ db: prisma, deletePrefix: deleteBackupJobBlobs })
      if (n) console.log(`[CLEANUP] work backup jobs expired — ${n}`)
      const { purgeExpiredUploads } = await import('@/lib/work/backup-upload')
      const m = await purgeExpiredUploads({ db: prisma, deletePrefix: deleteBackupJobBlobs })
      if (m) console.log(`[CLEANUP] work backup uploads expired — ${m}`)
      const { purgeExpiredFileUploads } = await import('@/lib/work/file-upload')
      const fu = await purgeExpiredFileUploads({ db: prisma, deletePrefix: deleteBackupJobBlobs })
      if (fu) console.log(`[CLEANUP] work file uploads expired — ${fu}`)
    } catch (error) {
      console.error('[CLEANUP] Failed to purge work backup jobs:', error instanceof Error ? error.message.slice(0, 200) : 'error')
    }
    try {
      const { processScanSorts } = await import('@/lib/work/scan-sort')
      const r = await processScanSorts()
      if (r.closed || r.reclaimed || r.woke || r.started.length) console.log(`[CLEANUP] scan sorts — closed ${r.closed} · reclaimed ${r.reclaimed} · woke ${r.woke} · started ${r.started.length}`)
    } catch (error) {
      console.error('[CLEANUP] Failed to process scan sorts:', error instanceof Error ? error.message.slice(0, 200) : 'error')
    }
    try {
      const { purgeDeletedForms } = await import('@/lib/work/myforms')
      const n = await purgeDeletedForms(prisma)
      if (n) console.log(`[CLEANUP] my forms purged — ${n}`)
    } catch (error) {
      console.error('[CLEANUP] Failed to purge deleted forms:', error instanceof Error ? error.message.slice(0, 200) : 'error')
    }
  }

  async processWorkAlerts(): Promise<void> {
    try {
      const [{ processWorkAlerts }, { ensureUserDataKey }] = await Promise.all([import('@/lib/work/assembled-alerts'), import('@/lib/user-data-key')])
      const r = await processWorkAlerts({ db: prisma, dataKey: ensureUserDataKey })
      if (r.fired || r.cards || r.failed) console.log(`[CLEANUP] work alerts — apps ${r.apps} · fired ${r.fired} · late ${r.late} · cards ${r.cards} · failed ${r.failed}`)
    } catch (error) {
      console.error('[CLEANUP] Failed to process work alerts:', error instanceof Error ? error.message.slice(0, 200) : 'error')
    }
  }

  async markStaleWorkSends(): Promise<void> {
    try {
      const { markStaleSends } = await import('@/lib/work/sends')
      const n = await markStaleSends(prisma)
      if (n > 0) console.log(`[CLEANUP] ${n} work send(s) without an answer marked unknown`)
    } catch (error) {
      console.error('[CLEANUP] Failed to mark stale work sends:', error instanceof Error ? error.message.slice(0, 200) : 'error')
    }
    if (this.workTelegramBusy) return
    this.workTelegramBusy = true
    try {
      const [{ processWorkTelegram }, { ensureUserDataKey }] = await Promise.all([import('@/lib/work/assembled-telegram'), import('@/lib/user-data-key')])
      const r = await processWorkTelegram({ db: prisma, dataKey: ensureUserDataKey })
      if (r.sent || r.stale || r.other) console.log(`[CLEANUP] work telegram — sent ${r.sent} · stale ${r.stale} · other ${r.other}`)
    } catch (error) {
      console.error('[CLEANUP] Failed to send work telegram alerts:', error instanceof Error ? error.message.slice(0, 200) : 'error')
    } finally {
      this.workTelegramBusy = false
    }
  }


  async processManagedCpaReset(): Promise<void> { return cloudJobs.processManagedCpaReset() }

  async processExpiredSubscriptionGraceStart(): Promise<void> { return cloudJobs.processExpiredSubscriptionGraceStart() }

  async processGracePeriodExpiration(): Promise<void> { return cloudJobs.processGracePeriodExpiration() }

  async processHardFreeConversion(): Promise<void> { return cloudJobs.processHardFreeConversion() }

  async processTrialExpiry(): Promise<void> { return cloudJobs.processTrialExpiry() }
  async reconcileStoreSubscriptions(): Promise<void> { return cloudJobs.reconcileStoreSubscriptions() }
  async retryStoreAcknowledgements(): Promise<void> { return cloudJobs.retryStoreAcknowledgements() }
  async retryOldContractCuts(): Promise<void> { return cloudJobs.retryOldContractCuts() }

  async processConsentLedgerExport(): Promise<void> { return cloudJobs.processConsentLedgerExport() }

  async processBoosterExpiry(): Promise<void> { return cloudJobs.processBoosterExpiry() }

  async processBoosterExpiryAlerts(): Promise<void> { return cloudJobs.processBoosterExpiryAlerts() }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'

    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    const size = (bytes / Math.pow(1024, i)).toFixed(1)

    return `${size} ${sizes[i]}`
  }
}

export const autoRun = AutoRun.getInstance()

autoRun.startCleanup()
