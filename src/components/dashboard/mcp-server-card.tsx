'use client'

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/hooks/useLanguage'
import { Plug, KeyRound, Clock, Globe } from 'lucide-react'
import { countryFlagEmoji, countryName } from '@/lib/country-display'

export interface McpSummary {
  token_count: number
  last_used_at: string | null
  last_used_ip: string | null
  last_used_country: string | null
  last_used_token_name: string | null
}

interface McpServerCardProps {
  mcp: McpSummary | null | undefined
  formatDateTime: (value: string) => string
}

export function McpServerCard({ mcp, formatDateTime }: McpServerCardProps) {
  const { t, currentLanguage } = useLanguage()

  if (!mcp) return null

  const connected = mcp.token_count > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              {t('dashboard_mcp_label')}
            </CardTitle>
            <CardDescription>{t('dashboard_mcp_card_subtitle')}</CardDescription>
          </div>
          <Button asChild variant={connected ? 'outline' : 'default'} size="sm" className="shrink-0">
            <Link href="/app/settings?tab=mcp">
              {connected ? t('dashboard_mcp_manage') : t('dashboard_mcp_setup_link')}
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!connected ? (
          <p className="text-sm text-muted-foreground">{t('dashboard_mcp_empty_body')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile
              icon={<KeyRound className="h-4 w-4" />}
              label={t('dashboard_mcp_stat_tokens')}
              value={<span className="text-2xl font-semibold tabular-nums">{mcp.token_count}</span>}
            />
            <Tile
              icon={<Clock className="h-4 w-4" />}
              label={t('dashboard_mcp_last_access')}
              value={
                mcp.last_used_at ? (
                  <span className="text-base font-medium">{formatDateTime(mcp.last_used_at)}</span>
                ) : (
                  <span className="text-base font-medium text-muted-foreground">{t('dashboard_mcp_never_used')}</span>
                )
              }
              hint={mcp.last_used_at ? mcp.last_used_token_name ?? undefined : undefined}
            />
            <Tile
              icon={<Globe className="h-4 w-4" />}
              label={t('dashboard_mcp_stat_origin')}
              value={
                mcp.last_used_ip ? (
                  <span className="text-base font-medium">
                    {mcp.last_used_country && (
                      <>
                        {countryFlagEmoji(mcp.last_used_country)}{' '}
                        {countryName(mcp.last_used_country, currentLanguage)}
                      </>
                    )}
                  </span>
                ) : (
                  <span className="text-base font-medium text-muted-foreground">
                    {t('dashboard_mcp_origin_pending')}
                  </span>
                )
              }
              hint={mcp.last_used_ip ?? undefined}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Tile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="break-words">{value}</div>
      {hint && <div className="mt-1 font-mono text-xs text-muted-foreground break-all">{hint}</div>}
    </div>
  )
}
