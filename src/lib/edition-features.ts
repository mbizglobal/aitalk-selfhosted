import { getEdition, type Edition } from '@/lib/edition'

export interface EditionFeature {
  name: string
  verdict: 'cloud_only' | 'off_first_release'
  jobs: readonly string[]
  routes?: readonly string[]
  nodeKinds?: readonly string[]
  triggers?: readonly string[]
  toolTypes?: readonly string[]
  miniApps?: readonly string[]
  knowledgeSources?: readonly string[]
}

export const SELFHOSTED_OFF_FEATURES: readonly EditionFeature[] = [
  {
    name: 'Voice and phone calls',
    verdict: 'cloud_only',
    jobs: ['cleanupStaleCallSessions', 'cleanupStaleWebVoiceSessions'],
    routes: [
      '/voice',
      '/demo',
      '/api/voice-widget',
      '/api/webhooks/acs',
      '/api/webhooks/clawops',
      '/api/public/voice-demo',
      '/api/dev',
      '/api/agent-studio/acs-provision',
      '/api/agents/*/acs-connection',
      '/api/agents/*/clawops-connection',
      '/api/agents/*/clawops-numbers',
      '/api/agents/*/phone-numbers',
      '/api/agents/*/pstn-outbound-budget',
    ],
    nodeKinds: ['pstn'],
    triggers: ['pstn'],
  },
  {
    name: 'SMS',
    verdict: 'cloud_only',
    jobs: [],
    routes: ['/api/agent-studio/sms'],
    nodeKinds: ['sms', 'sms_acs', 'sms_infobip'],
    toolTypes: ['sms'],
  },
  {
    name: 'Voice quiz',
    verdict: 'cloud_only',
    jobs: ['sweepVoiceQuizRounds', 'processConsentLedgerExport', 'reportQuizCpaShortfall'],
    routes: ['/app/voice-quiz', '/api/voice-quiz', '/api/dashboard/voice-quiz'],
    miniApps: ['voice_quiz'],
  },
  {
    name: 'Mini apps',
    verdict: 'cloud_only',
    jobs: ['cleanupExpiredMiniAppPayloads'],
    routes: ['/api/miniapp'],
    miniApps: ['quiz'],
  },
  { name: 'Mobile app API', verdict: 'cloud_only', jobs: [], routes: ['/api/app-api'] },
  {
    name: 'CPA',
    verdict: 'cloud_only',
    jobs: ['sweepAiCallCpaReservations', 'cleanupOldCPALogs', 'monthlyResetCPA', 'processManagedCpaReset'],
  },
  {
    name: 'Subscription and billing',
    verdict: 'cloud_only',
    jobs: [
      'sweepTeamSeats',
      'cleanupOldConversations',
      'processInvoicePlanChanges',
      'processCancelledInvoiceSubscriptions',
      'processInvoiceAutoRenewal',
      'processExpiredSubscriptionGraceStart',
      'processGracePeriodExpiration',
      'processHardFreeConversion',
    ],
    routes: [
      '/app/subscription',
      '/app/invoices',
      '/api/subscription',
      '/api/invoices',
      '/api/billing-info',
      '/api/currency',
      '/api/exchange-rate',
      '/api/partner',
    ],
  },
  { name: 'Booster', verdict: 'cloud_only', jobs: ['processBoosterExpiry', 'processBoosterExpiryAlerts'] },
  {
    name: 'Trial',
    verdict: 'cloud_only',
    jobs: ['processTrialExpiry'],
    routes: ['/contact-trial', '/api/trial-lead', '/api/auth/apply-partner-code'],
  },
  { name: 'Operator admin', verdict: 'cloud_only', jobs: [], routes: ['/console', '/api/console', '/admin', '/api/admin'] },
  {
    name: 'Marketing site',
    verdict: 'cloud_only',
    jobs: [],
    routes: [
      '/en', '/de', '/de-ch', '/fr', '/ko', '/es', '/ja', '/it', '/home',
      '/law', '/pricing', '/mbizglobal', '/aboutus',
      '/blog', '/api/blog', '/sitemap.xml', '/test',
    ],
  },
  { name: 'Playground', verdict: 'cloud_only', jobs: [], routes: ['/app/playground'] },
  { name: 'Legacy RAG providers', verdict: 'cloud_only', jobs: [], routes: ['/api/storage/gemini-files', '/api/storage/rag-provider'] },

  {
    name: 'Calendar and bookings',
    verdict: 'off_first_release',
    jobs: [],
    routes: [
      '/app/bookings',
      '/book',
      '/booking.min.js',
      '/api/booking',
      '/api/agent-studio/google-calendar',
      '/api/agent-studio/microsoft-calendar',
      '/api/agent-studio/holidays',
      '/api/dashboard/calendar',
      '/api/dashboard/calendar-workflows',
      '/api/dashboard/bookings-stats',
    ],
    toolTypes: ['google_calendar', 'microsoft_calendar'],
  },
  { name: 'Website crawl', verdict: 'off_first_release', jobs: [], routes: ['/api/storage/crawl'], knowledgeSources: ['website'] },
  { name: 'Google Drive', verdict: 'off_first_release', jobs: [], routes: ['/api/storage/google-drive'], knowledgeSources: ['google_drive'] },
  { name: 'SharePoint', verdict: 'off_first_release', jobs: [], routes: ['/api/storage/sharepoint'], knowledgeSources: ['sharepoint'] },
  { name: 'GitBook', verdict: 'off_first_release', jobs: [], routes: ['/api/integrations/gitbook'], knowledgeSources: ['gitbook'] },
  { name: 'Dashboard AI helper', verdict: 'off_first_release', jobs: [], routes: ['/api/agent-studio/codex'] },
  { name: 'Welcome message translation', verdict: 'off_first_release', jobs: [], routes: ['/api/translate-welcome-message'] },
]

