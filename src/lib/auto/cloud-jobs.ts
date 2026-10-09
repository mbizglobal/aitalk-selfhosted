const unavailable = (job: string) => async (): Promise<void> => {
  throw new Error(`[AutoRun] ${job} is a cloud-only job and is not part of this installation`)
}

export const cloudJobs = {
  cleanupStaleCallSessions: unavailable('cleanupStaleCallSessions'),
  cleanupStaleWebVoiceSessions: unavailable('cleanupStaleWebVoiceSessions'),
  sweepVoiceQuizRounds: unavailable('sweepVoiceQuizRounds'),
  processConsentLedgerExport: unavailable('processConsentLedgerExport'),
  reportQuizCpaShortfall: unavailable('reportQuizCpaShortfall'),
  cleanupExpiredMiniAppPayloads: unavailable('cleanupExpiredMiniAppPayloads'),
  sweepAiCallCpaReservations: unavailable('sweepAiCallCpaReservations'),
  cleanupOldCPALogs: unavailable('cleanupOldCPALogs'),
  monthlyResetCPA: unavailable('monthlyResetCPA'),
  processManagedCpaReset: unavailable('processManagedCpaReset'),
  sweepTeamSeats: unavailable('sweepTeamSeats'),
  cleanupOldConversations: unavailable('cleanupOldConversations'),
  processInvoicePlanChanges: unavailable('processInvoicePlanChanges'),
  processCancelledInvoiceSubscriptions: unavailable('processCancelledInvoiceSubscriptions'),
  processInvoiceAutoRenewal: unavailable('processInvoiceAutoRenewal'),
  processExpiredSubscriptionGraceStart: unavailable('processExpiredSubscriptionGraceStart'),
  processGracePeriodExpiration: unavailable('processGracePeriodExpiration'),
  processHardFreeConversion: unavailable('processHardFreeConversion'),
  processBoosterExpiry: unavailable('processBoosterExpiry'),
  processBoosterExpiryAlerts: unavailable('processBoosterExpiryAlerts'),
  processTrialExpiry: unavailable('processTrialExpiry'),
  reconcileStoreSubscriptions: unavailable('reconcileStoreSubscriptions'),
  retryStoreAcknowledgements: unavailable('retryStoreAcknowledgements'),
  retryOldContractCuts: unavailable('retryOldContractCuts'),
}
