'use client'

import { useEdition } from '@/components/EditionProvider'
import { useLanguage } from '@/hooks/useLanguage'
import { AITALK_SITE_URL, AITALK_SUPPORT_EMAIL, SELFHOSTED_REPO_URL, SELFHOSTED_VERSION } from '@/lib/selfhosted-brand'

export function SelfHostedFooter({ layout = 'row', className = '' }: { layout?: 'row' | 'stack'; className?: string }) {
  const edition = useEdition()
  const { t } = useLanguage()
  if (edition !== 'selfhosted') return null

  const link = 'underline-offset-2 hover:underline hover:text-foreground'
  const items = [
    <span key="v">AI Talk Self-hosted {SELFHOSTED_VERSION}</span>,
    <a key="site" className={link} href={AITALK_SITE_URL} target="_blank" rel="noopener noreferrer">aitalk.ch</a>,
    <a key="repo" className={link} href={SELFHOSTED_REPO_URL} target="_blank" rel="noopener noreferrer">{t('selfhosted_footer_updates')}</a>,
    <a key="mail" className={link} href={`mailto:${AITALK_SUPPORT_EMAIL}`}>{AITALK_SUPPORT_EMAIL}</a>,
  ]

  return (
    <footer className={`text-xs text-muted-foreground ${className}`}>
      {layout === 'row' ? (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          {items.flatMap((item, i) => (i ? [<span key={`d${i}`} aria-hidden="true">·</span>, item] : [item]))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">{items}</div>
      )}
    </footer>
  )
}