export const SHARED_JOBS: readonly string[] = [
  'cleanupOldTempFiles',
  'cleanupOldTempStorage',
  'processScheduledAnonymizations',
  'cleanupExpiredVisitorContacts',
]

export function enabledJobs(edition: Edition = getEdition()): ReadonlySet<string> {
  if (edition === 'selfhosted') return new Set(SHARED_JOBS)
  return new Set([...SHARED_JOBS, ...SELFHOSTED_OFF_FEATURES.flatMap((f) => f.jobs)])
}

export function normalizeRoutePath(pathname: string): string {
  let p = pathname
  for (let i = 0; i < 3 && p.includes('%'); i++) {
    try {
      const next = decodeURIComponent(p)
      if (next === p) break
      p = next
    } catch {
      break
    }
  }
  p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase()
  if (!p.startsWith('/')) p = '/' + p
  if (p.length > 1) p = p.replace(/\/+$/, '') || '/'
  return p
}

function decodeRepeated(v: string): string {
  let p = v
  for (let i = 0; i < 3 && p.includes('%'); i++) {
    try {
      const next = decodeURIComponent(p)
      if (next === p) break
      p = next
    } catch {
      break
    }
  }
  return p
}

function rawSegments(pathname: string): string[] {
  const segs = pathname.split('/').filter((seg, i) => i === 0 || seg !== '').map((seg) => decodeRepeated(seg).toLowerCase())
  return segs[0] === '' ? segs : ['', ...segs]
}

function wildcardMatches(got: readonly string[], want: readonly string[]): boolean {
  const match = (i: number, j: number): boolean => {
    if (i === want.length) return true
    if (want[i] !== '*') return j < got.length && got[j] === want[i] && match(i + 1, j + 1)
    for (let k = j + 1; k <= got.length; k++) if (got[k - 1] !== '' && match(i + 1, k)) return true
    return false
  }
  return match(0, 0)
}

function routeMatches(path: string, raw: readonly string[], prefix: string): boolean {
  if (!prefix.includes('*')) return path === prefix || path.startsWith(prefix + '/')
  const want = prefix.split('/')
  return wildcardMatches(path.split('/'), want) || wildcardMatches(raw, want)
}

export function offFeatureForRoute(pathname: string, edition: Edition = getEdition()): EditionFeature | null {
  if (edition !== 'selfhosted') return null
  const path = normalizeRoutePath(pathname)
  const raw = rawSegments(pathname)
  return SELFHOSTED_OFF_FEATURES.find((f) => f.routes?.some((r) => routeMatches(path, raw, r))) ?? null
}

type PartKey = 'nodeKinds' | 'triggers' | 'toolTypes' | 'miniApps' | 'knowledgeSources'

export function offFeatureFor(key: PartKey, value: unknown, edition: Edition = getEdition()): EditionFeature | null {
  if (edition !== 'selfhosted' || typeof value !== 'string' || !value) return null
  return SELFHOSTED_OFF_FEATURES.find((f) => f[key]?.includes(value)) ?? null
}
