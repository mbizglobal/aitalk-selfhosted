
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getAppBaseUrl } = await import('@/lib/app-url')
    getAppBaseUrl()
    const { isSelfHosted } = await import('@/lib/edition')
    if (isSelfHosted()) {
      const { selfHostedPreflight, formatPreflight } = await import('@/lib/selfhosted-preflight')
      const problems = await selfHostedPreflight()
      if (problems.length) throw new Error(formatPreflight(problems))
      const { warnIfPgvectorMissing } = await import('@/lib/knowledge/pgvector-status')
      void warnIfPgvectorMissing()
    }
    const { getLicenseState, describeLicenseState } = await import('@/lib/license')
    const license = getLicenseState()
    if (license.status !== 'none') console.log(describeLicenseState(license))
    if (process.env.AITALK_BACKGROUND_JOBS === 'off') {
      console.log('[INSTRUMENTATION] Background jobs off (AITALK_BACKGROUND_JOBS=off)')
      return
    }
    const { startScheduler } = await import('@/lib/schedule')
    startScheduler()
    console.log('[INSTRUMENTATION] Scheduler started')

    const { autoRun } = await import('@/lib/auto/cleanup')
    autoRun.startCleanup()
    console.log('[INSTRUMENTATION] AutoRun started')
  }
}
