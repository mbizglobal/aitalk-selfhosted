'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, KeyRound, Loader2, PowerOff, Radio, XCircle } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import type { DeployRequestDerivedState } from '@/lib/workflow/service'
import type { DeploySummary } from '@/lib/workflow/deploy-summary'

interface Props {
  requestId: string
  notFound?: boolean
  derivedState?: DeployRequestDerivedState
  workflow?: { name: string; workflowId: string; agentId: string }
  expiresAt?: string
  approvedAt?: string | null
  summary?: DeploySummary
}

const KNOWN_TRIGGERS = new Set(['chatWidget', 'schedule', 'pstn', 'telegram'])

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  )
}

function StatusCard({
  icon,
  tone,
  title,
  message,
  action,
}: {
  icon: React.ReactNode
  tone: 'ok' | 'warn' | 'error'
  title: string
  message: string
  action?: React.ReactNode
}) {
  const toneClass =
    tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-red-600'
  return (
    <div className="rounded-xl border bg-background p-8 shadow-sm text-center">
      <div className={`mx-auto mb-4 ${toneClass}`}>{icon}</div>
      <h1 className="text-lg font-semibold mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground whitespace-pre-line">{message}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function DeployConfirmClient(props: Props) {
  const router = useRouter()
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'deployed' | 'canceled' | null>(null)

  const dashboardBtn = (
    <button
      onClick={() => router.push('/app/workflows')}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
    >
      {t('deploy_confirm_go_workflows')}
    </button>
  )

  if (props.notFound) {
    return (
      <Shell>
        <StatusCard
          icon={<XCircle className="h-10 w-10" />}
          tone="error"
          title={t('deploy_confirm_notfound_title')}
          message={t('deploy_confirm_notfound_msg')}
        />
      </Shell>
    )
  }

  if (done === 'deployed' || props.derivedState === 'deployed') {
    const named = props.workflow
      ? t('deploy_confirm_deployed_msg_named').replace('{name}', props.workflow.name)
      : t('deploy_confirm_deployed_msg_generic')
    const when = props.approvedAt ? new Date(props.approvedAt).toLocaleString() : null
    const approvedLine = when
      ? '\n' + t('deploy_confirm_approved_at').replace('{when}', when)
      : ''
    return (
      <Shell>
        <StatusCard
          icon={<CheckCircle2 className="h-10 w-10" />}
          tone="ok"
          title={t('deploy_confirm_deployed_title')}
          message={named + approvedLine}
          action={dashboardBtn}
        />
      </Shell>
    )
  }

  if (props.derivedState === 'off') {
    const named = props.workflow
      ? t('deploy_confirm_off_msg_named').replace('{name}', props.workflow.name)
      : t('deploy_confirm_off_msg_generic')
    return (
      <Shell>
        <StatusCard
          icon={<PowerOff className="h-10 w-10" />}
          tone="warn"
          title={t('deploy_confirm_off_title')}
          message={named}
          action={dashboardBtn}
        />
      </Shell>
    )
  }

  if (done === 'canceled' || props.derivedState === 'canceled') {
    return (
      <Shell>
        <StatusCard
          icon={<XCircle className="h-10 w-10" />}
          tone="warn"
          title={t('deploy_confirm_canceled_title')}
          message={t('deploy_confirm_canceled_msg')}
          action={dashboardBtn}
        />
      </Shell>
    )
  }

  if (props.derivedState === 'expired') {
    return (
      <Shell>
        <StatusCard
          icon={<Clock className="h-10 w-10" />}
          tone="warn"
          title={t('deploy_confirm_expired_title')}
          message={t('deploy_confirm_expired_msg')}
          action={dashboardBtn}
        />
      </Shell>
    )
  }

  if (props.derivedState === 'wrong_status') {
    return (
      <Shell>
        <StatusCard
          icon={<AlertTriangle className="h-10 w-10" />}
          tone="warn"
          title={t('deploy_confirm_wrongstatus_title')}
          message={t('deploy_confirm_wrongstatus_msg')}
          action={dashboardBtn}
        />
      </Shell>
    )
  }

  const isStale = props.derivedState === 'stale'

  const approve = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workflows/deploy-requests/${props.requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setDone('deployed')
      } else {
        setError(data.error || t('deploy_confirm_err_deploy'))
      }
    } catch {
      setError(t('deploy_confirm_err_network'))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workflows/deploy-requests/${props.requestId}`, { method: 'DELETE' })
      if (res.ok) setDone('canceled')
      else setError(t('deploy_confirm_err_cancel'))
    } catch {
      setError(t('deploy_confirm_err_network'))
    } finally {
      setBusy(false)
    }
  }

  const summary = props.summary
  const expiresLabel = props.expiresAt ? new Date(props.expiresAt).toLocaleString() : null

  const egressTarget = (e: NonNullable<DeploySummary['egress']>[number]): string => {
    if (e.target) return e.target
    if (e.kindKey === 'aiTool' && e.toolKey) {
      return `${t('deploy_confirm_tool_' + e.toolKey)} — ${t('deploy_confirm_tool_runtime_suffix')}`
    }
    if (e.kindKey === 'mcpNode') return t('deploy_confirm_mcpnode_target')
    return ''
  }

  return (
    <Shell>
      <div className="rounded-xl border bg-background shadow-sm overflow-hidden">
        <div className="border-b px-6 py-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('deploy_confirm_eyebrow')}</p>
          <h1 className="mt-1 text-xl font-semibold">{props.workflow?.name ?? t('deploy_confirm_workflow_fallback')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('deploy_confirm_subtitle')}</p>
        </div>

        {isStale && (
          <div className="flex items-start gap-2 border-b bg-amber-50 px-6 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('deploy_confirm_stale_banner')}</span>
          </div>
        )}

        <div className="space-y-6 px-6 py-5">
          {summary?.parseError && (
            <p className="text-sm text-muted-foreground">{t('deploy_confirm_parse_error')}</p>
          )}

          <Section icon={<Radio className="h-4 w-4" />} title={t('deploy_confirm_section_triggers')} empty={!summary?.triggers.length} emptyText={t('deploy_confirm_triggers_empty')}>
            {summary?.triggers.map((tr, i) => (
              <Row key={i} main={KNOWN_TRIGGERS.has(tr.type) ? t('deploy_confirm_trigger_' + tr.type) : tr.type} sub={tr.detail} />
            ))}
          </Section>

          <Section
            icon={<ArrowUpRight className="h-4 w-4" />}
            title={t('deploy_confirm_section_egress')}
            highlight
            empty={!summary?.egress.length}
            emptyText={t('deploy_confirm_egress_empty')}
          >
            {summary?.egress.map((e, i) => (
              <Row key={i} main={egressTarget(e)} sub={`${t('deploy_confirm_kind_' + e.kindKey)} · ${e.node}`} mono />
            ))}
          </Section>

          <Section icon={<KeyRound className="h-4 w-4" />} title={t('deploy_confirm_section_connections')} empty={!summary?.connections.length} emptyText={t('deploy_confirm_connections_empty')}>
            {summary?.connections.map((c, i) => (
              <Row key={i} main={c.connectionId} sub={`${c.ref} · ${c.node}`} mono />
            ))}
          </Section>
        </div>

        {error && (
          <div className="mx-6 mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <span className="text-xs text-muted-foreground">
            {expiresLabel ? `${t('deploy_confirm_expires')} ${expiresLabel}` : null}
          </span>
          <div className="flex gap-2">
            <button
              onClick={cancel}
              disabled={busy}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {t('deploy_confirm_cancel')}
            </button>
            <button
              onClick={approve}
              disabled={busy || isStale}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('deploy_confirm_deploy')}
            </button>
          </div>
        </div>
      </div>
    </Shell>
  )
}

function Section({
  icon,
  title,
  highlight,
  empty,
  emptyText,
  children,
}: {
  icon: React.ReactNode
  title: string
  highlight?: boolean
  empty?: boolean
  emptyText: string
  children?: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
        <span className={highlight ? 'text-amber-600' : 'text-muted-foreground'}>{icon}</span>
        {title}
      </div>
      {empty ? (
        <p className="pl-6 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className={`space-y-1.5 rounded-lg border p-3 ${highlight ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20' : ''}`}>
          {children}
        </div>
      )}
    </div>
  )
}

function Row({ main, sub, mono }: { main: string; sub?: string; mono?: boolean }) {
  return (
    <div className="text-sm">
      <div className={mono ? 'break-all font-mono text-[13px]' : 'font-medium'}>{main}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}
