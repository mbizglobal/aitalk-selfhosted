
import { emailServiceV2 } from '@/lib/email-v2'
import { BCP47, WIDGET_TEXT, type WidgetLang } from './i18n'

export function formatWhen(iso: string, timezone: string, lang: WidgetLang): string {
  try {
    return new Intl.DateTimeFormat(BCP47[lang], {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export async function sendBookingConfirmation(p: {
  to: string
  lang: WidgetLang
  title: string
  name: string
  startIso: string
  timezone: string
  partySize: number | null
  tableName: string | null
  message: string
  contactPhone: string | null
}): Promise<boolean> {
  const t = WIDGET_TEXT[p.lang]
  const lines: Array<{ label: string; value: string }> = [
    { label: `${t.date} / ${t.time}`, value: formatWhen(p.startIso, p.timezone, p.lang) },
  ]
  if (p.partySize) lines.push({ label: t.guestsLabel, value: t.guests(p.partySize) })
  if (p.tableName) lines.push({ label: t.emailTable, value: p.tableName })
  if (p.message) lines.push({ label: t.emailMessage, value: p.message })
  const r = await emailServiceV2.sendBookingWidgetEmail({
    to: p.to,
    subject: t.emailSubject(p.title),
    heading: t.doneTitle,
    paragraphs: [t.emailHello(p.name), t.emailIntro(p.title)],
    lines,
    footer: `${p.contactPhone ? t.contactToChangePhone(p.contactPhone) : t.contactToChange} — ${t.poweredBy}`,
  })
  return r.success
}

export async function sendBookingConfirmLink(p: {
  to: string
  lang: WidgetLang
  title: string
  name: string
  startIso: string
  timezone: string
  partySize: number | null
  link: string
  minutes: number
}): Promise<boolean> {
  const t = WIDGET_TEXT[p.lang]
  if (!/^https?:\/\/[A-Za-z0-9.:-]+\/book\/[A-Za-z0-9_-]+\/confirm\?t=[A-Za-z0-9_-]+&lang=[a-z]{2}$/.test(p.link)) return false
  const lines: Array<{ label: string; value: string }> = [
    { label: `${t.date} / ${t.time}`, value: formatWhen(p.startIso, p.timezone, p.lang) },
  ]
  if (p.partySize) lines.push({ label: t.guestsLabel, value: t.guests(p.partySize) })
  const r = await emailServiceV2.sendBookingWidgetEmail({
    to: p.to,
    subject: t.confirmEmailSubject(p.title),
    heading: t.confirmEmailHeading,
    paragraphs: [t.emailHello(p.name), t.confirmEmailIntro(p.title, p.minutes)],
    lines,
    bodyHtml: `<a href="${p.link}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${t.confirmEmailButton}</a>`,
    footer: `${t.confirmEmailIgnore} — ${t.poweredBy}`,
  })
  return r.success
}
