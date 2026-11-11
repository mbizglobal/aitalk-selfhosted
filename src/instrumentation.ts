
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
    void (async () => {
      try {
        const [{ prisma }, { migrateLegacyWorkApps }, { generateWorkflowId }] = await Promise.all([import('@/lib/prisma'), import('@/lib/work/app-canvas-migrate'), import('@/lib/workflow/service')])
        const r = await migrateLegacyWorkApps(prisma, generateWorkflowId)
        if (r.migrated.length || r.failed.length) {
          console.log(`[INSTRUMENTATION] Work apps moved to canvases: ${r.migrated.length}${r.failed.length ? ` · failed ${r.failed.length} (${r.failed.map((f) => f.workflowId).join(', ')})` : ''}`)
        }
        const cloned = r.migrated.filter((m) => m.cloned?.length)
        if (cloned.length) console.log(`[INSTRUMENTATION] Work app connections copied (Vault accounts must enter the secret again): ${cloned.map((m) => `${m.workflowId}:${m.cloned!.join('+')}`).join(', ')}`)
      } catch (e) {
        console.error('[INSTRUMENTATION] Work app move failed:', e instanceof Error ? e.message.slice(0, 200) : 'error')
      }
    })()

    const { startScheduler } = await import('@/lib/schedule')
    startScheduler()
    console.log('[INSTRUMENTATION] Scheduler started')

    const { autoRun } = await import('@/lib/auto/cleanup')
    autoRun.startCleanup()
    console.log('[INSTRUMENTATION] AutoRun started')
  }
}
