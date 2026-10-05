'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { KeyRound } from 'lucide-react'

export interface LicenseInfo {
  status: 'none' | 'invalid' | 'active' | 'grace' | 'expired'
  reason?: string
  licensee?: string
  licenseId?: string
  expiresAt?: string
  graceEndsAt?: string | null
  features?: string[]
  clientCompanies?: number | null
}

interface Props { t: (key: string) => string; info: LicenseInfo }

const BADGE: Record<LicenseInfo['status'], string> = {
  none: 'bg-muted text-muted-foreground',
  invalid: 'bg-red-500/10 text-red-600 dark:text-red-400',
  expired: 'bg-red-500/10 text-red-600 dark:text-red-400',
  grace: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
}

export function LicenseSection({ t, info }: Props) {
  const row = (label: string, value: string) => (
    <div className="flex flex-col sm:flex-row sm:gap-4 py-1.5 text-sm">
      <span className="sm:w-48 text-muted-foreground">{label}</span>
      <span className="font-medium break-all">{value}</span>
    </div>
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {t('lic_title')}
          <Badge className={BADGE[info.status]}>{t(`lic_status_${info.status}`)}</Badge>
        </CardTitle>
        <CardDescription>{t('lic_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {info.status === 'grace' && info.graceEndsAt && (
          <p className="text-sm text-amber-700 dark:text-amber-400">{t('lic_grace_notice').replace('{date}', info.graceEndsAt)}</p>
        )}
        {info.status === 'invalid' && (
          <p className="text-sm text-red-600 dark:text-red-400">{t('lic_invalid_notice')} ({info.reason})</p>
        )}
        {info.licensee && (
          <div className="divide-y">
            {row(t('lic_licensee'), info.licensee)}
            {info.licenseId && row(t('lic_license_id'), info.licenseId)}
            {info.expiresAt && row(t('lic_expires'), info.expiresAt)}
            {row(t('lic_features'), info.features?.length ? info.features.join(', ') : '—')}
            {info.clientCompanies != null && row(t('lic_client_companies'), String(info.clientCompanies))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t('lic_how_to')}</p>
      </CardContent>
    </Card>
  )
}
